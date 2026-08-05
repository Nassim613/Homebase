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

  // Bootstrap fallback: if this device's local copy of the Sheet URL was ever wiped
  // (browsers — especially iOS Safari — can silently clear PWA storage under storage
  // pressure or after inactivity), fall back to the known-good deployed URL rather than
  // silently going "not connected." A device recovering this way also auto-heals the
  // "imported data only shows on one device" symptom, since that's really the same
  // root cause: no URL means no pulling, means it just looks empty.
  DEFAULT_SHEET_URL: 'https://script.google.com/macros/s/AKfycbxIPtOx0K2XiZnk1Rb99mgpMKJkgPx2vYyXELYlqgeEonYuDnKSVUS1WuksL2y9So32SQ/exec',

  async getUrl() {
    const meta = await DB.get('settings', 'meta');
    if (meta && meta.sheetUrl) return meta.sheetUrl;
    // Local copy is missing — self-heal by saving the default back to this device
    // so future reads (and the Settings page) reflect a connected state again.
    const m = meta || { id: 'meta' };
    m.sheetUrl = this.DEFAULT_SHEET_URL;
    await DB.put('settings', m);
    return this.DEFAULT_SHEET_URL;
  },

  async pushEntry(sheetName, entry) {
    const url = await this.getUrl();
    if (!url || !navigator.onLine) {
      this.setStatus('pending');
      return false;
    }
    const token = await Auth.ensureToken();
    if (!token) { this.setStatus('pending'); return false; }
    this.setStatus('syncing');
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ sheet: sheetName, entry, token })
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
    if (this._pullInProgress) return false;
    const url = await this.getUrl();
    if (!url || !navigator.onLine) return false;
    const token = await Auth.ensureToken();
    if (!token) return false;
    this._pullInProgress = true;
    let anyChanged = false;
    try {
      const res = await fetch(url + '?token=' + encodeURIComponent(token), { method: 'GET' });
      const data = await res.json();
      if (data.error) {
        // Apps Script rejected the request (bad/expired token, not on the allowlist,
        // etc). Previously this silently looked identical to "zero data everywhere" —
        // now it's surfaced explicitly instead of hiding the real reason.
        this.lastPullError = data.error;
        console.warn('Pull sync denied:', data.error);
        this._pullInProgress = false;
        await this.refreshStatus();
        return false;
      }
      this.lastPullError = null;
      for (const job of SYNC_JOBS) {
        const rows = data[job.sheet] || [];
        if (!rows.length) continue;
        // One bulk read of everything already local for this store, instead of a
        // separate read per incoming row — this is the main thing that makes a big
        // first sync fast instead of taking minutes.
        const localById = await DB.getAllAsMap(job.store);
        const toWrite = [];
        for (const rawJson of rows) {
          let remote;
          try { remote = JSON.parse(rawJson); } catch (e) { continue; }
          if (!remote || !remote.id) continue;
          const local = localById.get(remote.id);
          if (local && local.synced === false) continue; // local has a pending change — don't clobber it
          job.strip.forEach((f) => { if (local && local[f] !== undefined) remote[f] = local[f]; });
          remote.synced = true;
          // Skip the write entirely if nothing actually changed — avoids pointless
          // IndexedDB churn every 10 seconds, and lets callers know whether a screen
          // refresh is actually worth doing (vs re-rendering the same data repeatedly).
          if (local && JSON.stringify(local) === JSON.stringify(remote)) continue;
          toWrite.push(remote);
        }
        if (toWrite.length) {
          try { await DB.putMany(job.store, toWrite); anyChanged = true; } catch (e) { /* store may not exist locally yet, skip */ }
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
            let changed = false;
            if (!localMeta.importCompleted) { localMeta.importCompleted = true; changed = true; }
            if (remoteFlag.importedAt && !localMeta.importedAt) { localMeta.importedAt = remoteFlag.importedAt; changed = true; }
            if (changed) await DB.put('settings', localMeta);
          }
          if (remoteFlag.key === 'groceryWeeklyBudget') {
            const localMeta = (await DB.get('settings', 'meta')) || { id: 'meta' };
            if (localMeta.groceryWeeklyBudget !== remoteFlag.value) {
              localMeta.groceryWeeklyBudget = remoteFlag.value;
              await DB.put('settings', localMeta);
              anyChanged = true;
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
    return anyChanged;
  },

  // Read-only — fetches current row counts per sheet without touching any local data.
  // Used as a safety check before anything destructive (like clearing the Sheet), so a
  // device with incomplete local data can't silently wipe out real data it never had.
  async getRemoteCounts() {
    const url = await this.getUrl();
    if (!url) return null;
    const token = await Auth.ensureToken();
    if (!token) return null;
    try {
      const res = await fetch(url + '?token=' + encodeURIComponent(token), { method: 'GET' });
      const data = await res.json();
      if (data.error) return null;
      const counts = {};
      for (const job of SYNC_JOBS) counts[job.sheet] = (data[job.sheet] || []).length;
      return counts;
    } catch (err) {
      return null;
    }
  },

  async clearRemoteSheet() {
    const url = await this.getUrl();
    if (!url) return { ok: false, error: 'Not connected to a Sheet' };
    const token = await Auth.ensureToken();
    if (!token) return { ok: false, error: 'Not signed in' };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'clearAllData', token })
      });
      return await res.json();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  async forceFullResync() {
    // Resets every record's sync flag so a subsequent retryAllPending() re-pushes everything
    // from scratch. Use this after manually clearing the Sheet, so the Sheet ends up with
    // exactly one clean copy of each record instead of relying on deduping a messy history.
    for (const job of SYNC_JOBS) {
      try {
        const items = await DB.getAll(job.store);
        if (!items.length) continue;
        items.forEach((item) => { item.synced = false; });
        await DB.putMany(job.store, items);
      } catch (err) {
        console.warn(`Force resync: skipped store "${job.store}":`, err.message);
      }
    }
    this.retryAllPending();
  },

  // Sends many records in ONE request instead of one request per record — this is what
  // makes a big backlog (a fresh import, or catching up after being offline) take minutes
  // instead of hours. Used by retryAllPending; individual entry saves still use the
  // single-record pushEntry above for instant per-action feedback.
  async pushBatch(sheetName, entries) {
    const url = await this.getUrl();
    if (!url || !navigator.onLine) return false;
    const token = await Auth.ensureToken();
    if (!token) return false;
    this.setStatus('syncing');
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ sheet: sheetName, entries, token })
      });
      this.setStatus('synced');
      return true;
    } catch (err) {
      this.setStatus('pending');
      return false;
    }
  },

  async retryAllPending() {
    if (this._syncInProgress) return; // a sync is already running the queue — don't start a second overlapping pass
    this._syncInProgress = true;
    const BATCH_SIZE = 200; // keeps each Apps Script call well within its own execution limits
    try {
      for (const job of SYNC_JOBS) {
        try {
          const items = await DB.getAll(job.store);
          const pending = items.filter((i) => !i.synced);
          if (!pending.length) continue;
          for (let i = 0; i < pending.length; i += BATCH_SIZE) {
            const chunk = pending.slice(i, i + BATCH_SIZE);
            const payloads = chunk.map((item) => {
              const payload = { ...item };
              job.strip.forEach((k) => delete payload[k]);
              return payload;
            });
            const ok = await this.pushBatch(job.sheet, payloads);
            if (ok) {
              chunk.forEach((item) => { item.synced = true; });
              await DB.putMany(job.store, chunk);
            }
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
    const changed = await this.pullAll();
    await this.retryAllPending();
    return changed;
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
    if (!url) return { ok: false, error: 'Not connected to a Sheet' };
    if (!navigator.onLine) return { ok: false, error: 'Device is offline' };
    const token = await Auth.ensureToken();
    if (!token) return { ok: false, error: 'Not signed in' };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'uploadPhoto', dataUrl, folder, fileName, token })
      });
      if (!res.ok) return { ok: false, error: `Server responded ${res.status}` };
      const data = await res.json();
      if (!data.ok) return { ok: false, error: data.error || 'Apps Script rejected the upload' };
      return { ok: true, url: data.url, viewUrl: data.viewUrl, isImage: data.isImage };
    } catch (err) {
      return { ok: false, error: err.message || 'Network request failed' };
    }
  },

  // Screens where re-rendering mid-use would wipe out whatever the person is currently
  // typing — never auto-refresh these, no matter how new the incoming data is.
  FORM_VIEWS: ['add', 'addCost', 'addIssue', 'addVehicle', 'addWeight', 'categoryForm', 'projectForm', 'storeForm', 'sellVehicle'],

  startPolling() {
    window.addEventListener('online', () => this.fullSync());
    window.addEventListener('offline', () => this.setStatus('pending'));
    setInterval(() => {
      this.fullSync().then((changed) => {
        if (changed && typeof currentView !== 'undefined' && !this.FORM_VIEWS.includes(currentView) && typeof route === 'function') {
          route(); // something genuinely new arrived and it's safe to redraw — refresh what's on screen
        }
      });
    }, 10000);
  }
};
