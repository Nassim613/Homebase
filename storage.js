// ---------- IndexedDB wrapper ----------
const DB_NAME = 'homebase';
const DB_VERSION = 3;
const STORES = ['entries', 'categories', 'payees', 'cars', 'projects', 'recurring', 'settings', 'weightEntries', 'jazzIssues', 'issueTypes', 'vetClinics', 'vehicles', 'garageCosts', 'expenseTypes', 'repairTypes', 'garagePlaces'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

const DB = {
  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async get(storeName, id) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async put(storeName, obj) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(obj);
      req.onsuccess = () => resolve(obj);
      req.onerror = () => reject(req.error);
    });
  },
  async delete(storeName, id) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  },
  // Bulk versions — critical for a full sync pull/import, which can involve thousands
  // of records. Opening one transaction per record (the plain get/put above) is fine
  // for single-entry edits, but doing that thousands of times in a row is genuinely
  // slow, especially on phones — this is what made a fresh device's first sync look
  // "stuck" when it was really just working through records one at a time.
  async getAllAsMap(storeName) {
    const all = await this.getAll(storeName);
    return new Map(all.map((r) => [r.id, r]));
  },
  async putMany(storeName, objects) {
    if (!objects.length) return;
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      let remaining = objects.length;
      objects.forEach((obj) => {
        const req = store.put(obj);
        req.onsuccess = () => { if (--remaining === 0) resolve(); };
        req.onerror = () => reject(req.error);
      });
    });
  },
  async getSetting(key, fallback) {
    const rec = await this.get('settings', key);
    return rec ? rec.value : fallback;
  },
  async setSetting(key, value) {
    return this.put('settings', { id: key, value });
  }
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- Default seed data ----------
const DEFAULT_CATEGORIES = [
  { name: 'Groceries', type: 'expense', icon: 'ti-shopping-cart', conditionalField: 'none' },
  { name: 'Gas', type: 'expense', icon: 'ti-gas-station', conditionalField: 'car' },
  { name: 'Car maintenance', type: 'expense', icon: 'ti-tool', conditionalField: 'car' },
  { name: 'Car insurance', type: 'expense', icon: 'ti-shield-check', conditionalField: 'carSplit' },
  { name: 'House maintenance', type: 'expense', icon: 'ti-home', conditionalField: 'project' },
  { name: 'Mortgage', type: 'expense', icon: 'ti-home-dollar', conditionalField: 'none' },
  { name: 'Jazz food', type: 'expense', icon: 'ti-paw', conditionalField: 'none' },
  { name: 'Jazz care', type: 'expense', icon: 'ti-paw', conditionalField: 'none' },
  { name: 'Dining', type: 'expense', icon: 'ti-tools-kitchen-2', conditionalField: 'none' },
  { name: 'Subscriptions', type: 'expense', icon: 'ti-repeat', conditionalField: 'none' },
  { name: 'Pay', type: 'income', icon: 'ti-building-bank', conditionalField: 'none' },
  { name: 'Allowance', type: 'transfer', icon: 'ti-user', conditionalField: 'none' },
  { name: 'Credit card payment', type: 'transfer', icon: 'ti-credit-card', conditionalField: 'none' }
];

const DEFAULT_EXPENSE_TYPES_GARAGE = [
  { name: 'Mechanical repairs', icon: 'ti-tool', hasRepairSubtype: true },
  { name: 'Body repairs', icon: 'ti-car-crash', hasRepairSubtype: false },
  { name: 'Used/new parts', icon: 'ti-shopping-cart', hasRepairSubtype: false },
  { name: 'Car wash / detail', icon: 'ti-droplet', hasRepairSubtype: false },
  { name: 'Towing', icon: 'ti-tow-truck', hasRepairSubtype: false },
  { name: 'Service Ontario', icon: 'ti-file-certificate', hasRepairSubtype: false },
  { name: 'Commission', icon: 'ti-cash', hasRepairSubtype: false },
  { name: 'Appraisal', icon: 'ti-clipboard-check', hasRepairSubtype: false },
  { name: 'Safety', icon: 'ti-shield-check', hasRepairSubtype: false },
  { name: 'Rust proofing', icon: 'ti-spray', hasRepairSubtype: false },
  { name: 'Parts installation', icon: 'ti-settings', hasRepairSubtype: false }
];

const DEFAULT_REPAIR_TYPES = ['Brakes', 'Suspension', 'Air conditioning', 'Battery', 'Oil change', 'Tires', 'Exhaust', 'Starter'];

const DEFAULT_ISSUE_TYPES = [
  { name: 'Skin', icon: 'ti-droplet' },
  { name: 'Behavior / panic', icon: 'ti-brain' },
  { name: 'Eye', icon: 'ti-eye' },
  { name: 'Ear', icon: 'ti-ear' },
  { name: 'Digestive / vomiting', icon: 'ti-stomach' },
  { name: 'Food change', icon: 'ti-bone' }
];

async function seedIfEmpty() {
  // Never seed unless we're SURE the emptiness is real — i.e. a pull actually completed
  // without error and still came back with nothing. A failed or incomplete pull also
  // leaves local data empty, but that's "we don't know yet," not "there's genuinely
  // nothing here" — seeding in that case is exactly what caused repeated duplicate
  // categories to pile up in the Sheet. When in doubt, do nothing and wait for a real pull.
  if (typeof Sync !== 'undefined' && (!Sync.hasPulledOnce || Sync.lastPullError)) {
    console.warn('seedIfEmpty: skipped — no confirmed successful pull yet, so emptiness cannot be trusted.');
    return;
  }
  const cats = await DB.getAll('categories');
  if (cats.length === 0) {
    for (const c of DEFAULT_CATEGORIES) {
      await DB.put('categories', { id: uid(), ...c, defaultStoreId: null, defaultAmount: null, hidden: false });
    }
  }
  const payees = await DB.getAll('payees');
  if (payees.length === 0) {
    for (const name of ['Store', 'Restaurant']) {
      await DB.put('payees', { id: uid(), name, logo: null, defaultCategoryId: null, defaultAmount: null });
    }
  }
  const issueTypes = await DB.getAll('issueTypes');
  if (issueTypes.length === 0) {
    for (const t of DEFAULT_ISSUE_TYPES) await DB.put('issueTypes', { id: uid(), ...t, hidden: false });
  }
  const expenseTypes = await DB.getAll('expenseTypes');
  if (expenseTypes.length === 0) {
    for (const t of DEFAULT_EXPENSE_TYPES_GARAGE) await DB.put('expenseTypes', { id: uid(), ...t });
  }
  const repairTypes = await DB.getAll('repairTypes');
  if (repairTypes.length === 0) {
    for (const n of DEFAULT_REPAIR_TYPES) await DB.put('repairTypes', { id: uid(), name: n });
  }
  const settings = await DB.get('settings', 'meta');
  if (!settings) {
    await DB.put('settings', { id: 'meta', sheetUrl: '', importCompleted: false });
  }
}
