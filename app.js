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
function fmtDateFull(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
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
// Store logos can hold either a real uploaded photo (base64 data: URL), a real
// resolved link (https://...), or a leftover raw path from the original spreadsheet
// import (e.g. "-Payee Logo/xyz.png") that was never a working link. Only the first
// two should ever be rendered as an <img> — the third just shows as a broken image.
function payeeLogoUrl(payee) {
  const candidates = [payee.logoLink, payee.logo];
  for (const c of candidates) {
    if (c && (c.startsWith('http://') || c.startsWith('https://') || c.startsWith('data:'))) return c;
  }
  return null;
}

// Deleted records are kept locally as tombstones (deleted:true) rather than actually
// removed, so the delete itself can sync — otherwise a pull from another device would
// just bring a "deleted" record right back. These helpers are what every display screen
// should use instead of DB.getAll directly, so deleted items never show up in lists,
// totals, or reports. Sync code intentionally does NOT use these — it needs to see
// everything, deleted or not, for the tombstone itself to propagate.
async function getActiveEntries() { return (await DB.getAll('entries')).filter((r) => !r.deleted); }
async function getActiveWeightEntries() { return (await DB.getAll('weightEntries')).filter((r) => !r.deleted); }
async function getActiveRecurring() { return (await DB.getAll('recurring')).filter((r) => !r.deleted); }
async function getActiveGarageCosts() { return (await DB.getAll('garageCosts')).filter((r) => !r.deleted); }

// ---------- Header ----------
function renderHeader() {
  const now = new Date();
  document.getElementById('dateLine').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const titles = { finance: 'Finances', jazz: 'Jazz', weight: 'Weight', garage: 'Garage', more: 'Settings' };
  document.getElementById('pageTitle').textContent = titles[currentTab] || '';
  const whoEl = document.getElementById('signedInAs');
  if (whoEl) whoEl.textContent = Auth.email ? Auth.email : '';
}

function renderSyncPill() {
  const pill = document.getElementById('syncPill');
  const text = document.getElementById('syncText');
  pill.className = 'status-pill ' + Sync.status;
  const map = { synced: ['ti-check', 'Synced'], syncing: ['ti-refresh', 'Syncing…'], pending: ['ti-clock', 'Pending'], offline: ['ti-cloud-off', 'Not connected'] };
  const [icon, label] = map[Sync.status] || map.offline;
  pill.innerHTML = `<i class="ti ${icon}"></i> <span>${label}</span>`;
}

// Manual "don't want to wait for the 10-second poll" refresh — forces an immediate
// pull/push cycle and redraws the current screen if it's safe to (never on a form,
// same rule as the automatic background refresh).
async function manualRefresh() {
  const icon = document.getElementById('manualRefreshIcon');
  const btn = document.getElementById('manualRefreshBtn');
  const statusEl = document.getElementById('manualRefreshStatus');
  if (btn) btn.disabled = true;
  if (icon) icon.style.animation = 'spin 0.8s linear infinite';
  const changed = await Sync.fullSync();
  if (icon) icon.style.animation = '';
  if (btn) btn.disabled = false;
  if (!Sync.FORM_VIEWS.includes(currentView)) route();
  if (statusEl) {
    statusEl.textContent = Sync.lastPullError ? "Couldn't refresh" : (changed ? 'Updated' : 'Up to date');
    statusEl.style.color = Sync.lastPullError ? 'var(--red)' : '#0F6E56';
    statusEl.style.opacity = '1';
    setTimeout(() => { statusEl.style.opacity = '0'; }, 1800);
  }
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
  else if (currentTab === 'jazz' && currentView === 'main') { jazzDuplicate = null; jazzPhotoDrafts = []; photoUploadLinks.jazz = []; pendingPhotoUploads.jazz = []; photoUploadStatus.jazz = []; photoUploadErrors.jazz = []; existingLinksRemoved.jazz = []; currentView = 'addIssue'; route(); }
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
    if (currentView === 'projectForm') return renderProjectForm();
    if (currentView === 'reports') return renderReportsStub();
    if (currentView === 'utilitiesReport') return renderUtilitiesReport();
    if (currentView === 'vehicleReport') return renderFinanceVehicleReport();
    if (currentView === 'transfersReport') return renderTransfersReport();
    if (currentView === 'projectsReport') return renderProjectsReport();
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
let financeRange = 'thisMonth'; // thisMonth | lastMonth | twoMonthsAgo | last3Months | last6Months | lastYear | last2Years | allTime
let financeTypeFilter = null; // null | 'income' | 'expense' | 'transfer'
let financeSortBy = 'date'; // date | amount
const FINANCE_RANGE_LABELS = { thisMonth: 'This month', lastMonth: 'Last month', twoMonthsAgo: '2 months ago', last3Months: 'Last 3 months', last6Months: 'Last 6 months', lastYear: 'Last year', last2Years: 'Last 2 years', allTime: 'All time' };

function fmtISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function getFinanceRangeBounds(range) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  if (range === 'lastMonth') return { start: fmtISO(new Date(y, m - 1, 1)), end: fmtISO(new Date(y, m, 0)) };
  if (range === 'twoMonthsAgo') return { start: fmtISO(new Date(y, m - 2, 1)), end: fmtISO(new Date(y, m - 1, 0)) };
  if (range === 'last3Months') return { start: fmtISO(new Date(y, m - 2, 1)), end: fmtISO(new Date(y, m + 1, 0)) };
  if (range === 'last6Months') return { start: fmtISO(new Date(y, m - 5, 1)), end: fmtISO(new Date(y, m + 1, 0)) };
  if (range === 'lastYear') return { start: fmtISO(new Date(y, 0, 1)), end: fmtISO(new Date(y, 11, 31)) }; // calendar year, not a rolling 12 months
  if (range === 'last2Years') return { start: fmtISO(new Date(y - 1, 0, 1)), end: fmtISO(new Date(y, 11, 31)) }; // this calendar year + the one before it
  if (range === 'allTime') return { start: '0000-01-01', end: '9999-12-31' };
  return { start: fmtISO(new Date(y, m, 1)), end: fmtISO(new Date(y, m + 1, 0)) }; // thisMonth
}
function setFinanceRange(r) { financeRange = r; renderFinanceMain(); }
function openFinanceRangeMoreModal() {
  const options = ['last3Months', 'last6Months', 'lastYear', 'last2Years', 'allTime'];
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:14px">More ranges</p>
    <div class="check-list">
      ${options.map((r) => `
        <div class="list-row" onclick="setFinanceRange('${r}');closeModal()" style="${financeRange===r?'background:var(--gold-soft);border-radius:10px':''}">
          <span>${FINANCE_RANGE_LABELS[r]}</span>
          ${financeRange===r ? '<i class="ti ti-check" style="color:var(--gold)"></i>' : ''}
        </div>
      `).join('')}
    </div>
  `;
  openModal();
}
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
// Generic collapse-all / expand-all for any list built from the collapseHeader +
// .collapse-body pattern (Finance, Jazz, Reports, Garage's All Repairs, etc.) — just
// give it the id of the wrapping container and it handles everything inside.
function collapseAllIn(containerId, collapse) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.collapse-body').forEach((body) => { body.style.display = collapse ? 'none' : 'block'; });
  container.querySelectorAll('.collapse-chevron').forEach((icon) => { icon.className = 'ti collapse-chevron ti-chevron-' + (collapse ? 'right' : 'down'); });
}
function collapseAllControls(containerId) {
  return `<div style="display:flex;gap:8px;margin-bottom:10px">
    <button class="btn" style="flex:1;padding:8px;font-size:12px" onclick="collapseAllIn('${containerId}', false)"><i class="ti ti-chevrons-down"></i> Show all</button>
    <button class="btn" style="flex:1;padding:8px;font-size:12px" onclick="collapseAllIn('${containerId}', true)"><i class="ti ti-chevrons-up"></i> Collapse all</button>
  </div>`;
}

async function renderFinanceMain() {
  const entries = (await getActiveEntries()).sort((a, b) => b.date.localeCompare(a.date));
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
    <div class="search-box"><i class="ti ti-search"></i><input id="financeSearch" placeholder="Search description, store, category, amount..."></div>

    <div class="chip-row">
      <button class="chip ${financeRange==='thisMonth'?'active':''}" onclick="setFinanceRange('thisMonth')">This month</button>
      <button class="chip ${financeRange==='lastMonth'?'active':''}" onclick="setFinanceRange('lastMonth')">Last month</button>
      <button class="chip ${financeRange==='twoMonthsAgo'?'active':''}" onclick="setFinanceRange('twoMonthsAgo')">2 months ago</button>
      <button class="chip ${['last3Months','last6Months','lastYear','last2Years','allTime'].includes(financeRange)?'active':''}" onclick="openFinanceRangeMoreModal()">${['last3Months','last6Months','lastYear','last2Years','allTime'].includes(financeRange) ? FINANCE_RANGE_LABELS[financeRange] : 'More'} <i class="ti ti-chevron-down" style="font-size:11px;vertical-align:-1px"></i></button>
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

    <button class="btn" style="margin-bottom:14px" onclick="goFoodBudget()"><i class="ti ti-shopping-cart"></i> Food budget by week</button>

    <div class="chip-row">
      <span style="font-size:11px;color:var(--ink-soft);align-self:center;margin-right:2px">Sort:</span>
      <button class="chip ${financeSortBy==='date'?'active':''}" onclick="setFinanceSort('date')">Date</button>
      <button class="chip ${financeSortBy==='amount'?'active':''}" onclick="setFinanceSort('amount')">Amount (highest first)</button>
    </div>

    ${financeSortBy === 'date' ? collapseAllControls('entryList') : ''}
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
      ${days.map((d) => renderDayGroup(d, byDay[d], catById, payeeById, openByDefault)).join('')}
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
  let valClass, sign, displayAmount = e.amount;
  if (e.type === 'transfer') {
    valClass = e.transferDirection === 'in' ? 'pos' : 'neg';
    sign = e.transferDirection === 'in' ? '+' : '-';
  } else if (e.type === 'expense' && e.amount < 0) {
    // A return/refund — a negative expense amount reads as a credit, not another charge
    valClass = 'pos';
    sign = '+';
    displayAmount = Math.abs(e.amount);
  } else {
    const isNeg = e.type === 'expense';
    valClass = isNeg ? 'neg' : 'pos';
    sign = isNeg ? '' : '+';
  }
  return `
    <div class="entry-row" onclick="openEntryDetail('${e.id}')">
      <div class="entry-icon">
        ${payeeLogoUrl(payee) ? `<img src="${payeeLogoUrl(payee)}" style="width:100%;height:100%;object-fit:contain;background:var(--surface-raised)">` : `<i class="ti ${cat.icon || 'ti-tag'}" style="color:var(--ink-soft)"></i>`}
        <div class="entry-badge" style="background:${categoryColor(e.categoryId)}22"><i class="ti ${cat.icon || 'ti-tag'}" style="color:${categoryColor(e.categoryId)}"></i></div>
      </div>
      <div class="entry-body">
        <div class="entry-top">
          <span class="entry-title">${esc(payee.name || cat.name || 'Entry')}${e.receiptLink ? ' <i class="ti ti-paperclip" style="font-size:12px;color:var(--ink-soft)"></i>' : ''}</span>
          <span class="entry-value ${valClass}">${sign}${fmtMoney(displayAmount)}</span>
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
  const entries = await getActiveEntries();
  const categories = await DB.getAll('categories');
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const payees = await DB.getAll('payees');
  const payeeById = Object.fromEntries(payees.map((p) => [p.id, p]));
  const meta = await DB.get('settings', 'meta');
  const weeklyBudget = meta && meta.groceryWeeklyBudget ? meta.groceryWeeklyBudget : null;
  const currentWeekStart = getWeekStart(todayStr());

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

    <div class="card tight">
      <label class="field-label">Weekly budget</label>
      <div style="display:flex;gap:8px">
        <input type="number" step="0.01" id="groceryBudgetInput" placeholder="No budget set" value="${weeklyBudget || ''}" style="flex:1">
        <button class="btn" style="width:auto;padding:8px 14px" onclick="saveGroceryWeeklyBudget()">Save</button>
      </div>
    </div>

    ${weeks.length ? collapseAllControls('foodBudgetList') : ''}
    <div id="foodBudgetList">${weeks.length ? weeks.map((wk, i) => {
      const weekEntries = byWeek[wk].sort((a, b) => b.date.localeCompare(a.date));
      const total = weekEntries.reduce((s, e) => s + e.amount, 0);
      const isCurrent = wk === currentWeekStart;
      let budgetLine = '';
      if (weeklyBudget) {
        const diff = weeklyBudget - total;
        const over = diff < 0;
        budgetLine = `<span class="amt ${over ? 'neg' : 'pos'}" style="font-weight:600">${over ? fmtMoney(-diff) + ' over' : fmtMoney(diff) + ' left'}</span>`;
      }
      return `
        <div class="section-title" onclick="toggleCollapse(this)" style="cursor:pointer;${weeklyBudget ? 'background:' + (total > weeklyBudget ? 'var(--rose-soft)' : 'var(--sage-soft)') + ';border-radius:10px;padding:8px' : ''}">
          <span>${getWeekLabel(wk)}${isCurrent ? ' · this week' : ''} <i class="ti collapse-chevron ti-chevron-${i===0?'down':'right'}" style="font-size:11px;vertical-align:-1px"></i></span>
          ${weeklyBudget ? `<span style="text-align:right"><span class="amt neg" style="display:block">${fmtMoney(total)} spent</span>${budgetLine}</span>` : `<span class="amt neg">${fmtMoney(total)}</span>`}
        </div>
        <div class="collapse-body" style="display:${i===0?'block':'none'}">${weekEntries.map((e) => renderEntryRow(e, catById, payeeById, false)).join('')}</div>
      `;
    }).join('') : '<div class="empty-state">No Groceries or Meal Kit expenses logged yet.</div>'}</div>
  `;
}
async function saveGroceryWeeklyBudget() {
  const val = parseFloat(document.getElementById('groceryBudgetInput').value) || null;
  const meta = (await DB.get('settings', 'meta')) || { id: 'meta' };
  meta.groceryWeeklyBudget = val;
  await DB.put('settings', meta);
  Sync.pushEntry('Meta', { id: 'groceryBudgetFlag', key: 'groceryWeeklyBudget', value: val });
  renderFoodBudget();
}
function goMain() { currentView = 'main'; duplicateSource = null; route(); }

// ---------- Finance Reports ----------
let reportsCategoryFilter = []; // array of category IDs; empty = all
let reportsStoreFilter = []; // array of payee IDs; empty = all
let reportsTypeFilter = null;
let reportsDateRange = 'last6'; // thisMonth | last3 | last6 | thisYear | allTime
let reportsExcludedCategoryIds = [];
let reportsIncExpChart = null;
let reportsCatChart = null;

function setReportsType(t) { reportsTypeFilter = reportsTypeFilter === t ? null : t; renderReportsStub(); }
function setReportsDateRange(r) { reportsDateRange = r; renderReportsStub(); }

async function openReportsStoreFilterModal() {
  const payees = (await DB.getAll('payees')).sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:6px">Filter by store</p>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:14px">Pick one or more. Leave all unchecked to show everything.</p>
    <div class="check-list">
      ${payees.map((p) => `<label class="check-row">
        <input type="checkbox" ${reportsStoreFilter.includes(p.id) ? 'checked' : ''} onchange="toggleReportsStoreFilter('${p.id}')">
        <span>${esc(p.name)}</span>
      </label>`).join('')}
    </div>
    <button class="btn btn-primary" style="margin-bottom:8px" onclick="closeModal();renderReportsStub();">Apply</button>
    ${reportsStoreFilter.length ? `<button class="btn" onclick="reportsStoreFilter=[];closeModal();renderReportsStub();">Clear selection</button>` : ''}
  `;
  openModal();
}
function toggleReportsStoreFilter(id) {
  const idx = reportsStoreFilter.indexOf(id);
  if (idx === -1) reportsStoreFilter.push(id); else reportsStoreFilter.splice(idx, 1);
}
async function selectUtilitiesFilter() {
  const payees = await DB.getAll('payees');
  const keywords = ['hydro', 'enbridge', 'water'];
  const matches = payees.filter((p) => keywords.some((k) => p.name.toLowerCase().includes(k)));
  reportsStoreFilter = matches.map((p) => p.id);
  renderReportsStub();
}

async function openReportsCategoryFilterModal() {
  const categories = (await DB.getAll('categories')).filter((c) => !c.hidden).sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:6px">Filter by category</p>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:14px">Pick one or more. Leave all unchecked to show everything.</p>
    <div class="check-list">
      ${categories.map((c) => `<label class="check-row">
        <input type="checkbox" ${reportsCategoryFilter.includes(c.id) ? 'checked' : ''} onchange="toggleReportsCategoryFilter('${c.id}')">
        <span style="color:${categoryColor(c.id)}">${esc(c.name)}</span>
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

// ---------- Shared popup entry list (used by charts, table cells, category rows) ----------
let reportsPopupState = null; // { entries, title, subtitle }
let reportsPopupSortBy = 'date'; // date | amount

function setReportsPopupSort(s) { reportsPopupSortBy = s; renderReportsPopupContent(); }

async function renderReportsPopup(entries, title, subtitle) {
  reportsPopupState = { entries, title, subtitle };
  await renderReportsPopupContent();
  openModal();
}
async function renderReportsPopupContent() {
  const categories = await DB.getAll('categories');
  const payees = await DB.getAll('payees');
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const payeeById = Object.fromEntries(payees.map((p) => [p.id, p]));
  const { entries, title, subtitle } = reportsPopupState;
  const sorted = reportsPopupSortBy === 'amount' ? [...entries].sort((a, b) => b.amount - a.amount) : [...entries].sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:2px">${esc(title)}</p>
    ${subtitle ? `<p style="font-size:12px;color:var(--ink-soft);margin-bottom:10px">${subtitle}</p>` : ''}
    <div class="chip-row" style="margin-bottom:12px">
      <button class="chip ${reportsPopupSortBy==='date'?'active':''}" onclick="setReportsPopupSort('date')">Date</button>
      <button class="chip ${reportsPopupSortBy==='amount'?'active':''}" onclick="setReportsPopupSort('amount')">Amount (highest first)</button>
    </div>
    <div>${sorted.length ? sorted.map((e) => renderEntryRow(e, catById, payeeById, true)).join('') : '<div class="empty-state">No entries.</div>'}</div>
  `;
  modalBackStack = renderReportsPopupContent;
}

async function selectReportsCell(categoryId, mk2) {
  const allEntries = await getActiveEntries();
  const categories = await DB.getAll('categories');
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const cat = catById[categoryId] || {};
  const matches = allEntries.filter((e) => e.categoryId === categoryId && monthKey(e.date) === mk2);
  const label = new Date(mk2 + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  renderReportsPopup(matches, cat.name || '', label);
}

async function selectReportsCategoryAll(categoryIdOrIds) {
  const categoryIds = Array.isArray(categoryIdOrIds) ? categoryIdOrIds : [categoryIdOrIds];
  const allEntries = await getActiveEntries();
  const categories = await DB.getAll('categories');
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const displayName = catById[categoryIds[0]] ? catById[categoryIds[0]].name : '';
  const { start, end } = getFinanceRangeBoundsForKeys(getReportsMonthKeys(reportsDateRange, allEntries));
  const matches = allEntries.filter((e) => categoryIds.includes(e.categoryId) && e.date >= start && e.date <= end);
  const total = matches.reduce((s, e) => s + e.amount, 0);

  // Same period, one year earlier — a simple, general "vs last year" for any category
  const shiftYear = (d) => { const dt = new Date(d + 'T00:00:00'); dt.setFullYear(dt.getFullYear() - 1); return fmtISO(dt); };
  const lastYearStart = shiftYear(start), lastYearEnd = shiftYear(end);
  const lastYearMatches = allEntries.filter((e) => categoryIds.includes(e.categoryId) && e.date >= lastYearStart && e.date <= lastYearEnd);
  const lastYearTotal = lastYearMatches.reduce((s, e) => s + e.amount, 0);
  const diff = total - lastYearTotal;
  const diffPct = lastYearTotal ? Math.round((diff / lastYearTotal) * 100) : null;
  const compareLine = lastYearTotal || lastYearMatches.length
    ? `Last year same period: ${fmtMoney(lastYearTotal)} <span style="color:${diff<=0?'#0F6E56':'var(--red)'}">(${diff>=0?'+':''}${fmtMoney(diff)}${diffPct!==null?', '+diffPct+'%':''})</span>`
    : `No entries in this category last year for comparison`;

  renderReportsPopup(matches, displayName, `${FINANCE_RANGE_LABELS[reportsDateRange] || 'Selected range'} · ${fmtMoney(total)} total, ${matches.length} entr${matches.length===1?'y':'ies'}<br>${compareLine}`);
}

async function selectReportsChartMonth(mk2, type) {
  const allEntries = await getActiveEntries();
  let entries = allEntries;
  if (reportsCategoryFilter.length) entries = entries.filter((e) => reportsCategoryFilter.includes(e.categoryId));
  if (reportsStoreFilter.length) entries = entries.filter((e) => reportsStoreFilter.includes(e.storeId));
  const matches = entries.filter((e) => monthKey(e.date) === mk2 && e.type === type);
  const label = new Date(mk2 + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  renderReportsPopup(matches, type[0].toUpperCase() + type.slice(1), label);
}

// The Top Categories chart groups spend by NAME (so a category that's been split into
// multiple duplicate IDs at some point still shows as one bar) — but clicking through
// used to only look up a single ID, silently missing any entries whose categoryId
// pointed at a different duplicate of that same name. Now it gathers every ID that
// shares the clicked name, so the popup actually matches what the bar shows.
async function selectReportsChartCategory(categoryName) {
  const categories = await DB.getAll('categories');
  const matchingIds = categories.filter((c) => c.name === categoryName).map((c) => c.id);
  if (!matchingIds.length) return;
  selectReportsCategoryAll(matchingIds);
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

let reportsView = 'overview'; // overview | table
let reportsInlineSortBy = 'date'; // date | amount

function setReportsView(v) { reportsView = v; renderReportsStub(); }
function setReportsInlineSort(s) { reportsInlineSortBy = s; renderReportsStub(); }
function renderReportsInlineEntries(rangeEntries, catById, payeeById) {
  if (!rangeEntries.length) return '<div class="empty-state">No entries for these categories in this range.</div>';
  if (reportsInlineSortBy === 'amount') {
    const sorted = [...rangeEntries].sort((a, b) => b.amount - a.amount);
    return sorted.map((e) => renderEntryRow(e, catById, payeeById, true)).join('');
  }
  const byMonth = {};
  rangeEntries.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach((e) => { const mk2 = monthKey(e.date); (byMonth[mk2] = byMonth[mk2] || []).push(e); });
  const monthsList = Object.keys(byMonth).sort().reverse();
  return monthsList.map((mk2, i) => `
    ${collapseHeader('month', new Date(mk2+'-01T00:00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'}), netOf(byMonth[mk2]), 0, i===0)}
    <div class="collapse-body" style="display:${i===0?'block':'none'}">${byMonth[mk2].map((e) => renderEntryRow(e, catById, payeeById, true)).join('')}</div>
  `).join('');
}

async function openReportsFiltersModal() {
  const categories = (await DB.getAll('categories')).filter((c) => !c.hidden && !['allowance','personal'].some((ex) => c.name.toLowerCase().includes(ex))).sort((a, b) => a.name.localeCompare(b.name));
  const payees = (await DB.getAll('payees')).sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:14px">Filters</p>

    <label class="field-label">Type</label>
    <div class="chip-row" id="filterTypeChips" style="margin-bottom:14px">
      <button class="chip ${reportsTypeFilter==='expense'?'active':''}" onclick="setReportsTypeInModal('expense')">Expense</button>
      <button class="chip ${reportsTypeFilter==='income'?'active':''}" onclick="setReportsTypeInModal('income')">Income</button>
      <button class="chip ${reportsTypeFilter==='transfer'?'active':''}" onclick="setReportsTypeInModal('transfer')">Transfer</button>
    </div>

    <label class="field-label">Categories</label>
    <div class="check-list" style="max-height:22vh">
      ${categories.map((c) => `<label class="check-row">
        <input type="checkbox" ${reportsCategoryFilter.includes(c.id) ? 'checked' : ''} onchange="toggleReportsCategoryFilter('${c.id}')">
        <span style="color:${categoryColor(c.id)};font-size:13px">${esc(c.name)}</span>
      </label>`).join('')}
    </div>

    <label class="field-label">Stores</label>
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <button class="chip" style="flex:1" onclick="selectUtilitiesFilter();openReportsFiltersModal();"><i class="ti ti-bolt"></i> Utilities</button>
    </div>
    <div class="check-list" style="max-height:22vh">
      ${payees.map((p) => `<label class="check-row">
        <input type="checkbox" ${reportsStoreFilter.includes(p.id) ? 'checked' : ''} onchange="toggleReportsStoreFilter('${p.id}')">
        <span style="font-size:13px">${esc(p.name)}</span>
      </label>`).join('')}
    </div>

    <button class="btn btn-primary" style="margin-bottom:8px" onclick="closeModal();renderReportsStub();">Apply</button>
    ${(reportsCategoryFilter.length || reportsStoreFilter.length || reportsTypeFilter) ? `<button class="btn" onclick="reportsCategoryFilter=[];reportsStoreFilter=[];reportsTypeFilter=null;closeModal();renderReportsStub();">Clear all filters</button>` : ''}
  `;
  openModal();
}
function setReportsTypeInModal(t) {
  reportsTypeFilter = reportsTypeFilter === t ? null : t;
  document.querySelectorAll('#filterTypeChips .chip').forEach((b) => b.classList.remove('active'));
  event.currentTarget.classList.toggle('active', reportsTypeFilter === t);
}

async function renderReportsStub() {
  const allEntries = await getActiveEntries();
  const categories = await DB.getAll('categories');
  const payees = await DB.getAll('payees');
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const payeeById = Object.fromEntries(payees.map((p) => [p.id, p]));

  let entries = allEntries;
  if (reportsCategoryFilter.length) entries = entries.filter((e) => reportsCategoryFilter.includes(e.categoryId));
  if (reportsStoreFilter.length) entries = entries.filter((e) => reportsStoreFilter.includes(e.storeId));
  if (reportsTypeFilter) entries = entries.filter((e) => e.type === reportsTypeFilter);
  const REPORTS_ALWAYS_EXCLUDE = ['allowance', 'personal'];
  entries = entries.filter((e) => {
    const name = (catById[e.categoryId] || {}).name || '';
    return !REPORTS_ALWAYS_EXCLUDE.some((ex) => name.toLowerCase().includes(ex));
  });

  const monthKeys = getReportsMonthKeys(reportsDateRange, entries); // newest first already for thisMonth/last3/last6/thisYear/allTime
  const rangeEntries = entries.filter((e) => monthKeys.includes(monthKey(e.date)));

  const chartMonthKeys = [...monthKeys].reverse(); // chronological, follows the selected date range fully
  const monthLabels = chartMonthKeys.map((mk2) => new Date(mk2 + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' }));
  const incomeByMonth = chartMonthKeys.map((mk2) => entries.filter((e) => monthKey(e.date) === mk2 && e.type === 'income').reduce((s, e) => s + e.amount, 0));
  const expenseByMonth = chartMonthKeys.map((mk2) => entries.filter((e) => monthKey(e.date) === mk2 && e.type === 'expense').reduce((s, e) => s + e.amount, 0));
  const netByMonth = chartMonthKeys.map((mk2, i) => incomeByMonth[i] - expenseByMonth[i]);

  const TOP_CATS_EXCLUDE = ['mortgage'];
  const catSpend = {};
  rangeEntries.filter((e) => e.type === 'expense').forEach((e) => {
    const name = (catById[e.categoryId] || {}).name || 'Other';
    if (TOP_CATS_EXCLUDE.some((ex) => name.toLowerCase().includes(ex))) return;
    catSpend[name] = (catSpend[name] || 0) + e.amount;
  });
  const topCats = Object.entries(catSpend).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Category x month pivot
  const tableCats = categories.filter((c) => !c.hidden && !reportsExcludedCategoryIds.includes(c.id) && !REPORTS_ALWAYS_EXCLUDE.some((ex) => c.name.toLowerCase().includes(ex))).sort((a, b) => a.name.localeCompare(b.name));
  const pivot = {}; // catId -> monthKey -> total
  tableCats.forEach((c) => { pivot[c.id] = {}; });
  rangeEntries.forEach((e) => {
    if (!pivot[e.categoryId]) return;
    pivot[e.categoryId][monthKey(e.date)] = (pivot[e.categoryId][monthKey(e.date)] || 0) + e.amount;
  });
  const monthColLabels = monthKeys.map((mk2) => new Date(mk2 + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' }));

  const activeFilterCount = reportsCategoryFilter.length + reportsStoreFilter.length + (reportsTypeFilter ? 1 : 0);

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Reports</span></div>

    <div class="chip-row">
      <button class="chip ${reportsDateRange==='thisMonth'?'active':''}" onclick="setReportsDateRange('thisMonth')">This month</button>
      <button class="chip ${reportsDateRange==='last3'?'active':''}" onclick="setReportsDateRange('last3')">Last 3 months</button>
      <button class="chip ${reportsDateRange==='last6'?'active':''}" onclick="setReportsDateRange('last6')">Last 6 months</button>
      <button class="chip ${reportsDateRange==='thisYear'?'active':''}" onclick="setReportsDateRange('thisYear')">This year</button>
      <button class="chip ${reportsDateRange==='allTime'?'active':''}" onclick="setReportsDateRange('allTime')">All time</button>
    </div>

    <button class="btn" style="margin-bottom:14px;text-align:left" onclick="openReportsFiltersModal()">
      <i class="ti ti-filter"></i> ${activeFilterCount ? `${activeFilterCount} filter${activeFilterCount===1?'':'s'} active` : 'Filters'}
    </button>

    <div class="btn-toggle-row" style="margin-bottom:14px">
      <button class="btn-toggle ${reportsView==='overview'?'active-neutral':''}" onclick="setReportsView('overview')">Overview</button>
      <button class="btn-toggle ${reportsView==='table'?'active-neutral':''}" onclick="setReportsView('table')">Category table</button>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <button class="btn" style="flex:1 1 45%" onclick="currentView='utilitiesReport';route()"><i class="ti ti-bolt"></i> Utilities</button>
      <button class="btn" style="flex:1 1 45%" onclick="currentView='vehicleReport';route()"><i class="ti ti-car"></i> Vehicles</button>
      <button class="btn" style="flex:1 1 45%" onclick="currentView='transfersReport';route()"><i class="ti ti-arrows-left-right"></i> Transfers</button>
      <button class="btn" style="flex:1 1 45%" onclick="currentView='projectsReport';route()"><i class="ti ti-tools"></i> Projects</button>
    </div>

    ${reportsView === 'overview' ? `
      ${reportsStoreFilter.length > 1 ? `
        <p class="section-label">By store, in range</p>
        <div style="display:grid;grid-template-columns:repeat(${Math.min(reportsStoreFilter.length,3)},1fr);gap:8px;margin-bottom:16px">
          ${reportsStoreFilter.map((sid) => {
            const p = payeeById[sid] || {};
            const total = rangeEntries.filter((e) => e.storeId === sid).reduce((s, e) => s + e.amount, 0);
            return `<div class="stat"><p class="label">${esc(p.name || '')}</p><p class="value" style="font-size:13px">${fmtMoney(total)}</p></div>`;
          }).join('')}
        </div>
      ` : ''}

      <p class="section-label">Income vs expense</p>
      <div style="position:relative;width:100%;height:180px;margin-bottom:20px"><canvas id="reportsIncExpChart"></canvas></div>

      <p class="section-label">Top categories in range</p>
      <div style="position:relative;width:100%;height:${Math.max(100, topCats.length*32)}px;margin-bottom:20px">${topCats.length ? '<canvas id="reportsCatChart"></canvas>' : '<div class="empty-state">No expenses in this range.</div>'}</div>

      ${(() => {
        const budgeted = categories.filter((c) => c.monthlyBudget);
        if (!budgeted.length) return '';
        const monthsWithData = [...new Set(entries.filter((e) => budgeted.some((c) => c.id === e.categoryId)).map((e) => monthKey(e.date)))].sort().reverse().slice(0, 6);
        if (!monthsWithData.length) return '';
        return `
          <p class="section-label">Budget status</p>
          ${monthsWithData.map((mk, mi) => {
            const rows = budgeted.map((c) => {
              const spent = entries.filter((e) => e.categoryId === c.id && monthKey(e.date) === mk && e.type === 'expense').reduce((s, e) => s + e.amount, 0);
              const diff = c.monthlyBudget - spent;
              const over = diff < 0;
              return { name: c.name, budget: c.monthlyBudget, spent, over, diff };
            });
            const overCount = rows.filter((r) => r.over).length;
            const label = new Date(mk + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            return `
              <div class="section-title" style="cursor:pointer" onclick="toggleCollapse(this)">
                <span>${label} <i class="ti collapse-chevron ti-chevron-${mi===0?'down':'right'}" style="font-size:11px;vertical-align:-1px"></i></span>
                <span style="font-size:12px;color:${overCount ? 'var(--red)' : '#0F6E56'}">${overCount ? overCount + ' over' : 'all under'}</span>
              </div>
              <div class="collapse-body" style="display:${mi===0?'block':'none'}">
                ${rows.map((r) => `
                  <div class="list-row" style="cursor:default;display:block;padding:10px 0">
                    <div style="display:flex;justify-content:space-between;align-items:baseline">
                      <span style="font-size:14px;font-weight:600;color:var(--ink)">${esc(r.name)}</span>
                      <span style="font-size:13px;font-weight:600;color:${r.over?'var(--red)':'#0F6E56'}">${r.over ? fmtMoney(-r.diff)+' over' : fmtMoney(r.diff)+' left'}</span>
                    </div>
                    <p style="font-size:11px;color:var(--ink-soft);margin:2px 0 0">Budget ${fmtMoney(r.budget)} · Spent ${fmtMoney(r.spent)}</p>
                  </div>
                `).join('')}
              </div>
            `;
          }).join('')}
        `;
      })()}
    ` : `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
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
                  const overBudget = c.monthlyBudget && val > c.monthlyBudget;
                  return `<td onclick="selectReportsCell('${c.id}','${mk2}')" style="padding:8px 12px;text-align:right;cursor:pointer;color:${overBudget?'var(--red)':(val?'var(--ink)':'var(--line)')};${overBudget?'background:var(--rose-soft);font-weight:600;':''}border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${val ? fmtMoney(val) : '–'}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      ${reportsCategoryFilter.length ? `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
          <p class="section-label" style="margin:0">Entries for selected categories</p>
        </div>
        <div class="chip-row" style="margin-bottom:12px">
          <button class="chip ${reportsInlineSortBy==='date'?'active':''}" onclick="setReportsInlineSort('date')">Date</button>
          <button class="chip ${reportsInlineSortBy==='amount'?'active':''}" onclick="setReportsInlineSort('amount')">Amount (highest first)</button>
        </div>
        ${reportsInlineSortBy === 'date' ? collapseAllControls('reportsEntriesList') : ''}
        <div id="reportsEntriesList">${renderReportsInlineEntries(rangeEntries, catById, payeeById)}</div>
      ` : ''}
    `}
  `;

  if (reportsView !== 'overview') return; // no charts to draw on the Table tab

  const muted = getComputedStyle(document.documentElement).getPropertyValue('--ink-soft').trim() || '#5B5568';
  if (reportsIncExpChart) reportsIncExpChart.destroy();
  reportsIncExpChart = new Chart(document.getElementById('reportsIncExpChart'), {
    type: 'bar',
    data: { labels: monthLabels, datasets: [
      { label: 'Income', data: incomeByMonth, backgroundColor: '#008300', borderRadius: 4 },
      { label: 'Expense', data: expenseByMonth, backgroundColor: '#C9564F', borderRadius: 4 },
      { label: 'Net', data: netByMonth, type: 'line', borderColor: '#2B2640', backgroundColor: '#2B2640', tension: 0.3, yAxisID: 'y', order: 0, pointRadius: 3 }
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom', labels: { color: muted, boxWidth: 12, font: { size: 11 } } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { color: muted } } },
      onClick: (evt, els) => {
        if (!els.length) return;
        if (els[0].datasetIndex === 2) return; // the Net line isn't a real transaction type to drill into
        const type = els[0].datasetIndex === 0 ? 'income' : 'expense';
        selectReportsChartMonth(chartMonthKeys[els[0].index], type);
      }
    }
  });
  if (topCats.length) {
    if (reportsCatChart) reportsCatChart.destroy();
    reportsCatChart = new Chart(document.getElementById('reportsCatChart'), {
      type: 'bar',
      data: { labels: topCats.map((c) => c[0]), datasets: [{ data: topCats.map((c) => c[1]), backgroundColor: '#E3A94E', borderRadius: 4 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: muted } }, y: { grid: { display: false }, ticks: { color: muted } } },
        onClick: (evt, els) => {
          if (!els.length) return;
          selectReportsChartCategory(topCats[els[0].index][0]);
        }
      }
    });
  }
}

// ---------- Utilities year-over-year report ----------
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function utilityEntriesFor(allEntries, storeId, year, monthNum) {
  const mk2 = `${year}-${String(monthNum).padStart(2,'0')}`;
  return allEntries.filter((e) => e.storeId === storeId && monthKey(e.date) === mk2);
}

async function renderUtilitiesReport() {
  const allEntries = await getActiveEntries();
  const payees = await DB.getAll('payees');
  const keywords = ['hydro', 'enbridge', 'water'];
  const utilityStores = payees.filter((p) => keywords.some((k) => p.name.toLowerCase().includes(k))).sort((a,b) => a.name.localeCompare(b.name));
  const utilityIds = new Set(utilityStores.map((p) => p.id));
  const relevant = allEntries.filter((e) => utilityIds.has(e.storeId));

  if (!relevant.length) {
    $main.innerHTML = `<div class="back" style="margin-bottom:14px;cursor:pointer" onclick="currentView='reports';route()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Utilities</span></div><div class="empty-state">No utility entries yet. Store names matched: Hydro, Enbridge, Water.</div>`;
    return;
  }

  const years = [...new Set(relevant.map((e) => e.date.slice(0,4)))].sort().reverse();
  const yearTotal = (year) => utilityStores.reduce((s, store) => s + MONTH_ABBR.reduce((s2, _, i) => s2 + utilityEntriesFor(relevant, store.id, year, i+1).reduce((s3,e)=>s3+e.amount,0), 0), 0);

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="currentView='reports';route()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Utilities</span></div>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:16px">Tap a cell for that month, tap a store's name for its full year</p>

    ${years.length > 1 ? `
      <p class="section-label" style="margin-bottom:8px">Total by year</p>
      <div style="position:relative;width:100%;height:160px;margin-bottom:20px"><canvas id="utilitiesYearChart"></canvas></div>
    ` : ''}

    <div style="display:grid;grid-template-columns:repeat(${Math.min(years.length,4)},1fr);gap:8px;margin-bottom:16px">
      ${years.map((year) => `<div class="stat"><p class="label">${year} total</p><p class="value" style="font-size:14px">${fmtMoney(yearTotal(year))}</p></div>`).join('')}
    </div>

    ${years.map((year) => {
      const rowsHtml = utilityStores.map((store) => {
        const cells = MONTH_ABBR.map((_, i) => {
          const matches = utilityEntriesFor(relevant, store.id, year, i + 1);
          const total = matches.reduce((s, e) => s + e.amount, 0);
          return `<td onclick="selectUtilityCell('${store.id}','${year}',${i+1})" style="padding:8px 10px;text-align:right;cursor:pointer;color:${total?'var(--ink)':'var(--line)'};border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${total ? fmtMoney(total) : '–'}</td>`;
        }).join('');
        return `<tr><td onclick="selectUtilityStoreYear('${store.id}','${year}')" style="padding:8px 10px;position:sticky;left:0;background:var(--surface-raised);font-weight:700;cursor:pointer;color:var(--gold);border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${esc(store.name)}</td>${cells}</tr>`;
      }).join('');
      const totalCells = MONTH_ABBR.map((_, i) => {
        const total = utilityStores.reduce((s, store) => s + utilityEntriesFor(relevant, store.id, year, i+1).reduce((s2,e)=>s2+e.amount,0), 0);
        return `<td style="padding:8px 10px;text-align:right;font-weight:700;border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${total ? fmtMoney(total) : '–'}</td>`;
      }).join('');
      return `
        <p class="section-label">${year}</p>
        <div style="overflow-x:auto;margin-bottom:20px;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:12px">
          <table style="border-collapse:collapse;font-size:12px;white-space:nowrap;width:100%">
            <thead><tr>
              <th style="text-align:left;padding:8px 10px;position:sticky;left:0;background:var(--surface-raised);color:var(--ink-soft);font-weight:600;min-width:110px;border-bottom:1px solid var(--line);border-right:1px solid var(--line)"></th>
              ${MONTH_ABBR.map((m) => `<th style="text-align:right;padding:8px 10px;color:var(--ink-soft);font-weight:600;min-width:64px;border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${m}</th>`).join('')}
            </tr></thead>
            <tbody>
              ${rowsHtml}
              <tr style="background:var(--sage-soft)"><td style="padding:8px 10px;position:sticky;left:0;background:var(--sage-soft);font-weight:700;border-right:1px solid var(--line)">Total</td>${totalCells}</tr>
            </tbody>
          </table>
        </div>
      `;
    }).join('')}
  `;

  if (years.length > 1) {
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--ink-soft').trim() || '#5B5568';
    const chronological = [...years].reverse();
    const palette = ['#E3A94E', '#2A78D6', '#C9564F', '#7C9473', '#B5568C'];
    if (window.__utilitiesYearChart) window.__utilitiesYearChart.destroy();
    window.__utilitiesYearChart = new Chart(document.getElementById('utilitiesYearChart'), {
      type: 'bar',
      data: {
        labels: chronological,
        datasets: utilityStores.map((store, i) => ({
          label: store.name,
          data: chronological.map((year) => MONTH_ABBR.reduce((s, _, m) => s + utilityEntriesFor(relevant, store.id, year, m+1).reduce((s2,e)=>s2+e.amount,0), 0)),
          backgroundColor: palette[i % palette.length], borderRadius: 4
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: muted, boxWidth: 12, font: { size: 11 } } } },
        scales: { x: { grid: { display: false }, ticks: { color: muted }, stacked: true }, y: { ticks: { color: muted }, stacked: true } }
      }
    });
  }
}
async function selectUtilityStoreYear(storeId, year) {
  const allEntries = await getActiveEntries();
  const payees = await DB.getAll('payees');
  const store = payees.find((p) => p.id === storeId) || {};
  const matches = MONTH_ABBR.flatMap((_, i) => utilityEntriesFor(allEntries, storeId, year, i + 1));
  renderReportsPopup(matches, store.name || '', `${year} — ${fmtMoney(matches.reduce((s,e)=>s+e.amount,0))} total`);
}
async function selectUtilityCell(storeId, year, monthNum) {
  const allEntries = await getActiveEntries();
  const payees = await DB.getAll('payees');
  const store = payees.find((p) => p.id === storeId) || {};
  const matches = utilityEntriesFor(allEntries, storeId, year, monthNum);
  renderReportsPopup(matches, store.name || '', `${MONTH_ABBR[monthNum-1]} ${year}`);
}

// ---------- Finance vehicle cost report ----------
function vehicleEntriesFor(entries, carId, categoryId, mk2) {
  return entries.filter((e) => {
    if (e.categoryId !== categoryId) return false;
    if (mk2 && monthKey(e.date) !== mk2) return false;
    if (e.carSplit && e.carSplit.length) return e.carSplit.some((s) => s.carId === carId);
    return e.carId === carId;
  });
}
function vehicleAmountFor(entries, carId, categoryId, mk2) {
  let total = 0;
  vehicleEntriesFor(entries, carId, categoryId, mk2).forEach((e) => {
    if (e.carSplit && e.carSplit.length) {
      const share = e.carSplit.find((s) => s.carId === carId);
      if (share) total += share.amount;
    } else {
      total += e.amount;
    }
  });
  return total;
}

let vehicleReportRange = '1y'; // 3m | 6m | 1y | 2y | all
function setVehicleReportRange(r) { vehicleReportRange = r; renderFinanceVehicleReport(); }
function vehicleReportRangeBounds(range) {
  const now = new Date();
  if (range === 'all') return { start: '0000-01-01', end: '9999-12-31' };
  const monthsBack = { '3m': 3, '6m': 6, '1y': 12, '2y': 24 }[range] || 12;
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1);
  return { start: fmtISO(start), end: fmtISO(now) };
}

const VEHICLE_CAR_EXCLUDE = {
  'Gas': ['all cars', 'tesla'],
  'Car maintenance': ['tesla'],
  'Car insurance': ['all cars']
};

async function renderFinanceVehicleReport() {
  const allEntries = await getActiveEntries();
  const categories = await DB.getAll('categories');
  const cars = (await DB.getAll('cars')).sort((a,b) => a.name.localeCompare(b.name));
  const gasCat = categories.find((c) => c.name.toLowerCase() === 'gas');
  const maintCat = categories.find((c) => c.name.toLowerCase().includes('car maintenance'));
  const insCat = categories.find((c) => c.name.toLowerCase().includes('car insurance'));
  const catGroups = [
    { label: 'Gas', cat: gasCat },
    { label: 'Car maintenance', cat: maintCat },
    { label: 'Car insurance', cat: insCat }
  ].filter((g) => g.cat);

  const relevant = allEntries.filter((e) => catGroups.some((g) => e.categoryId === g.cat.id));
  if (!relevant.length || !cars.length) {
    $main.innerHTML = `<div class="back" style="margin-bottom:14px;cursor:pointer" onclick="currentView='reports';route()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Vehicles</span></div><div class="empty-state">No Gas / Car Maintenance / Car Insurance entries with a car assigned yet.</div>`;
    return;
  }
  // Newest month first, leftmost — right next to the label column
  const monthKeysList = [...new Set(relevant.map((e) => monthKey(e.date)))].sort().reverse();
  const monthColLabels = monthKeysList.map((mk2) => new Date(mk2+'-01T00:00:00').toLocaleDateString(undefined,{month:'short',year:'numeric'}));

  const allCarsCar = cars.find((c) => c.name.toLowerCase() === 'all cars');
  const realCars = cars.filter((c) => !['all cars', 'tesla'].includes(c.name.toLowerCase()));

  const gasTotalAllTime = gasCat ? relevant.filter((e) => e.categoryId === gasCat.id).reduce((s,e) => s + e.amount, 0) : 0;
  const gasMonthsCount = gasCat ? new Set(relevant.filter((e) => e.categoryId === gasCat.id).map((e) => monthKey(e.date))).size : 0;
  const avgGasPerMonth = gasMonthsCount ? gasTotalAllTime / gasMonthsCount : 0;

  // Per-car gas average, not just one overall number — each car's own total divided by
  // the number of distinct months *that car* actually had a gas entry, so a car you've
  // only owned for 2 months doesn't get diluted by months it wasn't even yours yet.
  const excludeGasNames = VEHICLE_CAR_EXCLUDE['Gas'] || [];
  const gasCarsForAvg = cars.filter((c) => !excludeGasNames.includes(c.name.toLowerCase()));
  const avgGasPerCar = gasCat ? gasCarsForAvg.map((car) => {
    const carGasEntries = relevant.filter((e) => e.categoryId === gasCat.id && e.carId === car.id);
    const months = new Set(carGasEntries.map((e) => monthKey(e.date))).size;
    const total = carGasEntries.reduce((s, e) => s + e.amount, 0);
    return { car, avg: months ? total / months : 0 };
  }).filter((r) => r.avg > 0) : [];

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="currentView='reports';route()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Vehicles</span></div>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:16px">Tap a cell to see its entries</p>

    ${gasCat ? `<div class="stat" style="margin-bottom:8px"><p class="label">Avg gas / month (all cars combined)</p><p class="value" style="font-size:14px">${fmtMoney(avgGasPerMonth)}</p></div>` : ''}
    ${avgGasPerCar.length ? `<div class="card tight" style="margin-bottom:16px">
      <p class="field-label" style="margin-bottom:6px">Avg gas / month, by car</p>
      ${avgGasPerCar.map((r) => `<div class="list-row" style="cursor:default"><span style="font-size:12px">${esc(r.car.name)}</span><span style="font-size:12px;font-weight:600">${fmtMoney(r.avg)}</span></div>`).join('')}
    </div>` : ''}

    <div style="overflow-x:auto;margin-bottom:20px;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:12px">
      <table style="border-collapse:collapse;font-size:12px;white-space:nowrap;width:100%">
        <thead><tr>
          <th style="text-align:left;padding:8px 10px;position:sticky;left:0;background:var(--surface-raised);color:var(--ink-soft);font-weight:600;min-width:120px;border-bottom:1px solid var(--line);border-right:1px solid var(--line)"></th>
          ${monthColLabels.map((l) => `<th style="text-align:right;padding:8px 10px;color:var(--ink-soft);font-weight:600;min-width:64px;border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${l}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${catGroups.map((g) => {
            const excludeNames = VEHICLE_CAR_EXCLUDE[g.label] || [];
            const carsForGroup = cars.filter((c) => !excludeNames.includes(c.name.toLowerCase()));
            return `
            <tr style="background:var(--gold-soft)"><td colspan="${monthKeysList.length+1}" style="padding:6px 10px;position:sticky;left:0;background:var(--gold-soft);font-weight:700;border-bottom:1px solid var(--line)">${g.label}</td></tr>
            ${carsForGroup.map((car) => `
              <tr>
                <td style="padding:8px 10px;position:sticky;left:0;background:var(--surface-raised);font-weight:600;border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${esc(car.name)}</td>
                ${monthKeysList.map((mk2) => {
                  const val = vehicleAmountFor(relevant, car.id, g.cat.id, mk2);
                  return `<td onclick="selectVehicleCell('${car.id}','${g.cat.id}','${mk2}')" style="padding:8px 10px;text-align:right;cursor:pointer;color:${val?'var(--ink)':'var(--line)'};border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${val ? fmtMoney(val) : '–'}</td>`;
                }).join('')}
              </tr>
            `).join('')}
            <tr style="background:var(--surface)">
              <td style="padding:8px 10px;position:sticky;left:0;background:var(--surface);font-weight:700;border-bottom:1px solid var(--line);border-right:1px solid var(--line)">Total</td>
              ${monthKeysList.map((mk2) => {
                const total = carsForGroup.reduce((s, car) => s + vehicleAmountFor(relevant, car.id, g.cat.id, mk2), 0);
                return `<td style="padding:8px 10px;text-align:right;font-weight:700;border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${total ? fmtMoney(total) : '–'}</td>`;
              }).join('')}
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>

    ${maintCat ? `
      <p class="section-label" style="margin-bottom:8px">Car maintenance over time</p>
      <div style="position:relative;width:100%;height:220px;margin-bottom:20px"><canvas id="vehicleMaintChart"></canvas></div>
    ` : ''}

    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
      <p class="section-label" style="margin:0">Cost of ownership</p>
    </div>
    <div class="chip-row" style="margin-bottom:14px">
      <button class="chip ${vehicleReportRange==='3m'?'active':''}" onclick="setVehicleReportRange('3m')">3M</button>
      <button class="chip ${vehicleReportRange==='6m'?'active':''}" onclick="setVehicleReportRange('6m')">6M</button>
      <button class="chip ${vehicleReportRange==='1y'?'active':''}" onclick="setVehicleReportRange('1y')">1Y</button>
      <button class="chip ${vehicleReportRange==='2y'?'active':''}" onclick="setVehicleReportRange('2y')">2Y</button>
      <button class="chip ${vehicleReportRange==='all'?'active':''}" onclick="setVehicleReportRange('all')">All time</button>
    </div>
    ${(() => {
      const { start, end } = vehicleReportRangeBounds(vehicleReportRange);
      const inRange = relevant.filter((e) => e.date >= start && e.date <= end);
      return realCars.map((car) => {
        const gasTotal = gasCat ? vehicleOwnershipAmount(inRange, car.id, gasCat.id, allCarsCar ? allCarsCar.id : null, realCars.length) : 0;
        const maintTotal = maintCat ? vehicleOwnershipAmount(inRange, car.id, maintCat.id, allCarsCar ? allCarsCar.id : null, realCars.length) : 0;
        const insTotal = insCat ? vehicleOwnershipAmount(inRange, car.id, insCat.id, allCarsCar ? allCarsCar.id : null, realCars.length) : 0;
        const maintOnly = maintTotal; // no gas, no insurance
        const withoutGas = maintTotal + insTotal;
        const withGas = withoutGas + gasTotal;
        return `
          <div class="card tight" style="margin-bottom:10px">
            <p style="font-weight:700;margin-bottom:6px">${esc(car.name)}</p>
            <div class="stat-grid">
              <div class="stat" style="cursor:pointer" onclick="selectVehicleOwnershipStat('${car.id}','maint','${vehicleReportRange}')"><p class="label">Maintenance only</p><p class="value" style="font-size:14px">${fmtMoney(maintOnly)}</p></div>
              <div class="stat" style="cursor:pointer" onclick="selectVehicleOwnershipStat('${car.id}','nogas','${vehicleReportRange}')"><p class="label">Without gas</p><p class="value" style="font-size:14px">${fmtMoney(withoutGas)}</p></div>
              <div class="stat" style="cursor:pointer" onclick="selectVehicleOwnershipStat('${car.id}','withgas','${vehicleReportRange}')"><p class="label">With gas</p><p class="value" style="font-size:14px">${fmtMoney(withGas)}</p></div>
            </div>
          </div>
        `;
      }).join('');
    })()}
  `;

  // Car maintenance over time — one line per car
  if (maintCat) {
    const months = [...new Set(relevant.filter((e) => e.categoryId === maintCat.id).map((e) => monthKey(e.date)))].sort();
    const labels = months.map((mk2) => new Date(mk2+'-01T00:00:00').toLocaleDateString(undefined,{month:'short',year:'numeric'}));
    const excludeMaintNames = [...(VEHICLE_CAR_EXCLUDE['Car maintenance'] || []), 'all cars']; // "All Cars" is a synthetic bucket, not a real vehicle — doesn't belong in a per-car breakdown
    const maintCars = cars.filter((c) => !excludeMaintNames.includes(c.name.toLowerCase()));
    const palette = ['#E3A94E', '#2A78D6', '#C9564F', '#7C9473', '#B5568C', '#D4783F'];
    const datasets = maintCars.map((car, i) => ({
      label: car.name,
      data: months.map((mk2) => vehicleAmountFor(relevant, car.id, maintCat.id, mk2) || 0),
      backgroundColor: palette[i % palette.length],
      borderRadius: 4
    })).filter((ds) => ds.data.some((v) => v > 0));
    if (datasets.length) {
      const muted = getComputedStyle(document.documentElement).getPropertyValue('--ink-soft').trim() || '#5B5568';
      if (window.__vehicleMaintChart) window.__vehicleMaintChart.destroy();
      window.__vehicleMaintChart = new Chart(document.getElementById('vehicleMaintChart'), {
        type: 'bar',
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: muted, boxWidth: 12, font: { size: 11 } } } },
          scales: { x: { grid: { display: false }, ticks: { color: muted, font: { size: 10 } } }, y: { ticks: { color: muted } } }
        }
      });
    }
  }
}
// Cost-of-ownership specific: a car's own entries, plus an even share of any entry
// tagged to "All Cars" (since that cost genuinely applies to all real cars, split evenly).
// Same matching logic as vehicleOwnershipAmount, but returns the actual entries
// instead of a sum — used so tapping a cost-of-ownership stat can show what it's made of.
function vehicleOwnershipEntries(entries, carId, categoryIds, allCarsId) {
  return entries.filter((e) => {
    if (!categoryIds.includes(e.categoryId)) return false;
    if (e.carSplit && e.carSplit.length) return e.carSplit.some((s) => s.carId === carId || (allCarsId && s.carId === allCarsId));
    return e.carId === carId || (allCarsId && e.carId === allCarsId);
  });
}
async function selectVehicleOwnershipStat(carId, statType, range) {
  const cars = await DB.getAll('cars');
  const car = cars.find((c) => c.id === carId) || {};
  const categories = await DB.getAll('categories');
  const gasCat = categories.find((c) => c.name === 'Gas');
  const maintCat = categories.find((c) => c.name === 'Car maintenance');
  const insCat = categories.find((c) => c.name === 'Car insurance');
  const catIds = statType === 'maint' ? [maintCat && maintCat.id].filter(Boolean)
    : statType === 'nogas' ? [maintCat && maintCat.id, insCat && insCat.id].filter(Boolean)
    : [maintCat && maintCat.id, insCat && insCat.id, gasCat && gasCat.id].filter(Boolean);
  const allEntries = await getActiveEntries();
  const allCarsCar = cars.find((c) => c.name.toLowerCase() === 'all cars');
  const { start, end } = vehicleReportRangeBounds(range);
  const inRange = allEntries.filter((e) => e.date >= start && e.date <= end);
  const matches = vehicleOwnershipEntries(inRange, carId, catIds, allCarsCar ? allCarsCar.id : null);
  const label = statType === 'maint' ? 'Maintenance only' : statType === 'nogas' ? 'Without gas' : 'With gas';
  const rangeLabels = { '3m': 'Last 3 months', '6m': 'Last 6 months', '1y': 'Last year', '2y': 'Last 2 years', 'all': 'All time' };
  renderReportsPopup(matches, car.name || '', `${label} · ${rangeLabels[range] || range}${allCarsCar ? ' (includes a share of any "All Cars" entries)' : ''}`);
}
function vehicleOwnershipAmount(entries, carId, categoryId, allCarsId, realCarsCount) {
  let total = 0;
  entries.forEach((e) => {
    if (e.categoryId !== categoryId) return;
    if (e.carSplit && e.carSplit.length) {
      const share = e.carSplit.find((s) => s.carId === carId);
      if (share) total += share.amount;
      if (allCarsId) {
        const allShare = e.carSplit.find((s) => s.carId === allCarsId);
        if (allShare) total += allShare.amount / realCarsCount;
      }
    } else if (e.carId === carId) {
      total += e.amount;
    } else if (allCarsId && e.carId === allCarsId) {
      total += e.amount / realCarsCount;
    }
  });
  return total;
}
async function selectVehicleCell(carId, categoryId, mk2) {
  const allEntries = await getActiveEntries();
  const cars = await DB.getAll('cars');
  const categories = await DB.getAll('categories');
  const car = cars.find((c) => c.id === carId) || {};
  const cat = categories.find((c) => c.id === categoryId) || {};
  const matches = vehicleEntriesFor(allEntries, carId, categoryId, mk2);
  const label = new Date(mk2+'-01T00:00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'});
  renderReportsPopup(matches, `${car.name} · ${cat.name}`, label);
}

// ---------- Transfers report ----------
// ---------- Projects by year report ----------
async function renderProjectsReport() {
  const allEntries = await getActiveEntries();
  const projects = await DB.getAll('projects');
  const projectById = Object.fromEntries(projects.map((p) => [p.id, p]));
  const relevant = allEntries.filter((e) => e.projectId && e.type === 'expense');

  if (!relevant.length) {
    $main.innerHTML = `<div class="back" style="margin-bottom:14px;cursor:pointer" onclick="currentView='reports';route()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Projects</span></div><div class="empty-state">No expenses tagged to a project yet.</div>`;
    return;
  }

  const years = [...new Set(relevant.map((e) => e.date.slice(0, 4)))].sort().reverse();
  const projectIds = [...new Set(relevant.map((e) => e.projectId))];
  // Previously this silently dropped any projectId that didn't match a *current* project
  // record (e.g. a project that got deleted or recreated with a new ID since) — meaning
  // real spending data could disappear from the table with no indication why. Now it
  // shows those under "Unknown project" instead, so nothing is hidden, and it's obvious
  // if that's actually what's happening.
  const projectsUsed = projectIds.map((id) => projectById[id] || { id, name: 'Unknown project (was this one deleted or recreated?)' }).sort((a, b) => a.name.localeCompare(b.name));

  const amountFor = (projectId, year) => relevant.filter((e) => e.projectId === projectId && e.date.slice(0, 4) === year).reduce((s, e) => s + e.amount, 0);

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="currentView='reports';route()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Projects</span></div>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:16px">Tap a cell to see its entries</p>

    <p class="section-label" style="margin-bottom:8px">By year</p>
    <div style="position:relative;width:100%;height:${Math.max(160, projectsUsed.length * years.length * 10)}px;margin-bottom:20px"><canvas id="projectsYearChart"></canvas></div>

    <div style="overflow-x:auto;margin-bottom:20px;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:12px">
      <table style="border-collapse:collapse;font-size:12px;white-space:nowrap;width:100%">
        <thead><tr>
          <th style="text-align:left;padding:8px 12px;position:sticky;left:0;background:var(--surface-raised);color:var(--ink-soft);font-weight:600;min-width:120px;border-bottom:1px solid var(--line);border-right:1px solid var(--line)">Project</th>
          ${years.map((y) => `<th style="text-align:right;padding:8px 12px;color:var(--ink-soft);font-weight:600;min-width:80px;border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${y}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${projectsUsed.map((p) => `
            <tr>
              <td style="padding:8px 12px;position:sticky;left:0;background:var(--surface-raised);font-weight:700;color:var(--gold);border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${esc(p.name)}</td>
              ${years.map((y) => {
                const val = amountFor(p.id, y);
                return `<td onclick="selectProjectYearCell('${p.id}','${y}')" style="padding:8px 12px;text-align:right;cursor:pointer;color:${val?'var(--ink)':'var(--line)'};border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${val ? fmtMoney(val) : '–'}</td>`;
              }).join('')}
            </tr>
          `).join('')}
          <tr style="background:var(--surface)">
            <td style="padding:8px 12px;position:sticky;left:0;background:var(--surface);font-weight:700;border-bottom:1px solid var(--line);border-right:1px solid var(--line)">Total</td>
            ${years.map((y) => {
              const total = projectsUsed.reduce((s, p) => s + amountFor(p.id, y), 0);
              return `<td style="padding:8px 12px;text-align:right;font-weight:700;border-bottom:1px solid var(--line);border-right:1px solid var(--line)">${total ? fmtMoney(total) : '–'}</td>`;
            }).join('')}
          </tr>
        </tbody>
      </table>
    </div>
  `;

  const muted = getComputedStyle(document.documentElement).getPropertyValue('--ink-soft').trim() || '#5B5568';
  const palette = ['#E3A94E', '#2A78D6', '#C9564F', '#7C9473', '#B5568C', '#D4783F'];
  if (window.__projectsYearChart) window.__projectsYearChart.destroy();
  window.__projectsYearChart = new Chart(document.getElementById('projectsYearChart'), {
    type: 'bar',
    data: {
      labels: projectsUsed.map((p) => p.name),
      datasets: years.map((y, i) => ({ label: y, data: projectsUsed.map((p) => amountFor(p.id, y)), backgroundColor: palette[i % palette.length], borderRadius: 4 }))
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: muted, boxWidth: 12, font: { size: 11 } } } },
      scales: { x: { ticks: { color: muted } }, y: { grid: { display: false }, ticks: { color: muted, font: { size: 10 } } } }
    }
  });
}
async function selectProjectYearCell(projectId, year) {
  const allEntries = await getActiveEntries();
  const projects = await DB.getAll('projects');
  const p = projects.find((x) => x.id === projectId) || {};
  const matches = allEntries.filter((e) => e.projectId === projectId && e.date.slice(0, 4) === year);
  renderReportsPopup(matches, p.name || '', year);
}

async function renderTransfersReport() {
  const allEntries = await getActiveEntries();
  const categories = await DB.getAll('categories');
  const payees = await DB.getAll('payees');
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const payeeById = Object.fromEntries(payees.map((p) => [p.id, p]));
  const transfers = allEntries.filter((e) => e.type === 'transfer');

  if (!transfers.length) {
    $main.innerHTML = `<div class="back" style="margin-bottom:14px;cursor:pointer" onclick="currentView='reports';route()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Transfers</span></div><div class="empty-state">No transfer entries yet.</div>`;
    return;
  }

  const totalIn = transfers.filter((e) => e.transferDirection === 'in').reduce((s, e) => s + e.amount, 0);
  const totalOut = transfers.filter((e) => e.transferDirection !== 'in').reduce((s, e) => s + e.amount, 0);

  const byCategory = {};
  transfers.forEach((e) => {
    const cid = e.categoryId;
    byCategory[cid] = byCategory[cid] || { in: 0, out: 0 };
    if (e.transferDirection === 'in') byCategory[cid].in += e.amount; else byCategory[cid].out += e.amount;
  });
  const catRows = Object.entries(byCategory).sort((a, b) => (catById[a[0]]||{}).name?.localeCompare((catById[b[0]]||{}).name) || 0);

  const byMonth = {};
  transfers.slice().sort((a,b) => b.date.localeCompare(a.date)).forEach((e) => { const mk = monthKey(e.date); (byMonth[mk] = byMonth[mk] || []).push(e); });
  const months = Object.keys(byMonth).sort().reverse();

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="currentView='reports';route()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Transfers</span></div>
    <div class="stat-grid">
      <div class="stat" style="background:var(--sage-soft)"><p class="label">In</p><p class="value" style="color:#0F6E56">${fmtMoney(totalIn)}</p></div>
      <div class="stat" style="background:var(--rose-soft)"><p class="label">Out</p><p class="value" style="color:var(--red)">${fmtMoney(totalOut)}</p></div>
    </div>
    <p class="section-label">By category</p>
    ${catRows.map(([cid, v]) => `
      <div class="list-row" onclick="selectReportsCategoryTransfers('${cid}')">
        <span style="color:${categoryColor(cid)};font-weight:700">${esc((catById[cid]||{}).name || 'Unknown')}</span>
        <span style="font-size:12px"><span style="color:#0F6E56">+${fmtMoney(v.in)}</span> · <span style="color:var(--red)">-${fmtMoney(v.out)}</span></span>
      </div>
    `).join('')}

    <p class="section-label" style="margin-top:16px">All transfers</p>
    ${months.map((mk, i) => {
      const monthNet = byMonth[mk].reduce((s, e) => s + (e.transferDirection === 'in' ? e.amount : -e.amount), 0);
      return `
      ${collapseHeader('month', new Date(mk+'-01T00:00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'}), monthNet, 0, i===0)}
      <div class="collapse-body" style="display:${i===0?'block':'none'}">${byMonth[mk].map((e) => renderEntryRow(e, catById, payeeById, true)).join('')}</div>
    `;
    }).join('')}
  `;
}
async function selectReportsCategoryTransfers(categoryId) {
  const allEntries = await getActiveEntries();
  const matches = allEntries.filter((e) => e.type === 'transfer' && e.categoryId === categoryId);
  const categories = await DB.getAll('categories');
  const cat = categories.find((c) => c.id === categoryId) || {};
  renderReportsPopup(matches, cat.name || '', `${matches.length} entr${matches.length===1?'y':'ies'}`);
}

async function openReportsCategoryConfig() {
  const categories = (await DB.getAll('categories')).filter((c) => !c.hidden && !['allowance','personal'].some((ex) => c.name.toLowerCase().includes(ex))).sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:6px">Table categories</p>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:14px">Uncheck any category to remove it from the table above.</p>
    <div class="check-list" style="max-height:50vh">
      ${categories.map((c) => `<label class="check-row">
        <input type="checkbox" ${reportsExcludedCategoryIds.includes(c.id) ? '' : 'checked'} onchange="toggleReportsExcludeCategory('${c.id}')">
        <span style="color:${categoryColor(c.id)}">${esc(c.name)}</span>
      </label>`).join('')}
    </div>
    <button class="btn btn-primary" onclick="closeModal()">Done</button>
  `;
  openModal();
}

// ---------- Add / Edit Entry ----------
let currentEntryId = null;
function openEntryDetail(id) { currentEntryId = id; renderEntryDetail(); }

let modalBackStack = null;
function openModal() { document.getElementById('modalOverlay').style.display = 'flex'; }
function closeModal() { document.getElementById('modalOverlay').style.display = 'none'; document.getElementById('modalSheet').innerHTML = ''; modalBackStack = null; }

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
  const isRefund = entry.type === 'expense' && entry.amount < 0;
  const isNeg = entry.type === 'expense' && !isRefund;
  const valClass = entry.type === 'transfer' ? '' : (isNeg ? 'neg' : 'pos');
  const detailSign = isRefund ? '+' : (entry.type === 'expense' ? '-' : (entry.type === 'income' ? '+' : ''));
  const detailAmount = Math.abs(entry.amount);

  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    ${payeeLogoUrl(payee) ? `
      <div style="width:76px;height:76px;border-radius:18px;overflow:hidden;margin:0 auto 14px;box-shadow:var(--shadow)">
        <img src="${payeeLogoUrl(payee)}" style="width:100%;height:100%;object-fit:contain;background:var(--surface-raised)">
      </div>
    ` : ''}
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          ${!payeeLogoUrl(payee) ? `<div class="entry-icon" style="width:36px;height:36px"><i class="ti ${cat.icon || 'ti-tag'}" style="color:var(--ink-soft);font-size:18px"></i></div>` : ''}
          <div>
            <p style="font-size:16px;font-weight:600;margin:0">${esc(payee.name || cat.name || 'Entry')}</p>
            <p style="font-size:12px;color:var(--ink-soft);margin:2px 0 0">${esc(cat.name || '')}</p>
          </div>
        </div>
        <span class="entry-value ${valClass}" style="font-size:20px">${detailSign}${fmtMoney(detailAmount)}</span>
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
    ${renderLinkPreview(entry.receiptLink, 'Receipt')}

    <button class="btn" style="margin-bottom:10px" onclick="editEntry()"><i class="ti ti-edit"></i> Edit</button>
    <button class="btn" style="margin-bottom:10px" onclick="duplicateEntry()"><i class="ti ti-copy"></i> Duplicate</button>
    <button class="btn" style="background:var(--red-soft);color:var(--red);border-color:var(--red);margin-bottom:10px" onclick="deleteEntry()"><i class="ti ti-trash"></i> Delete</button>
    <button class="btn" onclick="if(modalBackStack){modalBackStack();}else{closeModal();}">${modalBackStack ? 'Back' : 'Close'}</button>
  `;
  openModal();
}

// Shared across Finance receipts, Jazz photos, Vehicle photos, Garage receipts.
// Real images (jpg/png/etc) show as an actual inline thumbnail you can tap to open
// full-size; everything else (PDFs, etc) shows as a plain "View" link instead,
// since those can't be embedded as an <img>.
function renderLinkPreview(link, label) {
  if (!link || !link.url) return '';
  const openUrl = link.viewUrl || link.url;
  if (link.isImage) {
    return `<div class="card tight" style="margin-top:10px"><p class="field-label" style="margin-bottom:8px">${esc(label)}</p><a href="${openUrl}" target="_blank" rel="noopener"><img src="${link.url}" style="width:100%;border-radius:10px;display:block"></a></div>`;
  }
  return `<div class="card tight" style="margin-top:10px;display:flex;justify-content:space-between;align-items:center"><span class="field-label" style="margin:0">${esc(label)}</span><a href="${openUrl}" target="_blank" rel="noopener" class="btn" style="width:auto;padding:8px 14px;text-decoration:none"><i class="ti ti-external-link"></i> View</a></div>`;
}
function renderLinkPreviewList(links, label) {
  if (!links || !links.length) return '';
  return links.map((l, i) => renderLinkPreview(l, links.length > 1 ? `${label} ${i + 1}` : label)).join('');
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
  if (!confirm('Delete this entry? This removes it everywhere it syncs to (all your devices and the Sheet history stays as a record, but it stops showing in the app).')) return;
  const entry = await DB.get('entries', currentEntryId);
  entry.deleted = true;
  entry.synced = false;
  await DB.put('entries', entry);
  Sync.pushEntry('Finance', entry).then(() => DB.put('entries', entry));
  closeModal();
  renderFinanceMain();
}

let entryReceiptFormFor = undefined;
let entryReceiptDraft = null; // local base64 preview while uploading
let entryReceiptLink = null; // resolved {url, viewUrl, isImage, column} once uploaded, or the existing one being kept
let entryReceiptUploading = false;
let entryReceiptUploadError = null;

// Reusable live search-filter for any picker modal's list — just show/hide rows by
// whether their text matches, so it works the same way everywhere without needing a
// separate filter function per picker.
function filterPickerList(inputEl, listId) {
  const q = inputEl.value.trim().toLowerCase();
  const list = document.getElementById(listId);
  if (!list) return;
  let anyVisible = false;
  list.querySelectorAll('.list-row').forEach((row) => {
    const match = row.textContent.toLowerCase().includes(q);
    row.style.display = match ? '' : 'none';
    if (match) anyVisible = true;
  });
  const emptyMsg = list.querySelector('.picker-empty-msg');
  if (emptyMsg) emptyMsg.style.display = anyVisible ? 'none' : 'block';
}

function openCategoryPickerModal() {
  const categories = (window.__categories || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const currentVal = document.getElementById('f_category').value;
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:14px">Select category</p>
    <input placeholder="Search categories..." oninput="filterPickerList(this,'categoryPickerList')" style="margin-bottom:12px">
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="closeModal();goAddCategory('add')"><i class="ti ti-plus"></i> Add new category</button>
    <div class="check-list" id="categoryPickerList" style="max-height:55vh">
      ${categories.map((c) => `
        <div class="list-row" onclick="selectCategoryFromPicker('${c.id}')" style="${currentVal===c.id?'background:var(--gold-soft);border-radius:10px':''}">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="icon-badge" style="background:${categoryColor(c.id)}22"><i class="ti ${c.icon || 'ti-tag'}" style="color:${categoryColor(c.id)}"></i></div>
            <span style="color:${categoryColor(c.id)};font-weight:600">${esc(c.name)}</span>
          </div>
        </div>
      `).join('') || '<div class="empty-state">No categories yet.</div>'}
      <div class="empty-state picker-empty-msg" style="display:none">No matches.</div>
    </div>
  `;
  openModal();
}
function selectCategoryFromPicker(id) {
  document.getElementById('f_category').value = id;
  closeModal();
  onCategoryChange();
  updateCategoryButtonDisplay();
}
function updateCategoryButtonDisplay() {
  const el = document.getElementById('f_categoryButtonContent');
  if (!el) return;
  const id = document.getElementById('f_category').value;
  const categories = window.__categories || [];
  const c = categories.find((x) => x.id === id);
  if (!c) { el.textContent = 'Select…'; return; }
  el.innerHTML = `<i class="ti ${c.icon || 'ti-tag'}" style="color:${categoryColor(c.id)};margin-right:8px"></i>${esc(c.name)}`;
}

// A small bundled cartoon illustration — a trembling, wide-eyed dog — auto-attached
// to every "Behavior" issue so you don't have to find/upload the same image each time.
// It's a plain SVG data URI, not an upload, so it works offline and needs no Drive round-trip.
const JAZZ_BEHAVIOR_ILLUSTRATION_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 220">
  <rect width="300" height="220" fill="#F4EFE4"/>
  <g stroke="#C97B84" stroke-width="2.5" stroke-linecap="round" opacity="0.55">
    <path d="M60 40 Q64 50 58 58"/><path d="M50 46 Q56 54 52 64"/>
    <path d="M230 44 Q226 54 232 62"/><path d="M242 38 Q236 48 240 58"/>
  </g>
  <ellipse cx="150" cy="176" rx="70" ry="14" fill="#2B2640" opacity="0.08"/>
  <path d="M100 178 Q95 130 108 108 Q95 100 96 82 Q108 76 118 92 Q132 78 150 78 Q168 78 182 92 Q192 76 204 82 Q205 100 192 108 Q205 130 200 178 Z" fill="#D4783F"/>
  <path d="M112 90 Q100 60 90 66 Q92 92 108 100 Z" fill="#B5568C"/>
  <path d="M188 90 Q200 60 210 66 Q208 92 192 100 Z" fill="#B5568C"/>
  <circle cx="128" cy="112" r="13" fill="#fff"/>
  <circle cx="172" cy="112" r="13" fill="#fff"/>
  <circle cx="128" cy="114" r="6.5" fill="#2B2640"/>
  <circle cx="172" cy="114" r="6.5" fill="#2B2640"/>
  <circle cx="125.5" cy="111.5" r="2" fill="#fff"/>
  <circle cx="169.5" cy="111.5" r="2" fill="#fff"/>
  <ellipse cx="150" cy="130" rx="7" ry="5" fill="#2B2640"/>
  <path d="M138 142 Q150 136 162 142" stroke="#2B2640" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <path d="M104 122 Q98 128 104 134" stroke="#2B2640" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.4"/>
  <path d="M196 122 Q202 128 196 134" stroke="#2B2640" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.4"/>
  <path d="M188 172 Q205 160 198 145" stroke="#D4783F" stroke-width="10" fill="none" stroke-linecap="round"/>
</svg>
`.trim());

function openIssueTypePickerModal() {
  const issueTypes = (window.__issueTypesCache || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const currentVal = document.getElementById('j_type').value;
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:14px">Select issue type</p>
    <input placeholder="Search issue types..." oninput="filterPickerList(this,'issueTypePickerList')" style="margin-bottom:12px">
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="closeModal();openIssueTypeModal(true)"><i class="ti ti-plus"></i> Add new type</button>
    <div class="check-list" id="issueTypePickerList" style="max-height:55vh">
      ${issueTypes.map((t) => `
        <div class="list-row" onclick="selectIssueTypeFromPicker('${t.id}')" style="${currentVal===t.id?'background:var(--gold-soft);border-radius:10px':''}">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="icon-badge" style="background:var(--rose-soft)"><i class="ti ${t.icon || 'ti-stethoscope'}" style="color:var(--rose)"></i></div>
            <span>${esc(t.name)}</span>
          </div>
        </div>
      `).join('') || '<div class="empty-state">No issue types yet.</div>'}
      <div class="empty-state picker-empty-msg" style="display:none">No matches.</div>
    </div>
  `;
  openModal();
}
function selectIssueTypeFromPicker(id) {
  document.getElementById('j_type').value = id;
  closeModal();
  updateIssueTypeButtonDisplay();
  attachBehaviorIllustrationIfNeeded(id);
}
function updateIssueTypeButtonDisplay() {
  const el = document.getElementById('j_typeButtonContent');
  if (!el) return;
  const id = document.getElementById('j_type').value;
  const t = (window.__issueTypesCache || []).find((x) => x.id === id);
  if (!t) { el.textContent = 'Select…'; return; }
  el.innerHTML = `<i class="ti ${t.icon || 'ti-stethoscope'}" style="color:var(--rose);margin-right:8px"></i>${esc(t.name)}`;
}
// If the chosen type is "Behavior" and no photo is attached yet this session, auto-add
// the bundled illustration so you don't have to hunt for the same image every time.
function attachBehaviorIllustrationIfNeeded(typeId) {
  const t = (window.__issueTypesCache || []).find((x) => x.id === typeId);
  if (!t || t.name.trim().toLowerCase() !== 'behavior') return;
  const alreadyHasOne = jazzPhotoDrafts.includes(JAZZ_BEHAVIOR_ILLUSTRATION_URL);
  if (alreadyHasOne) return;
  jazzPhotoDrafts.push(JAZZ_BEHAVIOR_ILLUSTRATION_URL);
  photoUploadLinks.jazz.push({ url: JAZZ_BEHAVIOR_ILLUSTRATION_URL, viewUrl: JAZZ_BEHAVIOR_ILLUSTRATION_URL, isImage: true });
  const grid = document.getElementById('jazzPhotoGrid');
  if (grid) grid.innerHTML = renderPhotoGrid(jazzPhotoDrafts, 'jazz');
}

