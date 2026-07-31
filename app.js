// ---------- App state ----------
let currentTab = 'finance';
let currentView = 'main'; // main | add | categories | reports
let editingCategory = null;
let duplicateSource = null;
let carSplitDraft = [];

const $main = document.getElementById('mainContent');
const $fab = document.getElementById('fab');

function fmtMoney(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function monthKey(d) { return d.slice(0, 7); }
function esc(s) { return (s || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

// ---------- Header ----------
function renderHeader() {
  const now = new Date();
  document.getElementById('dateLine').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const titles = { finance: 'Finances', jazz: 'Jazz', weight: 'Weight', garage: 'Garage', more: 'More' };
  document.getElementById('pageTitle').textContent = titles[currentTab] || '';
}

function renderSyncPill() {
  const pill = document.getElementById('syncPill');
  const text = document.getElementById('syncText');
  pill.className = 'status-pill ' + Sync.status;
  const map = { synced: ['ti-check', 'Synced'], syncing: ['ti-refresh', 'Syncing…'], pending: ['ti-clock', 'Pending'], offline: ['ti-cloud-off', 'Not connected'] };
  const [icon, label] = map[Sync.status] || map.offline;
  pill.innerHTML = `<i class="ti ${icon}"></i> <span>${label}</span>`;
}

// ---------- Tab nav ----------
document.querySelectorAll('nav.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    currentView = 'main';
    renderHeader();
    route();
  });
});

$fab.addEventListener('click', () => {
  if (currentTab === 'finance' && currentView === 'main') { currentView = 'add'; route(); }
  else if (currentTab === 'jazz' && currentView === 'main') { currentView = 'addIssue'; route(); }
  else if (currentTab === 'weight' && currentView === 'main') { currentView = 'addWeight'; route(); }
  else if (currentTab === 'garage' && currentView === 'main') { currentView = 'addVehicle'; route(); }
});

// ---------- Router ----------
async function route() {
  if (currentTab === 'finance') {
    $fab.style.display = currentView === 'main' ? 'flex' : 'none';
    if (currentView === 'main') return renderFinanceMain();
    if (currentView === 'add') return renderAddEntry();
    if (currentView === 'categories') return renderCategoriesManager();
    if (currentView === 'reports') return renderReportsStub();
  } else if (currentTab === 'jazz') {
    $fab.style.display = currentView === 'main' ? 'flex' : 'none';
    if (currentView === 'main') return renderJazzMain();
    if (currentView === 'addIssue') return renderAddIssue();
    if (currentView === 'issueDetail') return renderIssueDetail();
    if (currentView === 'report') return renderJazzReport();
  } else if (currentTab === 'weight') {
    $fab.style.display = currentView === 'main' ? 'flex' : 'none';
    if (currentView === 'main') return renderWeightMain();
    if (currentView === 'addWeight') return renderAddWeight();
  } else if (currentTab === 'garage') {
    $fab.style.display = currentView === 'main' ? 'flex' : 'none';
    if (currentView === 'main') return renderGarageMain();
    if (currentView === 'addVehicle') return renderAddVehicle();
    if (currentView === 'vehicleDetail') return renderVehicleDetail();
    if (currentView === 'addCost') return renderAddCost();
    if (currentView === 'sellVehicle') return renderSellVehicle();
    if (currentView === 'allRepairs') return renderAllRepairs();
    if (currentView === 'garageReport') return renderGarageReport();
  } else if (currentTab === 'more') {
    $fab.style.display = 'none';
    return renderMore();
  } else {
    $fab.style.display = 'none';
    $main.innerHTML = `<div class="empty-state">${currentTab[0].toUpperCase() + currentTab.slice(1)} is coming in the next build phase.</div>`;
  }
}

// ---------- Finance: main screen ----------
async function renderFinanceMain() {
  const entries = (await DB.getAll('entries')).sort((a, b) => b.date.localeCompare(a.date));
  const categories = await DB.getAll('categories');
  const payees = await DB.getAll('payees');
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const payeeById = Object.fromEntries(payees.map((p) => [p.id, p]));

  const mk = monthKey(todayStr());
  const monthEntries = entries.filter((e) => monthKey(e.date) === mk && e.type !== 'transfer');
  const income = monthEntries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const expense = monthEntries.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const net = income - expense;

  const byDay = {};
  entries.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
  const days = Object.keys(byDay).sort().reverse();

  $main.innerHTML = `
    <div class="card hero-card" style="background:${net >= 0 ? 'var(--sage-soft)' : 'var(--rose-soft)'}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <p class="label" style="color:${net >= 0 ? '#0F6E56' : 'var(--red)'}">Net this month</p>
        <i class="ti ${net >= 0 ? 'ti-trending-up' : 'ti-trending-down'}" style="color:${net >= 0 ? '#0F6E56' : 'var(--red)'}"></i>
      </div>
      <p class="big" style="color:${net >= 0 ? '#0F6E56' : 'var(--red)'}">${net >= 0 ? '+' : ''}${fmtMoney(net)}</p>
    </div>
    <div class="stat-grid">
      <div class="stat"><p class="label">Income</p><p class="value" style="color:#0F6E56">${fmtMoney(income)}</p></div>
      <div class="stat"><p class="label">Expenses</p><p class="value" style="color:var(--red)">${fmtMoney(expense)}</p></div>
    </div>
    <p style="font-size:11px;color:var(--ink-soft);margin-bottom:14px">Resets on the 1st of each month</p>

    <div class="search-box"><i class="ti ti-search"></i><input id="financeSearch" placeholder="Search description, store, category, amount..."></div>

    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn" style="flex:1" onclick="goCategories()"><i class="ti ti-tag"></i> Categories & stores</button>
      <button class="btn" style="flex:1" onclick="goReports()"><i class="ti ti-chart-bar"></i> Reports</button>
    </div>

    <div id="entryList">${days.length ? days.map((d) => renderDayGroup(d, byDay[d], catById, payeeById)).join('') : '<div class="empty-state">No entries yet. Tap + to add one.</div>'}</div>
  `;

  document.getElementById('financeSearch').addEventListener('input', (e) => filterEntries(e.target.value, days, byDay, catById, payeeById));
}

