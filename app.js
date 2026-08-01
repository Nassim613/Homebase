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
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtDateYear(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function monthKey(d) { return d.slice(0, 7); }
function esc(s) { return (s || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

const CATEGORY_COLOR_PALETTE = ['#E3A94E', '#7C9473', '#C97B84', '#2A78D6', '#8A6BC9', '#D4783F', '#4A9D8F', '#B5568C'];
function categoryColor(catId) {
  if (!catId) return CATEGORY_COLOR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < catId.length; i++) hash = (hash * 31 + catId.charCodeAt(i)) | 0;
  return CATEGORY_COLOR_PALETTE[Math.abs(hash) % CATEGORY_COLOR_PALETTE.length];
}

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
    if (currentView === 'categoryForm') return renderCategoryForm();
    if (currentView === 'storeForm') return renderStoreForm();
    if (currentView === 'reports') return renderReportsStub();
    if (currentView === 'foodBudget') return renderFoodBudget();
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
// ---------- Finance range & type filter state ----------
let financeRange = 'thisMonth'; // thisMonth | lastMonth | last3Months | lastWeek | last6Months | lastYear | last2Years | allTime
let financeTypeFilter = null; // null | 'income' | 'expense' | 'transfer'
let financeSortBy = 'date'; // date | amount
const FINANCE_RANGE_LABELS = { thisMonth: 'This month', lastMonth: 'Last month', last3Months: 'Last 3 months', lastWeek: 'Last 7 days', last6Months: 'Last 6 months', lastYear: 'Last year', last2Years: 'Last 2 years', allTime: 'All time' };

function fmtISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function getFinanceRangeBounds(range) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  if (range === 'lastMonth') return { start: fmtISO(new Date(y, m - 1, 1)), end: fmtISO(new Date(y, m, 0)) };
  if (range === 'last3Months') return { start: fmtISO(new Date(y, m - 2, 1)), end: fmtISO(new Date(y, m + 1, 0)) };
  if (range === 'lastWeek') { const start = new Date(now); start.setDate(start.getDate() - 6); return { start: fmtISO(start), end: fmtISO(now) }; }
  if (range === 'last6Months') return { start: fmtISO(new Date(y, m - 5, 1)), end: fmtISO(new Date(y, m + 1, 0)) };
  if (range === 'lastYear') return { start: fmtISO(new Date(y - 1, m, 1)), end: fmtISO(now) };
  if (range === 'last2Years') return { start: fmtISO(new Date(y - 2, m, 1)), end: fmtISO(now) };
  if (range === 'allTime') return { start: '0000-01-01', end: '9999-12-31' };
  return { start: fmtISO(new Date(y, m, 1)), end: fmtISO(new Date(y, m + 1, 0)) }; // thisMonth
}
function setFinanceRange(r) { financeRange = r; renderFinanceMain(); }
function toggleFinanceTypeFilter(t) { financeTypeFilter = financeTypeFilter === t ? null : t; renderFinanceMain(); }
function setFinanceSort(s) { financeSortBy = s; renderFinanceMain(); }
function toggleCollapse(el) {
  const body = el.nextElementSibling;
  const icon = el.querySelector('.collapse-chevron');
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (icon) icon.className = 'ti collapse-chevron ti-chevron-' + (open ? 'right' : 'down');
}
function netOf(list) {
  return list.filter((e) => e.type !== 'transfer').reduce((s, e) => s + (e.type === 'income' ? e.amount : -e.amount), 0);
}

async function renderFinanceMain() {
  const entries = (await DB.getAll('entries')).sort((a, b) => b.date.localeCompare(a.date));
  const categories = await DB.getAll('categories');
  const payees = await DB.getAll('payees');
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const payeeById = Object.fromEntries(payees.map((p) => [p.id, p]));

  const { start, end } = getFinanceRangeBounds(financeRange);
  const inRange = entries.filter((e) => e.date >= start && e.date <= end);
  const income = inRange.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const expense = inRange.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const transfer = inRange.filter((e) => e.type === 'transfer').reduce((s, e) => s + e.amount, 0);
  const net = income - expense;

  const listSource = financeTypeFilter ? inRange.filter((e) => e.type === financeTypeFilter) : inRange;

  $main.innerHTML = `
    <div class="chip-row">
      <button class="chip ${financeRange==='thisMonth'?'active':''}" onclick="setFinanceRange('thisMonth')">This month</button>
      <button class="chip ${financeRange==='lastWeek'?'active':''}" onclick="setFinanceRange('lastWeek')">Last 7 days</button>
      <button class="chip ${financeRange==='lastMonth'?'active':''}" onclick="setFinanceRange('lastMonth')">Last month</button>
      <button class="chip ${financeRange==='last3Months'?'active':''}" onclick="setFinanceRange('last3Months')">Last 3 months</button>
      <button class="chip ${financeRange==='last6Months'?'active':''}" onclick="setFinanceRange('last6Months')">Last 6 months</button>
      <button class="chip ${financeRange==='lastYear'?'active':''}" onclick="setFinanceRange('lastYear')">Last year</button>
      <button class="chip ${financeRange==='last2Years'?'active':''}" onclick="setFinanceRange('last2Years')">Last 2 years</button>
      <button class="chip ${financeRange==='allTime'?'active':''}" onclick="setFinanceRange('allTime')">All time</button>
    </div>
    <div class="card hero-card" style="background:${net >= 0 ? 'var(--sage-soft)' : 'var(--rose-soft)'}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <p class="label" style="color:${net >= 0 ? '#0F6E56' : 'var(--red)'}">Net · ${FINANCE_RANGE_LABELS[financeRange]}</p>
        <i class="ti ${net >= 0 ? 'ti-trending-up' : 'ti-trending-down'}" style="color:${net >= 0 ? '#0F6E56' : 'var(--red)'}"></i>
      </div>
      <p class="big" style="color:${net >= 0 ? '#0F6E56' : 'var(--red)'}">${net >= 0 ? '+' : ''}${fmtMoney(net)}</p>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
      <div class="stat" style="cursor:pointer;${financeTypeFilter==='income'?'outline:2px solid #0F6E56':''}" onclick="toggleFinanceTypeFilter('income')"><p class="label">Income</p><p class="value" style="color:#0F6E56;font-size:13px">${fmtMoney(income)}</p></div>
      <div class="stat" style="cursor:pointer;${financeTypeFilter==='expense'?'outline:2px solid var(--red)':''}" onclick="toggleFinanceTypeFilter('expense')"><p class="label">Expenses</p><p class="value" style="color:var(--red);font-size:13px">${fmtMoney(expense)}</p></div>
      <div class="stat" style="cursor:pointer;${financeTypeFilter==='transfer'?'outline:2px solid var(--gold)':''}" onclick="toggleFinanceTypeFilter('transfer')"><p class="label">Transfers</p><p class="value" style="font-size:13px">${fmtMoney(transfer)}</p></div>
    </div>
    ${financeTypeFilter ? `<p style="font-size:11px;color:var(--ink-soft);margin-bottom:14px">Showing ${financeTypeFilter} only — tap it again to clear</p>` : `<p style="font-size:11px;color:var(--ink-soft);margin-bottom:14px">Tap Income, Expenses, or Transfers to filter the list</p>`}

    <div class="search-box"><i class="ti ti-search"></i><input id="financeSearch" placeholder="Search description, store, category, amount..."></div>

    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn" style="flex:1" onclick="goCategories()"><i class="ti ti-tag"></i> Categories & stores</button>
      <button class="btn" style="flex:1" onclick="goReports()"><i class="ti ti-chart-bar"></i> Reports</button>
    </div>
    <button class="btn" style="margin-bottom:14px" onclick="goFoodBudget()"><i class="ti ti-shopping-cart"></i> Food budget by week</button>

    <div class="chip-row">
      <span style="font-size:11px;color:var(--ink-soft);align-self:center;margin-right:2px">Sort:</span>
      <button class="chip ${financeSortBy==='date'?'active':''}" onclick="setFinanceSort('date')">Date</button>
      <button class="chip ${financeSortBy==='amount'?'active':''}" onclick="setFinanceSort('amount')">Amount (highest first)</button>
    </div>

    <div id="entryList">${renderFinanceList(listSource, catById, payeeById)}</div>
  `;

  document.getElementById('financeSearch').addEventListener('input', (e) => filterEntriesLive(e.target.value, listSource, catById, payeeById));
}

function renderFinanceList(list, catById, payeeById) {
  if (!list.length) return '<div class="empty-state">No entries in this range.</div>';
  if (financeSortBy === 'amount') {
    const sorted = [...list].sort((a, b) => b.amount - a.amount);
    return sorted.map((e) => renderEntryRow(e, catById, payeeById, true)).join('');
  }
  const byYear = {};
  list.forEach((e) => {
    const y = e.date.slice(0, 4);
    (byYear[y] = byYear[y] || []).push(e);
  });
  const years = Object.keys(byYear).sort().reverse();
  return years.map((y, yi) => renderYearGroup(y, byYear[y], catById, payeeById, yi === 0)).join('');
}

function collapseHeader(level, label, netVal, indent, openByDefault) {
  return `<div class="section-title" style="cursor:pointer;padding-left:${indent}px" onclick="toggleCollapse(this)">
    <span>${label} <i class="ti collapse-chevron ti-chevron-${openByDefault ? 'down' : 'right'}" style="font-size:11px;vertical-align:-1px"></i></span>
    <span class="amt ${netVal < 0 ? 'neg' : 'pos'}">${netVal >= 0 ? '+' : ''}${fmtMoney(netVal)}</span>
  </div>`;
}

function renderYearGroup(year, yearEntries, catById, payeeById, openByDefault) {
  const byMonth = {};
  yearEntries.forEach((e) => { const mk = monthKey(e.date); (byMonth[mk] = byMonth[mk] || []).push(e); });
  const months = Object.keys(byMonth).sort().reverse();
  return `
    ${collapseHeader('year', year, netOf(yearEntries), 0, openByDefault)}
    <div class="collapse-body" style="display:${openByDefault ? 'block' : 'none'}">
      ${months.map((mk, mi) => renderMonthGroup(mk, byMonth[mk], catById, payeeById, openByDefault && mi === 0)).join('')}
    </div>
  `;
}

function renderMonthGroup(mk, monthEntries, catById, payeeById, openByDefault) {
  const label = new Date(mk + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long' });
  const byDay = {};
  monthEntries.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
  const days = Object.keys(byDay).sort().reverse();
  return `
    ${collapseHeader('month', label, netOf(monthEntries), 14, openByDefault)}
    <div class="collapse-body" style="display:${openByDefault ? 'block' : 'none'}">
      ${days.map((d, di) => renderDayGroup(d, byDay[d], catById, payeeById, openByDefault && di === 0)).join('')}
    </div>
  `;
}

function renderDayGroup(date, dayEntries, catById, payeeById, openByDefault) {
  return `
    ${collapseHeader('day', fmtDate(date), netOf(dayEntries), 28, openByDefault !== false)}
    <div class="collapse-body" style="display:${openByDefault !== false ? 'block' : 'none'}">
      ${dayEntries.map((e) => renderEntryRow(e, catById, payeeById)).join('')}
    </div>
  `;
}

function renderEntryRow(e, catById, payeeById, showDate) {
  const cat = catById[e.categoryId] || {};
  const payee = payeeById[e.storeId] || {};
  let valClass, sign;
  if (e.type === 'transfer') {
    valClass = e.transferDirection === 'in' ? 'pos' : 'neg';
    sign = e.transferDirection === 'in' ? '+' : '-';
  } else {
    const isNeg = e.type === 'expense';
    valClass = isNeg ? 'neg' : 'pos';
    sign = isNeg ? '' : '+';
  }
  return `
    <div class="entry-row" onclick="openEntryDetail('${e.id}')">
      <div class="entry-icon">
        ${payee.logo ? `<img src="${payee.logo}" style="width:100%;height:100%;object-fit:cover">` : `<i class="ti ${cat.icon || 'ti-tag'}" style="color:var(--ink-soft)"></i>`}
        <div class="entry-badge" style="background:${categoryColor(e.categoryId)}22"><i class="ti ${cat.icon || 'ti-tag'}" style="color:${categoryColor(e.categoryId)}"></i></div>
      </div>
      <div class="entry-body">
        <div class="entry-top">
          <span class="entry-title">${esc(payee.name || cat.name || 'Entry')}</span>
          <span class="entry-value ${valClass}">${sign}${fmtMoney(e.amount)}</span>
        </div>
        <div class="entry-meta"><span style="font-weight:700;color:${categoryColor(e.categoryId)}">${esc(cat.name || '')}</span>${showDate ? ' · ' + fmtDate(e.date) : ''}${e.recurringId ? ' · Recurring' : ''}</div>
        ${e.description ? `<div class="entry-desc">${esc(e.description)}</div>` : ''}
      </div>
    </div>
  `;
}

function filterEntriesLive(q, listSource, catById, payeeById) {
  q = q.trim().toLowerCase();
  const list = document.getElementById('entryList');
  if (!q) { list.innerHTML = renderFinanceList(listSource, catById, payeeById); return; }
  const matches = listSource.filter((e) => {
    const cat = catById[e.categoryId] || {};
    const payee = payeeById[e.storeId] || {};
    const hay = `${cat.name || ''} ${payee.name || ''} ${e.description || ''} ${e.amount}`.toLowerCase();
    return hay.includes(q);
  });
  list.innerHTML = matches.length ? renderFinanceList(matches, catById, payeeById) : '<div class="empty-state">No matches.</div>';
}

function goCategories() { currentView = 'categories'; route(); }
function goReports() { currentView = 'reports'; route(); }
function goFoodBudget() { currentView = 'foodBudget'; route(); }

function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // shift back to Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return fmtISO(monday);
}
function getWeekLabel(weekStartStr) {
  const start = new Date(weekStartStr + 'T00:00:00');
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const f = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${f(start)} – ${f(end)}`;
}

async function renderFoodBudget() {
  const entries = await DB.getAll('entries');
  const categories = await DB.getAll('categories');
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const payees = await DB.getAll('payees');
  const payeeById = Object.fromEntries(payees.map((p) => [p.id, p]));

  const relevant = entries.filter((e) => {
    if (e.type !== 'expense') return false;
    const cat = catById[e.categoryId];
    if (!cat) return false;
    const n = cat.name.toLowerCase();
    return n.includes('groceries') || n.includes('meal kit');
  });

  const byWeek = {};
  relevant.forEach((e) => { const wk = getWeekStart(e.date); (byWeek[wk] = byWeek[wk] || []).push(e); });
  const weeks = Object.keys(byWeek).sort().reverse();

  $main.innerHTML = `
    <div class="back" style="margin-bottom:6px;cursor:pointer" onclick="goMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Food budget</span></div>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:16px">Groceries + Meal Kit, grouped by week (Monday–Sunday)</p>
    ${weeks.length ? weeks.map((wk, i) => {
      const weekEntries = byWeek[wk].sort((a, b) => b.date.localeCompare(a.date));
      const total = weekEntries.reduce((s, e) => s + e.amount, 0);
      return `
        <div class="section-title" onclick="toggleMonthSection(this)" style="cursor:pointer">
          <span>${getWeekLabel(wk)} <i class="ti ti-chevron-${i===0?'down':'right'}" style="font-size:11px;vertical-align:-1px"></i></span>
          <span class="amt neg">${fmtMoney(total)}</span>
        </div>
        <div class="month-body" style="display:${i===0?'block':'none'}">${weekEntries.map((e) => renderEntryRow(e, catById, payeeById, false)).join('')}</div>
      `;
    }).join('') : '<div class="empty-state">No Groceries or Meal Kit expenses logged yet.</div>'}
  `;
}
function goMain() { currentView = 'main'; duplicateSource = null; route(); }

// ---------- Finance Reports ----------
let reportsCategoryFilter = []; // array of category IDs; empty = all
let reportsStoreFilter = null;
let reportsTypeFilter = null;
let reportsDateRange = 'last6'; // thisMonth | last3 | last6 | thisYear | allTime
let reportsExcludedCategoryIds = [];
let reportsIncExpChart = null;
let reportsCatChart = null;

function setReportsFilter(kind, val) {
  if (kind === 'store') reportsStoreFilter = val || null;
  renderReportsStub();
}
function setReportsType(t) { reportsTypeFilter = reportsTypeFilter === t ? null : t; renderReportsStub(); }
function setReportsDateRange(r) { reportsDateRange = r; renderReportsStub(); }

async function openReportsCategoryFilterModal() {
  const categories = (await DB.getAll('categories')).filter((c) => !c.hidden).sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:6px">Filter by category</p>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:14px">Pick one or more. Leave all unchecked to show everything.</p>
    <div style="max-height:50vh;overflow-y:auto;margin-bottom:16px">
      ${categories.map((c) => `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)">
        <input type="checkbox" ${reportsCategoryFilter.includes(c.id) ? 'checked' : ''} onchange="toggleReportsCategoryFilter('${c.id}')">
        <span style="color:${categoryColor(c.id)};font-weight:600">${esc(c.name)}</span>
      </label>`).join('')}
    </div>
    <button class="btn btn-primary" style="margin-bottom:8px" onclick="closeModal();renderReportsStub();">Apply</button>
    ${reportsCategoryFilter.length ? `<button class="btn" onclick="reportsCategoryFilter=[];closeModal();renderReportsStub();">Clear selection</button>` : ''}
  `;
  openModal();
}
function toggleReportsCategoryFilter(id) {
  const idx = reportsCategoryFilter.indexOf(id);
  if (idx === -1) reportsCategoryFilter.push(id); else reportsCategoryFilter.splice(idx, 1);
}

