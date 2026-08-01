// ---------- Sync engine ----------
// SYNC_JOBS is the single source of truth for what syncs where. `strip` fields never
// get pushed (they're local-only, e.g. base64 photos — too big for Sheet cells). The same
// list is used in reverse on pull: if a pulled record would otherwise wipe out a local-only
// field (like a photo that was never synced), the local value is kept instead.
const SYNC_JOBS = [
  { store: 'entries', sheet: 'Finance', strip: [] },
  { store: 'categories', sheet: 'Categories', strip: [] },
  { store: 'payees', sheet: 'Stores', strip: ['logo'] },
  { store: 'jazzIssues', sheet: 'Jazz', strip: ['photos'] },
  { store: 'weightEntries', sheet: 'Weight', strip: [] },
  { store: 'vehicles', sheet: 'Vehicles', strip: ['photos', 'ownershipDoc'] },
  { store: 'garageCosts', sheet: 'GarageCosts', strip: ['photos'] },
  { store: 'cars', sheet: 'Cars', strip: [] },
  { store: 'projects', sheet: 'Projects', strip: [] },
  { store: 'expenseTypes', sheet: 'ExpenseTypes', strip: [] },
  { store: 'repairTypes', sheet: 'RepairTypes', strip: [] },
  { store: 'issueTypes', sheet: 'IssueTypes', strip: [] },
  { store: 'vetClinics', sheet: 'VetClinics', strip: [] },
  { store: 'garagePlaces', sheet: 'Places', strip: [] },
  { store: 'recurring', sheet: 'Recurring', strip: [] }
];

const Sync = {
  status: 'offline', // 'synced' | 'syncing' | 'offline' | 'pending'
  listeners: [],
  _syncInProgress: false,
  _pullInProgress: false,

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

  // Pulls the current state of every sheet down and merges it into local storage.
  // Two safety rules: (1) never overwrite a local record that has unpushed changes
  // of its own (synced: false) — that would silently discard something you just did;
  // (2) never let a pulled record wipe out a local-only field (photos, logos) that
  // was deliberately never sent to the Sheet in the first place.
  async pullAll() {
    if (this._pullInProgress) return;
    const url = await this.getUrl();
    if (!url || !navigator.onLine) return;
    this._pullInProgress = true;
    try {
      const res = await fetch(url, { method: 'GET' });
      const data = await res.json();
      for (const job of SYNC_JOBS) {
        const rows = data[job.sheet] || [];
        for (const rawJson of rows) {
          let remote;
          try { remote = JSON.parse(rawJson); } catch (e) { continue; }
          if (!remote || !remote.id) continue;
          let local;
          try { local = await DB.get(job.store, remote.id); } catch (e) { continue; }
          if (local && local.synced === false) continue; // local has a pending change — don't clobber it
          job.strip.forEach((f) => { if (local && local[f] !== undefined) remote[f] = local[f]; });
          remote.synced = true;
          try { await DB.put(job.store, remote); } catch (e) { /* store may not exist locally yet, skip */ }
        }
      }
      // Special case: the "already imported" flag lives in local settings, not a normal
      // per-record store, so it needs its own small merge — only ever moves false -> true,
      // never the reverse, so this can't accidentally re-lock a device that unlocked itself.
      const metaRows = data['Meta'] || [];
      for (const rawJson of metaRows) {
        try {
          const remoteFlag = JSON.parse(rawJson);
          if (remoteFlag.key === 'importCompleted' && remoteFlag.value === true) {
            const localMeta = (await DB.get('settings', 'meta')) || { id: 'meta' };
            if (!localMeta.importCompleted) {
              localMeta.importCompleted = true;
              await DB.put('settings', localMeta);
            }
          }
        } catch (e) { /* ignore malformed row */ }
      }
    } catch (err) {
      console.warn('Pull sync failed:', err.message);
    } finally {
      this._pullInProgress = false;
    }
    await this.refreshStatus();
  },

  async forceFullResync() {
    // Resets every record's sync flag so a subsequent retryAllPending() re-pushes everything
    // from scratch. Use this after manually clearing the Sheet, so the Sheet ends up with
    // exactly one clean copy of each record instead of relying on deduping a messy history.
    for (const job of SYNC_JOBS) {
      try {
        const items = await DB.getAll(job.store);
        for (const item of items) {
          item.synced = false;
          await DB.put(job.store, item);
        }
      } catch (err) {
        console.warn(`Force resync: skipped store "${job.store}":`, err.message);
      }
    }
    this.retryAllPending();
  },

  async retryAllPending() {
    if (this._syncInProgress) return; // a sync is already running the queue — don't start a second overlapping pass
    this._syncInProgress = true;
    try {
      for (const job of SYNC_JOBS) {
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

  // Pull first (catch up on anything from other devices), then push anything pending locally.
  async fullSync() {
    await this.pullAll();
    await this.retryAllPending();
  },

  async refreshStatus() {
    const url = await this.getUrl();
    if (!url) { this.setStatus('offline'); return; }
    let pendingCount = 0;
    for (const job of SYNC_JOBS) {
      try {
        const items = await DB.getAll(job.store);
        pendingCount += items.filter((i) => !i.synced).length;
      } catch (err) {
        console.warn(`Sync status check skipped store "${job.store}" (not present in local DB yet):`, err.message);
      }
    }
    if (!navigator.onLine) this.setStatus('pending');
    else if (pendingCount > 0) this.setStatus('pending');
    else this.setStatus('synced');
  },

  // Uploads a photo (base64 data URL) to your Drive via Apps Script, under
  // "Homebase Photos/<folder>". Returns the embeddable thumbnail URL on success,
  // or null on failure (offline, no Sheet URL set, etc) — callers should fall back
  // to the local-only copy in that case, nothing is lost either way.
  async uploadPhoto(dataUrl, folder, fileName) {
    const url = await this.getUrl();
    if (!url || !navigator.onLine) return null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'uploadPhoto', dataUrl, folder, fileName })
      });
      const data = await res.json();
      return data.ok ? data.url : null;
    } catch (err) {
      console.warn('Photo upload failed:', err.message);
      return null;
    }
  },

  startPolling() {
    window.addEventListener('online', () => this.fullSync());
    window.addEventListener('offline', () => this.setStatus('pending'));
    setInterval(() => this.fullSync(), 10000);
  }
};
