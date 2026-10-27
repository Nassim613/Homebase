// ---------- Search everything (desktop) ----------
// The search field at the top of the desktop sidebar, or Ctrl K / ⌘K from anywhere,
// opens one search across every section. Results are grouped by section and open in the
// same place they would from the section itself — an entry, cost or expense in the side
// panel, an issue or visit beside its list, a build or car on its own page.
//
// Passwords only ever match on the site name: usernames, passwords and notes are never
// searched or shown here.
//
// Relies on globals from app.js and the section files: DB, esc(), fmtMoney(), fmtDateYear(),
// currentTab/currentView/moreView, route(), renderHeader(), syncNavActive(), closeModal(),
// isDesktopLayout(), and each section's open*() function.

const SEARCH_SECTIONS = {
  Finance:   { icon: 'ti-report-money', bg: '#E1EFE6', fg: '#24694C' },
  Builds:    { icon: 'ti-hammer',       bg: '#EAE3F3', fg: '#5B3F82' },
  Garage:    { icon: 'ti-car',          bg: '#F8E7D2', fg: '#8A4E0E' },
  Jazz:      { icon: 'ti-paw',          bg: '#DCEEEE', fg: '#1C6262' },
  Noah:      { icon: 'ti-mood-kid',     bg: '#F3DEE0', fg: '#93384A' },
  Documents: { icon: 'ti-folder',       bg: '#DFEAF3', fg: '#285A80' },
  Passwords: { icon: 'ti-lock',         bg: '#F1EBE2', fg: '#4A4458' },
  Go:        { icon: 'ti-arrow-right',  bg: '#F5E3C4', fg: '#7A5810' }
};
const SEARCH_ORDER = ['Go', 'Finance', 'Builds', 'Garage', 'Jazz', 'Noah', 'Documents', 'Passwords'];
const SEARCH_GROUP_LIMIT = 8;

let searchIndex = [];
let searchScope = 'All';
let searchActive = 0;
let searchVisible = []; // flat list of the results on screen, in display order

async function activeRecords(store) {
  try { return (await DB.getAll(store)).filter((r) => !r.deleted); } catch (e) { return []; }
}