async function selectReportsCell(categoryId, mk2) {
  const allEntries = await DB.getAll('entries');
  const categories = await DB.getAll('categories');
  const payees = await DB.getAll('payees');
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const payeeById = Object.fromEntries(payees.map((p) => [p.id, p]));
  const cat = catById[categoryId] || {};
  const matches = allEntries.filter((e) => e.categoryId === categoryId && monthKey(e.date) === mk2).sort((a, b) => b.date.localeCompare(a.date));
  const label = new Date(mk2 + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:2px">${esc(cat.name || '')}</p>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:16px">${label}</p>
    <div>${matches.length ? matches.map((e) => renderEntryRow(e, catById, payeeById, false)).join('') : '<div class="empty-state">No entries.</div>'}</div>
  `;
  openModal();
}

async function selectReportsCategoryAll(categoryId) {
  const allEntries = await DB.getAll('entries');
  const categories = await DB.getAll('categories');
  const payees = await DB.getAll('payees');
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const payeeById = Object.fromEntries(payees.map((p) => [p.id, p]));
  const cat = catById[categoryId] || {};
  const { start, end } = getFinanceRangeBoundsForKeys(getReportsMonthKeys(reportsDateRange, allEntries));
  const matches = allEntries.filter((e) => e.categoryId === categoryId && e.date >= start && e.date <= end).sort((a, b) => b.date.localeCompare(a.date));
  const total = matches.reduce((s, e) => s + e.amount, 0);
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:2px">${esc(cat.name || '')}</p>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:16px">${FINANCE_RANGE_LABELS[reportsDateRange] || 'Selected range'} · ${fmtMoney(total)} total, ${matches.length} entr${matches.length===1?'y':'ies'}</p>
    <div>${matches.length ? matches.map((e) => renderEntryRow(e, catById, payeeById, true)).join('') : '<div class="empty-state">No entries.</div>'}</div>
  `;
  openModal();
}
function getFinanceRangeBoundsForKeys(keys) {
  const sorted = [...keys].sort();
  return { start: sorted[0] + '-01', end: fmtISO(new Date(new Date(sorted[sorted.length - 1] + '-01').getFullYear(), new Date(sorted[sorted.length - 1] + '-01').getMonth() + 1, 0)) };
}

function getReportsMonthKeys(range, allEntries) {
  const now = new Date();
  if (range === 'thisMonth') return [monthKey(todayStr())];
  if (range === 'last3' || range === 'last6') {
    const n = range === 'last3' ? 3 : 6;
    const keys = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return keys;
  }
  if (range === 'thisYear') {
    const keys = [];
    for (let m = now.getMonth(); m >= 0; m--) keys.push(`${now.getFullYear()}-${String(m + 1).padStart(2, '0')}`);
    return keys;
  }
  // allTime: derive from actual data extent
  if (!allEntries.length) return [monthKey(todayStr())];
  const sorted = [...allEntries].map((e) => monthKey(e.date)).sort();
  const earliest = sorted[0], latest = sorted[sorted.length - 1];
  const keys = [];
  let [y, m] = latest.split('-').map(Number);
  const [ey, em] = earliest.split('-').map(Number);
  while (y > ey || (y === ey && m >= em)) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
    m--; if (m === 0) { m = 12; y--; }
  }
  return keys;
}