function renderDayGroup(date, dayEntries, catById, payeeById) {
  const relevant = dayEntries.filter((e) => e.type !== 'transfer');
  const dayNet = relevant.reduce((s, e) => s + (e.type === 'income' ? e.amount : -e.amount), 0);
  return `
    <div class="section-title"><span>${fmtDate(date)}</span>${relevant.length ? `<span class="amt ${dayNet < 0 ? 'neg' : 'pos'}">${dayNet >= 0 ? '+' : ''}${fmtMoney(dayNet)}</span>` : ''}</div>
    ${dayEntries.map((e) => renderEntryRow(e, catById, payeeById)).join('')}
  `;
}

function renderEntryRow(e, catById, payeeById) {
  const cat = catById[e.categoryId] || {};
  const payee = payeeById[e.storeId] || {};
  const isNeg = e.type === 'expense';
  const valClass = e.type === 'transfer' ? '' : (isNeg ? 'neg' : 'pos');
  const sign = e.type === 'transfer' ? '' : (isNeg ? '' : '+');
  return `
    <div class="entry-row" onclick="openEntryActions('${e.id}')">
      <div class="entry-icon">
        ${payee.logo ? `<img src="${payee.logo}" style="width:100%;height:100%;object-fit:cover">` : `<i class="ti ${cat.icon || 'ti-tag'}" style="color:var(--ink-soft)"></i>`}
        <div class="entry-badge" style="background:var(--gold-soft)"><i class="ti ${cat.icon || 'ti-tag'}" style="color:#8a6412"></i></div>
      </div>
      <div class="entry-body">
        <div class="entry-top">
          <span class="entry-title">${esc(payee.name || cat.name || 'Entry')}</span>
          <span class="entry-value ${valClass}">${sign}${fmtMoney(e.amount)}</span>
        </div>
        <div class="entry-meta">${esc(cat.name || '')}${e.recurringId ? ' · Recurring' : ''}</div>
        ${e.description ? `<div class="entry-desc">${esc(e.description)}</div>` : ''}
      </div>
    </div>
  `;
}

function filterEntries(q, days, byDay, catById, payeeById) {
  q = q.trim().toLowerCase();
  const list = document.getElementById('entryList');
  if (!q) { list.innerHTML = days.map((d) => renderDayGroup(d, byDay[d], catById, payeeById)).join(''); return; }
  const filteredByDay = {};
  days.forEach((d) => {
    const matches = byDay[d].filter((e) => {
      const cat = catById[e.categoryId] || {};
      const payee = payeeById[e.storeId] || {};
      const hay = `${cat.name || ''} ${payee.name || ''} ${e.description || ''} ${e.amount}`.toLowerCase();
      return hay.includes(q);
    });
    if (matches.length) filteredByDay[d] = matches;
  });
  const keys = Object.keys(filteredByDay);
  list.innerHTML = keys.length ? keys.map((d) => renderDayGroup(d, filteredByDay[d], catById, payeeById)).join('') : '<div class="empty-state">No matches.</div>';
}

function goCategories() { currentView = 'categories'; route(); }
function goReports() { currentView = 'reports'; route(); }
function goMain() { currentView = 'main'; duplicateSource = null; route(); }

