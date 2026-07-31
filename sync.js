// ---------- Sync engine ----------
const Sync = {
  status: 'offline', // 'synced' | 'syncing' | 'offline' | 'pending'
  listeners: [],
  _syncInProgress: false,

  onStatusChange(fn) {
    this.listeners.push(fn);
  },
  setStatus(s) {
    this.status = s;
    this.listeners.forEach((fn) => fn(s));
  },

  async getUrl() {
    const meta = await DB.get('settings', 'meta');
    return meta ? meta.sheetUrl : '';
  },

  async pushEntry(sheetName, entry) {
    const url = await this.getUrl();
    if (!url || !navigator.onLine) {
      this.setStatus('pending');
      return false;
    }
    this.setStatus('syncing');
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ sheet: sheetName, entry })
      });
      entry.synced = true;
      this.setStatus('synced');
      return true;
    } catch (err) {
      this.setStatus('pending');
      return false;
    }
  },

  async forceFullResync() {
    // Resets every record's sync flag so a subsequent retryAllPending() re-pushes everything
    // from scratch. Use this after manually clearing the Sheet, so the Sheet ends up with
    // exactly one clean copy of each record instead of relying on deduping a messy history.
    const stores = ['entries', 'jazzIssues', 'weightEntries', 'vehicles', 'garageCosts'];
    for (const s of stores) {
      try {
        const items = await DB.getAll(s);
        for (const item of items) {
          item.synced = false;
          await DB.put(s, item);
        }
      } catch (err) {
        console.warn(`Force resync: skipped store "${s}":`, err.message);
      }
    }
    this.retryAllPending();
  },

  async retryAllPending() {
    if (this._syncInProgress) return; // a sync is already running the queue — don't start a second overlapping pass
    this._syncInProgress = true;
    try {
      const jobs = [
        { store: 'entries', sheet: 'Finance', strip: [] },
        { store: 'jazzIssues', sheet: 'Jazz', strip: ['photos'] },
        { store: 'weightEntries', sheet: 'Weight', strip: [] },
        { store: 'vehicles', sheet: 'Vehicles', strip: ['photos', 'ownershipDoc'] },
        { store: 'garageCosts', sheet: 'GarageCosts', strip: ['photos'] }
      ];
      for (const job of jobs) {
        try {
          const items = await DB.getAll(job.store);
          const pending = items.filter((i) => !i.synced);
          for (const item of pending) {
            const payload = { ...item };
            job.strip.forEach((k) => delete payload[k]);
            const ok = await this.pushEntry(job.sheet, payload);
            if (ok) { item.synced = true; await DB.put(job.store, item); }
          }
        } catch (err) {
          console.warn(`Sync skipped store "${job.store}" (not present in local DB yet):`, err.message);
        }
      }
    } finally {
      this._syncInProgress = false;
    }
    await this.refreshStatus();
  },

  async refreshStatus() {
    const url = await this.getUrl();
    if (!url) { this.setStatus('offline'); return; }
    const stores = ['entries', 'jazzIssues', 'weightEntries', 'vehicles', 'garageCosts'];
    let pendingCount = 0;
    for (const s of stores) {
      try {
        const items = await DB.getAll(s);
        pendingCount += items.filter((i) => !i.synced).length;
      } catch (err) {
        console.warn(`Sync status check skipped store "${s}" (not present in local DB yet):`, err.message);
      }
    }
    if (!navigator.onLine) this.setStatus('pending');
    else if (pendingCount > 0) this.setStatus('pending');
    else this.setStatus('synced');
  },

  startPolling() {
    window.addEventListener('online', () => this.retryAllPending());
    window.addEventListener('offline', () => this.setStatus('pending'));
    setInterval(() => this.retryAllPending(), 25000);
  }
};