async function toggleReportsExcludeCategory(catId) {
  const idx = reportsExcludedCategoryIds.indexOf(catId);
  if (idx === -1) reportsExcludedCategoryIds.push(catId); else reportsExcludedCategoryIds.splice(idx, 1);
  renderReportsStub();
}

async function renderReportsStub() {
  const allEntries = await DB.getAll('entries');
  const categories = await DB.getAll('categories');
  const payees = await DB.getAll('payees');
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const payeeById = Object.fromEntries(payees.map((p) => [p.id, p]));

  let entries = allEntries;
  if (reportsCategoryFilter.length) entries = entries.filter((e) => reportsCategoryFilter.includes(e.categoryId));
  if (reportsStoreFilter) entries = entries.filter((e) => e.storeId === reportsStoreFilter);
  if (reportsTypeFilter) entries = entries.filter((e) => e.type === reportsTypeFilter);

  const monthKeys = getReportsMonthKeys(reportsDateRange, entries); // newest first already for thisMonth/last3/last6/thisYear/allTime
  const rangeEntries = entries.filter((e) => monthKeys.includes(monthKey(e.date)));

  const mk = monthKey(todayStr());
  const mIncome = entries.filter((e) => monthKey(e.date) === mk && e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const mExpense = entries.filter((e) => monthKey(e.date) === mk && e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const mNet = mIncome - mExpense;

  const chartMonthKeys = [...monthKeys].reverse(); // chronological, follows the selected date range fully
  const monthLabels = chartMonthKeys.map((mk2) => new Date(mk2 + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' }));
  const incomeByMonth = chartMonthKeys.map((mk2) => entries.filter((e) => monthKey(e.date) === mk2 && e.type === 'income').reduce((s, e) => s + e.amount, 0));
  const expenseByMonth = chartMonthKeys.map((mk2) => entries.filter((e) => monthKey(e.date) === mk2 && e.type === 'expense').reduce((s, e) => s + e.amount, 0));

  const TOP_CATS_EXCLUDE = ['mortgage', 'allowance', 'personal'];
  const catSpend = {};
  rangeEntries.filter((e) => e.type === 'expense').forEach((e) => {
    const name = (catById[e.categoryId] || {}).name || 'Other';
    if (TOP_CATS_EXCLUDE.some((ex) => name.toLowerCase().includes(ex))) return;
    catSpend[name] = (catSpend[name] || 0) + e.amount;
  });
  const topCats = Object.entries(catSpend).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Category x month pivot
  const tableCats = categories.filter((c) => !c.hidden && !reportsExcludedCategoryIds.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  const pivot = {}; // catId -> monthKey -> total
  tableCats.forEach((c) => { pivot[c.id] = {}; });
  rangeEntries.forEach((e) => {
    if (!pivot[e.categoryId]) return;
    pivot[e.categoryId][monthKey(e.date)] = (pivot[e.categoryId][monthKey(e.date)] || 0) + e.amount;
  });
  const monthColLabels = monthKeys.map((mk2) => new Date(mk2 + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' }));

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Reports</span></div>

    <div class="chip-row">
      <button class="chip ${reportsDateRange==='thisMonth'?'active':''}" onclick="setReportsDateRange('thisMonth')">This month</button>
      <button class="chip ${reportsDateRange==='last3'?'active':''}" onclick="setReportsDateRange('last3')">Last 3 months</button>
      <button class="chip ${reportsDateRange==='last6'?'active':''}" onclick="setReportsDateRange('last6')">Last 6 months</button>
      <button class="chip ${reportsDateRange==='thisYear'?'active':''}" onclick="setReportsDateRange('thisYear')">This year</button>
      <button class="chip ${reportsDateRange==='allTime'?'active':''}" onclick="setReportsDateRange('allTime')">All time</button>
    </div>

    <div class="field-row" style="margin-bottom:10px">
      <button class="btn" style="text-align:left" onclick="openReportsCategoryFilterModal()">
        <i class="ti ti-tag"></i> ${reportsCategoryFilter.length ? `${reportsCategoryFilter.length} categor${reportsCategoryFilter.length===1?'y':'ies'} selected` : 'All categories'}
      </button>
      <select onchange="setReportsFilter('store', this.value)">
        <option value="">All stores</option>
        ${payees.sort((a,b)=>a.name.localeCompare(b.name)).map((p) => `<option value="${p.id}" ${reportsStoreFilter===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}
      </select>
    </div>
    <div class="chip-row">
      <button class="chip ${reportsTypeFilter==='expense'?'active':''}" onclick="setReportsType('expense')">Expense</button>
      <button class="chip ${reportsTypeFilter==='income'?'active':''}" onclick="setReportsType('income')">Income</button>
      <button class="chip ${reportsTypeFilter==='transfer'?'active':''}" onclick="setReportsType('transfer')">Transfer</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
      <div class="stat"><p class="label">Income (this mo.)</p><p class="value" style="color:#0F6E56;font-size:13px">${fmtMoney(mIncome)}</p></div>
      <div class="stat"><p class="label">Expenses (this mo.)</p><p class="value" style="color:var(--red);font-size:13px">${fmtMoney(mExpense)}</p></div>
      <div class="stat" style="background:${mNet>=0?'var(--sage-soft)':'var(--rose-soft)'}"><p class="label">Net</p><p class="value" style="color:${mNet>=0?'#0F6E56':'var(--red)'};font-size:13px">${mNet>=0?'+':''}${fmtMoney(mNet)}</p></div>
    </div>

    <p class="section-label">Income vs expense</p>
    <div style="position:relative;width:100%;height:180px;margin-bottom:20px"><canvas id="reportsIncExpChart"></canvas></div>

    <p class="section-label">Top categories in range</p>
    <div style="position:relative;width:100%;height:${Math.max(100, topCats.length*32)}px;margin-bottom:20px">${topCats.length ? '<canvas id="reportsCatChart"></canvas>' : '<div class="empty-state">No expenses in this range.</div>'}</div>

    <div style="display:flex;justify-content:space-between;align-items:baseline;margin:16px 0 8px">
      <p class="section-label" style="margin:0">Category by month</p>
      <span style="font-size:11px;color:var(--ink-soft);cursor:pointer" onclick="openReportsCategoryConfig()">Configure</span>
    </div>
    <p style="font-size:11px;color:var(--ink-soft);margin-bottom:8px">Tap a category name for its full range, or a cell for just that month</p>
    <div style="overflow-x:auto;margin-bottom:16px;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:12px">
      <table style="border-collapse:collapse;font-size:12px;white-space:nowrap;width:100%">
        <thead><tr>
          <th style="text-align:left;padding:8px 12px;position:sticky;left:0;background:var(--surface-raised);color:var(--ink-soft);font-weight:600;min-width:120px;border-bottom:1px solid var(--line);border-right:1px solid var(--line)">Category</th>
          ${monthColLabels.map((l) => `<th style="text-align:right;padding:8px 12px;color:var(--ink-soft);font-weight:600;min-width:80px;border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${l}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${tableCats.map((c) => `
            <tr>
              <td onclick="selectReportsCategoryAll('${c.id}')" style="padding:8px 12px;position:sticky;left:0;background:var(--surface-raised);font-weight:700;color:${categoryColor(c.id)};cursor:pointer;border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${esc(c.name)}</td>
              ${monthKeys.map((mk2) => {
                const val = pivot[c.id][mk2];
                return `<td onclick="selectReportsCell('${c.id}','${mk2}')" style="padding:8px 12px;text-align:right;cursor:pointer;color:${val?'var(--ink)':'var(--line)'};border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${val ? fmtMoney(val) : '–'}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    ${reportsCategoryFilter.length ? `
      <p class="section-label">Entries for selected categories</p>
      <div id="reportsEntriesList">${(() => {
        const byMonth = {};
        rangeEntries.slice().sort((a,b)=>b.date.localeCompare(a.date)).forEach((e) => { const mk2 = monthKey(e.date); (byMonth[mk2] = byMonth[mk2] || []).push(e); });
        const monthsList = Object.keys(byMonth).sort().reverse();
        if (!monthsList.length) return '<div class="empty-state">No entries for these categories in this range.</div>';
        return monthsList.map((mk2, i) => `
          ${collapseHeader('month', new Date(mk2+'-01T00:00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'}), netOf(byMonth[mk2]), 0, i===0)}
          <div class="collapse-body" style="display:${i===0?'block':'none'}">${byMonth[mk2].map((e) => renderEntryRow(e, catById, payeeById, true)).join('')}</div>
        `).join('');
      })()}</div>
    ` : ''}
  `;

  const muted = getComputedStyle(document.documentElement).getPropertyValue('--ink-soft').trim() || '#5B5568';
  if (reportsIncExpChart) reportsIncExpChart.destroy();
  reportsIncExpChart = new Chart(document.getElementById('reportsIncExpChart'), {
    type: 'bar',
    data: { labels: monthLabels, datasets: [
      { label: 'Income', data: incomeByMonth, backgroundColor: '#008300', borderRadius: 4 },
      { label: 'Expense', data: expenseByMonth, backgroundColor: '#C9564F', borderRadius: 4 }
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { ticks: { color: muted } } } }
  });
  if (topCats.length) {
    if (reportsCatChart) reportsCatChart.destroy();
    reportsCatChart = new Chart(document.getElementById('reportsCatChart'), {
      type: 'bar',
      data: { labels: topCats.map((c) => c[0]), datasets: [{ data: topCats.map((c) => c[1]), backgroundColor: '#E3A94E', borderRadius: 4 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: muted } }, y: { grid: { display: false }, ticks: { color: muted } } } }
    });
  }
}

async function openReportsCategoryConfig() {
  const categories = (await DB.getAll('categories')).filter((c) => !c.hidden).sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:6px">Table categories</p>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:14px">Uncheck any category to remove it from the table above.</p>
    <div style="max-height:50vh;overflow-y:auto;margin-bottom:16px">
      ${categories.map((c) => `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)">
        <input type="checkbox" ${reportsExcludedCategoryIds.includes(c.id) ? '' : 'checked'} onchange="toggleReportsExcludeCategory('${c.id}')">
        <span style="color:${categoryColor(c.id)};font-weight:600">${esc(c.name)}</span>
      </label>`).join('')}
    </div>
    <button class="btn btn-primary" onclick="closeModal()">Done</button>
  `;
  openModal();
}

// ---------- Add / Edit Entry ----------
let currentEntryId = null;
function openEntryDetail(id) { currentEntryId = id; renderEntryDetail(); }

function openModal() { document.getElementById('modalOverlay').style.display = 'flex'; }
function closeModal() { document.getElementById('modalOverlay').style.display = 'none'; document.getElementById('modalSheet').innerHTML = ''; }

async function renderEntryDetail() {
  const entry = await DB.get('entries', currentEntryId);
  if (!entry) return;
  const categories = await DB.getAll('categories');
  const payees = await DB.getAll('payees');
  const cars = await DB.getAll('cars');
  const projects = await DB.getAll('projects');
  const cat = categories.find((c) => c.id === entry.categoryId) || {};
  const payee = payees.find((p) => p.id === entry.storeId) || {};
  const car = entry.carId ? cars.find((c) => c.id === entry.carId) : null;
  const project = entry.projectId ? projects.find((p) => p.id === entry.projectId) : null;
  const isNeg = entry.type === 'expense';
  const valClass = entry.type === 'transfer' ? '' : (isNeg ? 'neg' : 'pos');

  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="entry-icon" style="width:36px;height:36px">
            ${payee.logo ? `<img src="${payee.logo}" style="width:100%;height:100%;object-fit:cover">` : `<i class="ti ${cat.icon || 'ti-tag'}" style="color:var(--ink-soft);font-size:18px"></i>`}
          </div>
          <div>
            <p style="font-size:16px;font-weight:600;margin:0">${esc(payee.name || cat.name || 'Entry')}</p>
            <p style="font-size:12px;color:var(--ink-soft);margin:2px 0 0">${esc(cat.name || '')}</p>
          </div>
        </div>
        <span class="entry-value ${valClass}" style="font-size:20px">${entry.type === 'expense' ? '-' : entry.type === 'income' ? '+' : ''}${fmtMoney(entry.amount)}</span>
      </div>
      <div class="divider"></div>
      <div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Date</span><span style="font-size:12px">${fmtDate(entry.date)}</span></div>
      <div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Type</span><span style="font-size:12px;text-transform:capitalize">${entry.type}${entry.type === 'transfer' ? (entry.transferDirection === 'in' ? ' (in)' : ' (out)') : ''}</span></div>
      ${entry.description ? `<div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Description</span><span style="font-size:12px;text-align:right;max-width:60%">${esc(entry.description)}</span></div>` : ''}
      ${car ? `<div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Car</span><span style="font-size:12px">${esc(car.name)}</span></div>` : ''}
      ${entry.carName && !car ? `<div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Cars</span><span style="font-size:12px">${esc(entry.carName)}</span></div>` : ''}
      ${project ? `<div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Project</span><span style="font-size:12px">${esc(project.name)}</span></div>` : ''}
      <div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Synced</span><span style="font-size:12px">${entry.synced ? 'Yes' : 'Pending'}</span></div>
    </div>

    <button class="btn" style="margin-bottom:10px" onclick="editEntry()"><i class="ti ti-edit"></i> Edit</button>
    <button class="btn" style="margin-bottom:10px" onclick="duplicateEntry()"><i class="ti ti-copy"></i> Duplicate</button>
    <button class="btn" style="background:var(--red-soft);color:var(--red);border-color:var(--red);margin-bottom:10px" onclick="deleteEntry()"><i class="ti ti-trash"></i> Delete</button>
    <button class="btn" onclick="closeModal()">Close</button>
  `;
  openModal();
}

async function editEntry() {
  const entry = await DB.get('entries', currentEntryId);
  duplicateSource = { ...entry, __editId: entry.id };
  closeModal();
  currentView = 'add'; route();
}
async function duplicateEntry() {
  const entry = await DB.get('entries', currentEntryId);
  duplicateSource = { ...entry };
  delete duplicateSource.__editId;
  closeModal();
  currentView = 'add'; route();
}
async function deleteEntry() {
  if (!confirm('Delete this entry? This can\'t be undone locally (though it may still exist as a row in your Sheet history).')) return;
  await DB.delete('entries', currentEntryId);
  closeModal();
  renderFinanceMain();
}

async function renderAddEntry() {
  const categories = (await DB.getAll('categories')).filter((c) => !c.hidden).sort((a, b) => a.name.localeCompare(b.name));
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
    <div id="transferDirectionArea"></div>

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
  if (src && src.type === 'transfer') selectTransferDirection(src.transferDirection || 'out');

  document.getElementById('f_category').addEventListener('change', (e) => {
    if (e.target.value === '__new') return goAddCategory('add');
  });
  document.getElementById('f_store').addEventListener('change', (e) => {
    if (e.target.value === '__new') return goAddStore('add');
  });
}

function setType(t) {
  document.querySelectorAll('#typeToggle .btn-toggle').forEach((b) => {
    b.classList.remove('active-expense', 'active-income', 'active-transfer');
    if (b.dataset.type === t) b.classList.add('active-' + t);
  });
  window.__currentType = t;
  const area = document.getElementById('transferDirectionArea');
  if (t === 'transfer') {
    area.innerHTML = `<div class="card tight" style="background:var(--surface)"><label class="field-label">Direction</label><div class="btn-toggle-row" id="transferDirToggle" style="margin-bottom:0">
      <button type="button" class="btn-toggle" onclick="selectTransferDirection('out')"><i class="ti ti-arrow-up-right" style="vertical-align:-2px"></i> Money out</button>
      <button type="button" class="btn-toggle" onclick="selectTransferDirection('in')"><i class="ti ti-arrow-down-left" style="vertical-align:-2px"></i> Money in</button>
    </div></div>`;
    selectTransferDirection(window.__transferDirection || 'out');
  } else {
    area.innerHTML = '';
  }
}
function selectTransferDirection(dir) {
  window.__transferDirection = dir;
  const wrap = document.getElementById('transferDirToggle');
  if (!wrap) return;
  wrap.querySelectorAll('.btn-toggle').forEach((b, i) => {
    b.classList.remove('active-expense', 'active-income');
    const isOut = i === 0;
    if ((isOut && dir === 'out') || (!isOut && dir === 'in')) b.classList.add(isOut ? 'active-expense' : 'active-income');
  });
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
  } else if (cat.conditionalField === 'carSplit') {
    carSplitDraft = (window.__cars || []).map((c) => ({ carId: c.id, name: c.name, checked: false, amount: 0 }));
    area.innerHTML = renderCarSplitUI();
  } else {
    area.innerHTML = '';
  }
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

// ---------- Category form (its own page) ----------
let categoryFormEditId = null;
let categoryFormReturnTo = null;
const CATEGORY_ICON_CHOICES = ['ti-tag', 'ti-shopping-cart', 'ti-home', 'ti-car', 'ti-heart', 'ti-tool', 'ti-building-bank', 'ti-user', 'ti-repeat', 'ti-tools-kitchen-2', 'ti-shield-check', 'ti-plane'];

function goAddCategory(returnTo) { categoryFormEditId = null; categoryFormReturnTo = returnTo || null; currentView = 'categoryForm'; route(); }
function goEditCategory(id) { categoryFormEditId = id; categoryFormReturnTo = null; currentView = 'categoryForm'; route(); }

async function renderCategoryForm() {
  const existing = categoryFormEditId ? await DB.get('categories', categoryFormEditId) : null;
  window.__categoryTypeDraft = existing ? existing.type : 'expense';
  window.__categoryIconDraft = existing ? (existing.icon || 'ti-tag') : 'ti-tag';
  window.__categoryConditionalDraft = existing ? existing.conditionalField : 'none';

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="${categoryFormReturnTo === 'add' ? "currentView='add';route()" : "currentView='categories';route()"}"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${existing ? 'Edit' : 'Add'} category</span></div>

    <div class="field"><label class="field-label">Name</label><input id="cat_name" placeholder="e.g. Groceries" value="${existing ? esc(existing.name) : ''}"></div>

    <label class="field-label">Type</label>
    <div class="btn-toggle-row" id="catTypeToggle">
      <button class="btn-toggle" onclick="selectCategoryType(this,'expense')">Expense</button>
      <button class="btn-toggle" onclick="selectCategoryType(this,'income')">Income</button>
      <button class="btn-toggle" onclick="selectCategoryType(this,'transfer')">Transfer</button>
    </div>

    <label class="field-label">Icon</label>
    <div id="catIconPicker" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      ${CATEGORY_ICON_CHOICES.map((ic) => `<button type="button" onclick="selectCategoryIcon('${ic}', event)" style="width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line);background:${ic === window.__categoryIconDraft ? 'var(--gold-soft)' : 'var(--surface-raised)'}"><i class="ti ${ic}"></i></button>`).join('')}
    </div>

    <label class="field-label">Extra field on entries</label>
    <select id="cat_conditional" style="margin-bottom:20px">
      <option value="none" ${window.__categoryConditionalDraft === 'none' ? 'selected' : ''}>None</option>
      <option value="car" ${window.__categoryConditionalDraft === 'car' ? 'selected' : ''}>Car (single)</option>
      <option value="carSplit" ${window.__categoryConditionalDraft === 'carSplit' ? 'selected' : ''}>Cars (split across multiple)</option>
      <option value="project" ${window.__categoryConditionalDraft === 'project' ? 'selected' : ''}>Project</option>
    </select>

    <button class="btn btn-primary" onclick="saveCategoryForm()">Save category</button>
    ${existing ? `<button class="btn" style="margin-top:10px;background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="hideCategory('${existing.id}')">Hide from lists</button>` : ''}
  `;
  setTimeout(() => selectCategoryType(document.querySelector(`#catTypeToggle button:nth-child(${window.__categoryTypeDraft === 'expense' ? 1 : window.__categoryTypeDraft === 'income' ? 2 : 3})`), window.__categoryTypeDraft), 0);
}
function selectCategoryType(btn, t) {
  document.querySelectorAll('#catTypeToggle .btn-toggle').forEach((b) => b.classList.remove('active-expense', 'active-income', 'active-transfer'));
  if (btn) btn.classList.add('active-' + t);
  window.__categoryTypeDraft = t;
}
function selectCategoryIcon(ic, evt) {
  window.__categoryIconDraft = ic;
  document.querySelectorAll('#catIconPicker button').forEach((b) => { b.style.background = 'var(--surface-raised)'; });
  if (evt && evt.currentTarget) evt.currentTarget.style.background = 'var(--gold-soft)';
}
async function hideCategory(id) {
  if (!confirm('Hide this category from all lists? Past entries that used it are unaffected — this only removes it from pickers going forward. You can restore it later from the manager.')) return;
  const cat = await DB.get('categories', id);
  cat.hidden = true;
  cat.synced = false;
  await DB.put('categories', cat);
  Sync.pushEntry('Categories', cat).then(() => DB.put('categories', cat));
  currentView = 'categories'; route();
}
async function saveCategoryForm() {
  const name = document.getElementById('cat_name').value.trim();
  if (!name) { alert('Category needs a name.'); return; }
  const cat = categoryFormEditId ? await DB.get('categories', categoryFormEditId) : { id: uid(), defaultStoreId: null, defaultAmount: null, hidden: false };
  cat.name = name;
  cat.type = window.__categoryTypeDraft || 'expense';
  cat.icon = window.__categoryIconDraft || 'ti-tag';
  cat.conditionalField = document.getElementById('cat_conditional').value;
  cat.synced = false;
  await DB.put('categories', cat);
  Sync.pushEntry('Categories', cat).then(() => DB.put('categories', cat));
  if (categoryFormReturnTo === 'add') {
    currentView = 'add'; route();
    setTimeout(() => { const sel = document.getElementById('f_category'); if (sel) { sel.value = cat.id; onCategoryChange(); } }, 0);
  } else {
    currentView = 'categories'; route();
  }
}

// ---------- Store form (its own page, with logo upload) ----------
let storeFormEditId = null;
let storeFormReturnTo = null;
let storeLogoDraft = null;

function goAddStore(returnTo) { storeFormEditId = null; storeFormReturnTo = returnTo || null; storeLogoDraft = null; currentView = 'storeForm'; route(); }
function goEditStore(id) { storeFormEditId = id; storeFormReturnTo = null; storeLogoDraft = null; currentView = 'storeForm'; route(); }

async function renderStoreForm() {
  const existing = storeFormEditId ? await DB.get('payees', storeFormEditId) : null;
  if (existing) storeLogoDraft = existing.logo || null;

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="${storeFormReturnTo === 'add' ? "currentView='add';route()" : "currentView='categories';route()"}"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${existing ? 'Edit' : 'Add'} store</span></div>

    <div class="field"><label class="field-label">Name</label><input id="store_name" placeholder="e.g. Costco" value="${existing ? esc(existing.name) : ''}"></div>

    <label class="field-label">Logo</label>
    <div class="photo-slot" style="width:90px;height:90px;margin-bottom:20px" onclick="document.getElementById('storeLogoInput').click()">
      ${storeLogoDraft ? `<img src="${storeLogoDraft}">` : '<i class="ti ti-building-store" style="font-size:24px"></i>'}
    </div>
    <input type="file" id="storeLogoInput" accept="image/*" style="display:none" onchange="handleStoreLogoUpload(event)">

    <div class="field"><label class="field-label">Logo link (optional)</label><input id="store_logoLink" placeholder="Link to logo image (e.g. Drive link)" value="${existing ? esc(existing.logoLink || '') : ''}"></div>
    <p style="font-size:11px;color:var(--ink-soft);margin:-10px 0 16px">A link is text only and syncs to your Sheet; the uploaded photo above stays on this device only.</p>

    <button class="btn btn-primary" onclick="saveStoreForm()">Save store</button>
  `;
}
function handleStoreLogoUpload(e) {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => { storeLogoDraft = reader.result; renderStoreForm(); };
  reader.readAsDataURL(f);
}
async function saveStoreForm() {
  const name = document.getElementById('store_name').value.trim();
  if (!name) { alert('Store needs a name.'); return; }
  const payee = storeFormEditId ? await DB.get('payees', storeFormEditId) : { id: uid(), defaultCategoryId: null, defaultAmount: null };
  payee.name = name;
  payee.logo = storeLogoDraft;
  payee.logoLink = document.getElementById('store_logoLink').value.trim();
  payee.synced = false;
  await DB.put('payees', payee);
  const { logo, ...syncablePayee } = payee;
  Sync.pushEntry('Stores', syncablePayee).then(() => { payee.synced = true; DB.put('payees', payee); });
  if (storeFormReturnTo === 'add') {
    currentView = 'add'; route();
    setTimeout(() => { const sel = document.getElementById('f_store'); if (sel) sel.value = payee.id; }, 0);
  } else {
    currentView = 'categories'; route();
  }
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
    return c ? c.name : s.carId;
  }).join(' & ') : '';

  const entry = {
    id: (duplicateSource && duplicateSource.__editId) || uid(),
    date, categoryId, storeId, amount, description, type,
    categoryName: catObj ? catObj.name : '',
    storeName: payeeObj ? payeeObj.name : '',
    carId, projectId,
    carName: carObj ? carObj.name : carSplitNames,
    projectName: projectObj ? projectObj.name : '',
    transferDirection: type === 'transfer' ? (window.__transferDirection || 'out') : null,
    carSplit: carSplitFinal,
    synced: false
  };
  await DB.put('entries', entry);
  Sync.pushEntry('Finance', entry).then(() => DB.put('entries', entry));
  duplicateSource = null; carSplitDraft = []; window.__transferDirection = null;
  currentView = 'main';
  route();
}

// ---------- Categories & Stores manager ----------
let managerTab = 'categories';
let showHiddenCategories = false;
async function renderCategoriesManager() {
  const allCategories = (await DB.getAll('categories')).sort((a, b) => a.name.localeCompare(b.name));
  const payees = (await DB.getAll('payees')).sort((a, b) => a.name.localeCompare(b.name));
  const categories = showHiddenCategories ? allCategories : allCategories.filter((c) => !c.hidden);
  const hiddenCount = allCategories.filter((c) => c.hidden).length;
  const list = managerTab === 'categories' ? categories : payees;

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Categories & stores</span></div>
    <div class="chip-row">
      <button class="chip ${managerTab === 'categories' ? 'active' : ''}" onclick="switchManagerTab('categories')">Categories</button>
      <button class="chip ${managerTab === 'payees' ? 'active' : ''}" onclick="switchManagerTab('payees')">Stores</button>
    </div>
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="${managerTab === 'categories' ? 'goAddCategory()' : 'goAddStore()'}"><i class="ti ti-plus"></i> Add ${managerTab === 'categories' ? 'category' : 'store'}</button>
    ${managerTab === 'categories' && hiddenCount ? `<div class="list-row" onclick="showHiddenCategories=!showHiddenCategories;renderCategoriesManager()" style="margin-bottom:8px"><span style="font-size:12px;color:var(--ink-soft)">${showHiddenCategories ? 'Hide' : 'Show'} ${hiddenCount} hidden categor${hiddenCount===1?'y':'ies'}</span><i class="ti ti-chevron-${showHiddenCategories?'down':'right'}"></i></div>` : ''}
    <div>${list.map((item) => managerTab === 'categories' ? renderCategoryListRow(item) : renderPayeeListRow(item)).join('') || '<div class="empty-state">Nothing yet.</div>'}</div>
  `;
}
function switchManagerTab(t) { managerTab = t; renderCategoriesManager(); }

function renderCategoryListRow(c) {
  return `<div class="list-row" onclick="${c.hidden ? `restoreCategory('${c.id}')` : `goEditCategory('${c.id}')`}" style="${c.hidden ? 'opacity:0.55' : ''}">
    <div style="display:flex;align-items:center"><div class="icon-badge" style="background:var(--gold-soft)"><i class="ti ${c.icon || 'ti-tag'}"></i></div><span>${esc(c.name)}${c.hidden ? ' (hidden)' : ''}</span></div>
    <span style="font-size:11px;color:var(--ink-soft);text-transform:capitalize">${c.hidden ? 'Tap to restore' : c.type}</span>
  </div>`;
}
async function restoreCategory(id) {
  const cat = await DB.get('categories', id);
  cat.hidden = false;
  cat.synced = false;
  await DB.put('categories', cat);
  Sync.pushEntry('Categories', cat).then(() => DB.put('categories', cat));
  renderCategoriesManager();
}
function renderPayeeListRow(p) {
  return `<div class="list-row" onclick="goEditStore('${p.id}')">
    <div style="display:flex;align-items:center"><div class="icon-badge" style="background:var(--surface)">${p.logo ? `<img src="${p.logo}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">` : '<i class="ti ti-building-store"></i>'}</div><span>${esc(p.name)}</span></div>
  </div>`;
}

// ---------- Init ----------
async function init() {
  await seedIfEmpty();
  renderHeader();
  Sync.onStatusChange(renderSyncPill);
  await Sync.refreshStatus();
  route();
  Sync.startPolling();
  Sync.pullAll().then(() => { if (currentView === 'main') route(); }); // catch up with any existing Sheet data on this device
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
  const issueTypes = (await DB.getAll('issueTypes')).filter((t) => !t.hidden);
  const vetClinics = await DB.getAll('vetClinics');
  const src = jazzDuplicate;

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goJazzMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Log an issue</span></div>
    <div class="field"><label class="field-label">Started</label><input type="date" id="j_date" value="${todayStr()}"></div>
    <div class="field"><label class="field-label">Issue type</label>
      <select id="j_type" onchange="if(this.value==='__new') openIssueTypeModal(true)">
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

    <div class="field-row" style="margin-bottom:14px">
      <div><label class="field-label">Weather</label><select id="j_weather"><option>Sunny</option><option>Cloudy</option><option>Rainy</option><option>Snowing</option></select></div>
      <div><label class="field-label">Stool</label><select id="j_stool"><option>Normal</option><option>Diarrhea</option></select></div>
    </div>
    <label class="field-label">Snow covered</label>
    <div class="btn-toggle-row" id="snowToggle">
      <button class="btn-toggle" onclick="selectSnow(this,false)">No</button>
      <button class="btn-toggle" onclick="selectSnow(this,true)">Yes</button>
    </div>

    <div class="card tight" style="background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label class="field-label" style="margin:0">Medication given</label>
        <button type="button" class="chip" id="medToggle" onclick="toggleMed()">No</button>
      </div>
      <div id="medFields" style="display:none">
        <input id="j_medName" placeholder="Medication name (include dosage/frequency here)" style="margin-bottom:8px">
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
  selectSnow(document.querySelector('#snowToggle .btn-toggle'), false);
}

function selectSeverity(btn, val) { btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral')); btn.classList.add('active-neutral'); window.__severity = val; }
function selectStatus(btn, val) { btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral')); btn.classList.add('active-neutral'); window.__status = val; }
function selectSnow(btn, val) { btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral')); btn.classList.add('active-neutral'); window.__snowCovered = val; }
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

const ISSUE_ICON_CHOICES = ['ti-stethoscope', 'ti-droplet', 'ti-brain', 'ti-eye', 'ti-ear', 'ti-bone', 'ti-nose', 'ti-bug'];
let issueTypeModalEditId = null;
let issueTypeModalIcon = 'ti-stethoscope';
let issueTypeModalReturnToAdd = false;

function openIssueTypeModal(returnToAdd) {
  issueTypeModalEditId = null;
  issueTypeModalIcon = 'ti-stethoscope';
  issueTypeModalReturnToAdd = !!returnToAdd;
  renderIssueTypeModal();
  openModal();
}
async function editIssueTypeModal(id) {
  issueTypeModalEditId = id;
  const t = await DB.get('issueTypes', id);
  issueTypeModalIcon = t.icon || 'ti-stethoscope';
  issueTypeModalReturnToAdd = false;
  renderIssueTypeModal();
  openModal();
}
async function renderIssueTypeModal() {
  const existing = issueTypeModalEditId ? await DB.get('issueTypes', issueTypeModalEditId) : null;
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:16px">${existing ? 'Edit' : 'Add'} issue type</p>
    <div class="field"><label class="field-label">Name</label><input id="itype_name" placeholder="e.g. Skin" value="${existing ? esc(existing.name) : ''}"></div>
    <label class="field-label">Icon</label>
    <div id="itypeIconPicker" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
      ${ISSUE_ICON_CHOICES.map((ic) => `<button type="button" onclick="selectIssueTypeIcon('${ic}', event)" style="width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line);background:${ic === issueTypeModalIcon ? 'var(--rose-soft)' : 'var(--surface-raised)'}"><i class="ti ${ic}"></i></button>`).join('')}
    </div>
    <button class="btn btn-primary" style="margin-bottom:10px" onclick="saveIssueTypeModal()">Save</button>
    ${existing ? `<button class="btn" style="margin-bottom:10px;background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="hideIssueTypeModal('${existing.id}')">Hide from list</button>` : ''}
    <button class="btn" onclick="closeModal()">Cancel</button>
  `;
}
function selectIssueTypeIcon(ic, evt) {
  issueTypeModalIcon = ic;
  document.querySelectorAll('#itypeIconPicker button').forEach((b) => { b.style.background = 'var(--surface-raised)'; });
  if (evt && evt.currentTarget) evt.currentTarget.style.background = 'var(--rose-soft)';
}
async function saveIssueTypeModal() {
  const name = document.getElementById('itype_name').value.trim();
  if (!name) { alert('Issue type needs a name.'); return; }
  const t = issueTypeModalEditId ? await DB.get('issueTypes', issueTypeModalEditId) : { id: uid(), hidden: false };
  t.name = name;
  t.icon = issueTypeModalIcon;
  t.synced = false;
  await DB.put('issueTypes', t);
  Sync.pushEntry('IssueTypes', t).then(() => DB.put('issueTypes', t));
  closeModal();
  if (issueTypeModalReturnToAdd) {
    renderAddIssue().then(() => { const sel = document.getElementById('j_type'); if (sel) sel.value = t.id; });
  } else if (moreView === 'issueTypes') {
    renderIssueTypesManager();
  }
}
async function hideIssueTypeModal(id) {
  if (!confirm('Hide this issue type from lists? Past issues that used it are unaffected.')) return;
  const t = await DB.get('issueTypes', id);
  t.hidden = true;
  t.synced = false;
  await DB.put('issueTypes', t);
  Sync.pushEntry('IssueTypes', t).then(() => DB.put('issueTypes', t));
  closeModal();
  if (moreView === 'issueTypes') renderIssueTypesManager();
}

let showHiddenIssueTypes = false;
async function renderIssueTypesManager() {
  const all = (await DB.getAll('issueTypes')).sort((a, b) => a.name.localeCompare(b.name));
  const list = showHiddenIssueTypes ? all : all.filter((t) => !t.hidden);
  const hiddenCount = all.filter((t) => t.hidden).length;
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMoreMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Issue types</span></div>
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="openIssueTypeModal(false)"><i class="ti ti-plus"></i> Add issue type</button>
    ${hiddenCount ? `<div class="list-row" onclick="showHiddenIssueTypes=!showHiddenIssueTypes;renderIssueTypesManager()" style="margin-bottom:8px"><span style="font-size:12px;color:var(--ink-soft)">${showHiddenIssueTypes?'Hide':'Show'} ${hiddenCount} hidden</span><i class="ti ti-chevron-${showHiddenIssueTypes?'down':'right'}"></i></div>` : ''}
    <div>${list.map((t) => `<div class="list-row" style="${t.hidden?'opacity:0.55':''}" onclick="${t.hidden ? `restoreIssueType('${t.id}')` : `editIssueTypeModal('${t.id}')`}"><span><i class="ti ${t.icon||'ti-stethoscope'}"></i> ${esc(t.name)}${t.hidden?' (hidden)':''}</span><i class="ti ti-chevron-right"></i></div>`).join('') || '<div class="empty-state">None yet.</div>'}</div>
  `;
}
async function restoreIssueType(id) {
  const t = await DB.get('issueTypes', id);
  t.hidden = false;
  t.synced = false;
  await DB.put('issueTypes', t);
  Sync.pushEntry('IssueTypes', t).then(() => DB.put('issueTypes', t));
  renderIssueTypesManager();
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
    weather: document.getElementById('j_weather').value,
    snowCovered: !!window.__snowCovered,
    stool: document.getElementById('j_stool').value,
    medGiven: !!window.__medGiven,
    medName: window.__medGiven ? document.getElementById('j_medName').value : '',
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
  jazzPhotoDrafts = []; window.__medGiven = false; window.__vetVisit = false; window.__snowCovered = false;
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

    <div class="thread-item"><p class="meta">${fmtDate(issue.startDate)} · ${issue.severity}</p><p class="note">${esc(issue.description||'')}</p>${issue.medGiven ? `<p class="meta">Medication: ${esc(issue.medName)}</p>` : ''}${issue.weather || issue.stool || issue.snowCovered ? `<p class="meta">${[issue.weather, issue.snowCovered ? 'Snow covered' : '', issue.stool ? 'Stool: ' + issue.stool : ''].filter(Boolean).join(' · ')}</p>` : ''}</div>
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
let weightPerson = 'Nassim'; // real names used directly, since multiple people may use the same app/device
let weightRange = '6m';

let weightChartInstance = null;

function goWeightMain() { currentView = 'main'; route(); }
function selectWeightPerson(person) { weightPerson = person; renderWeightMain(); }
function setWeightRange(r) { weightRange = r; renderWeightMain(); }

async function renderWeightMain() {
  const all = (await DB.getAll('weightEntries')).filter((w) => w.subject === weightPerson.toLowerCase());
  const sorted = [...all].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  const prev = sorted[1];
  const diff = latest && prev ? +(latest.value - prev.value).toFixed(1) : null;
  const inRange = all.filter((w) => withinRange(w.date, weightRange)).sort((a, b) => a.date.localeCompare(b.date));

  $main.innerHTML = `
    <div class="btn-toggle-row">
      <button class="btn-toggle ${weightPerson==='Nassim'?'active-neutral':''}" onclick="selectWeightPerson('Nassim')">Nassim</button>
      <button class="btn-toggle ${weightPerson==='Safia'?'active-neutral':''}" onclick="selectWeightPerson('Safia')">Safia</button>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div><p class="label" style="font-size:11px;color:var(--ink-soft)">Latest</p><p class="big" style="font-size:24px">${latest ? latest.value + ' lbs' : '—'}</p></div>
        ${diff !== null ? `<div style="text-align:right"><p class="label" style="font-size:11px;color:var(--ink-soft)">Since last</p><p style="font-weight:600;color:${diff<=0?'#0F6E56':'var(--red)'}">${diff>0?'+':''}${diff} lbs</p></div>` : ''}
      </div>
    </div>

    <div class="chip-row">
      <button class="chip ${weightRange==='3m'?'active':''}" onclick="setWeightRange('3m')">3M</button>
      <button class="chip ${weightRange==='6m'?'active':''}" onclick="setWeightRange('6m')">6M</button>
      <button class="chip ${weightRange==='1y'?'active':''}" onclick="setWeightRange('1y')">1Y</button>
      <button class="chip ${weightRange==='all'?'active':''}" onclick="setWeightRange('all')">All time</button>
    </div>
    <div style="position:relative;width:100%;height:180px;margin-bottom:20px">
      ${inRange.length >= 2 ? '<canvas id="weightChart"></canvas>' : '<div class="empty-state">Log at least 2 entries in this range to see a trend.</div>'}
    </div>

    <p class="section-label">History</p>
    <div id="weightList">${sorted.length ? sorted.map((w) => `<div class="list-row" style="cursor:default"><div><span>${fmtDateYear(w.date)}</span>${w.note ? `<div class="entry-desc">${esc(w.note)}</div>` : ''}</div><span style="font-weight:600">${w.value} lbs</span></div>`).join('') : '<div class="empty-state">No entries yet.</div>'}</div>
  `;

  if (inRange.length >= 2 && window.Chart) {
    const ctx = document.getElementById('weightChart');
    if (weightChartInstance) weightChartInstance.destroy();
    weightChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: inRange.map((w) => fmtDate(w.date)),
        datasets: [{ data: inRange.map((w) => w.value), borderColor: '#2a78d6', backgroundColor: 'rgba(42,120,214,0.1)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#2a78d6' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(137,135,129,0.2)' } } }
      }
    });
  }
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
let moreView = 'main'; // main | carsProjects | expenseRepairTypes | syncData | issueTypes
let editingSheetUrl = false;

function goMoreMain() { moreView = 'main'; renderMore(); }

async function renderMore() {
  if (moreView === 'carsProjects') return renderCarsProjectsManager();
  if (moreView === 'expenseRepairTypes') return renderExpenseRepairManager();
  if (moreView === 'syncData') return renderSyncDataPage();
  if (moreView === 'issueTypes') return renderIssueTypesManager();

  $main.innerHTML = `
    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft)">Overview</p>
    <div class="list-row" onclick="currentTab='finance';currentView='reports';document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='finance'));route()"><span><i class="ti ti-chart-bar"></i> Finance reports</span><i class="ti ti-chevron-right"></i></div>
    <div class="list-row" onclick="currentTab='jazz';currentView='report';document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='jazz'));route()"><span><i class="ti ti-heart-rate-monitor"></i> Jazz's health report</span><i class="ti ti-chevron-right"></i></div>

    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);margin-top:16px">Finance</p>
    <div class="list-row" onclick="currentTab='finance';currentView='categories';document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='finance'));route()"><span><i class="ti ti-tag"></i> Categories & stores</span><i class="ti ti-chevron-right"></i></div>
    <div class="list-row" onclick="moreView='carsProjects';renderMore()"><span><i class="ti ti-car"></i> Cars & projects</span><i class="ti ti-chevron-right"></i></div>

    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);margin-top:16px">Jazz</p>
    <div class="list-row" onclick="moreView='issueTypes';renderMore()"><span><i class="ti ti-stethoscope"></i> Issue types</span><i class="ti ti-chevron-right"></i></div>

    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);margin-top:16px">Garage</p>
    <div class="list-row" onclick="moreView='expenseRepairTypes';renderMore()"><span><i class="ti ti-tool"></i> Expense & repair types</span><i class="ti ti-chevron-right"></i></div>

    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);margin-top:16px">Sync & data</p>
    <div class="list-row" onclick="moreView='syncData';renderMore()"><span><i class="ti ti-cloud"></i> Google Sheet sync & import</span><span class="status-pill ${Sync.status}" style="font-size:11px"><i class="ti ti-cloud"></i></span></div>
  `;
}

async function renderSyncDataPage() {
  const meta = await DB.get('settings', 'meta');
  const sheetUrl = meta ? meta.sheetUrl : '';
  const importCompleted = meta ? !!meta.importCompleted : false;

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMoreMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Sync & data</span></div>

    <div class="card tight">
      <label class="field-label">Google Sheet</label>
      ${sheetUrl && !editingSheetUrl ? `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="status-pill" style="background:var(--sage-soft);color:#0F6E56"><i class="ti ti-link"></i> <span>Linked to a Sheet</span></span>
          <button class="btn" style="width:auto;padding:8px 14px" onclick="editingSheetUrl=true;renderSyncDataPage()">Change</button>
        </div>
      ` : `
        <input id="sheetUrlInput" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(sheetUrl)}" style="margin-bottom:8px">
        <button class="btn btn-primary" onclick="saveSheetUrl()">Save</button>
        ${sheetUrl ? `<button class="btn" style="margin-top:8px" onclick="editingSheetUrl=false;renderSyncDataPage()">Cancel</button>` : ''}
      `}
    </div>
    <div class="card tight" style="display:flex;justify-content:space-between;align-items:center">
      <span class="status-pill ${Sync.status}" id="moreSyncPill"><i class="ti ti-cloud"></i> <span id="moreSyncText"></span></span>
      <button class="btn" style="width:auto;padding:8px 14px" onclick="Sync.fullSync().then(renderSyncDataPage)">Retry sync</button>
    </div>
    <div class="card tight">
      <label class="field-label">Clean up duplicate categories, stores, etc.</label>
      <p style="font-size:12px;color:var(--ink-soft);margin-bottom:10px">If the same category or store shows up more than once with a different color (this can happen from testing on multiple devices before sync was set up), run this once. It merges duplicates by name, keeps everything's history intact, and re-syncs the fix.</p>
      <button class="btn" id="cleanupBtn" onclick="runDimensionCleanup()">Find & merge duplicates</button>
      <p id="cleanupStatus" style="font-size:12px;color:var(--ink-soft);margin-top:8px"></p>
    </div>
    <div class="card tight">
      <label class="field-label">Force full resync</label>
      <p style="font-size:12px;color:var(--ink-soft);margin-bottom:10px">Only use this after manually clearing all rows from your Sheet's tabs. This re-sends every record from scratch, guaranteeing exactly one clean copy of each — but it will create duplicates again if the Sheet still has old rows in it.</p>
      <button class="btn" style="background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="if(confirm('Have you already cleared all data rows from every tab in your Sheet? This will re-send everything from scratch.')){Sync.forceFullResync();renderSyncDataPage();}">Force full resync</button>
    </div>
    <div class="card tight">
      <label class="field-label">Import historical data</label>
      ${importCompleted ? `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="status-pill" style="background:var(--sage-soft);color:#0F6E56"><i class="ti ti-check"></i> <span>Already imported</span></span>
          <button class="btn" style="width:auto;padding:8px 14px;font-size:12px" onclick="if(confirm('Only do this if you specifically need to re-import — it could create duplicate records if the same data is already in your app or Sheet.')){resetImportLock();}">Unlock</button>
        </div>
      ` : `
        <p style="font-size:12px;color:var(--ink-soft);margin-bottom:10px">Upload a converted <code>import-data.json</code> file to bring in past entries, once. This file never leaves your device except to sync to your own Sheet afterward.</p>
        <input type="file" accept=".json" onchange="handleImportFile(event)" style="margin-bottom:8px">
      `}
      <p id="importStatus" style="font-size:12px;color:var(--ink-soft)"></p>
    </div>
  `;
  updateMoreSyncPill();
}
async function resetImportLock() {
  const meta = (await DB.get('settings', 'meta')) || { id: 'meta' };
  meta.importCompleted = false;
  await DB.put('settings', meta);
  renderSyncDataPage();
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
  editingSheetUrl = false;
  try {
    await Sync.refreshStatus();
    Sync.fullSync().then(renderSyncDataPage);
  } catch (err) {
    console.warn('Sync status/retry hit an error, but the URL was saved:', err.message);
  }
  renderSyncDataPage();
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

async function runDimensionCleanup() {
  const statusEl = document.getElementById('cleanupStatus');
  statusEl.textContent = 'Scanning for duplicates…';
  const report = await cleanupDuplicateDimensions((msg) => { statusEl.textContent = msg; });
  if (!report.length) {
    statusEl.textContent = 'No duplicates found.';
  } else {
    statusEl.innerHTML = `<b>Done:</b><br>${report.join('<br>')}<br>Now clear your Sheet's tabs and run Force full resync below to push the clean version up.`;
  }
  Sync.retryAllPending();
}