async function buildSearchIndex() {
  const [entries, categories, payees, builds, subBuilds, buildExpenses, vehicles, garageCosts, expenseTypes, repairTypes,
    jazzIssues, issueTypes, noahIssues, noahIssueTypes, noahVisits, noahVisitTypes, noahMilestones, docFolders, passwords] =
    await Promise.all(['entries', 'categories', 'payees', 'builds', 'subBuilds', 'buildExpenses', 'vehicles', 'garageCosts', 'expenseTypes', 'repairTypes',
      'jazzIssues', 'issueTypes', 'noahIssues', 'noahIssueTypes', 'noahVisits', 'noahVisitTypes', 'noahMilestones', 'docFolders', 'passwords'].map(activeRecords));
  const byId = (list) => Object.fromEntries(list.map((r) => [r.id, r]));
  const catById = byId(categories), payeeById = byId(payees), buildById = byId(builds), subById = byId(subBuilds);
  const vehicleById = byId(vehicles), expTypeById = byId(expenseTypes), repairById = byId(repairTypes);
  const jazzTypeById = byId(issueTypes), noahTypeById = byId(noahIssueTypes), visitTypeById = byId(noahVisitTypes);
  const dateLabel = (d) => (d ? fmtDateYear(d) : '');
  const join = (...parts) => parts.filter(Boolean).join(' · ');
  const items = [];
  const add = (section, title, sub, open, extra) => items.push({
    section, title: title || '(untitled)', sub: sub || '', open,
    right: (extra && extra.right) || '', rightClass: (extra && extra.rightClass) || '',
    date: (extra && extra.date) || '',
    hay: [title, sub, extra && extra.hay].filter(Boolean).join(' ').toLowerCase()
  });

  // Section shortcuts, so typing "garage" also offers going there
  [['Finance', 'finance', 'main'], ['Noah', 'noah', 'main'], ['Jazz', 'jazz', 'main'], ['Weight', 'weight', 'main'],
    ['Garage', 'garage', 'main'], ['Builds', 'builds', 'main'], ['Finance reports', 'finance', 'reports']].forEach(([label, tab, view]) =>
    add('Go', label, 'Go to ' + label, () => searchGoTo(tab, view)));
  add('Go', 'Documents', 'Go to Documents', () => searchGoTo('more', 'main', () => { moreView = 'docFolders'; }));
  add('Go', 'Passwords', 'Go to Passwords', () => searchGoTo('more', 'main', () => { moreView = 'passwords'; }));
  add('Go', 'Settings', 'Go to Settings', () => searchGoTo('more', 'main', () => { moreView = 'main'; }));

  entries.forEach((e) => {
    const cat = catById[e.categoryId] || {}, payee = payeeById[e.storeId] || {};
    let sign = '-', cls = 'neg', amount = Math.abs(e.amount || 0);
    if (e.type === 'income') { sign = '+'; cls = 'pos'; }
    else if (e.type === 'transfer') { sign = e.transferDirection === 'in' ? '+' : '-'; cls = ''; }
    else if ((e.amount || 0) < 0) { sign = '+'; cls = 'pos'; } // a refund
    add('Finance', payee.name || cat.name || 'Entry', join(cat.name, dateLabel(e.date), e.description),
      () => searchGoTo('finance', 'main').then(() => openEntryDetail(e.id)),
      { right: sign + fmtMoney(amount).replace('-', ''), rightClass: cls, date: e.date, hay: [e.amount, e.type].join(' ') });
  });

  builds.forEach((b) => add('Builds', b.name, 'Project', () => searchGoTo('builds', 'buildDetail', () => { currentBuildId = b.id; })));
  subBuilds.forEach((sb) => {
    const b = buildById[sb.buildId] || {};
    add('Builds', sb.name, join(b.name, 'Sub-project', sb.type === 'diy' ? 'DIY' : sb.type === 'contractor' ? 'Contractor' : sb.type === 'mixed' ? 'Mixed' : ''),
      () => searchGoTo('builds', 'subBuildDetail', () => { currentBuildId = sb.buildId; currentSubBuildId = sb.id; buildSelectSubId = null; buildSelectedIds = new Set(); }));
  });
  buildExpenses.forEach((x) => {
    const sb = subById[x.subBuildId]; if (!sb) return;
    const b = buildById[sb.buildId] || {};
    add('Builds', x.description, join(b.name && sb.name ? b.name + ' › ' + sb.name : sb.name, x.storeName, dateLabel(x.date)),
      () => searchGoTo('builds', 'subBuildDetail', () => { currentBuildId = sb.buildId; currentSubBuildId = sb.id; buildSelectSubId = null; buildSelectedIds = new Set(); })
        .then(() => openBuildExpenseDetail(x.id)),
      { right: '-' + fmtMoney(Math.abs(x.amount || 0)), rightClass: 'neg', date: x.date, hay: String(x.amount || '') });
  });

  vehicles.forEach((v) => add('Garage', v.name || [v.year, v.make, v.model].filter(Boolean).join(' '), join([v.year, v.make, v.model].filter(Boolean).join(' '), v.status === 'sold' ? 'Sold' : ''),
    () => searchGoTo('garage', 'vehicleDetail', () => { currentVehicleId = v.id; }), { hay: [v.vin, v.color, v.trim].join(' ') }));
  garageCosts.forEach((c) => {
    const v = vehicleById[c.vehicleId]; if (!v) return;
    const type = (expTypeById[c.expenseTypeId] || {}).name || 'Cost';
    const repair = c.repairTypeId ? (repairById[c.repairTypeId] || {}).name : '';
    add('Garage', repair ? type + ' — ' + repair : type, join(v.name, c.place, dateLabel(c.date), c.comments),
      () => searchGoTo('garage', 'vehicleDetail', () => { currentVehicleId = c.vehicleId; }).then(() => openCostDetail(c.id)),
      { right: c.totalCost ? '-' + fmtMoney(Math.abs(c.totalCost)) : '', rightClass: 'neg', date: c.date, hay: String(c.totalCost || '') });
  });

  jazzIssues.forEach((i) => add('Jazz', (jazzTypeById[i.typeId] || {}).name || 'Issue', join(i.status === 'ongoing' ? 'Ongoing' : 'Resolved', dateLabel(i.startDate), i.description),
    () => searchGoTo('jazz', 'issueDetail', () => { currentIssueId = i.id; }),
    { date: i.startDate, hay: [i.medName, (i.updates || []).map((u) => u.note || u.text || '').join(' ')].join(' ') }));

  noahIssues.forEach((i) => add('Noah', (noahTypeById[i.typeId] || {}).name || 'Health entry', join(i.status === 'ongoing' ? 'Ongoing' : 'Resolved', dateLabel(i.startDate), i.description),
    () => searchGoTo('noah', 'noahIssueDetail', () => { noahIssueId = i.id; noahSection = 'health'; }),
    { date: i.startDate, hay: [i.medName, i.visitNotes].join(' ') }));
  noahVisits.forEach((v) => add('Noah', (visitTypeById[v.typeId] || {}).name || 'Visit', join('Visit', dateLabel(v.date), v.reason, v.doctor),
    () => searchGoTo('noah', 'noahVisitDetail', () => { noahVisitId = v.id; noahSection = 'visits'; }),
    { date: v.date, hay: v.comments }));
  noahMilestones.forEach((m) => add('Noah', m.title || 'Note', join(m.kind === 'note' ? 'Note' : 'Milestone', dateLabel(m.date), m.note),
    () => searchGoTo('noah', 'main', () => { noahSection = 'milestones'; }), { date: m.date }));

  docFolders.forEach((f) => {
    const openFolder = () => searchGoTo('more', 'main', () => { moreView = 'docFolderView'; currentViewDocFolderId = f.id; });
    const files = (f.fileLinks || []).filter(Boolean);
    add('Documents', f.name, `Folder · ${files.length} file${files.length === 1 ? '' : 's'}`, openFolder);
    files.forEach((l) => { if (l.name) add('Documents', l.name, 'In ' + f.name, openFolder); });
  });

  // Site name only — nothing else about a password is indexed
  passwords.forEach((p) => add('Passwords', p.site, 'Shared login', () => searchGoTo('more', 'main', () => { moreView = 'passwords'; })));

  // Newest first inside each section
  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return items;
}