function renderReportsStub() {
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMain()"><i class="ti ti-arrow-left"></i></div>
    <div class="empty-state">Full reports (charts, month grouping, Utilities/Cars/Transfers views) are coming in a later build pass. The core data model already supports everything needed for them.</div>
  `;
}

// ---------- Add / Edit Entry ----------
async function openEntryActions(id) {
  const entry = await DB.get('entries', id);
  if (!entry) return;
  const action = prompt('Type "duplicate", "edit", or "delete" for this entry:');
  if (action === 'duplicate') { duplicateSource = entry; currentView = 'add'; route(); }
  else if (action === 'edit') { duplicateSource = { ...entry, __editId: entry.id }; currentView = 'add'; route(); }
  else if (action === 'delete') { await DB.delete('entries', id); renderFinanceMain(); }
}

async function renderAddEntry() {
  const categories = (await DB.getAll('categories')).sort((a, b) => a.name.localeCompare(b.name));
  const payees = (await DB.getAll('payees')).sort((a, b) => a.name.localeCompare(b.name));
  const cars = await DB.getAll('cars');
  const projects = await DB.getAll('projects');
  const src = duplicateSource;

  const catOptions = categories.map((c) => `<option value="${c.id}" ${src && src.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const payeeOptions = payees.map((p) => `<option value="${p.id}" ${src && src.storeId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const carOptions = cars.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const projectOptions = projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${src && src.__editId ? 'Edit entry' : 'Add entry'}</span></div>

    <div class="field"><label class="field-label">Date</label><input type="date" id="f_date" value="${src ? (src.__editId ? src.date : todayStr()) : todayStr()}"></div>

    <div class="field"><label class="field-label">Category</label>
      <select id="f_category" onchange="onCategoryChange()">
        <option value="">Select…</option>${catOptions}
        <option value="__new">+ Add category</option>
      </select>
    </div>

    <div id="conditionalFieldArea"></div>

    <div class="btn-toggle-row" id="typeToggle">
      <button class="btn-toggle" data-type="expense" onclick="setType('expense')">Expense</button>
      <button class="btn-toggle" data-type="income" onclick="setType('income')">Income</button>
      <button class="btn-toggle" data-type="transfer" onclick="setType('transfer')">Transfer</button>
    </div>

    <div class="field"><label class="field-label">Amount</label><input type="number" step="0.01" id="f_amount" placeholder="$0.00" value="${src ? src.amount : ''}"></div>

    <div class="field"><label class="field-label">Store</label>
      <select id="f_store">
        <option value="">Select…</option>${payeeOptions}
        <option value="__new">+ Add store</option>
      </select>
    </div>

    <div class="field"><label class="field-label">Description</label><input id="f_description" placeholder="What was this for?" value="${src ? esc(src.description || '') : ''}"></div>

    <button class="btn btn-primary" onclick="saveEntry()">Save entry</button>
  `;

  window.__cars = cars; window.__projects = projects; window.__categories = categories;
  if (src && src.categoryId) { document.getElementById('f_category').value = src.categoryId; onCategoryChange(true); }
  if (src && src.storeId) document.getElementById('f_store').value = src.storeId;
  setType(src ? src.type : 'expense');

  document.getElementById('f_category').addEventListener('change', (e) => {
    if (e.target.value === '__new') return promptNewCategory();
  });
  document.getElementById('f_store').addEventListener('change', (e) => {
    if (e.target.value === '__new') return promptNewPayee();
  });
}

function setType(t) {
  document.querySelectorAll('#typeToggle .btn-toggle').forEach((b) => {
    b.classList.remove('active-expense', 'active-income', 'active-transfer');
    if (b.dataset.type === t) b.classList.add('active-' + t);
  });
  window.__currentType = t;
}

function onCategoryChange(skipAutofill) {
  const catId = document.getElementById('f_category').value;
  const cat = (window.__categories || []).find((c) => c.id === catId);
  const area = document.getElementById('conditionalFieldArea');
  if (!cat) { area.innerHTML = ''; return; }
  if (!skipAutofill) setType(cat.type);

  if (!skipAutofill && cat.defaultStoreId) document.getElementById('f_store').value = cat.defaultStoreId;
  if (!skipAutofill && cat.defaultAmount) document.getElementById('f_amount').value = cat.defaultAmount;

  if (cat.conditionalField === 'car') {
    area.innerHTML = `<div class="card tight" style="background:var(--surface)"><label class="field-label"><i class="ti ti-car"></i> Car</label><select id="f_car" onchange="if(this.value==='__new') promptNewCarInline()">${(window.__cars || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}<option value="__new">+ Add car</option></select></div>`;
  } else if (cat.conditionalField === 'project') {
    area.innerHTML = `<div class="card tight" style="background:var(--surface)"><label class="field-label"><i class="ti ti-tools"></i> Project</label><select id="f_project" onchange="if(this.value==='__new') promptNewProjectInline()">${(window.__projects || []).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}<option value="__new">+ Add project</option></select></div>`;
  } else if (cat.conditionalField === 'givenTo') {
    area.innerHTML = `<div class="card tight" style="background:var(--surface)"><label class="field-label"><i class="ti ti-user"></i> Given to</label><div class="btn-toggle-row" style="margin-bottom:0"><button type="button" class="btn-toggle active-neutral" onclick="selectGivenTo(this,'You')">You</button><button type="button" class="btn-toggle" onclick="selectGivenTo(this,'Wife')">Wife</button></div></div>`;
    window.__givenTo = 'You';
  } else if (cat.conditionalField === 'carSplit') {
    carSplitDraft = (window.__cars || []).map((c) => ({ carId: c.id, name: c.name, checked: false, amount: 0 }));
    area.innerHTML = renderCarSplitUI();
  } else {
    area.innerHTML = '';
  }
}

function selectGivenTo(btn, who) {
  btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral'));
  btn.classList.add('active-neutral');
  window.__givenTo = who;
}

function renderCarSplitUI() {
  return `<div class="card tight" style="background:var(--surface)">
    <label class="field-label"><i class="ti ti-car"></i> Cars covered</label>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      ${carSplitDraft.map((c, i) => `<button type="button" class="chip ${c.checked ? 'active' : ''}" onclick="toggleCarSplit(${i})">${esc(c.name)}${c.checked ? ' ✓' : ''}</button>`).join('')}
    </div>
    <div id="carSplitAmounts">${carSplitDraft.filter((c) => c.checked).map((c, i) => `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:13px">${esc(c.name)}</span><input type="number" step="0.01" style="width:100px;text-align:right" onchange="updateCarSplitAmount('${c.carId}', this.value)" value="${c.amount}"></div>`).join('')}</div>
  </div>`;
}
function toggleCarSplit(i) {
  carSplitDraft[i].checked = !carSplitDraft[i].checked;
  const checkedCount = carSplitDraft.filter((c) => c.checked).length;
  const total = parseFloat(document.getElementById('f_amount').value) || 0;
  if (checkedCount) carSplitDraft.filter((c) => c.checked).forEach((c) => (c.amount = +(total / checkedCount).toFixed(2)));
  document.getElementById('conditionalFieldArea').innerHTML = renderCarSplitUI();
}
function updateCarSplitAmount(carId, val) {
  const c = carSplitDraft.find((c) => c.carId === carId);
  if (c) c.amount = parseFloat(val) || 0;
}

function promptNewCategory() {
  const name = prompt('New category name:');
  if (!name) { document.getElementById('f_category').value = ''; return; }
  const type = prompt('Type: expense, income, or transfer?', 'expense') || 'expense';
  const icon = 'ti-tag';
  const cat = { id: uid(), name, type, icon, conditionalField: 'none', defaultStoreId: null, defaultAmount: null };
  DB.put('categories', cat).then(() => { window.__categories.push(cat); renderAddEntry(); setTimeout(() => { document.getElementById('f_category').value = cat.id; onCategoryChange(); }, 0); });
}
function promptNewPayee() {
  const name = prompt('New store name:');
  if (!name) { document.getElementById('f_store').value = ''; return; }
  const payee = { id: uid(), name, logo: null, defaultCategoryId: null, defaultAmount: null };
  DB.put('payees', payee).then(() => { renderAddEntry(); setTimeout(() => { document.getElementById('f_store').value = payee.id; }, 0); });
}

async function saveEntry() {
  const categoryId = document.getElementById('f_category').value;
  const storeId = document.getElementById('f_store').value;
  const amount = parseFloat(document.getElementById('f_amount').value) || 0;
  const date = document.getElementById('f_date').value || todayStr();
  const description = document.getElementById('f_description').value.trim();
  const type = window.__currentType || 'expense';
  if (!categoryId || !amount) { alert('Category and amount are required.'); return; }

  const catObj = (window.__categories || []).find((c) => c.id === categoryId);
  const payeeObj = storeId ? (await DB.getAll('payees')).find((p) => p.id === storeId) : null;
  const carId = document.getElementById('f_car') ? document.getElementById('f_car').value : null;
  const projectId = document.getElementById('f_project') ? document.getElementById('f_project').value : null;
  const carObj = carId ? (window.__cars || []).find((c) => c.id === carId) : null;
  const projectObj = projectId ? (window.__projects || []).find((p) => p.id === projectId) : null;
  const carSplitFinal = carSplitDraft.length ? carSplitDraft.filter((c) => c.checked).map((c) => ({ carId: c.carId, amount: c.amount })) : null;
  const carSplitNames = carSplitFinal ? carSplitFinal.map((s) => {
    const c = (window.__cars || []).find((c) => c.id === s.carId);
    return `${c ? c.name : s.carId} ($${s.amount})`;
  }).join(', ') : '';

  const entry = {
    id: (duplicateSource && duplicateSource.__editId) || uid(),
    date, categoryId, storeId, amount, description, type,
    categoryName: catObj ? catObj.name : '',
    storeName: payeeObj ? payeeObj.name : '',
    carId, projectId,
    carName: carObj ? carObj.name : carSplitNames,
    projectName: projectObj ? projectObj.name : '',
    givenTo: window.__givenTo || null,
    carSplit: carSplitFinal,
    synced: false
  };
  await DB.put('entries', entry);
  Sync.pushEntry('Finance', entry).then(() => DB.put('entries', entry));
  duplicateSource = null; carSplitDraft = []; window.__givenTo = null;
  currentView = 'main';
  route();
}

// ---------- Categories & Stores manager ----------
let managerTab = 'categories';
async function renderCategoriesManager() {
  const categories = (await DB.getAll('categories')).sort((a, b) => a.name.localeCompare(b.name));
  const payees = (await DB.getAll('payees')).sort((a, b) => a.name.localeCompare(b.name));
  const list = managerTab === 'categories' ? categories : payees;

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Categories & stores</span></div>
    <div class="chip-row">
      <button class="chip ${managerTab === 'categories' ? 'active' : ''}" onclick="switchManagerTab('categories')">Categories</button>
      <button class="chip ${managerTab === 'payees' ? 'active' : ''}" onclick="switchManagerTab('payees')">Stores</button>
    </div>
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="${managerTab === 'categories' ? 'promptNewCategoryStandalone()' : 'promptNewPayeeStandalone()'}"><i class="ti ti-plus"></i> Add ${managerTab === 'categories' ? 'category' : 'store'}</button>
    <div>${list.map((item) => managerTab === 'categories' ? renderCategoryListRow(item) : renderPayeeListRow(item)).join('') || '<div class="empty-state">Nothing yet.</div>'}</div>
  `;
}
function switchManagerTab(t) { managerTab = t; renderCategoriesManager(); }

function renderCategoryListRow(c) {
  return `<div class="list-row" onclick="editCategoryPrompt('${c.id}')">
    <div style="display:flex;align-items:center"><div class="icon-badge" style="background:var(--gold-soft)"><i class="ti ${c.icon || 'ti-tag'}"></i></div><span>${esc(c.name)}</span></div>
    <span style="font-size:11px;color:var(--ink-soft);text-transform:capitalize">${c.type}</span>
  </div>`;
}
function renderPayeeListRow(p) {
  return `<div class="list-row" onclick="editPayeePrompt('${p.id}')">
    <div style="display:flex;align-items:center"><div class="icon-badge" style="background:var(--surface)">${p.logo ? `<img src="${p.logo}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">` : '<i class="ti ti-building-store"></i>'}</div><span>${esc(p.name)}</span></div>
  </div>`;
}

function promptNewCategoryStandalone() {
  const name = prompt('Category name:'); if (!name) return;
  const type = prompt('Type: expense, income, or transfer?', 'expense') || 'expense';
  DB.put('categories', { id: uid(), name, type, icon: 'ti-tag', conditionalField: 'none', defaultStoreId: null, defaultAmount: null }).then(renderCategoriesManager);
}
function promptNewPayeeStandalone() {
  const name = prompt('Store name:'); if (!name) return;
  DB.put('payees', { id: uid(), name, logo: null, defaultCategoryId: null, defaultAmount: null }).then(renderCategoriesManager);
}
async function editCategoryPrompt(id) {
  const c = await DB.get('categories', id);
  const name = prompt('Category name:', c.name); if (!name) return;
  c.name = name; await DB.put('categories', c); renderCategoriesManager();
}
async function editPayeePrompt(id) {
  const p = await DB.get('payees', id);
  const name = prompt('Store name:', p.name); if (!name) return;
  p.name = name; await DB.put('payees', p); renderCategoriesManager();
}

// ---------- Init ----------
async function init() {
  await seedIfEmpty();
  renderHeader();
  Sync.onStatusChange(renderSyncPill);
  await Sync.refreshStatus();
  Sync.startPolling();
  route();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}
init();

// ============ JAZZ MODULE ============
let jazzDuplicate = null;
let jazzPhotoDrafts = [];

function goJazzMain() { currentView = 'main'; route(); }
function goJazzReport() { currentView = 'report'; route(); }

async function renderJazzMain() {
  const issues = (await DB.getAll('jazzIssues')).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const weighIns = (await DB.getAll('weightEntries')).filter((w) => w.subject === 'jazz').sort((a, b) => b.date.localeCompare(a.date));
  const issueTypes = await DB.getAll('issueTypes');
  const typeById = Object.fromEntries(issueTypes.map((t) => [t.id, t]));

  const ongoingCount = issues.filter((i) => i.status === 'ongoing').length;
  const latestWeight = weighIns[0] ? weighIns[0].value + ' lbs' : '—';

  const items = [
    ...issues.map((i) => ({ kind: 'issue', date: i.startDate, data: i })),
    ...weighIns.map((w) => ({ kind: 'weight', date: w.date, data: w }))
  ].sort((a, b) => b.date.localeCompare(a.date));

  const byDay = {};
  items.forEach((it) => { (byDay[it.date] = byDay[it.date] || []).push(it); });
  const days = Object.keys(byDay).sort().reverse();

  $main.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><p class="label">Current weight</p><p class="value">${latestWeight}</p></div>
      <div class="stat" style="background:${ongoingCount ? 'var(--gold-soft)' : 'var(--surface-raised)'}"><p class="label" style="color:${ongoingCount ? '#8a6412' : 'var(--ink-soft)'}">Ongoing issues</p><p class="value" style="color:${ongoingCount ? '#8a6412' : 'var(--ink)'}">${ongoingCount}</p></div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px"><button class="btn" style="flex:1" onclick="goJazzReport()"><i class="ti ti-chart-bar"></i> Report</button><button class="btn" style="flex:1" onclick="logJazzWeighIn()"><i class="ti ti-scale"></i> Log weigh-in</button></div>
    <div class="search-box"><i class="ti ti-search"></i><input id="jazzSearch" placeholder="Search issues, meds, notes..."></div>
    <div id="jazzList">${days.length ? days.map((d) => renderJazzDayGroup(d, byDay[d], typeById)).join('') : '<div class="empty-state">Nothing logged yet. Tap + to add an issue or weigh-in.</div>'}</div>
  `;
  document.getElementById('jazzSearch').addEventListener('input', (e) => filterJazz(e.target.value, days, byDay, typeById));
}

function renderJazzDayGroup(date, dayItems, typeById) {
  return `<div class="section-title"><span>${fmtDate(date)}</span></div>${dayItems.map((it) => renderJazzItem(it, typeById)).join('')}`;
}

function renderJazzItem(it, typeById) {
  if (it.kind === 'weight') {
    return `<div class="entry-row"><div class="entry-icon"><i class="ti ti-scale" style="color:var(--ink-soft)"></i></div>
      <div class="entry-body"><div class="entry-top"><span class="entry-title">Weigh-in</span><span class="entry-value">${it.data.value} lbs</span></div>${it.data.note ? `<div class="entry-desc">${esc(it.data.note)}</div>` : ''}</div></div>`;
  }
  const issue = it.data;
  const type = typeById[issue.typeId] || {};
  return `<div class="entry-row" onclick="openIssue('${issue.id}')">
    <div class="entry-icon"><i class="ti ${type.icon || 'ti-stethoscope'}" style="color:var(--rose)"></i></div>
    <div class="entry-body">
      <div class="entry-top"><span class="entry-title">${esc(type.name || 'Issue')}</span><span class="pill-sm ${issue.status === 'ongoing' ? 'pill-ongoing' : 'pill-resolved'}">${issue.status === 'ongoing' ? 'Ongoing' : 'Resolved'}</span></div>
      <div class="entry-meta">${issue.severity}${issue.medGiven ? ' · meds given' : ''}${issue.vetVisit ? ' · vet visit' : ''}${issue.medCost || issue.vetCost ? ' · ' + fmtMoney((issue.medCost||0)+(issue.vetCost||0)) : ''}</div>
      ${issue.description ? `<div class="entry-desc">${esc(issue.description)}</div>` : ''}
    </div>
  </div>`;
}

function filterJazz(q, days, byDay, typeById) {
  q = q.trim().toLowerCase();
  const list = document.getElementById('jazzList');
  if (!q) { list.innerHTML = days.map((d) => renderJazzDayGroup(d, byDay[d], typeById)).join(''); return; }
  const filtered = {};
  days.forEach((d) => {
    const m = byDay[d].filter((it) => {
      if (it.kind === 'weight') return ('weigh-in ' + (it.data.note||'')).toLowerCase().includes(q);
      const type = typeById[it.data.typeId] || {};
      return `${type.name||''} ${it.data.description||''} ${it.data.medName||''}`.toLowerCase().includes(q);
    });
    if (m.length) filtered[d] = m;
  });
  const keys = Object.keys(filtered);
  list.innerHTML = keys.length ? keys.map((d) => renderJazzDayGroup(d, filtered[d], typeById)).join('') : '<div class="empty-state">No matches.</div>';
}

async function renderAddIssue() {
  const issueTypes = await DB.getAll('issueTypes');
  const vetClinics = await DB.getAll('vetClinics');
  const src = jazzDuplicate;

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goJazzMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Log an issue</span></div>
    <div class="field"><label class="field-label">Started</label><input type="date" id="j_date" value="${todayStr()}"></div>
    <div class="field"><label class="field-label">Issue type</label>
      <select id="j_type" onchange="if(this.value==='__new') promptNewIssueType()">
        ${issueTypes.map((t) => `<option value="${t.id}" ${src && src.typeId===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}
        <option value="__new">+ Add type</option>
      </select>
    </div>
    <label class="field-label">Severity</label>
    <div class="btn-toggle-row" id="severityToggle">
      <button class="btn-toggle" onclick="selectSeverity(this,'Mild')">Mild</button>
      <button class="btn-toggle" onclick="selectSeverity(this,'Moderate')">Moderate</button>
      <button class="btn-toggle" onclick="selectSeverity(this,'Severe')">Severe</button>
    </div>
    <label class="field-label">Status</label>
    <div class="btn-toggle-row" id="statusToggle">
      <button class="btn-toggle" onclick="selectStatus(this,'ongoing')">Ongoing</button>
      <button class="btn-toggle" onclick="selectStatus(this,'resolved')">Resolved</button>
    </div>
    <div class="field"><label class="field-label">Description</label><textarea id="j_description" placeholder="What's happening, when it started, any pattern..."></textarea></div>

    <div class="card tight" style="background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label class="field-label" style="margin:0">Medication given</label>
        <button type="button" class="chip" id="medToggle" onclick="toggleMed()">No</button>
      </div>
      <div id="medFields" style="display:none">
        <input id="j_medName" placeholder="Medication name" style="margin-bottom:8px">
        <input id="j_medFreq" placeholder="How often" style="margin-bottom:8px">
        <input id="j_medCost" type="number" step="0.01" placeholder="Cost (optional)">
      </div>
    </div>

    <div class="card tight" style="background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label class="field-label" style="margin:0">Vet visit linked</label>
        <button type="button" class="chip" id="vetToggle" onclick="toggleVet()">No</button>
      </div>
      <div id="vetFields" style="display:none">
        <select id="j_vetClinic" style="margin-bottom:8px" onchange="if(this.value==='__new') promptNewVetClinic()">
          ${vetClinics.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
          <option value="__new">+ Add clinic</option>
        </select>
        <input id="j_vetCost" type="number" step="0.01" placeholder="Cost (optional)">
      </div>
    </div>

    <label class="field-label">Photos</label>
    <div class="photo-grid" id="jazzPhotoGrid">${renderPhotoGrid(jazzPhotoDrafts, 'jazz')}</div>

    <button class="btn btn-primary" onclick="saveIssue()">Save entry</button>
  `;
  selectSeverity(document.querySelector('#severityToggle .btn-toggle'), 'Mild');
  selectStatus(document.querySelector('#statusToggle .btn-toggle'), 'ongoing');
}

function selectSeverity(btn, val) { btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral')); btn.classList.add('active-neutral'); window.__severity = val; }
function selectStatus(btn, val) { btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral')); btn.classList.add('active-neutral'); window.__status = val; }
function toggleMed() { window.__medGiven = !window.__medGiven; document.getElementById('medToggle').textContent = window.__medGiven ? 'Yes' : 'No'; document.getElementById('medFields').style.display = window.__medGiven ? 'block' : 'none'; }
function toggleVet() { window.__vetVisit = !window.__vetVisit; document.getElementById('vetToggle').textContent = window.__vetVisit ? 'Yes' : 'No'; document.getElementById('vetFields').style.display = window.__vetVisit ? 'block' : 'none'; }

function renderPhotoGrid(drafts, prefix) {
  let html = drafts.map((d, i) => `<div class="photo-slot"><img src="${d}"></div>`).join('');
  if (drafts.length < 6) html += `<div class="photo-slot" onclick="document.getElementById('${prefix}FileInput').click()"><i class="ti ti-plus"></i></div>`;
  html += `<input type="file" id="${prefix}FileInput" accept="image/*" multiple style="display:none" onchange="handlePhotoUpload(event,'${prefix}')">`;
  return html;
}
function getPhotoDraftArray(prefix) {
  if (prefix === 'jazz') return jazzPhotoDrafts;
  return garagePhotoDrafts; // 'garage' (add vehicle) and 'garage2' (add cost) share the same draft array, cleared on save
}
function handlePhotoUpload(e, prefix) {
  const files = Array.from(e.target.files);
  const target = getPhotoDraftArray(prefix);
  let remaining = files.length;
  files.forEach((f) => {
    const reader = new FileReader();
    reader.onload = () => { target.push(reader.result); if (--remaining === 0) { const g = document.getElementById(prefix+'PhotoGrid'); if (g) g.innerHTML = renderPhotoGrid(target, prefix); } };
    reader.readAsDataURL(f);
  });
}

function promptNewIssueType() {
  const name = prompt('New issue type name:'); if (!name) return;
  DB.put('issueTypes', { id: uid(), name, icon: 'ti-stethoscope' }).then(renderAddIssue);
}
function promptNewVetClinic() {
  const name = prompt('Vet clinic name:'); if (!name) return;
  DB.put('vetClinics', { id: uid(), name }).then(renderAddIssue);
}

async function saveIssue() {
  const typeId = document.getElementById('j_type').value;
  const startDate = document.getElementById('j_date').value || todayStr();
  const issue = {
    id: uid(), typeId, startDate, endDate: null,
    severity: window.__severity || 'Mild', status: window.__status || 'ongoing',
    description: document.getElementById('j_description').value.trim(),
    medGiven: !!window.__medGiven,
    medName: window.__medGiven ? document.getElementById('j_medName').value : '',
    medFreq: window.__medGiven ? document.getElementById('j_medFreq').value : '',
    medCost: window.__medGiven ? parseFloat(document.getElementById('j_medCost').value) || 0 : 0,
    vetVisit: !!window.__vetVisit,
    vetClinicId: window.__vetVisit ? document.getElementById('j_vetClinic').value : null,
    vetCost: window.__vetVisit ? parseFloat(document.getElementById('j_vetCost').value) || 0 : 0,
    photos: [...jazzPhotoDrafts],
    updates: [],
    synced: false
  };
  await DB.put('jazzIssues', issue);
  Sync.pushEntry('Jazz', issue).then(() => DB.put('jazzIssues', issue));
  jazzPhotoDrafts = []; window.__medGiven = false; window.__vetVisit = false;
  currentView = 'main'; route();
}

let currentIssueId = null;
function openIssue(id) { currentIssueId = id; currentView = 'issueDetail'; route(); }

async function renderIssueDetail() {
  const issue = await DB.get('jazzIssues', currentIssueId);
  const types = await DB.getAll('issueTypes');
  const type = types.find((t) => t.id === issue.typeId) || {};
  const days = Math.max(1, Math.round((new Date(issue.endDate || todayStr()) - new Date(issue.startDate)) / 86400000) + 1);

  $main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <div class="back" style="cursor:pointer" onclick="goJazzMain()"><i class="ti ti-arrow-left"></i> <i class="ti ${type.icon||'ti-stethoscope'}" style="margin-left:8px"></i> <span style="font-family:'Fraunces',serif;font-size:16px;margin-left:6px">${esc(type.name||'Issue')}</span></div>
      <span class="pill-sm ${issue.status === 'ongoing' ? 'pill-ongoing' : 'pill-resolved'}">${issue.status === 'ongoing' ? 'Ongoing' : 'Resolved'}</span>
    </div>
    <p style="font-size:11px;color:var(--ink-soft);margin-bottom:16px">Started ${fmtDate(issue.startDate)} · ${days} day${days===1?'':'s'} so far</p>

    <div class="thread-item"><p class="meta">${fmtDate(issue.startDate)} · ${issue.severity}</p><p class="note">${esc(issue.description||'')}</p>${issue.medGiven ? `<p class="meta">Medication: ${esc(issue.medName)}, ${esc(issue.medFreq)}</p>` : ''}</div>
    ${(issue.updates||[]).map((u) => `<div class="thread-item"><p class="meta">${fmtDate(u.date)} · ${u.severity}</p><p class="note">${esc(u.note)}</p></div>`).join('')}

    <button class="btn" style="margin-bottom:10px" onclick="addIssueUpdate()"><i class="ti ti-plus"></i> Add update</button>
    ${issue.status === 'ongoing' ? `<button class="btn" style="background:var(--sage-soft);color:#0F6E56;border-color:var(--sage)" onclick="markIssueResolved()"><i class="ti ti-check"></i> Mark resolved</button>` : ''}
  `;
}

async function addIssueUpdate() {
  const note = prompt('What\'s the update?'); if (!note) return;
  const severity = prompt('Severity now (Mild/Moderate/Severe)?', 'Mild') || 'Mild';
  const issue = await DB.get('jazzIssues', currentIssueId);
  issue.updates = issue.updates || [];
  issue.updates.push({ date: todayStr(), severity, note });
  await DB.put('jazzIssues', issue);
  Sync.pushEntry('Jazz', issue).then(() => DB.put('jazzIssues', issue)); // appends a fresh snapshot row; the Sheet is an append-only log, not an editable mirror
  renderIssueDetail();
}
async function markIssueResolved() {
  const issue = await DB.get('jazzIssues', currentIssueId);
  issue.status = 'resolved'; issue.endDate = todayStr();
  await DB.put('jazzIssues', issue);
  Sync.pushEntry('Jazz', issue).then(() => DB.put('jazzIssues', issue));
  renderIssueDetail();
}

async function renderJazzReport() {
  const issues = await DB.getAll('jazzIssues');
  const types = await DB.getAll('issueTypes');
  const typeById = Object.fromEntries(types.map((t) => [t.id, t]));
  const ongoing = issues.filter((i) => i.status === 'ongoing').length;
  const medCosts = issues.reduce((s, i) => s + (i.medCost || 0), 0);
  const vetCosts = issues.reduce((s, i) => s + (i.vetCost || 0), 0);
  const byType = {};
  issues.forEach((i) => { const n = (typeById[i.typeId]||{}).name || 'Other'; byType[n] = (byType[n]||0)+1; });

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goJazzMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Jazz's report</span></div>
    <div class="stat-grid">
      <div class="stat"><p class="label">Issues logged</p><p class="value">${issues.length}</p></div>
      <div class="stat" style="background:${ongoing?'var(--gold-soft)':'var(--surface-raised)'}"><p class="label">Ongoing</p><p class="value">${ongoing}</p></div>
    </div>
    <div class="stat-grid">
      <div class="stat"><p class="label">Med costs</p><p class="value">${fmtMoney(medCosts)}</p></div>
      <div class="stat"><p class="label">Vet costs</p><p class="value">${fmtMoney(vetCosts)}</p></div>
    </div>
    <p class="section-label">Issues by type</p>
    ${Object.keys(byType).length ? Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([n,c]) => `<div class="list-row"><span>${esc(n)}</span><span>${c}</span></div>`).join('') : '<div class="empty-state">No issues logged yet.</div>'}
  `;
}

// ============ WEIGHT MODULE (family) ============
let weightPerson = 'You';
function goWeightMain() { currentView = 'main'; route(); }
function selectWeightPerson(person) { weightPerson = person; renderWeightMain(); }

async function renderWeightMain() {
  const all = (await DB.getAll('weightEntries')).filter((w) => w.subject === weightPerson.toLowerCase());
  const sorted = [...all].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  const prev = sorted[1];
  const diff = latest && prev ? +(latest.value - prev.value).toFixed(1) : null;

  $main.innerHTML = `
    <div class="btn-toggle-row">
      <button class="btn-toggle ${weightPerson==='You'?'active-neutral':''}" onclick="selectWeightPerson('You')">You</button>
      <button class="btn-toggle ${weightPerson==='Wife'?'active-neutral':''}" onclick="selectWeightPerson('Wife')">Wife</button>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div><p class="label" style="font-size:11px;color:var(--ink-soft)">Latest</p><p class="big" style="font-size:24px">${latest ? latest.value + ' lbs' : '—'}</p></div>
        ${diff !== null ? `<div style="text-align:right"><p class="label" style="font-size:11px;color:var(--ink-soft)">Since last</p><p style="font-weight:600;color:${diff<=0?'#0F6E56':'var(--red)'}">${diff>0?'+':''}${diff} lbs</p></div>` : ''}
      </div>
    </div>
    <p class="section-label">History</p>
    <div id="weightList">${sorted.length ? sorted.map((w) => `<div class="list-row" style="cursor:default"><div><span>${fmtDate(w.date)}</span>${w.note ? `<div class="entry-desc">${esc(w.note)}</div>` : ''}</div><span style="font-weight:600">${w.value} lbs</span></div>`).join('') : '<div class="empty-state">No entries yet.</div>'}</div>
  `;
}

async function renderAddWeight() {
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goWeightMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Log weight — ${weightPerson}</span></div>
    <div class="field"><label class="field-label">Date</label><input type="date" id="w_date" value="${todayStr()}"></div>
    <div class="field"><label class="field-label">Weight (lbs)</label><input type="number" step="0.1" id="w_value" placeholder="0.0"></div>
    <div class="field"><label class="field-label">Notes</label><input id="w_note" placeholder="Optional"></div>
    <button class="btn btn-primary" onclick="saveWeight()">Save entry</button>
  `;
}

async function saveWeight() {
  const value = parseFloat(document.getElementById('w_value').value);
  if (!value) { alert('Enter a weight value.'); return; }
  const entry = { id: uid(), subject: weightPerson.toLowerCase(), date: document.getElementById('w_date').value || todayStr(), value, note: document.getElementById('w_note').value.trim(), synced: false };
  await DB.put('weightEntries', entry);
  Sync.pushEntry('Weight', entry).then(() => DB.put('weightEntries', entry));
  currentView = 'main'; route();
}

async function logJazzWeighIn() {
  const value = parseFloat(prompt('Jazz\'s weight (lbs)?'));
  if (!value) return;
  const note = prompt('Note (optional):') || '';
  const entry = { id: uid(), subject: 'jazz', date: todayStr(), value, note, synced: false };
  await DB.put('weightEntries', entry);
  Sync.pushEntry('Weight', entry).then(() => DB.put('weightEntries', entry));
  renderJazzMain();
}

// ============ MORE / SETTINGS MODULE ============
let moreView = 'main'; // main | carsProjects | expenseRepairTypes

function goMoreMain() { moreView = 'main'; renderMore(); }

async function renderMore() {
  if (moreView === 'carsProjects') return renderCarsProjectsManager();
  if (moreView === 'expenseRepairTypes') return renderExpenseRepairManager();

  const meta = await DB.get('settings', 'meta');
  const sheetUrl = meta ? meta.sheetUrl : '';

  $main.innerHTML = `
    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft)">Overview</p>
    <div class="list-row" onclick="currentTab='finance';currentView='reports';document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='finance'));route()"><span><i class="ti ti-chart-bar"></i> Finance reports</span><i class="ti ti-chevron-right"></i></div>
    <div class="list-row" onclick="currentTab='jazz';currentView='report';document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='jazz'));route()"><span><i class="ti ti-heart-rate-monitor"></i> Jazz's health report</span><i class="ti ti-chevron-right"></i></div>

    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);margin-top:16px">Finance</p>
    <div class="list-row" onclick="currentTab='finance';currentView='categories';document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='finance'));route()"><span><i class="ti ti-tag"></i> Categories & stores</span><i class="ti ti-chevron-right"></i></div>
    <div class="list-row" onclick="moreView='carsProjects';renderMore()"><span><i class="ti ti-car"></i> Cars & projects</span><i class="ti ti-chevron-right"></i></div>

    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);margin-top:16px">Garage</p>
    <div class="list-row" onclick="moreView='expenseRepairTypes';renderMore()"><span><i class="ti ti-tool"></i> Expense & repair types</span><i class="ti ti-chevron-right"></i></div>

    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);margin-top:16px">Sync & data</p>
    <div class="card tight">
      <label class="field-label">Google Sheet Web App URL</label>
      <input id="sheetUrlInput" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(sheetUrl)}" style="margin-bottom:8px">
      <button class="btn btn-primary" onclick="saveSheetUrl()">Save</button>
    </div>
    <div class="card tight" style="display:flex;justify-content:space-between;align-items:center">
      <span class="status-pill ${Sync.status}" id="moreSyncPill"><i class="ti ti-cloud"></i> <span id="moreSyncText"></span></span>
      <button class="btn" style="width:auto;padding:8px 14px" onclick="Sync.retryAllPending().then(renderMore)">Retry sync</button>
    </div>
    <div class="card tight">
      <label class="field-label">Import historical data</label>
      <p style="font-size:12px;color:var(--ink-soft);margin-bottom:10px">Upload a converted <code>import-data.json</code> file to bring in past entries. This file never leaves your device except to sync to your own Sheet afterward.</p>
      <input type="file" accept=".json" onchange="handleImportFile(event)" style="margin-bottom:8px">
      <p id="importStatus" style="font-size:12px;color:var(--ink-soft)"></p>
    </div>
  `;
  updateMoreSyncPill();
}
function updateMoreSyncPill() {
  const pill = document.getElementById('moreSyncPill');
  if (!pill) return;
  const map = { synced: ['ti-check', 'Synced'], syncing: ['ti-refresh', 'Syncing…'], pending: ['ti-clock', 'Pending'], offline: ['ti-cloud-off', 'Not connected'] };
  const [icon, label] = map[Sync.status] || map.offline;
  pill.className = 'status-pill ' + Sync.status;
  pill.innerHTML = `<i class="ti ${icon}"></i> <span>${label}</span>`;
}
async function saveSheetUrl() {
  const url = document.getElementById('sheetUrlInput').value.trim();
  const meta = (await DB.get('settings', 'meta')) || { id: 'meta' };
  meta.sheetUrl = url;
  await DB.put('settings', meta);
  try {
    await Sync.refreshStatus();
    Sync.retryAllPending();
  } catch (err) {
    console.warn('Sync status/retry hit an error, but the URL was saved:', err.message);
  }
  renderMore();
}

// ---------- Cars & Projects manager ----------
let carsProjectsTab = 'cars';
async function renderCarsProjectsManager() {
  const cars = await DB.getAll('cars');
  const projects = await DB.getAll('projects');
  const list = carsProjectsTab === 'cars' ? cars : projects;
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMoreMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Cars & projects</span></div>
    <div class="chip-row">
      <button class="chip ${carsProjectsTab==='cars'?'active':''}" onclick="carsProjectsTab='cars';renderCarsProjectsManager()">Cars</button>
      <button class="chip ${carsProjectsTab==='projects'?'active':''}" onclick="carsProjectsTab='projects';renderCarsProjectsManager()">Projects</button>
    </div>
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="${carsProjectsTab==='cars'?'addCarPrompt()':'addProjectPrompt()'}"><i class="ti ti-plus"></i> Add ${carsProjectsTab==='cars'?'car':'project'}</button>
    <div>${list.map((item) => `<div class="list-row" onclick="${carsProjectsTab==='cars'?'editCarPrompt':'editProjectPrompt'}('${item.id}')"><span>${esc(item.name)}</span><i class="ti ti-chevron-right"></i></div>`).join('') || '<div class="empty-state">None yet.</div>'}</div>
  `;
}
function addCarPrompt() { const name = prompt('Car name:'); if (!name) return; DB.put('cars', { id: uid(), name }).then(renderCarsProjectsManager); }
function addProjectPrompt() { const name = prompt('Project name:'); if (!name) return; DB.put('projects', { id: uid(), name }).then(renderCarsProjectsManager); }
async function editCarPrompt(id) { const c = await DB.get('cars', id); const name = prompt('Car name:', c.name); if (!name) return; c.name = name; await DB.put('cars', c); renderCarsProjectsManager(); }
async function editProjectPrompt(id) { const p = await DB.get('projects', id); const name = prompt('Project name:', p.name); if (!name) return; p.name = name; await DB.put('projects', p); renderCarsProjectsManager(); }

// ---------- Garage Expense & Repair types manager ----------
let expenseRepairTab = 'expense';
async function renderExpenseRepairManager() {
  const expenseTypes = await DB.getAll('expenseTypes');
  const repairTypes = await DB.getAll('repairTypes');
  const list = expenseRepairTab === 'expense' ? expenseTypes : repairTypes;
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMoreMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Expense & repair types</span></div>
    <div class="chip-row">
      <button class="chip ${expenseRepairTab==='expense'?'active':''}" onclick="expenseRepairTab='expense';renderExpenseRepairManager()">Expense types</button>
      <button class="chip ${expenseRepairTab==='repair'?'active':''}" onclick="expenseRepairTab='repair';renderExpenseRepairManager()">Repair types</button>
    </div>
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="${expenseRepairTab==='expense'?'addExpenseTypePrompt()':'addRepairTypePrompt()'}"><i class="ti ti-plus"></i> Add ${expenseRepairTab==='expense'?'expense type':'repair type'}</button>
    <div>${list.map((item) => expenseRepairTab==='expense'
      ? `<div class="list-row" onclick="editExpenseTypePrompt('${item.id}')"><span><i class="ti ${item.icon||'ti-tool'}"></i> ${esc(item.name)}</span><i class="ti ti-chevron-right"></i></div>`
      : `<div class="list-row" onclick="editRepairTypePrompt('${item.id}')"><span>${esc(item.name)}</span><i class="ti ti-chevron-right"></i></div>`
    ).join('') || '<div class="empty-state">None yet.</div>'}</div>
  `;
}
function addExpenseTypePrompt() {
  const name = prompt('Expense type name:'); if (!name) return;
  const hasRepair = confirm('Needs a repair-subtype dropdown (like Mechanical Repairs)?');
  DB.put('expenseTypes', { id: uid(), name, icon: 'ti-tool', hasRepairSubtype: hasRepair }).then(renderExpenseRepairManager);
}
function addRepairTypePrompt() { const name = prompt('Repair type name:'); if (!name) return; DB.put('repairTypes', { id: uid(), name }).then(renderExpenseRepairManager); }
async function editExpenseTypePrompt(id) { const t = await DB.get('expenseTypes', id); const name = prompt('Expense type name:', t.name); if (!name) return; t.name = name; await DB.put('expenseTypes', t); renderExpenseRepairManager(); }
async function editRepairTypePrompt(id) { const t = await DB.get('repairTypes', id); const name = prompt('Repair type name:', t.name); if (!name) return; t.name = name; await DB.put('repairTypes', t); renderExpenseRepairManager(); }

function promptNewCarInline() {
  const name = prompt('New car name:'); if (!name) { document.getElementById('f_car').value = ''; return; }
  DB.put('cars', { id: uid(), name }).then((c) => { window.__cars.push(c); onCategoryChange(true); document.getElementById('f_car').value = c.id; });
}
function promptNewProjectInline() {
  const name = prompt('New project name:'); if (!name) { document.getElementById('f_project').value = ''; return; }
  DB.put('projects', { id: uid(), name }).then((p) => { window.__projects.push(p); onCategoryChange(true); document.getElementById('f_project').value = p.id; });
}