function openStorePickerModal() {
  const payees = (window.__payeesCache || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const currentVal = document.getElementById('f_store').value;
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:14px">Select store</p>
    <input placeholder="Search stores..." oninput="filterPickerList(this,'storePickerList')" style="margin-bottom:12px">
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="closeModal();goAddStore('add')"><i class="ti ti-plus"></i> Add new store</button>
    <div class="check-list" id="storePickerList" style="max-height:55vh">
      ${payees.map((p) => `
        <div class="list-row" onclick="selectStoreFromPicker('${p.id}')" style="${currentVal===p.id?'background:var(--gold-soft);border-radius:10px':''}">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="icon-badge" style="background:var(--surface)">${payeeLogoUrl(p) ? `<img src="${payeeLogoUrl(p)}" style="width:100%;height:100%;object-fit:contain;background:var(--surface-raised);border-radius:8px">` : '<i class="ti ti-building-store"></i>'}</div>
            <span>${esc(p.name)}</span>
          </div>
        </div>
      `).join('') || '<div class="empty-state">No stores yet.</div>'}
      <div class="empty-state picker-empty-msg" style="display:none">No matches.</div>
    </div>
  `;
  openModal();
}
function selectStoreFromPicker(id) {
  document.getElementById('f_store').value = id;
  closeModal();
  updateStoreButtonDisplay();
  const store = (window.__payeesCache || []).find((p) => p.id === id);
  if (store && store.defaultAmount) document.getElementById('f_amount').value = store.defaultAmount;
}
async function updateStoreButtonDisplay() {
  const el = document.getElementById('f_storeButtonContent');
  if (!el) return;
  const id = document.getElementById('f_store').value;
  if (!id) { el.textContent = 'Select…'; return; }
  const payees = window.__payeesCache || (await DB.getAll('payees'));
  const p = payees.find((x) => x.id === id);
  if (!p) { el.textContent = 'Select…'; return; }
  const logo = payeeLogoUrl(p);
  el.innerHTML = `${logo ? `<img src="${logo}" style="width:22px;height:22px;border-radius:6px;object-fit:cover;vertical-align:-6px;margin-right:8px">` : ''}${esc(p.name)}`;
}

async function renderAddEntry() {
  const categories = (await DB.getAll('categories')).filter((c) => !c.hidden).sort((a, b) => a.name.localeCompare(b.name));
  const payees = (await DB.getAll('payees')).sort((a, b) => a.name.localeCompare(b.name));
  const cars = await DB.getAll('cars');
  const projects = (await DB.getAll('projects')).filter((p) => !p.hidden);
  const src = duplicateSource;

  const formKey = src && src.__editId ? src.__editId : (src ? 'duplicate-' + (src.id || '') : 'new');
  if (entryReceiptFormFor !== formKey) {
    entryReceiptFormFor = formKey;
    entryReceiptDraft = null;
    entryReceiptLink = (src && src.__editId && src.receiptLink) ? src.receiptLink : null;
    entryReceiptUploading = false;
  }

  const catOptions = categories.map((c) => `<option value="${c.id}" ${src && src.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const payeeOptions = payees.map((p) => `<option value="${p.id}" ${src && src.storeId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const carOptions = cars.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const projectOptions = projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${src && src.__editId ? 'Edit entry' : 'Add entry'}</span></div>

    <div class="field"><label class="field-label">Date</label><input type="date" id="f_date" value="${src && src.date ? src.date : todayStr()}"></div>

    <div class="field"><label class="field-label">Category</label>
      <button type="button" class="btn" style="text-align:left" onclick="openCategoryPickerModal()"><span id="f_categoryButtonContent">Select…</span></button>
      <input type="hidden" id="f_category" value="${src && src.categoryId ? src.categoryId : ''}">
    </div>

    <div id="conditionalFieldArea"></div>

    <div class="btn-toggle-row" id="typeToggle">
      <button class="btn-toggle" data-type="expense" onclick="setType('expense')">Expense</button>
      <button class="btn-toggle" data-type="income" onclick="setType('income')">Income</button>
      <button class="btn-toggle" data-type="transfer" onclick="setType('transfer')">Transfer</button>
    </div>
    <div id="transferDirectionArea"></div>

    <div class="field"><label class="field-label">Amount</label><input type="number" step="0.01" id="f_amount" placeholder="$0.00" value="${src ? src.amount : ''}" oninput="handleAmountInputForReturn()"></div>

    <div class="field"><label class="field-label">Store</label>
      <button type="button" class="btn" style="text-align:left" onclick="openStorePickerModal()"><span id="f_storeButtonContent">Select…</span></button>
      <input type="hidden" id="f_store" value="${src && src.storeId ? src.storeId : ''}">
    </div>

    <div class="field"><label class="field-label">Description</label><input id="f_description" placeholder="What was this for?" value="${src ? esc(src.description || '') : ''}"></div>

    <label class="field-label">Receipt</label>
    <div class="card tight" style="background:var(--surface);margin-bottom:20px">
      ${entryReceiptUploading ? `
        <p style="font-size:12px;color:var(--ink-soft)"><i class="ti ti-loader-2"></i> Uploading to Drive…</p>
      ` : entryReceiptLink ? `
        ${entryReceiptLink.isImage ? `<img src="${entryReceiptLink.url}" style="width:100%;border-radius:10px;margin-bottom:10px;display:block">` : `<p style="font-size:12px;color:var(--ink-soft);margin-bottom:10px"><i class="ti ti-file"></i> Receipt attached</p>`}
        <div style="display:flex;gap:8px">
          <a href="${entryReceiptLink.viewUrl || entryReceiptLink.url}" target="_blank" rel="noopener" class="btn" style="text-align:center;text-decoration:none">View full</a>
          <button type="button" class="btn" style="background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="removeEntryReceipt()">Remove</button>
        </div>
      ` : `
        ${entryReceiptUploadError ? `<p style="font-size:12px;color:var(--red);margin-bottom:10px"><i class="ti ti-alert-triangle"></i> Upload failed: ${esc(entryReceiptUploadError)}</p>` : ''}
        <p style="font-size:12px;color:var(--ink-soft);margin-bottom:10px">Attach a photo of the receipt — it uploads to your Drive automatically and shows up on every device.</p>
        <input type="file" accept="image/*,.pdf" onchange="handleEntryReceiptUpload(event)">
      `}
    </div>

    <button class="btn btn-primary" id="saveEntryBtn" onclick="saveEntry()">Save entry</button>
  `;

  window.__cars = cars; window.__projects = projects; window.__categories = categories; window.__payeesCache = payees;
  if (src && src.categoryId) { onCategoryChange(true); }
  setType(src ? src.type : 'expense');
  if (src && src.type === 'transfer') selectTransferDirection(src.transferDirection || 'out');
  updateStoreButtonDisplay();
  updateCategoryButtonDisplay();
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
    area.innerHTML = `<div class="card tight" style="background:var(--surface)"><label class="field-label"><i class="ti ti-car"></i> Car</label><div style="display:flex;gap:6px"><select id="f_car" style="flex:1">${(window.__cars || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button type="button" class="btn" style="width:44px;flex-shrink:0;padding:0" onclick="promptNewCarInline()"><i class="ti ti-plus"></i></button></div></div>`;
  } else if (cat.conditionalField === 'project') {
    const preselected = (duplicateSource && duplicateSource.projectId) || '';
    area.innerHTML = `<div class="card tight" style="background:var(--surface)"><label class="field-label"><i class="ti ti-tools"></i> Project</label><button type="button" class="btn" style="text-align:left" onclick="openProjectPickerModal()"><span id="f_projectButtonContent">Select…</span></button><input type="hidden" id="f_project" value="${preselected}"></div>`;
    updateProjectButtonDisplay();
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

    <div class="divider"></div>
    <p class="section-label">Defaults</p>
    <p style="font-size:12px;color:var(--ink-soft);margin:0 0 12px">Pre-fills these when you pick this category on a new entry. Still editable per entry.</p>
    <div class="field"><label class="field-label">Default store</label>
      <select id="cat_defaultStore">
        <option value="">None</option>
        ${(await DB.getAll('payees')).sort((a,b)=>a.name.localeCompare(b.name)).map((p) => `<option value="${p.id}" ${existing && existing.defaultStoreId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field" style="margin-bottom:20px"><label class="field-label">Default amount</label><input type="number" step="0.01" id="cat_defaultAmount" placeholder="Leave blank if it varies" value="${existing && existing.defaultAmount ? existing.defaultAmount : ''}"></div>
    <div class="field" style="margin-bottom:20px"><label class="field-label">Monthly budget</label><input type="number" step="0.01" id="cat_monthlyBudget" placeholder="Leave blank for no budget" value="${existing && existing.monthlyBudget ? existing.monthlyBudget : ''}"><p style="font-size:11px;color:var(--ink-soft);margin-top:4px">Resets every calendar month.</p></div>

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
  cat.defaultStoreId = document.getElementById('cat_defaultStore').value || null;
  cat.defaultAmount = parseFloat(document.getElementById('cat_defaultAmount').value) || null;
  cat.monthlyBudget = parseFloat(document.getElementById('cat_monthlyBudget').value) || null;
  cat.synced = false;
  await DB.put('categories', cat);
  Sync.pushEntry('Categories', cat).then(() => DB.put('categories', cat));
  if (categoryFormReturnTo === 'add') {
    currentView = 'add'; route();
    setTimeout(() => { const sel = document.getElementById('f_category'); if (sel) { sel.value = cat.id; onCategoryChange(); updateCategoryButtonDisplay(); } }, 0);
  } else {
    currentView = 'categories'; route();
  }
}

// ---------- Store form (its own page, with logo upload) ----------
let storeFormEditId = null;
let storeFormReturnTo = null;
let storeLogoDraft = null;
let storeLogoDriveUrl = null;
let storeLogoUploading = false;
let storeLogoUploadError = null;

function goAddStore(returnTo) { storeFormEditId = null; storeFormReturnTo = returnTo || null; storeLogoDraft = null; storeLogoDriveUrl = null; currentView = 'storeForm'; route(); }
function goEditStore(id) { storeFormEditId = id; storeFormReturnTo = null; storeLogoDraft = null; storeLogoDriveUrl = null; currentView = 'storeForm'; route(); }

async function renderStoreForm() {
  const existing = storeFormEditId ? await DB.get('payees', storeFormEditId) : null;
  if (existing) { storeLogoDraft = existing.logo || null; storeLogoDriveUrl = payeeLogoUrl({ logoLink: existing.logoLink }) || null; }

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="${storeFormReturnTo === 'add' ? "currentView='add';route()" : "currentView='categories';route()"}"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${existing ? 'Edit' : 'Add'} store</span></div>

    <div class="field"><label class="field-label">Name</label><input id="store_name" placeholder="e.g. Costco" value="${existing ? esc(existing.name) : ''}"></div>
    <div class="field"><label class="field-label">Default amount</label><input type="number" step="0.01" id="store_defaultAmount" placeholder="Leave blank if it varies" value="${existing && existing.defaultAmount ? existing.defaultAmount : ''}"></div>

    <label class="field-label">Logo</label>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <div class="photo-slot" style="width:90px;height:90px" onclick="document.getElementById('storeLogoInput').click()">
        ${storeLogoUploading ? `<i class="ti ti-loader-2"></i>` : (storeLogoDriveUrl ? `<img src="${storeLogoDriveUrl}" style="object-fit:contain">` : storeLogoDraft ? `<img src="${storeLogoDraft}" style="object-fit:contain">` : '<i class="ti ti-building-store" style="font-size:24px"></i>')}
      </div>
      ${(storeLogoDriveUrl || storeLogoDraft) && !storeLogoUploading ? `<button type="button" class="btn" style="width:auto;padding:8px 14px;background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="removeStoreLogo()">Remove</button>` : ''}
    </div>
    <p id="storeLogoStatus" style="font-size:11px;color:${storeLogoUploadError ? 'var(--red)' : 'var(--ink-soft)'};margin-bottom:12px">${storeLogoUploading ? 'Uploading to Drive…' : (storeLogoDriveUrl ? 'Saved to Drive — visible on every device' : (storeLogoUploadError ? 'Upload failed: ' + esc(storeLogoUploadError) : ''))}</p>
    <input type="file" id="storeLogoInput" accept="image/*" style="display:none" onchange="handleStoreLogoUpload(event)">

    <div class="field"><label class="field-label">Logo link (optional)</label><input id="store_logoLink" placeholder="Link to logo image (e.g. Drive link)" value="${esc(storeLogoDriveUrl || '')}"></div>
    <p style="font-size:11px;color:var(--ink-soft);margin:-10px 0 16px">Photos you pick above upload to your Drive automatically and show up on every device. This field is also editable directly if you'd rather paste a link yourself.</p>

    <button class="btn btn-primary" id="saveStoreBtn" onclick="saveStoreForm()">Save store</button>
  `;
}
function handleEntryReceiptUpload(e) {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = async () => {
    entryReceiptDraft = await compressImageDataUrl(reader.result);
    entryReceiptUploading = true;
    renderAddEntry();
    const result = await Sync.uploadPhoto(entryReceiptDraft, 'Finance Receipts', (document.getElementById('f_description')?.value || 'receipt').trim());
    entryReceiptUploading = false;
    if (result.ok) {
      entryReceiptLink = { url: result.url, viewUrl: result.viewUrl, isImage: result.isImage, column: 'Receipt' };
    } else {
      entryReceiptUploadError = result.error;
    }
    renderAddEntry();
  };
  reader.readAsDataURL(f);
}
function removeEntryReceipt() {
  entryReceiptLink = null;
  entryReceiptDraft = null;
  renderAddEntry();
}

function removeStoreLogo() {
  storeLogoDraft = null;
  storeLogoDriveUrl = null;
  renderStoreForm();
}
function handleStoreLogoUpload(e) {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = async () => {
    storeLogoDraft = await compressImageDataUrl(reader.result);
    storeLogoUploading = true;
    renderStoreForm();
    const result = await Sync.uploadPhoto(storeLogoDraft, 'Store Logos', (document.getElementById('store_name')?.value || 'logo').trim());
    storeLogoUploading = false;
    if (result.ok) {
      storeLogoDriveUrl = result.url;
      storeLogoUploadError = null;
    } else {
      storeLogoUploadError = result.error;
    }
    renderStoreForm();
  };
  reader.readAsDataURL(f);
}
async function saveStoreForm() {
  const name = document.getElementById('store_name').value.trim();
  if (!name) { alert('Store needs a name.'); return; }
  const btn = document.getElementById('saveStoreBtn');
  if (storeLogoUploading && btn) { btn.disabled = true; btn.textContent = 'Finishing photo upload…'; }
  while (storeLogoUploading) { await new Promise((r) => setTimeout(r, 150)); }
  if (btn) { btn.disabled = false; btn.textContent = 'Save store'; }
  const payee = storeFormEditId ? await DB.get('payees', storeFormEditId) : { id: uid(), defaultCategoryId: null, defaultAmount: null };
  payee.name = name;
  payee.defaultAmount = parseFloat(document.getElementById('store_defaultAmount').value) || null;
  payee.logo = storeLogoDraft; // local-only instant preview, kept as an offline fallback
  payee.logoLink = document.getElementById('store_logoLink').value.trim() || storeLogoDriveUrl || '';
  payee.synced = false;
  await DB.put('payees', payee);
  const { logo, ...syncablePayee } = payee;
  Sync.pushEntry('Stores', syncablePayee).then(() => { payee.synced = true; DB.put('payees', payee); });
  if (storeFormReturnTo === 'add') {
    currentView = 'add'; route();
    setTimeout(() => { const sel = document.getElementById('f_store'); if (sel) { sel.value = payee.id; updateStoreButtonDisplay(); } }, 0);
  } else {
    currentView = 'categories'; route();
  }
}

// Typing a negative amount usually means logging a return/refund against an existing
// purchase (often via Duplicate, which already carries over the original description).
// Prepends "Return: " once, preserving whatever's already there — never overwrites it.
function handleAmountInputForReturn() {
  const amountEl = document.getElementById('f_amount');
  const descEl = document.getElementById('f_description');
  if (!amountEl || !descEl) return;
  const val = parseFloat(amountEl.value);
  if (val < 0 && !descEl.value.startsWith('Return: ')) {
    descEl.value = 'Return: ' + descEl.value;
  }
}

async function saveEntry() {
  const btn = document.getElementById('saveEntryBtn');
  if (entryReceiptUploading && btn) { btn.disabled = true; btn.textContent = 'Finishing photo upload…'; }
  while (entryReceiptUploading) { await new Promise((r) => setTimeout(r, 150)); }
  if (btn) { btn.disabled = false; btn.textContent = 'Save entry'; }
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
    receiptLink: entryReceiptLink || null,
    synced: false
  };
  await DB.put('entries', entry);
  Sync.pushEntry('Finance', entry).then(() => DB.put('entries', entry));
  duplicateSource = null; carSplitDraft = []; window.__transferDirection = null;
  entryReceiptFormFor = undefined; entryReceiptDraft = null; entryReceiptLink = null; entryReceiptUploading = false;
  currentView = 'main';
  route();
}

// ---------- Categories & Stores manager ----------
let managerTab = 'categories';
let showHiddenCategories = false;
let showHiddenProjects = false;
async function renderCategoriesManager() {
  const allCategories = (await DB.getAll('categories')).sort((a, b) => a.name.localeCompare(b.name));
  const payees = (await DB.getAll('payees')).sort((a, b) => a.name.localeCompare(b.name));
  const allProjects = (await DB.getAll('projects')).sort((a, b) => a.name.localeCompare(b.name));
  const categories = showHiddenCategories ? allCategories : allCategories.filter((c) => !c.hidden);
  const hiddenCount = allCategories.filter((c) => c.hidden).length;
  const projects = showHiddenProjects ? allProjects : allProjects.filter((p) => !p.hidden);
  const hiddenProjectCount = allProjects.filter((p) => p.hidden).length;
  const list = managerTab === 'categories' ? categories : managerTab === 'payees' ? payees : projects;

  const addLabel = managerTab === 'categories' ? 'category' : managerTab === 'payees' ? 'store' : 'project';
  const addFn = managerTab === 'categories' ? 'goAddCategory()' : managerTab === 'payees' ? 'goAddStore()' : 'goAddProject()';

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Categories, Stores & Projects</span></div>
    <div class="chip-row">
      <button class="chip ${managerTab === 'categories' ? 'active' : ''}" onclick="switchManagerTab('categories')">Categories</button>
      <button class="chip ${managerTab === 'payees' ? 'active' : ''}" onclick="switchManagerTab('payees')">Stores</button>
      <button class="chip ${managerTab === 'projects' ? 'active' : ''}" onclick="switchManagerTab('projects')">Projects</button>
    </div>
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="${addFn}"><i class="ti ti-plus"></i> Add ${addLabel}</button>
    ${managerTab === 'categories' && hiddenCount ? `<div class="list-row" onclick="showHiddenCategories=!showHiddenCategories;renderCategoriesManager()" style="margin-bottom:8px"><span style="font-size:12px;color:var(--ink-soft)">${showHiddenCategories ? 'Hide' : 'Show'} ${hiddenCount} hidden categor${hiddenCount===1?'y':'ies'}</span><i class="ti ti-chevron-${showHiddenCategories?'down':'right'}"></i></div>` : ''}
    ${managerTab === 'projects' && hiddenProjectCount ? `<div class="list-row" onclick="showHiddenProjects=!showHiddenProjects;renderCategoriesManager()" style="margin-bottom:8px"><span style="font-size:12px;color:var(--ink-soft)">${showHiddenProjects ? 'Hide' : 'Show'} ${hiddenProjectCount} hidden project${hiddenProjectCount===1?'':'s'}</span><i class="ti ti-chevron-${showHiddenProjects?'down':'right'}"></i></div>` : ''}
    <div>${list.map((item) => managerTab === 'categories' ? renderCategoryListRow(item) : managerTab === 'payees' ? renderPayeeListRow(item) : renderProjectListRow(item)).join('') || '<div class="empty-state">Nothing yet.</div>'}</div>
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
    <div style="display:flex;align-items:center"><div class="icon-badge" style="background:var(--surface)">${payeeLogoUrl(p) ? `<img src="${payeeLogoUrl(p)}" style="width:100%;height:100%;object-fit:contain;background:var(--surface-raised);border-radius:8px">` : '<i class="ti ti-building-store"></i>'}</div><span>${esc(p.name)}</span></div>
  </div>`;
}

function renderProjectListRow(p) {
  return `<div class="list-row" onclick="${p.hidden ? `restoreProject('${p.id}')` : `goEditProject('${p.id}')`}" style="${p.hidden?'opacity:0.55':''}">
    <div style="display:flex;align-items:center"><div class="icon-badge" style="background:var(--gold-soft)"><i class="ti ti-tools"></i></div><span>${esc(p.name)}${p.hidden?' (hidden)':''}</span></div>
    <span style="font-size:11px;color:var(--ink-soft)">${p.hidden?'Tap to restore':''}</span>
  </div>`;
}
let projectFormEditId = null;
function goAddProject() { projectFormEditId = null; currentView = 'projectForm'; route(); }
function goEditProject(id) { projectFormEditId = id; currentView = 'projectForm'; route(); }
async function renderProjectForm() {
  const existing = projectFormEditId ? await DB.get('projects', projectFormEditId) : null;
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="managerTab='projects';currentView='categories';route()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${existing ? 'Edit' : 'Add'} project</span></div>
    <div class="field" style="margin-bottom:20px"><label class="field-label">Name</label><input id="project_name" placeholder="e.g. Backyard" value="${existing ? esc(existing.name) : ''}"></div>
    <button class="btn btn-primary" onclick="saveProjectForm()">Save project</button>
    ${existing ? `<button class="btn" style="margin-top:10px;background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="hideProject('${existing.id}')">Hide from lists</button>` : ''}
  `;
}
async function saveProjectForm() {
  const name = document.getElementById('project_name').value.trim();
  if (!name) { alert('Project needs a name.'); return; }
  const p = projectFormEditId ? await DB.get('projects', projectFormEditId) : { id: uid(), hidden: false };
  p.name = name;
  p.synced = false;
  await DB.put('projects', p);
  Sync.pushEntry('Projects', p).then(() => DB.put('projects', p));
  managerTab = 'projects'; currentView = 'categories'; route();
}
async function hideProject(id) {
  if (!confirm('Hide this project from lists? Past entries that used it are unaffected.')) return;
  const p = await DB.get('projects', id);
  p.hidden = true; p.synced = false;
  await DB.put('projects', p);
  Sync.pushEntry('Projects', p).then(() => DB.put('projects', p));
  managerTab = 'projects'; currentView = 'categories'; route();
}
async function restoreProject(id) {
  const p = await DB.get('projects', id);
  p.hidden = false; p.synced = false;
  await DB.put('projects', p);
  Sync.pushEntry('Projects', p).then(() => DB.put('projects', p));
  renderCategoriesManager();
}

// ---------- Init ----------
async function init() {
  renderHeader();
  Sync.onStatusChange(renderSyncPill);
  await Sync.refreshStatus();
  route(); // render immediately with whatever's already local — don't block startup on the network
  Sync.startPolling();
  Sync.pullAll().then(async () => {
    // Only NOW — after a real pull attempt — check whether default categories/stores/etc
    // are actually needed. This used to run before the first pull ever had a chance to
    // bring down real data, which meant any device with a temporarily-empty local cache
    // (a cleared browser, a fresh sign-in, anything) looked identical to "genuinely new
    // user" and got seeded with fresh duplicate defaults — which is what caused the
    // repeated category duplication in the Sheet. Now it only seeds if the Sheet itself
    // genuinely had nothing to offer.
    await seedIfEmpty();
    await processRecurringEntries(); // pull first, so we see any occurrence the Apps Script trigger already generated server-side
    if (currentView === 'main') route();
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}
// The app doesn't start until Auth confirms a signed-in, approved Google account —
// this is the actual access control. Everything before this point (loading the page
// shell, the sign-in screen itself) works without it; nothing that touches your data
// does.
Auth.init(() => init());

// ============ JAZZ MODULE ============
let jazzDuplicate = null;
let jazzPhotoDrafts = [];

function goJazzMain() { currentView = 'main'; route(); }
function goJazzReport() { currentView = 'report'; route(); }

async function renderJazzMain() {
  const issues = (await DB.getAll('jazzIssues')).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const weighIns = (await getActiveWeightEntries()).filter((w) => w.subject === 'jazz').sort((a, b) => b.date.localeCompare(a.date));
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
    ${collapseAllControls('jazzList')}
    <div id="jazzList">${days.length ? days.map((d, i) => renderJazzDayGroup(d, byDay[d], typeById, i === 0)).join('') : '<div class="empty-state">Nothing logged yet. Tap + to add an issue or weigh-in.</div>'}</div>
  `;
  document.getElementById('jazzSearch').addEventListener('input', (e) => filterJazz(e.target.value, days, byDay, typeById));
}

function renderJazzDayGroup(date, dayItems, typeById, openByDefault) {
  return `
    <div class="section-title" style="cursor:pointer" onclick="toggleCollapse(this)">
      <span>${fmtDateYear(date)} <i class="ti collapse-chevron ti-chevron-${openByDefault !== false ? 'down' : 'right'}" style="font-size:11px;vertical-align:-1px"></i></span>
      <span></span>
    </div>
    <div class="collapse-body" style="display:${openByDefault !== false ? 'block' : 'none'}">${dayItems.map((it) => renderJazzItem(it, typeById)).join('')}</div>
  `;
}

function renderJazzItem(it, typeById) {
  if (it.kind === 'weight') {
    return `<div class="entry-row"><div class="entry-icon"><i class="ti ti-scale" style="color:var(--ink-soft)"></i></div>
      <div class="entry-body"><div class="entry-top"><span class="entry-title">Weigh-in</span><span class="entry-value">${it.data.value} lbs</span></div>${it.data.note ? `<div class="entry-desc">${esc(it.data.note)}</div>` : ''}</div></div>`;
  }
  const issue = it.data;
  const type = typeById[issue.typeId] || {};
  const firstPhoto = issue.photoLinks && issue.photoLinks.find((p) => p.isImage);
  return `<div class="entry-row" onclick="openIssue('${issue.id}')">
    <div class="entry-icon" style="width:60px;height:60px;border-radius:12px">${firstPhoto ? `<img src="${firstPhoto.url}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : `<i class="ti ${type.icon || 'ti-stethoscope'}" style="color:var(--rose);font-size:22px"></i>`}</div>
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
  if (!q) { list.innerHTML = days.map((d, i) => renderJazzDayGroup(d, byDay[d], typeById, i === 0)).join(''); return; }
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
  list.innerHTML = keys.length ? keys.map((d, i) => renderJazzDayGroup(d, filtered[d], typeById, true)).join('') : '<div class="empty-state">No matches.</div>';
}

async function renderAddIssue() {
  const issueTypes = (await DB.getAll('issueTypes')).filter((t) => !t.hidden);
  const vetClinics = await DB.getAll('vetClinics');
  const pastIssues = await DB.getAll('jazzIssues');
  const medHistory = [...new Set(pastIssues.map((i) => i.medName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const src = jazzDuplicate;

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goJazzMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${src && src.__editId ? 'Edit' : 'Log an'} issue</span></div>
    <div class="field"><label class="field-label">Started</label><input type="date" id="j_date" value="${src ? src.startDate : todayStr()}"></div>
    <div class="field"><label class="field-label">Issue type</label>
      <button type="button" class="btn" style="text-align:left" onclick="openIssueTypePickerModal()"><span id="j_typeButtonContent">Select…</span></button>
      <input type="hidden" id="j_type" value="${src && src.typeId ? src.typeId : ''}">
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
    <div class="field"><label class="field-label">Description</label><textarea id="j_description" placeholder="What's happening, when it started, any pattern...">${src ? esc(src.description||'') : ''}</textarea></div>

    <div class="field-row" style="margin-bottom:14px">
      <div><label class="field-label">Weather</label><select id="j_weather">${['Sunny','Cloudy','Rainy','Snowing'].map((w) => `<option ${src && src.weather===w?'selected':''}>${w}</option>`).join('')}</select></div>
      <div><label class="field-label">Stool</label><select id="j_stool">${['Normal','Diarrhea'].map((s) => `<option ${src && src.stool===s?'selected':''}>${s}</option>`).join('')}</select></div>
    </div>
    <label class="field-label">Snow covered</label>
    <div class="btn-toggle-row" id="snowToggle">
      <button class="btn-toggle" onclick="selectSnow(this,false)">No</button>
      <button class="btn-toggle" onclick="selectSnow(this,true)">Yes</button>
    </div>

    <div class="card tight" style="background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label class="field-label" style="margin:0">Medication given</label>
        <button type="button" class="chip" id="medToggle" onclick="toggleMed()">${src && src.medGiven ? 'Yes' : 'No'}</button>
      </div>
      <div id="medFields" style="display:${src && src.medGiven ? 'block' : 'none'}">
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <select id="j_medName" style="flex:1">
            ${medHistory.map((m) => `<option ${src && src.medName===m?'selected':''}>${esc(m)}</option>`).join('')}
            ${src && src.medName && !medHistory.includes(src.medName) ? `<option selected>${esc(src.medName)}</option>` : ''}
          </select>
          <button type="button" class="btn" style="width:44px;flex-shrink:0;padding:0" onclick="openMedicationModal()"><i class="ti ti-plus"></i></button>
        </div>
        <input id="j_medCost" type="number" step="0.01" placeholder="Cost (optional)" value="${src && src.medCost ? src.medCost : ''}">
      </div>
    </div>

    <div class="card tight" style="background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label class="field-label" style="margin:0">Vet visit linked</label>
        <button type="button" class="chip" id="vetToggle" onclick="toggleVet()">${src && src.vetVisit ? 'Yes' : 'No'}</button>
      </div>
      <div id="vetFields" style="display:${src && src.vetVisit ? 'block' : 'none'}">
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <select id="j_vetClinic" style="flex:1">
            ${vetClinics.map((c) => `<option value="${c.id}" ${src && src.vetClinicId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
          </select>
          <button type="button" class="btn" style="width:44px;flex-shrink:0;padding:0" onclick="openVetClinicModal()"><i class="ti ti-plus"></i></button>
        </div>
        <input id="j_vetCost" type="number" step="0.01" placeholder="Cost (optional)" value="${src && src.vetCost ? src.vetCost : ''}">
      </div>
    </div>

    ${renderExistingLinksGrid(src && src.photoLinks, 'jazz', 'Existing photos (tap × to remove)')}
    <label class="field-label">Add photos</label>
    <div class="photo-grid" id="jazzPhotoGrid">${renderPhotoGrid(jazzPhotoDrafts, 'jazz')}</div>

    <button class="btn btn-primary" id="saveIssueBtn" onclick="saveIssue()">${src && src.__editId ? 'Save changes' : 'Save entry'}</button>
  `;
  selectSeverity(document.querySelector('#severityToggle .btn-toggle'), src ? src.severity : 'Mild');
  selectStatus(document.querySelector('#statusToggle .btn-toggle'), src ? src.status : 'ongoing');
  selectSnow(document.querySelector('#snowToggle .btn-toggle'), src ? !!src.snowCovered : false);
  window.__medGiven = src ? !!src.medGiven : false;
  window.__vetVisit = src ? !!src.vetVisit : false;
  window.__issueTypesCache = issueTypes;
  updateIssueTypeButtonDisplay();
  if (src && src.__editId) {
    // Correctly select the matching toggle button (not always the first) when editing
    const sevIdx = { Mild: 0, Moderate: 1, Severe: 2 }[src.severity] || 0;
    selectSeverity(document.querySelectorAll('#severityToggle .btn-toggle')[sevIdx], src.severity);
    const statIdx = src.status === 'resolved' ? 1 : 0;
    selectStatus(document.querySelectorAll('#statusToggle .btn-toggle')[statIdx], src.status);
    const snowIdx = src.snowCovered ? 1 : 0;
    selectSnow(document.querySelectorAll('#snowToggle .btn-toggle')[snowIdx], !!src.snowCovered);
  }
}

function selectSeverity(btn, val) { btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral')); if (btn) btn.classList.add('active-neutral'); window.__severity = val; }
function selectStatus(btn, val) { btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral')); if (btn) btn.classList.add('active-neutral'); window.__status = val; }
function selectSnow(btn, val) { btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral')); if (btn) btn.classList.add('active-neutral'); window.__snowCovered = val; }
function toggleMed() { window.__medGiven = !window.__medGiven; document.getElementById('medToggle').textContent = window.__medGiven ? 'Yes' : 'No'; document.getElementById('medFields').style.display = window.__medGiven ? 'block' : 'none'; }
function openMedicationModal() {
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:6px">Add medication</p>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:14px">Include dosage/frequency if useful, e.g. "Apoquel (1 tab, twice daily)". It'll be remembered for next time.</p>
    <div class="field"><label class="field-label">Name</label><input id="med_name" placeholder="Medication name"></div>
    <button class="btn btn-primary" onclick="saveMedicationInline()">Add</button>
  `;
  openModal();
}
function saveMedicationInline() {
  const name = document.getElementById('med_name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  closeModal();
  const sel = document.getElementById('j_medName');
  if (sel) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    sel.appendChild(opt);
    sel.value = name;
  }
}
function toggleVet() { window.__vetVisit = !window.__vetVisit; document.getElementById('vetToggle').textContent = window.__vetVisit ? 'Yes' : 'No'; document.getElementById('vetFields').style.display = window.__vetVisit ? 'block' : 'none'; }

function openVetClinicModal() {
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:16px">Add vet clinic</p>
    <div class="field"><label class="field-label">Name</label><input id="vc_name" placeholder="e.g. Carleton Place Veterinary Hospital"></div>
    <button class="btn btn-primary" onclick="saveVetClinic()">Save</button>
  `;
  openModal();
}
async function saveVetClinic() {
  const name = document.getElementById('vc_name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  const c = { id: uid(), name, synced: false };
  await DB.put('vetClinics', c);
  Sync.pushEntry('VetClinics', c).then(() => DB.put('vetClinics', c));
  closeModal();
  renderAddIssue().then(() => {
    const btn = document.getElementById('vetToggle');
    if (btn && btn.textContent !== 'Yes') toggleVet();
    const sel = document.getElementById('j_vetClinic'); if (sel) sel.value = c.id;
  });
}

function renderPhotoGrid(drafts, prefix) {
  const statuses = photoUploadStatus[prefix] || [];
  const errors = photoUploadErrors[prefix] || [];
  let html = drafts.map((d, i) => {
    const failed = statuses[i] === 'failed';
    const isMain = i === 0;
    return `<div class="photo-slot" style="position:relative">
      <img src="${d}">
      ${!isMain ? `<button type="button" title="Set as main photo" onclick="setMainDraftPhoto('${prefix}',${i})" style="position:absolute;top:4px;left:4px;width:22px;height:22px;border-radius:50%;background:rgba(43,38,64,0.75);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0"><i class="ti ti-star" style="color:white;font-size:12px"></i></button>` : `<div title="Main photo — shown in lists" style="position:absolute;top:4px;left:4px;width:22px;height:22px;border-radius:50%;background:var(--gold);display:flex;align-items:center;justify-content:center"><i class="ti ti-star-filled" style="color:white;font-size:12px"></i></div>`}
      <button type="button" title="Remove" onclick="removeDraftPhoto('${prefix}',${i})" style="position:absolute;bottom:4px;right:4px;width:22px;height:22px;border-radius:50%;background:rgba(43,38,64,0.75);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0"><i class="ti ti-x" style="color:white;font-size:13px"></i></button>
      ${failed ? `<button type="button" onclick="alert('Upload failed: ${esc((errors[i] || 'unknown reason').replace(/'/g, "\\'"))}')" title="Tap for the reason" style="position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:var(--red);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0"><i class="ti ti-alert-triangle" style="color:white;font-size:12px"></i></button>` : ''}
    </div>`;
  }).join('');
  if (drafts.length < 6) html += `<div class="photo-slot" onclick="document.getElementById('${prefix}FileInput').click()"><i class="ti ti-plus"></i></div>`;
  html += `<input type="file" id="${prefix}FileInput" accept="image/*,.pdf" multiple style="display:none" onchange="handlePhotoUpload(event,'${prefix}')">`;
  return html;
}
function getPhotoDraftArray(prefix) {
  if (prefix === 'jazz') return jazzPhotoDrafts;
  return garagePhotoDrafts; // 'garage' (add vehicle) and 'garage2' (add cost) share the same draft array, cleared on save
}
// Which Drive folder each context's uploads land in.
const PHOTO_LINK_CONTEXT = {
  jazz: { folder: 'Jazz Photos' },
  garage: { folder: 'Vehicle Photos' },
  garage2: { folder: 'Garage Receipts' }
};
let pendingPhotoUploads = { jazz: [], garage: [], garage2: [] }; // in-flight upload promises, per context — Save must await these before finishing
let photoUploadStatus = { jazz: [], garage: [], garage2: [] }; // parallel to each context's draft array: 'pending' | 'ok' | 'failed'
let photoUploadErrors = { jazz: [], garage: [], garage2: [] }; // parallel too — the actual reason, so it's reportable without a dev console
// Kept index-aligned with the draft array (photoUploadLinks[prefix][i] corresponds to
// drafts[i]), so removing or reordering a photo can't accidentally mix up which link
// belongs to which preview — a real bug in the earlier version, where links were just
// appended in whatever order uploads happened to finish, not the order shown on screen.
let photoUploadLinks = { jazz: [], garage: [], garage2: [] };

// Shrinks a photo to a reasonable size before it ever gets uploaded — a modern phone
// photo is routinely 3-5MB, sent as one uncompressed request that's genuinely prone to
// timing out on weak signal. Resizing to a sane max dimension and re-compressing as JPEG
// typically brings that down to a few hundred KB, which is far more resilient. PDFs pass
// through untouched, since this only applies to actual images.
function compressImageDataUrl(dataUrl, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    if (!dataUrl.startsWith('data:image/')) { resolve(dataUrl); return; }
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl); // fall back to the original rather than lose the photo
    img.src = dataUrl;
  });
}

function handlePhotoUpload(e, prefix) {
  const files = Array.from(e.target.files);
  const target = getPhotoDraftArray(prefix);
  const ctx = PHOTO_LINK_CONTEXT[prefix];
  let remaining = files.length;
  files.forEach((f) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = await compressImageDataUrl(reader.result);
      const idx = target.length;
      target.push(dataUrl);
      if (photoUploadStatus[prefix]) photoUploadStatus[prefix][idx] = 'pending';
      if (--remaining === 0) { const g = document.getElementById(prefix + 'PhotoGrid'); if (g) g.innerHTML = renderPhotoGrid(target, prefix); }
      if (ctx) {
        const uploadPromise = Sync.uploadPhoto(dataUrl, ctx.folder, f.name || 'photo').then((result) => {
          if (result.ok) {
            if (photoUploadLinks[prefix]) photoUploadLinks[prefix][idx] = { url: result.url, viewUrl: result.viewUrl, isImage: result.isImage };
            if (photoUploadStatus[prefix]) photoUploadStatus[prefix][idx] = 'ok';
          } else {
            if (photoUploadStatus[prefix]) photoUploadStatus[prefix][idx] = 'failed';
            if (photoUploadErrors[prefix]) photoUploadErrors[prefix][idx] = result.error;
          }
          const g = document.getElementById(prefix + 'PhotoGrid');
          if (g) g.innerHTML = renderPhotoGrid(target, prefix);
        });
        if (pendingPhotoUploads[prefix]) pendingPhotoUploads[prefix].push(uploadPromise);
      }
    };
    reader.readAsDataURL(f);
  });
}
// Removes a photo you've picked but haven't saved yet — works whether it's still
// uploading, already uploaded, or failed. This is also how you recover from a failed
// upload: remove it, then add the photo again for a fresh attempt.
function removeDraftPhoto(prefix, index) {
  const target = getPhotoDraftArray(prefix);
  target.splice(index, 1);
  if (photoUploadStatus[prefix]) photoUploadStatus[prefix].splice(index, 1);
  if (photoUploadLinks[prefix]) photoUploadLinks[prefix].splice(index, 1);
  if (photoUploadErrors[prefix]) photoUploadErrors[prefix].splice(index, 1);
  const g = document.getElementById(prefix + 'PhotoGrid');
  if (g) g.innerHTML = renderPhotoGrid(target, prefix);
}
// Moves a photo to the front — the first photo is what shows as the "main" one in lists.
function setMainDraftPhoto(prefix, index) {
  const target = getPhotoDraftArray(prefix);
  const arrays = [target, photoUploadStatus[prefix], photoUploadLinks[prefix], photoUploadErrors[prefix]];
  arrays.forEach((arr) => { if (arr && arr.length > index) { const [item] = arr.splice(index, 1); arr.unshift(item); } });
  const g = document.getElementById(prefix + 'PhotoGrid');
  if (g) g.innerHTML = renderPhotoGrid(target, prefix);
}
// Returns how many photos in this context failed to reach Drive — callers use this right
// before saving to warn the person instead of silently saving with a gap in photoLinks.
function countFailedUploads(prefix) {
  return (photoUploadStatus[prefix] || []).filter((s) => s === 'failed').length;
}
// Call before finalizing a save — waits for any still-uploading photos in this context
// so the saved record's photoLinks reflects everything, not just whatever had finished
// by the moment Save was tapped. Also clears the tracking list once done.
async function waitForPendingUploads(prefix) {
  const pending = pendingPhotoUploads[prefix] || [];
  if (pending.length) await Promise.all(pending);
  pendingPhotoUploads[prefix] = [];
}

// Shared "view existing photos / remove one / add new ones" manager for the three
// multi-photo forms (Jazz issue, Vehicle, Garage cost). Tracks which existing link
// indices got removed in THIS edit session — the actual removal only takes effect
// when the form is saved, so backing out is always safe.
let existingLinksRemoved = { jazz: [], vehicle: [], cost: [] };

function renderExistingLinksGrid(links, context, label) {
  if (!links || !links.length) return '';
  const visible = links.map((l, i) => ({ l, i })).filter(({ i }) => !existingLinksRemoved[context].includes(i));
  if (!visible.length) return '';
  return `
    <label class="field-label">${label}</label>
    <div class="photo-grid" style="margin-bottom:14px">
      ${visible.map(({ l, i }) => `
        <div class="photo-slot" style="position:relative">
          ${l.isImage
            ? `<a href="${l.viewUrl || l.url}" target="_blank" rel="noopener"><img src="${l.url}"></a>`
            : `<a href="${l.viewUrl || l.url}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;height:100%;background:var(--surface)"><i class="ti ti-file-text" style="font-size:24px;color:var(--ink-soft)"></i></a>`}
          <div onclick="removeExistingLink('${context}', ${i})" style="position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:rgba(43,38,64,0.75);display:flex;align-items:center;justify-content:center;cursor:pointer"><i class="ti ti-x" style="color:white;font-size:13px"></i></div>
        </div>
      `).join('')}
    </div>
  `;
}
function removeExistingLink(context, index) {
  existingLinksRemoved[context].push(index);
  if (context === 'jazz') renderAddIssue();
  else if (context === 'vehicle') renderAddVehicle();
  else if (context === 'cost') renderAddCost();
}
function keptExistingLinks(links, context) {
  if (!links) return [];
  return links.filter((_, i) => !existingLinksRemoved[context].includes(i));
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

async function saveIssue() {
  const btn = document.getElementById('saveIssueBtn');
  const originalBtnText = (jazzDuplicate && jazzDuplicate.__editId) ? 'Save changes' : 'Save entry';
  if (pendingPhotoUploads.jazz && pendingPhotoUploads.jazz.length && btn) {
    btn.disabled = true; btn.textContent = 'Finishing photo upload…';
  }
  await waitForPendingUploads('jazz');
  if (btn) { btn.disabled = false; btn.textContent = originalBtnText; }
  const failedCount = countFailedUploads('jazz');
  if (failedCount > 0) {
    const proceed = confirm(`${failedCount} photo${failedCount===1?'':'s'} couldn't reach Drive (check your connection) and will only be visible on this device. Save anyway? Cancel to try uploading again first.`);
    if (!proceed) return;
  }
  const typeId = document.getElementById('j_type').value;
  const startDate = document.getElementById('j_date').value || todayStr();
  const isEdit = jazzDuplicate && jazzDuplicate.__editId;
  const issue = {
    id: isEdit ? jazzDuplicate.__editId : uid(),
    typeId, startDate,
    endDate: isEdit ? jazzDuplicate.endDate : null,
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
    photoLinks: [...keptExistingLinks(isEdit && jazzDuplicate.photoLinks ? jazzDuplicate.photoLinks : [], 'jazz'), ...photoUploadLinks.jazz.filter(Boolean)],
    updates: isEdit ? jazzDuplicate.updates || [] : [],
    synced: false
  };
  await DB.put('jazzIssues', issue);
  Sync.pushEntry('Jazz', issue).then(() => DB.put('jazzIssues', issue));
  jazzPhotoDrafts = []; photoUploadLinks.jazz = []; existingLinksRemoved.jazz = []; window.__medGiven = false; window.__vetVisit = false; window.__snowCovered = false; jazzDuplicate = null;
  currentView = isEdit ? 'issueDetail' : 'main';
  if (isEdit) currentIssueId = issue.id;
  route();
}
function editIssue(id) {
  DB.get('jazzIssues', id).then((issue) => {
    jazzDuplicate = { ...issue, __editId: issue.id };
    jazzPhotoDrafts = []; photoUploadLinks.jazz = []; pendingPhotoUploads.jazz = []; photoUploadStatus.jazz = []; photoUploadErrors.jazz = []; existingLinksRemoved.jazz = [];
    currentView = 'addIssue'; route();
  });
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
    ${renderLinkPreviewList(issue.photoLinks, 'Photo')}

    <button class="btn" style="margin-bottom:10px" onclick="editIssue('${issue.id}')"><i class="ti ti-edit"></i> Edit</button>
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
  const byType = {}; // keyed by typeId, not name, so duplicate-named types never get merged together
  issues.forEach((i) => { byType[i.typeId] = (byType[i.typeId] || 0) + 1; });

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
    ${Object.keys(byType).length ? Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([tid,c]) => `<div class="list-row" onclick="selectJazzReportType('${tid}')"><span>${esc((typeById[tid]||{}).name || 'Other')}</span><span>${c}</span></div>`).join('') : '<div class="empty-state">No issues logged yet.</div>'}
  `;
}
async function selectJazzReportType(typeId) {
  const issues = (await DB.getAll('jazzIssues')).filter((i) => i.typeId === typeId).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const types = await DB.getAll('issueTypes');
  const typeName = (types.find((t) => t.id === typeId) || {}).name || 'Issues';
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:14px">${esc(typeName)} · ${issues.length} logged</p>
    <div class="check-list" style="max-height:65vh">
      ${issues.map((i) => `
        <div class="list-row" onclick="closeModal();openIssue('${i.id}')" style="display:block;padding:10px 0">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span style="font-size:13px;font-weight:600">${fmtDateFull(i.startDate)}</span>
            <span class="pill-sm ${i.status === 'ongoing' ? 'pill-ongoing' : 'pill-resolved'}">${i.status === 'ongoing' ? 'Ongoing' : 'Resolved'}</span>
          </div>
          ${i.description ? `<p style="font-size:12px;color:var(--ink-soft);margin:2px 0 0">${esc(i.description)}</p>` : ''}
        </div>
      `).join('') || '<div class="empty-state">None found.</div>'}
    </div>
  `;
  openModal();
}

// ============ WEIGHT MODULE (family) ============
let weightPerson = 'Nassim'; // real names used directly, since multiple people may use the same app/device
let weightRange = '6m';

let weightChartInstance = null;

function goWeightMain() { currentView = 'main'; route(); }
function selectWeightPerson(person) { weightPerson = person; renderWeightMain(); }
function setWeightRange(r) { weightRange = r; renderWeightMain(); }

async function renderWeightMain() {
  const all = (await getActiveWeightEntries()).filter((w) => w.subject === weightPerson.toLowerCase());
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
    ${sorted.length ? (() => {
      const byMonth = {};
      sorted.forEach((w) => { const mk = monthKey(w.date); (byMonth[mk] = byMonth[mk] || []).push(w); });
      const months = Object.keys(byMonth).sort().reverse();
      const controls = months.length > 1 ? collapseAllControls('weightList') : '';
      const body = months.map((mk, i) => {
        const label = new Date(mk + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        const monthEntries = byMonth[mk];
        return `
          <div class="section-title" style="cursor:pointer" onclick="toggleCollapse(this)">
            <span>${label} <i class="ti collapse-chevron ti-chevron-${i===0?'down':'right'}" style="font-size:11px;vertical-align:-1px"></i></span>
            <span></span>
          </div>
          <div class="collapse-body" style="display:${i===0?'block':'none'}">${monthEntries.map((w) => `<div class="list-row" onclick="openWeightEntryModal('${w.id}')"><div><span>${fmtDateYear(w.date)}</span>${w.note ? `<div class="entry-desc">${esc(w.note)}</div>` : ''}</div><span style="font-weight:600">${w.value} lbs</span></div>`).join('')}</div>
        `;
      }).join('');
      return controls + `<div id="weightList">${body}</div>`;
    })() : '<div class="empty-state">No entries yet.</div>'}
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

let weightEditId = null;
async function openWeightEntryModal(id) {
  weightEditId = id;
  const w = await DB.get('weightEntries', id);
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:16px">Edit weight entry</p>
    <div class="field"><label class="field-label">Date</label><input type="date" id="we_date" value="${w.date}"></div>
    <div class="field"><label class="field-label">Weight (lbs)</label><input type="number" step="0.1" id="we_value" value="${w.value}"></div>
    <div class="field"><label class="field-label">Notes</label><input id="we_note" value="${esc(w.note || '')}" placeholder="Optional"></div>
    <button class="btn btn-primary" style="margin-bottom:10px" onclick="saveWeightEdit()">Save changes</button>
    <button class="btn" style="background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="deleteWeightEntry()">Delete entry</button>
  `;
  openModal();
}
async function saveWeightEdit() {
  const value = parseFloat(document.getElementById('we_value').value);
  if (!value) { alert('Enter a weight value.'); return; }
  const w = await DB.get('weightEntries', weightEditId);
  w.date = document.getElementById('we_date').value || w.date;
  w.value = value;
  w.note = document.getElementById('we_note').value.trim();
  w.synced = false;
  await DB.put('weightEntries', w);
  Sync.pushEntry('Weight', w).then(() => DB.put('weightEntries', w));
  closeModal();
  renderWeightMain();
}
async function deleteWeightEntry() {
  if (!confirm('Delete this weight entry? This removes it everywhere it syncs to.')) return;
  const w = await DB.get('weightEntries', weightEditId);
  w.deleted = true;
  w.synced = false;
  await DB.put('weightEntries', w);
  Sync.pushEntry('Weight', w).then(() => DB.put('weightEntries', w));
  closeModal();
  renderWeightMain();
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
  if (moreView === 'recurring') return renderRecurringManager();

  $main.innerHTML = `
    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft)">Overview</p>
    <div class="list-row" onclick="currentTab='finance';currentView='reports';document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='finance'));route()"><span><i class="ti ti-chart-bar"></i> Finance reports</span><i class="ti ti-chevron-right"></i></div>
    <div class="list-row" onclick="currentTab='jazz';currentView='report';document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='jazz'));route()"><span><i class="ti ti-heart-rate-monitor"></i> Jazz's health report</span><i class="ti ti-chevron-right"></i></div>

    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);margin-top:16px">Finance</p>
    <div class="list-row" onclick="currentTab='finance';currentView='categories';document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='finance'));route()"><span><i class="ti ti-tag"></i> Categories, Stores & Projects</span><i class="ti ti-chevron-right"></i></div>
    <div class="list-row" onclick="currentTab='finance';currentView='reports';document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab==='finance'));route()"><span><i class="ti ti-chart-bar"></i> Reports</span><i class="ti ti-chevron-right"></i></div>
    <div class="list-row" onclick="moreView='carsProjects';renderMore()"><span><i class="ti ti-car"></i> Cars</span><i class="ti ti-chevron-right"></i></div>
    <div class="list-row" onclick="moreView='recurring';renderMore()"><span><i class="ti ti-repeat"></i> Recurring entries</span><i class="ti ti-chevron-right"></i></div>

    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);margin-top:16px">Jazz</p>
    <div class="list-row" onclick="moreView='issueTypes';renderMore()"><span><i class="ti ti-stethoscope"></i> Issue types</span><i class="ti ti-chevron-right"></i></div>

    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);margin-top:16px">Garage</p>
    <div class="list-row" onclick="moreView='expenseRepairTypes';renderMore()"><span><i class="ti ti-tool"></i> Expense & repair types</span><i class="ti ti-chevron-right"></i></div>

    <p class="section-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);margin-top:16px">Sync & data</p>
    <div class="list-row" onclick="moreView='syncData';renderMore()"><span><i class="ti ti-cloud"></i> Google Sheet sync & import</span><span class="status-pill ${Sync.status}" style="font-size:11px"><i class="ti ti-cloud"></i></span></div>
  `;
}

const SYNC_PLAIN_LABEL = {
  synced: { text: 'Up to date', icon: 'ti-check', color: '#0F6E56', bg: 'var(--sage-soft)' },
  syncing: { text: 'Saving your changes…', icon: 'ti-refresh', color: 'var(--red)', bg: 'var(--rose-soft)' },
  pending: { text: 'Saving your changes…', icon: 'ti-clock', color: 'var(--red)', bg: 'var(--rose-soft)' },
  offline: { text: 'Not connected yet', icon: 'ti-cloud-off', color: 'var(--ink-soft)', bg: 'var(--line)' }
};

async function renderSyncDataPage() {
  const meta = await DB.get('settings', 'meta');
  const sheetUrl = meta ? meta.sheetUrl : '';
  const importCompleted = meta ? !!meta.importCompleted : false;
  const importedAt = meta ? meta.importedAt : null;
  const s = SYNC_PLAIN_LABEL[Sync.status] || SYNC_PLAIN_LABEL.offline;

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMoreMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Sync & data</span></div>

    <div class="card tight" style="display:flex;justify-content:space-between;align-items:center">
      <div><label class="field-label" style="margin:0">Signed in as</label><p style="font-size:13px;font-weight:600;margin:2px 0 0">${esc(Auth.email || 'Unknown')}</p></div>
      <button class="btn" style="width:auto;padding:8px 14px" onclick="if(confirm('Sign out? You will need to sign back in to use Homebase.')){Auth.signOut();}">Sign out</button>
    </div>

    <div class="card tight">
      <label class="field-label">Google Sheet</label>
      ${sheetUrl && !editingSheetUrl ? `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <span class="status-pill" style="background:var(--sage-soft);color:#0F6E56"><i class="ti ti-link"></i> <span>Connected</span></span>
          <button class="btn" style="width:auto;padding:8px 14px" onclick="editingSheetUrl=true;renderSyncDataPage()">Change</button>
        </div>
      ` : `
        <input id="sheetUrlInput" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(sheetUrl)}" style="margin-bottom:8px">
        <button class="btn btn-primary" onclick="saveSheetUrl()">Save</button>
        ${sheetUrl ? `<button class="btn" style="margin-top:8px" onclick="editingSheetUrl=false;renderSyncDataPage()">Cancel</button>` : ''}
      `}
      <div class="divider" style="margin:14px 0"></div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="status-pill" id="moreSyncPill" style="background:${s.bg};color:${s.color}"><i class="ti ${s.icon}"></i> <span id="moreSyncText">${s.text}</span></span>
        <button class="btn" style="width:auto;padding:8px 14px" onclick="Sync.fullSync().then(renderSyncDataPage)">Retry now</button>
      </div>
      ${Sync.lastPullError ? `<p style="font-size:12px;color:var(--red);margin-top:8px"><i class="ti ti-alert-triangle"></i> Last sync was rejected: ${esc(Sync.lastPullError)}</p>` : ''}
    </div>

    <div class="card tight">
      <label class="field-label">Bring in your old spreadsheet data</label>
      ${importCompleted ? `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="status-pill" style="background:var(--sage-soft);color:#0F6E56"><i class="ti ti-check"></i> <span>Already done${importedAt ? ' · ' + fmtDate(importedAt) : ''}</span></span>
          <button class="btn" style="width:auto;padding:8px 14px;font-size:12px" onclick="if(confirm('Only do this if you specifically need to re-import a corrected file — it could create duplicates if the same data is already here.')){resetImportLock();}">Unlock</button>
        </div>
        <p style="font-size:11px;color:var(--ink-soft);margin-top:8px">This status is shared across every device you use — if you did this on your phone, your laptop will show the same "Already done" here too. You don't need to repeat it per device.</p>
      ` : `
        <p style="font-size:12px;color:var(--ink-soft);margin-bottom:10px">If you have an old spreadsheet's worth of history to bring in, upload the converted file here. This is a one-time thing — do it on just one device, and it'll show up everywhere automatically from then on.</p>
        <input type="file" accept=".json" onchange="handleImportFile(event)" style="margin-bottom:8px">
      `}
      <p id="importStatus" style="font-size:12px;color:var(--ink-soft)"></p>
    </div>

    <div class="section-title" onclick="toggleCollapse(this)" style="cursor:pointer">
      <span>Advanced / troubleshooting <i class="ti collapse-chevron ti-chevron-right" style="font-size:11px;vertical-align:-1px"></i></span>
      <span></span>
    </div>
    <div class="collapse-body" style="display:none">
      <p style="font-size:11px;color:var(--ink-soft);margin:8px 0 12px">You shouldn't need this for normal use — it's a fix-it button, only if something looks wrong (duplicate categories or stores with different colors, data that seems out of sync, etc).</p>
      <div class="card tight">
        <label class="field-label">Rebuild everything, automatically</label>
        <p style="font-size:12px;color:var(--ink-soft);margin-bottom:10px">Does all of it in one go: merges any duplicate categories or stores, clears your Sheet's tabs for you, then sends a fresh clean copy of everything. No manual steps in between.</p>
        <button class="btn" id="fixEverythingBtn" style="background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="runFixEverything()">Rebuild everything</button>
        <p id="fixEverythingStatus" style="font-size:12px;color:var(--ink-soft);margin-top:8px"></p>
      </div>
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
  const s = SYNC_PLAIN_LABEL[Sync.status] || SYNC_PLAIN_LABEL.offline;
  pill.style.background = s.bg;
  pill.style.color = s.color;
  pill.innerHTML = `<i class="ti ${s.icon}"></i> <span>${s.text}</span>`;
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
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMoreMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Cars</span></div>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:14px">Projects moved to Categories & stores.</p>
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="addCarPrompt()"><i class="ti ti-plus"></i> Add car</button>
    <div>${cars.map((item) => `<div class="list-row" onclick="editCarPrompt('${item.id}')"><span>${esc(item.name)}</span><i class="ti ti-chevron-right"></i></div>`).join('') || '<div class="empty-state">None yet.</div>'}</div>
  `;
}
function addCarPrompt() {
  const name = prompt('Car name:'); if (!name) return;
  const c = { id: uid(), name, synced: false };
  DB.put('cars', c).then(() => { Sync.pushEntry('Cars', c).then(() => DB.put('cars', c)); renderCarsProjectsManager(); });
}
async function editCarPrompt(id) {
  const c = await DB.get('cars', id);
  const name = prompt('Car name:', c.name); if (!name) return;
  c.name = name; c.synced = false;
  await DB.put('cars', c);
  Sync.pushEntry('Cars', c).then(() => DB.put('cars', c));
  renderCarsProjectsManager();
}

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
function openProjectPickerModal() {
  const projects = (window.__projects || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const currentVal = document.getElementById('f_project').value;
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:14px">Select project</p>
    <input placeholder="Search projects..." oninput="filterPickerList(this,'projectPickerList')" style="margin-bottom:12px">
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="promptNewProjectInline()"><i class="ti ti-plus"></i> Add new project</button>
    <div class="check-list" id="projectPickerList" style="max-height:55vh">
      ${projects.map((p) => `
        <div class="list-row" onclick="selectProjectFromPicker('${p.id}')" style="${currentVal===p.id?'background:var(--gold-soft);border-radius:10px':''}">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="icon-badge" style="background:var(--gold-soft)"><i class="ti ti-tools"></i></div>
            <span>${esc(p.name)}</span>
          </div>
        </div>
      `).join('') || '<div class="empty-state">No projects yet.</div>'}
      <div class="empty-state picker-empty-msg" style="display:none">No matches.</div>
    </div>
  `;
  openModal();
}
function selectProjectFromPicker(id) {
  document.getElementById('f_project').value = id;
  closeModal();
  updateProjectButtonDisplay();
}
function updateProjectButtonDisplay() {
  const el = document.getElementById('f_projectButtonContent');
  if (!el) return;
  const id = document.getElementById('f_project').value;
  const p = (window.__projects || []).find((x) => x.id === id);
  el.textContent = p ? p.name : 'Select…';
}
function promptNewProjectInline() {
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:16px">Add project</p>
    <div class="field"><label class="field-label">Name</label><input id="inline_project_name" placeholder="e.g. Backyard"></div>
    <button class="btn btn-primary" onclick="saveInlineProject()">Save</button>
  `;
  openModal();
}
async function saveInlineProject() {
  const name = document.getElementById('inline_project_name').value.trim();
  if (!name) { alert('Project needs a name.'); return; }
  const p = { id: uid(), name, hidden: false, synced: false };
  await DB.put('projects', p);
  Sync.pushEntry('Projects', p).then(() => DB.put('projects', p));
  window.__projects.push(p);
  closeModal();
  const sel = document.getElementById('f_project');
  if (sel) { sel.value = p.id; updateProjectButtonDisplay(); }
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

// One combined action: merges any duplicates, clears the Sheet automatically (no more
// manually deleting rows yourself), then pushes a fresh clean copy of everything. Replaces
// what used to be three separate steps you had to understand and sequence yourself.
async function runFixEverything() {
  if (!confirm("This rebuilds your Sheet from scratch: merges any duplicate categories/stores, clears every tab, then re-sends all your data fresh. It takes a few minutes and can't be interrupted halfway. Continue?")) return;
  const statusEl = document.getElementById('fixEverythingStatus');
  const btn = document.getElementById('fixEverythingBtn');
  btn.disabled = true;

  // Safety check: this device's local data is about to become the new source of truth
  // for the entire Sheet — if it's missing things the Sheet actually has (an incomplete
  // pull, a bug, anything), proceeding would silently destroy real data. Comparing
  // counts first catches that before it can happen, rather than trusting local data
  // blindly the way this used to.
  statusEl.textContent = 'Checking your data is complete before doing anything…';
  const remoteCounts = await Sync.getRemoteCounts();
  if (remoteCounts) {
    const shortfalls = [];
    for (const job of SYNC_JOBS) {
      const localCount = (await DB.getAll(job.store)).filter((r) => !r.deleted).length;
      const remoteCount = remoteCounts[job.sheet] || 0;
      if (remoteCount > 0 && localCount < remoteCount * 0.5) {
        shortfalls.push(`${job.sheet}: this device has ${localCount}, the Sheet has ${remoteCount}`);
      }
    }
    if (shortfalls.length) {
      statusEl.innerHTML = `<b>Stopped — this device's data looks incomplete compared to your Sheet:</b><br>${shortfalls.join('<br>')}<br><br>Proceeding would have deleted real data. Try the refresh button first so this device has everything, then run this again.`;
      btn.disabled = false;
      return;
    }
  }

  statusEl.textContent = 'Step 1 of 3 — merging any duplicates…';
  await cleanupDuplicateDimensions(() => {});
  statusEl.textContent = 'Step 2 of 3 — clearing your Sheet…';
  const clearResult = await Sync.clearRemoteSheet();
  if (!clearResult.ok) {
    statusEl.textContent = `Couldn't clear the Sheet: ${clearResult.error || 'unknown error'}. Nothing was changed — safe to try again.`;
    btn.disabled = false;
    return;
  }
  statusEl.textContent = 'Step 3 of 3 — sending everything fresh…';
  await Sync.forceFullResync();
  statusEl.textContent = 'Done! Your Sheet has been rebuilt with one clean copy of everything.';
  btn.disabled = false;
}

// ============ RECURRING ENTRIES ============
// Schedule shapes:
//   everyNDays: { n: number }
//   weekly:     { weekday: 0-6 (Sun-Sat), interval: number (1=every week, 2=biweekly, ...) }
//   monthly:    { day: 1-31 (clamped to month length) }

function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); } // m is 0-indexed
function addDaysISO(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return fmtISO(d);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

// Returns the next occurrence date strictly after `afterDateStr`, or the first
// occurrence on/after startDate if afterDateStr is null/undefined.
function nextOccurrence(rule, afterDateStr) {
  if (rule.repeatType === 'everyNDays') {
    const n = rule.n || 1;
    if (!afterDateStr) return rule.startDate;
    const diff = daysBetween(rule.startDate, afterDateStr);
    const k = Math.floor(diff / n) + 1;
    return addDaysISO(rule.startDate, k * n);
  }
  if (rule.repeatType === 'weekly') {
    const interval = rule.interval || 1;
    // Find the first date >= startDate matching the target weekday — the "anchor"
    const start = new Date(rule.startDate + 'T00:00:00');
    let shift = (rule.weekday - start.getDay() + 7) % 7;
    const anchor = fmtISO(new Date(start.getFullYear(), start.getMonth(), start.getDate() + shift));
    if (!afterDateStr) return anchor;
    const weeksSince = Math.floor(daysBetween(anchor, afterDateStr) / 7);
    let k = weeksSince + 1;
    while (k % interval !== 0) k++;
    return addDaysISO(anchor, k * 7);
  }
  if (rule.repeatType === 'monthly') {
    const day = rule.day || 1;
    const clampDate = (y, m) => { const d = Math.min(day, daysInMonth(y, m)); return fmtISO(new Date(y, m, d)); };
    if (!afterDateStr) {
      const start = new Date(rule.startDate + 'T00:00:00');
      let candidate = clampDate(start.getFullYear(), start.getMonth());
      if (candidate < rule.startDate) candidate = clampDate(start.getFullYear(), start.getMonth() + 1);
      return candidate;
    }
    const after = new Date(afterDateStr + 'T00:00:00');
    let candidate = clampDate(after.getFullYear(), after.getMonth());
    if (candidate <= afterDateStr) candidate = clampDate(after.getFullYear(), after.getMonth() + 1);
    return candidate;
  }
  return null;
}

// Generates any occurrences due up to and including today, for every rule. Safe to
// call repeatedly — only ever moves forward from each rule's own lastGeneratedDate.
async function processRecurringEntries() {
  const rules = await getActiveRecurring();
  const today = todayStr();
  for (const rule of rules) {
    let cursor = nextOccurrence(rule, rule.lastGeneratedDate || null);
    let changed = false;
    while (cursor && cursor <= today) {
      const entry = {
        id: uid(), date: cursor, categoryId: rule.categoryId, categoryName: rule.categoryName,
        storeId: rule.storeId, storeName: rule.storeName, amount: rule.amount, description: rule.description,
        type: rule.type, carId: null, projectId: null, carName: '', projectName: '',
        transferDirection: rule.type === 'transfer' ? 'out' : null, carSplit: null,
        recurringId: rule.id, synced: false
      };
      await DB.put('entries', entry);
      Sync.pushEntry('Finance', entry).then(() => DB.put('entries', entry));
      rule.lastGeneratedDate = cursor;
      changed = true;
      cursor = nextOccurrence(rule, cursor);
    }
    if (changed) {
      rule.synced = false;
      await DB.put('recurring', rule);
      Sync.pushEntry('Recurring', rule).then(() => DB.put('recurring', rule));
    }
  }
}

function recurringScheduleLabel(rule) {
  if (rule.repeatType === 'everyNDays') return `Every ${rule.n} day${rule.n===1?'':'s'}`;
  if (rule.repeatType === 'weekly') {
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return rule.interval === 1 ? `Every ${days[rule.weekday]}` : `Every ${rule.interval} weeks, ${days[rule.weekday]}`;
  }
  if (rule.repeatType === 'monthly') return `Monthly, on the ${rule.day}${['th','st','nd','rd'][(rule.day%10===1&&rule.day!==11)?1:(rule.day%10===2&&rule.day!==12)?2:(rule.day%10===3&&rule.day!==13)?3:0]}`;
  return '';
}

async function renderRecurringManager() {
  const rules = (await getActiveRecurring()).sort((a, b) => (a.description||'').localeCompare(b.description||''));
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMoreMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Recurring entries</span></div>
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="openRecurringModal()"><i class="ti ti-plus"></i> Add recurring entry</button>
    <div>${rules.length ? rules.map((r) => `
      <div class="list-row" onclick="openRecurringModal('${r.id}')">
        <div><span style="font-weight:600">${esc(r.categoryName || '')}${r.storeName ? ' · ' + esc(r.storeName) : ''}</span><div class="entry-desc">${esc(recurringScheduleLabel(r))}</div></div>
        <span style="font-weight:600">${fmtMoney(r.amount)}</span>
      </div>
    `).join('') : '<div class="empty-state">No recurring entries yet.</div>'}</div>
  `;
}

async function openRecurringModal(editId) {
  const categories = (await DB.getAll('categories')).filter((c) => !c.hidden).sort((a,b) => a.name.localeCompare(b.name));
  const payees = (await DB.getAll('payees')).sort((a,b) => a.name.localeCompare(b.name));
  const existing = editId ? await DB.get('recurring', editId) : null;
  window.__recurringEditId = editId || null;
  window.__recurringRepeatType = existing ? existing.repeatType : 'monthly';

  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:16px">${existing ? 'Edit' : 'Add'} recurring entry</p>
    <div class="field"><label class="field-label">Category</label>
      <select id="rec_category">${categories.map((c) => `<option value="${c.id}" ${existing && existing.categoryId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
    </div>
    <div class="field"><label class="field-label">Store</label>
      <select id="rec_store"><option value="">None</option>${payees.map((p) => `<option value="${p.id}" ${existing && existing.storeId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
    </div>
    <div class="field"><label class="field-label">Amount</label><input type="number" step="0.01" id="rec_amount" value="${existing ? existing.amount : ''}"></div>
    <div class="field"><label class="field-label">Description</label><input id="rec_description" value="${existing ? esc(existing.description||'') : ''}"></div>

    <label class="field-label">Repeats</label>
    <div class="btn-toggle-row" id="recRepeatToggle">
      <button type="button" class="btn-toggle" onclick="selectRecurringRepeat(this,'everyNDays')">Every N days</button>
      <button type="button" class="btn-toggle" onclick="selectRecurringRepeat(this,'weekly')">Weekly</button>
      <button type="button" class="btn-toggle" onclick="selectRecurringRepeat(this,'monthly')">Monthly</button>
    </div>
    <div id="recScheduleArea" style="margin-bottom:14px"></div>

    <div class="field"><label class="field-label">Starting from</label><input type="date" id="rec_start" value="${existing ? existing.startDate : todayStr()}"></div>

    <button class="btn btn-primary" style="margin-bottom:10px" onclick="saveRecurring()">${existing ? 'Save changes' : 'Save recurring entry'}</button>
    ${existing ? `<button class="btn" style="background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="deleteRecurring('${existing.id}')">Delete</button>` : ''}
  `;
  const idx = { everyNDays: 1, weekly: 2, monthly: 3 }[window.__recurringRepeatType];
  selectRecurringRepeat(document.querySelector(`#recRepeatToggle button:nth-child(${idx})`), window.__recurringRepeatType, existing);
  openModal();
}
function selectRecurringRepeat(btn, type, existing) {
  document.querySelectorAll('#recRepeatToggle .btn-toggle').forEach((b) => b.classList.remove('active-neutral'));
  if (btn) btn.classList.add('active-neutral');
  window.__recurringRepeatType = type;
  const area = document.getElementById('recScheduleArea');
  if (type === 'everyNDays') {
    area.innerHTML = `<label class="field-label">Every how many days?</label><input type="number" id="rec_n" value="${existing && existing.n ? existing.n : 30}">`;
  } else if (type === 'weekly') {
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    area.innerHTML = `
      <div class="field-row">
        <div><label class="field-label">Day</label><select id="rec_weekday">${days.map((d,i) => `<option value="${i}" ${existing && existing.weekday===i?'selected':''}>${d}</option>`).join('')}</select></div>
        <div><label class="field-label">Interval</label><select id="rec_interval">
          <option value="1" ${existing && existing.interval===1?'selected':''}>Every week</option>
          <option value="2" ${existing && existing.interval===2?'selected':''}>Every 2 weeks</option>
          <option value="3" ${existing && existing.interval===3?'selected':''}>Every 3 weeks</option>
          <option value="4" ${existing && existing.interval===4?'selected':''}>Every 4 weeks</option>
        </select></div>
      </div>`;
  } else if (type === 'monthly') {
    area.innerHTML = `<label class="field-label">Day of month</label><input type="number" min="1" max="31" id="rec_day" value="${existing && existing.day ? existing.day : 1}">`;
  }
}
async function saveRecurring() {
  const categoryId = document.getElementById('rec_category').value;
  const storeId = document.getElementById('rec_store').value;
  const amount = parseFloat(document.getElementById('rec_amount').value);
  if (!categoryId || !amount) { alert('Category and amount are required.'); return; }
  const categories = await DB.getAll('categories');
  const payees = await DB.getAll('payees');
  const cat = categories.find((c) => c.id === categoryId) || {};
  const payee = payees.find((p) => p.id === storeId);

  const rule = window.__recurringEditId ? await DB.get('recurring', window.__recurringEditId) : { id: uid(), lastGeneratedDate: null };
  rule.categoryId = categoryId;
  rule.categoryName = cat.name || '';
  rule.storeId = storeId || null;
  rule.storeName = payee ? payee.name : '';
  rule.amount = amount;
  rule.description = document.getElementById('rec_description').value.trim();
  rule.type = cat.type || 'expense';
  rule.repeatType = window.__recurringRepeatType;
  rule.startDate = document.getElementById('rec_start').value || todayStr();
  if (rule.repeatType === 'everyNDays') rule.n = parseInt(document.getElementById('rec_n').value) || 30;
  if (rule.repeatType === 'weekly') { rule.weekday = parseInt(document.getElementById('rec_weekday').value); rule.interval = parseInt(document.getElementById('rec_interval').value) || 1; }
  if (rule.repeatType === 'monthly') rule.day = parseInt(document.getElementById('rec_day').value) || 1;
  rule.synced = false;

  await DB.put('recurring', rule);
  Sync.pushEntry('Recurring', rule).then(() => DB.put('recurring', rule));
  closeModal();
  window.__recurringEditId = null;
  await processRecurringEntries(); // catch up immediately if the start date is already due
  renderRecurringManager();
}
async function deleteRecurring(id) {
  if (!confirm('Delete this recurring entry? Past generated entries stay in your history — this only stops future ones.')) return;
  const rule = await DB.get('recurring', id);
  rule.deleted = true;
  rule.active = false;
  rule.synced = false;
  await DB.put('recurring', rule);
  Sync.pushEntry('Recurring', rule).then(() => DB.put('recurring', rule));
  closeModal();
  renderRecurringManager();
}