// Switches to a section screen the same way the sidebar does, then lets the caller
// open the specific record on top of it.
function searchGoTo(tab, view, setup) {
  closeGlobalSearch();
  closeModal();
  currentTab = tab;
  currentView = view || 'main';
  if (setup) setup();
  renderHeader();
  syncNavActive();
  return Promise.resolve(route());
}

async function openGlobalSearch() {
  if (!isDesktopLayout()) return;
  const overlay = document.getElementById('searchOverlay');
  const input = document.getElementById('globalSearchInput');
  overlay.style.display = 'flex';
  input.value = '';
  searchScope = 'All';
  searchActive = 0;
  document.getElementById('globalSearchResults').innerHTML = '<div class="search-empty">Loading…</div>';
  input.focus();
  searchIndex = await buildSearchIndex();
  renderSearchResults();
}

function closeGlobalSearch() {
  const overlay = document.getElementById('searchOverlay');
  if (overlay) overlay.style.display = 'none';
}

function setSearchScope(scope) {
  searchScope = scope;
  searchActive = 0;
  renderSearchResults();
  document.getElementById('globalSearchInput').focus();
}

function renderSearchResults() {
  const q = document.getElementById('globalSearchInput').value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const matches = searchIndex.filter((it) =>
    (searchScope === 'All' ? (q || it.section === 'Go') : it.section === searchScope) &&
    (it.section !== 'Go' || q) &&
    words.every((w) => it.hay.includes(w)));

  const scopes = ['All', ...SEARCH_ORDER.filter((s) => s !== 'Go')];
  document.getElementById('globalSearchScopes').innerHTML = scopes.map((s) =>
    `<button class="chip ${s === searchScope ? 'active' : ''}" onclick="setSearchScope('${s}')">${s}</button>`).join('');

  const resultsEl = document.getElementById('globalSearchResults');
  if (!q && searchScope === 'All') {
    searchVisible = [];
    resultsEl.innerHTML = '<div class="search-empty">Type to search across Finance, Builds, Garage, Jazz, Noah, Documents and Passwords.</div>';
    return;
  }
  searchVisible = [];
  let html = '';
  SEARCH_ORDER.forEach((section) => {
    const group = matches.filter((m) => m.section === section);
    if (!group.length) return;
    const shown = group.slice(0, searchScope === 'All' ? SEARCH_GROUP_LIMIT : 60);
    html += `<p class="search-group-label">${section === 'Go' ? 'Go to' : section} · ${group.length}</p>`;
    shown.forEach((it) => {
      const idx = searchVisible.length;
      searchVisible.push(it);
      const s = SEARCH_SECTIONS[section];
      html += `<button class="search-result ${idx === searchActive ? 'active' : ''}" data-idx="${idx}" onmousemove="hoverSearchResult(${idx})" onclick="pickSearchResult(${idx})">
        <span class="search-badge" style="background:${s.bg};color:${s.fg}"><i class="ti ${s.icon}"></i></span>
        <span class="search-text"><span class="search-title">${esc(String(it.title))}</span>${it.sub ? `<span class="search-sub">${esc(it.sub)}</span>` : ''}</span>
        ${it.right ? `<span class="search-right ${it.rightClass}">${esc(it.right)}</span>` : ''}
      </button>`;
    });
    if (group.length > shown.length) {
      html += `<button class="search-result" onclick="setSearchScope('${section}')"><span class="search-sub" style="padding-left:46px">Show all ${group.length} in ${section}</span></button>`;
    }
  });
  resultsEl.innerHTML = html || `<div class="search-empty">Nothing matches “${esc(q)}”.</div>`;
}

function hoverSearchResult(idx) {
  if (idx === searchActive) return;
  searchActive = idx;
  highlightSearchResult(false);
}
function highlightSearchResult(scroll) {
  document.querySelectorAll('#globalSearchResults .search-result[data-idx]').forEach((el) =>
    el.classList.toggle('active', Number(el.dataset.idx) === searchActive));
  if (scroll) {
    const el = document.querySelector(`#globalSearchResults .search-result[data-idx="${searchActive}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
}
function pickSearchResult(idx) {
  const it = searchVisible[idx];
  if (it) it.open();
}

document.getElementById('globalSearchInput').addEventListener('input', () => { searchActive = 0; renderSearchResults(); });
document.getElementById('globalSearchInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); if (searchActive < searchVisible.length - 1) searchActive++; highlightSearchResult(true); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (searchActive > 0) searchActive--; highlightSearchResult(true); }
  else if (e.key === 'Enter') { e.preventDefault(); pickSearchResult(searchActive); }
  else if (e.key === 'Escape') { e.preventDefault(); closeGlobalSearch(); }
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K') && isDesktopLayout()) {
    e.preventDefault();
    if (document.getElementById('searchOverlay').style.display !== 'none') closeGlobalSearch();
    else openGlobalSearch();
  }
});
