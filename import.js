// ============ DATA IMPORT ============
// One-time import of historical data converted from an external spreadsheet.
// Merges "dimension" tables (categories, payees, cars, projects, expense/repair/issue types)
// by name instead of blindly inserting, so re-running an import or importing after the app's
// own default seed data won't create duplicate categories/stores/etc.

async function mergeDimension(storeName, incomingItems) {
  const existing = await DB.getAll(storeName);
  const existingByName = new Map(existing.map((e) => [e.name.trim().toLowerCase(), e]));
  const idMap = {}; // incoming id -> final id used in the DB
  for (const item of incomingItems) {
    const key = (item.name || '').trim().toLowerCase();
    const match = existingByName.get(key);
    if (match) {
      idMap[item.id] = match.id; // reuse the existing record's ID, don't duplicate
    } else {
      await DB.put(storeName, item);
      existingByName.set(key, item);
      idMap[item.id] = item.id;
    }
  }
  return idMap;
}

async function importBundle(bundle, onProgress) {
  const report = { inserted: {}, merged: {} };

  const catMap = await mergeDimension('categories', bundle.categories || []);
  const payeeMap = await mergeDimension('payees', bundle.payees || []);
  const carMap = await mergeDimension('cars', bundle.cars || []);
  const projectMap = await mergeDimension('projects', bundle.projects || []);
  const etypeMap = await mergeDimension('expenseTypes', bundle.expenseTypes || []);
  const rtypeMap = await mergeDimension('repairTypes', bundle.repairTypes || []);
  const itypeMap = await mergeDimension('issueTypes', bundle.issueTypes || []);
  onProgress && onProgress('Categories, stores, and types merged…');

  // Finance entries
  let n = 0;
  for (const e of (bundle.entries || [])) {
    e.categoryId = catMap[e.categoryId] || e.categoryId;
    e.storeId = payeeMap[e.storeId] || e.storeId;
    if (e.carId) e.carId = carMap[e.carId] || e.carId;
    if (e.projectId) e.projectId = projectMap[e.projectId] || e.projectId;
    if (e.carSplit) e.carSplit = e.carSplit.map((s) => ({ ...s, carId: carMap[s.carId] || s.carId }));
    await DB.put('entries', e);
    n++;
  }
  report.inserted.entries = n;
  onProgress && onProgress(`${n} finance entries imported…`);

  // Vehicles
  n = 0;
  const vehicleIdSet = new Set();
  for (const v of (bundle.vehicles || [])) {
    await DB.put('vehicles', v);
    vehicleIdSet.add(v.id);
    n++;
  }
  report.inserted.vehicles = n;
  onProgress && onProgress(`${n} vehicles imported…`);

  // Garage costs
  n = 0;
  for (const c of (bundle.garageCosts || [])) {
    if (c.expenseTypeId) c.expenseTypeId = etypeMap[c.expenseTypeId] || c.expenseTypeId;
    if (c.repairTypeId) c.repairTypeId = rtypeMap[c.repairTypeId] || c.repairTypeId;
    if (!vehicleIdSet.has(c.vehicleId)) continue; // skip orphaned costs (vehicle wasn't imported)
    await DB.put('garageCosts', c);
    n++;
  }
  report.inserted.garageCosts = n;
  onProgress && onProgress(`${n} garage costs imported…`);

  // Jazz issues
  n = 0;
  for (const j of (bundle.jazzIssues || [])) {
    if (j.typeId) j.typeId = itypeMap[j.typeId] || j.typeId;
    await DB.put('jazzIssues', j);
    n++;
  }
  report.inserted.jazzIssues = n;
  onProgress && onProgress(`${n} Jazz issues imported…`);

  // Weight entries
  n = 0;
  for (const w of (bundle.weightEntries || [])) {
    await DB.put('weightEntries', w);
    n++;
  }
  report.inserted.weightEntries = n;
  onProgress && onProgress(`${n} weight entries imported…`);

  return report;
}

// One-time cleanup for duplicate categories/stores/etc that can build up when multiple
// devices independently created the "same" item (by name) before two-way sync existed.
// Merges by name, keeps the oldest record as canonical, repoints every reference to it
// across entries/jazzIssues/garageCosts, and marks everything touched as unsynced so the
// fix pushes back up to the Sheet on the next sync.
const DIMENSION_CLEANUP_TARGETS = [
  { store: 'categories', refs: [{ store: 'entries', field: 'categoryId' }] },
  { store: 'payees', refs: [{ store: 'entries', field: 'storeId' }] },
  { store: 'cars', refs: [{ store: 'entries', field: 'carId' }] },
  { store: 'projects', refs: [{ store: 'entries', field: 'projectId' }] },
  { store: 'expenseTypes', refs: [{ store: 'garageCosts', field: 'expenseTypeId' }] },
  { store: 'repairTypes', refs: [{ store: 'garageCosts', field: 'repairTypeId' }] },
  { store: 'issueTypes', refs: [{ store: 'jazzIssues', field: 'typeId' }] },
  { store: 'vetClinics', refs: [{ store: 'jazzIssues', field: 'vetClinicId' }] }
];

async function cleanupDuplicateDimensions(onProgress) {
  const report = [];
  for (const target of DIMENSION_CLEANUP_TARGETS) {
    const items = await DB.getAll(target.store);
    const groups = new Map(); // lowercase name -> array of items
    items.forEach((item) => {
      const key = (item.name || '').trim().toLowerCase();
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    let mergedCount = 0;
    for (const [name, group] of groups) {
      if (group.length < 2) continue;
      group.sort((a, b) => a.id.localeCompare(b.id)); // stable, deterministic pick
      const canonical = group[0];
      const duplicates = group.slice(1);
      mergedCount += duplicates.length;

      // Repoint every entry that references a duplicate ID over to the canonical one
      for (const ref of target.refs) {
        const refItems = await DB.getAll(ref.store);
        for (const item of refItems) {
          if (duplicates.some((d) => d.id === item[ref.field])) {
            item[ref.field] = canonical.id;
            item.synced = false;
            await DB.put(ref.store, item);
          }
        }
      }

      // Remove the duplicate dimension records locally
      for (const dup of duplicates) {
        await DB.delete(target.store, dup.id);
      }
    }
    if (mergedCount > 0) {
      report.push(`${target.store}: merged ${mergedCount} duplicate(s)`);
      onProgress && onProgress(`Cleaned up ${target.store}…`);
    }
  }
  return report;
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('importStatus');
  statusEl.textContent = 'Reading file…';
  const reader = new FileReader();
  reader.onload = async () => {
    let bundle;
    try {
      bundle = JSON.parse(reader.result);
    } catch (err) {
      statusEl.textContent = 'Could not read that file — make sure it\'s the converted import-data.json.';
      return;
    }
    try {
      const report = await importBundle(bundle, (msg) => { statusEl.textContent = msg; });
      statusEl.innerHTML = `<b>Import complete.</b><br>${Object.entries(report.inserted).map(([k, v]) => `${v} ${k}`).join(', ')}.<br>Everything is saved locally now — it'll sync to your Sheet automatically in the background (this may take a while for a large import; watch the sync pill).`;
      const meta = (await DB.get('settings', 'meta')) || { id: 'meta' };
      meta.importCompleted = true;
      meta.importedAt = todayStr();
      await DB.put('settings', meta);
      Sync.pushEntry('Meta', { id: 'importFlag', key: 'importCompleted', value: true, importedAt: meta.importedAt });
      Sync.retryAllPending();
      setTimeout(() => { if (typeof renderMore === 'function') renderMore(); }, 1500); // brief pause so the success message is visible before the screen switches to the locked state
    } catch (err) {
      statusEl.textContent = 'Import failed: ' + err.message;
    }
  };
  reader.readAsText(file);
}
