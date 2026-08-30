// ============================================================
// BUILDS — Builds -> Sub-builds -> Expenses
// Mirrors the conventions in app.js / garage.js:
//   - DB stores hold plain objects with an `id`, soft-deleted via `deleted:true`
//   - every write sets `synced:false`, then calls Sync.pushEntry(sheet, entry)
//     and flips `synced:true` on success
//   - $main / esc() / uid() / fmtMoney() / todayStr() / openModal() / closeModal()
//     come from app.js; renderPhotoGrid / handlePhotoUpload / renderExistingLinksGrid /
//     keptExistingLinks / waitForPendingUploads / countFailedUploads / compressImageDataUrl
//     are the same shared photo pipeline every other section uses, extended in app.js
//     with 3 new prefixes: 'buildTop' (project cover photos), 'buildSub' (sub-project
//     photos), 'buildExp' (expense receipts).
//
// Phases included here:
//   1. Builds -> Sub-builds -> Expenses, optional budgets, Build Categories
//   2. Store picker (shared with Finance's Stores list), generic icon fallback
//   3. Contractor/phase tracking on contractor & mixed sub-builds
//   4. Photos at every level + keyword-based smart icon detection on expenses
//   5. Settings > Build categories manager (rename / delete-if-unused / hide+restore)
// ============================================================

// ---------- Active-record helpers (mirrors getActiveGarageCosts etc in app.js) ----------
async function getActiveBuilds() {
  return (await DB.getAll('builds')).filter((b) => !b.deleted);
}
async function getActiveSubBuilds(buildId) {
  const all = (await DB.getAll('subBuilds')).filter((s) => !s.deleted);
  return buildId ? all.filter((s) => s.buildId === buildId) : all;
}
async function getActiveBuildExpenses(subBuildId) {
  const all = (await DB.getAll('buildExpenses')).filter((e) => !e.deleted);
  return subBuildId ? all.filter((e) => e.subBuildId === subBuildId) : all;
}
async function getActiveBuildCategories() {
  return (await DB.getAll('buildCategories')).filter((c) => !c.hidden);
}

async function computeSubBuildTotal(subBuildId) {
  const expenses = await getActiveBuildExpenses(subBuildId);
  return expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
}
async function computeBuildTotal(buildId) {
  const subBuilds = await getActiveSubBuilds(buildId);
  let total = 0;
  for (const sb of subBuilds) total += await computeSubBuildTotal(sb.id);
  return total;
}

const BUILD_ICONS = ['ti-trees', 'ti-home', 'ti-building-cottage', 'ti-building-warehouse', 'ti-fence', 'ti-grid-dots', 'ti-hammer', 'ti-tools', 'ti-dots'];
const DEFAULT_CONTRACTOR_PHASES = ['Permit approved', 'Foundation poured', 'Framing', 'Roofing', 'Complete / handed over'];

// Local-only photo draft arrays for the 3 Builds contexts registered in app.js's
// PHOTO_LINK_CONTEXT / getPhotoDraftArray — cleared after each save, same pattern as
// garagePhotoDrafts / jazzPhotoDrafts.
let buildTopPhotoDrafts = [];
let buildSubPhotoDrafts = [];
let buildExpPhotoDrafts = [];

// ============================================================
// SMART ICON DETECTION (Phase 4)
// ============================================================
// Keyword -> icon lookup, checked against the expense description first (most
// specific signal), falling back to the chosen category's own icon, and finally to a
// plain receipt icon if nothing matches. Manual override is always available via the
// icon picker in the Add Expense form.
const EXPENSE_ICON_KEYWORDS = [
  { keywords: ['door opener', 'garage door'], icon: 'ti-garage' },
  { keywords: ['electric', 'wiring', 'outlet', 'breaker'], icon: 'ti-bolt' },
  { keywords: ['insulation', 'drywall'], icon: 'ti-temperature' },
  { keywords: ['light', 'lighting', 'lamp', 'led'], icon: 'ti-bulb' },
  { keywords: ['paint'], icon: 'ti-palette' },
  { keywords: ['shelf', 'shelving', 'storage'], icon: 'ti-stack-2' },
  { keywords: ['concrete', 'cement', 'driveway', 'apron', 'foundation'], icon: 'ti-brick' },
  { keywords: ['roof', 'shingle'], icon: 'ti-home-2' },
  { keywords: ['fence', 'fencing', 'gate'], icon: 'ti-fence' },
  { keywords: ['lumber', 'wood', 'framing'], icon: 'ti-stack-3' },
  { keywords: ['permit'], icon: 'ti-file-certificate' },
  { keywords: ['plumb', 'pipe', 'faucet'], icon: 'ti-pipe' },
  { keywords: ['window'], icon: 'ti-window' },
  { keywords: ['tool', 'drill', 'saw'], icon: 'ti-tool' },
  { keywords: ['rental', 'rent'], icon: 'ti-truck' }
];
function detectExpenseIcon(description, fallbackIcon) {
  const d = (description || '').trim().toLowerCase();
  if (d) {
    for (const entry of EXPENSE_ICON_KEYWORDS) {
      if (entry.keywords.some((k) => d.includes(k))) return entry.icon;
    }
  }
  return fallbackIcon || 'ti-receipt';
}

// ============================================================
// BUILDS — top-level list
// ============================================================
function goBuildsMain() { currentView = 'main'; route(); }

async function renderBuildsMain() {
  const builds = (await getActiveBuilds()).sort((a, b) => a.name.localeCompare(b.name));
  const cards = await Promise.all(builds.map(async (b) => {
    const total = await computeBuildTotal(b.id);
    const subCount = (await getActiveSubBuilds(b.id)).length;
    const cover = (b.photoLinks && b.photoLinks[0]) || null;
    return `
      <div class="card tight" style="cursor:pointer" onclick="openBuild('${b.id}')">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          ${cover ? `<img src="${cover.url}" style="width:24px;height:24px;border-radius:6px;object-fit:cover;flex-shrink:0">` : `<i class="ti ${b.icon || 'ti-hammer'}" style="color:var(--gold);font-size:18px"></i>`}
          <span style="font-weight:600;flex:1">${esc(b.name)}</span>
          <i class="ti ti-chevron-right" style="color:var(--ink-soft);font-size:14px"></i>
        </div>
        <p style="font-size:11px;color:var(--ink-soft);margin-bottom:4px">${subCount} sub-project${subCount === 1 ? '' : 's'}</p>
        <span style="font-weight:600;font-size:14px">${fmtMoney(total)} spent</span>
      </div>
    `;
  }));

  $main.innerHTML = `
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="goAddBuild()"><i class="ti ti-plus"></i> New project</button>
    <div>${cards.join('') || '<div class="empty-state">No projects yet.</div>'}</div>
  `;
}

// ---------- Add / edit Build ----------
let buildEditId = null;
let buildIconDraft = null;

function goAddBuild() {
  buildEditId = null; buildIconDraft = BUILD_ICONS[0];
  buildTopPhotoDrafts = []; photoUploadLinks.buildTop = []; pendingPhotoUploads.buildTop = []; photoUploadStatus.buildTop = []; photoUploadErrors.buildTop = []; existingLinksRemoved.buildTop = [];
  currentView = 'addBuild'; route();
}
function goEditBuild(id) {
  buildEditId = id;
  buildTopPhotoDrafts = []; photoUploadLinks.buildTop = []; pendingPhotoUploads.buildTop = []; photoUploadStatus.buildTop = []; photoUploadErrors.buildTop = []; existingLinksRemoved.buildTop = [];
  currentView = 'addBuild'; route();
}

async function renderAddBuild() {
  const existing = buildEditId ? await DB.get('builds', buildEditId) : null;
  if (existing) buildIconDraft = existing.icon || BUILD_ICONS[0];
  else if (!buildIconDraft) buildIconDraft = BUILD_ICONS[0];

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="${existing ? `openBuild('${existing.id}')` : 'goBuildsMain()'}"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${existing ? 'Edit' : 'New'} project</span></div>
    <div class="field"><label class="field-label">Project name</label><input id="bd_name" placeholder="e.g. Backyard" value="${existing ? esc(existing.name) : ''}"></div>
    <div class="field"><label class="field-label">Budget <span style="color:var(--ink-soft);font-weight:400">(optional)</span></label><input type="number" step="0.01" id="bd_budget" placeholder="Leave blank to just track spend" value="${existing && existing.budget ? existing.budget : ''}"></div>
    <label class="field-label">Icon</label>
    <div id="buildIconPicker" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      ${BUILD_ICONS.map((ic) => `<button type="button" data-icon="${ic}" onclick="selectBuildIcon('${ic}')" style="width:40px;height:40px;border-radius:10px;border:1px solid var(--line);background:${buildIconDraft === ic ? 'var(--gold-soft)' : 'var(--surface-raised)'};display:flex;align-items:center;justify-content:center;cursor:pointer"><i class="ti ${ic}" style="font-size:18px;color:var(--ink)"></i></button>`).join('')}
    </div>
    ${renderExistingLinksGrid(existing && existing.photoLinks, 'buildTop', 'Existing photos (tap × to remove)')}
    <label class="field-label">Cover photos <span style="color:var(--ink-soft);font-weight:400">(optional)</span></label>
    <div class="photo-grid" id="buildTopPhotoGrid">${renderPhotoGrid(buildTopPhotoDrafts, 'buildTop')}</div>
    <button class="btn btn-primary" id="saveBuildBtn" onclick="saveBuild()">${existing ? 'Save changes' : 'Create project'}</button>
    ${existing ? `<button class="btn" style="margin-top:10px;background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="deleteBuild('${existing.id}')"><i class="ti ti-trash"></i> Delete project</button>` : ''}
  `;
}
function selectBuildIcon(icon) {
  buildIconDraft = icon;
  document.querySelectorAll('#buildIconPicker button').forEach((btn) => {
    btn.style.background = btn.dataset.icon === icon ? 'var(--gold-soft)' : 'var(--surface-raised)';
  });
}
async function saveBuild() {
  const name = document.getElementById('bd_name').value.trim();
  if (!name) { alert('Project name is required.'); return; }
  const btn = document.getElementById('saveBuildBtn');
  if (countFailedUploads('buildTop') > 0) {
    const proceed = confirm(`${countFailedUploads('buildTop')} photo${countFailedUploads('buildTop') === 1 ? '' : 's'} couldn't reach Drive (check your connection) and will only be visible on this device. Save anyway? Cancel to try uploading again first.`);
    if (!proceed) return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  await waitForPendingUploads('buildTop');
  const budgetRaw = document.getElementById('bd_budget').value;
  const build = buildEditId ? await DB.get('builds', buildEditId) : { id: uid() };
  Object.assign(build, {
    name,
    icon: buildIconDraft || BUILD_ICONS[0],
    budget: budgetRaw ? parseFloat(budgetRaw) : null,
    photos: [...buildTopPhotoDrafts],
    photoLinks: [...keptExistingLinks(build.photoLinks || [], 'buildTop'), ...photoUploadLinks.buildTop.filter(Boolean)],
    synced: false
  });
  await DB.put('builds', build);
  const { photos, ...syncableBuild } = build;
  Sync.pushEntry('Builds', syncableBuild).then(() => { build.synced = true; DB.put('builds', build); });
  const id = build.id;
  buildEditId = null; buildTopPhotoDrafts = []; existingLinksRemoved.buildTop = [];
  currentView = 'buildDetail'; currentBuildId = id; route();
}
async function deleteBuild(id) {
  const subBuilds = await getActiveSubBuilds(id);
  if (subBuilds.length && !confirm(`This project has ${subBuilds.length} sub-project${subBuilds.length === 1 ? '' : 's'} with their own expenses. Delete the whole project anyway?`)) return;
  if (!subBuilds.length && !confirm('Delete this project?')) return;
  const build = await DB.get('builds', id);
  build.deleted = true; build.synced = false;
  await DB.put('builds', build);
  const { photos, ...syncableBuild } = build;
  Sync.pushEntry('Builds', syncableBuild).then(() => { build.synced = true; DB.put('builds', build); });
  // Cascade soft-delete to sub-builds and their expenses, so nothing orphaned
  // still shows up in totals or lists elsewhere in the app.
  for (const sb of subBuilds) {
    await deleteSubBuildSilently_(sb.id);
  }
  buildEditId = null;
  currentView = 'main'; route();
}

// ============================================================
// BUILD DETAIL — sub-projects list
// ============================================================
let currentBuildId = null;
function openBuild(id) { currentBuildId = id; currentView = 'buildDetail'; route(); }

async function renderBuildDetail() {
  const build = await DB.get('builds', currentBuildId);
  const subBuilds = (await getActiveSubBuilds(currentBuildId)).sort((a, b) => a.name.localeCompare(b.name));
  const total = await computeBuildTotal(currentBuildId);

  const rows = await Promise.all(subBuilds.map(async (sb) => {
    const sbTotal = await computeSubBuildTotal(sb.id);
    const cover = (sb.photoLinks && sb.photoLinks[0]) || null;
    const currentPhase = sb.contractor && sb.contractor.phases ? sb.contractor.phases.filter((p) => p.done).pop() : null;
    return `
      <div class="card tight" style="cursor:pointer" onclick="openSubBuild('${sb.id}')">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          ${cover ? `<img src="${cover.url}" style="width:24px;height:24px;border-radius:6px;object-fit:cover;flex-shrink:0">` : ''}
          <span style="font-weight:600;flex:1">${esc(sb.name)}</span>
          <i class="ti ti-chevron-right" style="color:var(--ink-soft);font-size:14px"></i>
        </div>
        <p style="font-size:11px;color:var(--ink-soft);margin-bottom:6px">${esc(subBuildTypeLabel(sb.type))}${currentPhase ? ' · ' + esc(currentPhase.name) : ''}</p>
        <span style="font-weight:600;font-size:14px">${fmtMoney(sbTotal)} spent</span>
      </div>
    `;
  }));

  $main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div class="back" style="cursor:pointer" onclick="goBuildsMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:16px;margin-left:6px">${esc(build.name)}</span></div>
      <i class="ti ti-edit" style="font-size:18px;color:var(--ink-soft);cursor:pointer" onclick="goEditBuild('${build.id}')"></i>
    </div>
    <div class="card tight" style="margin-bottom:16px">
      <p style="font-size:11px;color:var(--ink-soft);margin-bottom:2px">Total spent</p>
      <p style="font-family:'Fraunces',serif;font-size:22px;font-weight:600">${fmtMoney(total)}</p>
      ${build.budget
        ? `<div style="height:6px;background:var(--line);border-radius:4px;overflow:hidden;margin-top:8px"><div style="width:${Math.min(100, (total / build.budget) * 100)}%;height:100%;background:var(--gold)"></div></div><p style="font-size:11px;color:var(--ink-soft);margin-top:4px">of ${fmtMoney(build.budget)} budgeted</p>`
        : `<p style="font-size:11px;color:var(--ink-soft);margin-top:4px">No budget set for this project</p>`}
    </div>
    <p class="section-label">Sub-projects</p>
    ${rows.join('') || '<div class="empty-state">No sub-projects yet.</div>'}
    <button class="btn btn-primary" style="margin-top:10px" onclick="goAddSubBuild('${build.id}')"><i class="ti ti-plus"></i> Add sub-project</button>
  `;
}

function subBuildTypeLabel(type) {
  if (type === 'contractor') return 'Contractor';
  if (type === 'mixed') return 'Mixed';
  return 'DIY';
}

// ---------- Add / edit Sub-build ----------
let subBuildEditId = null;
let subBuildParentId = null;
let subBuildTypeDraft = 'diy';

function goAddSubBuild(buildId) {
  subBuildEditId = null; subBuildParentId = buildId; subBuildTypeDraft = 'diy';
  buildSubPhotoDrafts = []; photoUploadLinks.buildSub = []; pendingPhotoUploads.buildSub = []; photoUploadStatus.buildSub = []; photoUploadErrors.buildSub = []; existingLinksRemoved.buildSub = [];
  currentView = 'addSubBuild'; route();
}
function goEditSubBuild(id, buildId) {
  subBuildEditId = id; subBuildParentId = buildId;
  buildSubPhotoDrafts = []; photoUploadLinks.buildSub = []; pendingPhotoUploads.buildSub = []; photoUploadStatus.buildSub = []; photoUploadErrors.buildSub = []; existingLinksRemoved.buildSub = [];
  currentView = 'addSubBuild'; route();
}

async function renderAddSubBuild() {
  const existing = subBuildEditId ? await DB.get('subBuilds', subBuildEditId) : null;
  if (existing) subBuildTypeDraft = existing.type || 'diy';

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="openBuild('${subBuildParentId}')"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${existing ? 'Edit' : 'Add'} sub-project</span></div>
    <div class="field"><label class="field-label">Sub-project name</label><input id="sb_name" placeholder="e.g. Fence" value="${existing ? esc(existing.name) : ''}"></div>
    <label class="field-label">Who's doing the work?</label>
    <div class="btn-toggle-row" id="subBuildTypeToggle" style="margin-bottom:14px">
      <button type="button" class="btn-toggle ${subBuildTypeDraft === 'diy' ? 'active-neutral' : ''}" onclick="selectSubBuildType(this,'diy')">DIY</button>
      <button type="button" class="btn-toggle ${subBuildTypeDraft === 'contractor' ? 'active-neutral' : ''}" onclick="selectSubBuildType(this,'contractor')">Contractor</button>
      <button type="button" class="btn-toggle ${subBuildTypeDraft === 'mixed' ? 'active-neutral' : ''}" onclick="selectSubBuildType(this,'mixed')">Mixed</button>
    </div>
    <div class="field"><label class="field-label">Budget <span style="color:var(--ink-soft);font-weight:400">(optional)</span></label><input type="number" step="0.01" id="sb_budget" placeholder="Leave blank to just track spend" value="${existing && existing.budget ? existing.budget : ''}"></div>
    ${renderExistingLinksGrid(existing && existing.photoLinks, 'buildSub', 'Existing photos (tap × to remove)')}
    <label class="field-label">Photos <span style="color:var(--ink-soft);font-weight:400">(optional)</span></label>
    <div class="photo-grid" id="buildSubPhotoGrid">${renderPhotoGrid(buildSubPhotoDrafts, 'buildSub')}</div>
    <button class="btn btn-primary" id="saveSubBuildBtn" onclick="saveSubBuild()">${existing ? 'Save changes' : 'Add sub-project'}</button>
    ${existing ? `<button class="btn" style="margin-top:10px;background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="deleteSubBuild('${existing.id}')"><i class="ti ti-trash"></i> Delete sub-project</button>` : ''}
  `;
}
function selectSubBuildType(btn, type) {
  subBuildTypeDraft = type;
  btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral'));
  btn.classList.add('active-neutral');
}
async function saveSubBuild() {
  const name = document.getElementById('sb_name').value.trim();
  if (!name) { alert('Sub-project name is required.'); return; }
  const btn = document.getElementById('saveSubBuildBtn');
  if (countFailedUploads('buildSub') > 0) {
    const proceed = confirm(`${countFailedUploads('buildSub')} photo${countFailedUploads('buildSub') === 1 ? '' : 's'} couldn't reach Drive and will only be visible on this device. Save anyway?`);
    if (!proceed) return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  await waitForPendingUploads('buildSub');
  const budgetRaw = document.getElementById('sb_budget').value;
  const sb = subBuildEditId ? await DB.get('subBuilds', subBuildEditId) : { id: uid(), buildId: subBuildParentId };
  const newType = subBuildTypeDraft;
  const typeChangedIntoContractorTracking = (newType === 'contractor' || newType === 'mixed') && !sb.contractor;
  Object.assign(sb, {
    name,
    type: newType,
    budget: budgetRaw ? parseFloat(budgetRaw) : null,
    photos: [...buildSubPhotoDrafts],
    photoLinks: [...keptExistingLinks(sb.photoLinks || [], 'buildSub'), ...photoUploadLinks.buildSub.filter(Boolean)],
    synced: false
  });
  // Seed default contractor tracking (name/scope/phases) the first time a sub-build
  // becomes contractor or mixed — never overwrites tracking that already exists.
  if (typeChangedIntoContractorTracking) {
    sb.contractor = {
      name: '', scope: '', contractTotal: null, amountPaid: null,
      phases: DEFAULT_CONTRACTOR_PHASES.map((label) => ({ id: uid(), name: label, done: false }))
    };
  }
  await DB.put('subBuilds', sb);
  const { photos, ...syncableSb } = sb;
  Sync.pushEntry('SubBuilds', syncableSb).then(() => { sb.synced = true; DB.put('subBuilds', sb); });
  const id = sb.id, buildId = sb.buildId;
  subBuildEditId = null; buildSubPhotoDrafts = []; existingLinksRemoved.buildSub = [];
  currentSubBuildId = id; currentBuildId = buildId;
  currentView = 'subBuildDetail'; route();
}
// Used by deleteBuild's cascade — same soft-delete as deleteSubBuild but without its
// own confirm() prompt or navigation, since the parent's confirm already covered it.
async function deleteSubBuildSilently_(id) {
  const expenses = await getActiveBuildExpenses(id);
  const sb = await DB.get('subBuilds', id);
  sb.deleted = true; sb.synced = false;
  await DB.put('subBuilds', sb);
  const { photos, ...syncableSb } = sb;
  Sync.pushEntry('SubBuilds', syncableSb).then(() => { sb.synced = true; DB.put('subBuilds', sb); });
  for (const ex of expenses) {
    ex.deleted = true; ex.synced = false;
    await DB.put('buildExpenses', ex);
    const { photos, ...syncableEx } = ex;
    Sync.pushEntry('BuildExpenses', syncableEx).then(() => { ex.synced = true; DB.put('buildExpenses', ex); });
  }
}
async function deleteSubBuild(id) {
  const expenses = await getActiveBuildExpenses(id);
  if (expenses.length && !confirm(`This sub-project has ${expenses.length} expense${expenses.length === 1 ? '' : 's'} logged. Delete it anyway?`)) return;
  if (!expenses.length && !confirm('Delete this sub-project?')) return;
  const buildId = subBuildParentId;
  await deleteSubBuildSilently_(id);
  subBuildEditId = null;
  currentBuildId = buildId;
  currentView = 'buildDetail'; route();
}

// ============================================================
// SUB-BUILD DETAIL — expense list + contractor card
// ============================================================
let currentSubBuildId = null;
function openSubBuild(id) { currentSubBuildId = id; currentView = 'subBuildDetail'; route(); }

async function renderSubBuildDetail() {
  const sb = await DB.get('subBuilds', currentSubBuildId);
  currentBuildId = sb.buildId;
  const build = await DB.get('builds', sb.buildId);
  const expenses = (await getActiveBuildExpenses(currentSubBuildId)).sort((a, b) => b.date.localeCompare(a.date));
  const categories = await getActiveBuildCategories();
  window.__buildCategoriesCache = categories;
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const total = await computeSubBuildTotal(currentSubBuildId);
  const showsContractorCard = sb.type === 'contractor' || sb.type === 'mixed';

  $main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div class="back" style="cursor:pointer" onclick="openBuild('${sb.buildId}')"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:16px;margin-left:6px">${esc(sb.name)}</span></div>
      <i class="ti ti-edit" style="font-size:18px;color:var(--ink-soft);cursor:pointer" onclick="goEditSubBuild('${sb.id}','${sb.buildId}')"></i>
    </div>
    <p style="font-size:11px;color:var(--ink-soft);margin-bottom:14px">${esc(build.name)} · ${esc(subBuildTypeLabel(sb.type))}</p>
    <div class="card tight" style="margin-bottom:16px">
      <p style="font-size:11px;color:var(--ink-soft);margin-bottom:2px">Total spent</p>
      <p style="font-family:'Fraunces',serif;font-size:22px;font-weight:600">${fmtMoney(total)}</p>
      ${sb.budget
        ? `<div style="height:6px;background:var(--line);border-radius:4px;overflow:hidden;margin-top:8px"><div style="width:${Math.min(100, (total / sb.budget) * 100)}%;height:100%;background:var(--gold)"></div></div><p style="font-size:11px;color:var(--ink-soft);margin-top:4px">of ${fmtMoney(sb.budget)} budgeted</p>`
        : `<p style="font-size:11px;color:var(--ink-soft);margin-top:4px">No budget set</p>`}
    </div>
    ${showsContractorCard ? renderContractorCard(sb) : ''}
    ${sb.photoLinks && sb.photoLinks.length ? `
      <p class="section-label">Photos</p>
      <div class="photo-grid" style="margin-bottom:14px">${sb.photoLinks.map((l) => `<a href="${l.viewUrl || l.url}" target="_blank" rel="noopener" class="photo-slot"><img src="${l.url}"></a>`).join('')}</div>
    ` : ''}
    <p class="section-label">Expenses</p>
    <div>${expenses.map((e) => renderBuildExpenseRow(e, catById)).join('') || '<div class="empty-state">No expenses yet.</div>'}</div>
    <button class="btn btn-primary" style="margin-top:10px" onclick="goAddBuildExpense('${sb.id}')"><i class="ti ti-plus"></i> Add expense</button>
  `;
}
function renderBuildExpenseRow(e, catById) {
  const cat = catById[e.categoryId] || {};
  const icon = e.icon || detectExpenseIcon(e.description, cat.icon);
  const thumb = e.photoLinks && e.photoLinks[0];
  return `
    <div class="entry-row" onclick="openBuildExpenseDetail('${e.id}')">
      <div class="entry-icon">${thumb ? `<img src="${thumb.url}" style="width:100%;height:100%;object-fit:cover">` : `<i class="ti ${icon}" style="color:var(--gold)"></i>`}</div>
      <div class="entry-body">
        <div class="entry-top"><span class="entry-title">${esc(e.description || '')}${e.photoLinks && e.photoLinks.length ? ' <i class="ti ti-paperclip" style="font-size:12px;color:var(--ink-soft)"></i>' : ''}</span><span class="entry-value">${fmtMoney(e.amount)}</span></div>
        <div class="entry-meta">${esc(cat.name || 'Uncategorized')}${e.storeName ? ' · ' + esc(e.storeName) : ''} · ${fmtDate(e.date)}</div>
      </div>
    </div>
  `;
}

// ---------- Expense detail (view / edit / delete) ----------
let buildExpenseDetailId = null;
async function openBuildExpenseDetail(id) {
  buildExpenseDetailId = id;
  const e = await DB.get('buildExpenses', id);
  const categories = await getActiveBuildCategories();
  const cat = categories.find((c) => c.id === e.categoryId) || {};
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:16px">${esc(e.description || '')}</p>
    <div class="card tight">
      <div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Amount</span><span style="font-size:12px">${fmtMoney(e.amount)}</span></div>
      <div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Category</span><span style="font-size:12px">${esc(cat.name || 'Uncategorized')}</span></div>
      ${e.storeName ? `<div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Store</span><span style="font-size:12px">${esc(e.storeName)}</span></div>` : ''}
      <div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Date</span><span style="font-size:12px">${fmtDateFull(e.date)}</span></div>
    </div>
    ${renderLinkPreviewList(e.photoLinks, 'Photo')}
    <button class="btn" style="margin-bottom:10px" onclick="editBuildExpenseFromDetail()"><i class="ti ti-edit"></i> Edit</button>
    <button class="btn" style="background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="deleteBuildExpenseFromDetail()"><i class="ti ti-trash"></i> Delete</button>
  `;
  openModal();
}
function editBuildExpenseFromDetail() {
  buildExpenseEditId = buildExpenseDetailId;
  closeModal();
  currentView = 'addBuildExpense'; route();
}
async function deleteBuildExpenseFromDetail() {
  if (!confirm('Delete this expense?')) return;
  const e = await DB.get('buildExpenses', buildExpenseDetailId);
  e.deleted = true; e.synced = false;
  await DB.put('buildExpenses', e);
  const { photos, ...syncableEx } = e;
  Sync.pushEntry('BuildExpenses', syncableEx).then(() => { e.synced = true; DB.put('buildExpenses', e); });
  closeModal();
  renderSubBuildDetail();
}

// ---------- Add / edit expense (Phase 2: store, Phase 4: photos + icon) ----------
let buildExpenseEditId = null;
let buildExpenseIconDraft = null; // null = auto-detect; a string = manual override
let buildExpenseStoreDraft = null; // { id, name } or null

function goAddBuildExpense(subBuildId) {
  buildExpenseEditId = null; currentSubBuildId = subBuildId;
  buildExpenseIconDraft = null; buildExpenseStoreDraft = null;
  buildExpPhotoDrafts = []; photoUploadLinks.buildExp = []; pendingPhotoUploads.buildExp = []; photoUploadStatus.buildExp = []; photoUploadErrors.buildExp = []; existingLinksRemoved.buildExp = [];
  currentView = 'addBuildExpense'; route();
}

async function renderAddBuildExpense() {
  const sb = await DB.get('subBuilds', currentSubBuildId);
  const categories = (await getActiveBuildCategories()).sort((a, b) => a.name.localeCompare(b.name));
  window.__buildCategoriesCache = categories;
  const existing = buildExpenseEditId ? await DB.get('buildExpenses', buildExpenseEditId) : null;
  window.__buildExpenseCategoryDraft = existing ? existing.categoryId : (categories[0] ? categories[0].id : null);
  if (existing) {
    buildExpenseIconDraft = existing.icon || null;
    buildExpenseStoreDraft = existing.storeId ? { id: existing.storeId, name: existing.storeName || '' } : null;
  }
  const currentCat = categories.find((c) => c.id === window.__buildExpenseCategoryDraft) || {};
  const displayIcon = buildExpenseIconDraft || detectExpenseIcon(existing ? existing.description : '', currentCat.icon);

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="openSubBuild('${sb.id}')"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${existing ? 'Edit' : 'Add'} expense</span></div>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:14px">${esc(sb.name)}</p>

    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div id="buildExpenseIconPreview" style="width:48px;height:48px;border-radius:12px;background:var(--gold);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ti ${displayIcon}" style="font-size:22px;color:#fff"></i></div>
      <div style="flex:1">
        <p style="font-size:12px;color:var(--ink-soft);margin:0 0 2px">${buildExpenseIconDraft ? 'Icon' : 'Icon auto-detected'}</p>
        <p style="font-size:13px;color:var(--gold);margin:0;cursor:pointer" onclick="openBuildExpenseIconPicker()">Choose a different icon</p>
      </div>
    </div>

    <div class="field"><label class="field-label">Description</label><input id="be_description" placeholder="e.g. Garage door opener" value="${existing ? esc(existing.description || '') : ''}" oninput="updateBuildExpenseIconPreviewLive()"></div>
    <div class="field"><label class="field-label">Amount</label><input type="number" step="0.01" id="be_amount" placeholder="$0.00" value="${existing ? existing.amount : ''}"></div>

    <label class="field-label">Category</label>
    <div id="buildCategoryChips" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
      ${categories.map((c) => `<button type="button" data-cat="${c.id}" onclick="selectBuildExpenseCategory('${c.id}')" style="border-radius:20px;padding:6px 14px;border:1px solid var(--line);background:${window.__buildExpenseCategoryDraft === c.id ? 'var(--gold)' : 'var(--surface-raised)'};color:${window.__buildExpenseCategoryDraft === c.id ? '#fff' : 'var(--ink)'};font-size:13px;font-weight:${window.__buildExpenseCategoryDraft === c.id ? '600' : '400'};cursor:pointer">${esc(c.name)}</button>`).join('')}
      <button type="button" onclick="openAddBuildCategoryModal()" style="border-radius:20px;padding:6px 14px;border:1px dashed var(--line);background:var(--surface-raised);color:var(--gold);font-size:13px;cursor:pointer">+ New</button>
    </div>

    <label class="field-label">Store <span style="color:var(--ink-soft);font-weight:400">(optional)</span></label>
    <button type="button" class="btn" style="text-align:left;margin-bottom:14px" onclick="openBuildStorePickerModal()"><span id="buildExpenseStoreButtonContent">${buildExpenseStoreDraft ? esc(buildExpenseStoreDraft.name) : 'Select…'}</span></button>

    <div class="field"><label class="field-label">Date</label><input type="date" id="be_date" value="${existing ? existing.date : todayStr()}"></div>

    ${renderExistingLinksGrid(existing && existing.photoLinks, 'buildExp', 'Existing photos (tap × to remove)')}
    <label class="field-label">Photos <span style="color:var(--ink-soft);font-weight:400">(optional)</span></label>
    <div class="photo-grid" id="buildExpPhotoGrid">${renderPhotoGrid(buildExpPhotoDrafts, 'buildExp')}</div>

    <button class="btn btn-primary" id="saveBuildExpenseBtn" onclick="saveBuildExpense()">${existing ? 'Save changes' : 'Save expense'}</button>
  `;
}
// Live-updates the icon preview as the description is typed, ONLY while the person
// hasn't manually overridden the icon — an explicit pick always wins over auto-detection.
function updateBuildExpenseIconPreviewLive() {
  if (buildExpenseIconDraft) return; // manual override in place, don't fight it
  const desc = document.getElementById('be_description').value;
  const categories = window.__buildCategoriesCache || [];
  const cat = categories.find((c) => c.id === window.__buildExpenseCategoryDraft) || {};
  const icon = detectExpenseIcon(desc, cat.icon);
  const preview = document.getElementById('buildExpenseIconPreview');
  if (preview) preview.innerHTML = `<i class="ti ${icon}" style="font-size:22px;color:#fff"></i>`;
}
function selectBuildExpenseCategory(id) {
  window.__buildExpenseCategoryDraft = id;
  document.querySelectorAll('#buildCategoryChips button[data-cat]').forEach((btn) => {
    const active = btn.dataset.cat === id;
    btn.style.background = active ? 'var(--gold)' : 'var(--surface-raised)';
    btn.style.color = active ? '#fff' : 'var(--ink)';
    btn.style.fontWeight = active ? '600' : '400';
  });
  updateBuildExpenseIconPreviewLive();
}
// ---------- Icon picker (Phase 4 manual override) ----------
const BUILD_EXPENSE_ICON_CHOICES = ['ti-receipt', 'ti-bolt', 'ti-temperature', 'ti-bulb', 'ti-palette', 'ti-stack-2', 'ti-brick', 'ti-home-2', 'ti-fence', 'ti-stack-3', 'ti-file-certificate', 'ti-pipe', 'ti-window', 'ti-tool', 'ti-truck', 'ti-garage', 'ti-shopping-cart'];
function openBuildExpenseIconPicker() {
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:16px">Choose an icon</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
      ${BUILD_EXPENSE_ICON_CHOICES.map((ic) => `<button type="button" onclick="selectBuildExpenseIcon('${ic}')" style="width:44px;height:44px;border-radius:10px;border:1px solid var(--line);background:var(--surface-raised);display:flex;align-items:center;justify-content:center;cursor:pointer"><i class="ti ${ic}" style="font-size:19px;color:var(--ink)"></i></button>`).join('')}
    </div>
    <button class="btn" onclick="resetBuildExpenseIconToAuto()">Use auto-detected icon instead</button>
  `;
  openModal();
}
function selectBuildExpenseIcon(icon) {
  buildExpenseIconDraft = icon;
  closeModal();
  const preview = document.getElementById('buildExpenseIconPreview');
  if (preview) {
    preview.innerHTML = `<i class="ti ${icon}" style="font-size:22px;color:#fff"></i>`;
    const label = preview.parentElement.querySelector('p');
    if (label) label.textContent = 'Icon';
  }
}
function resetBuildExpenseIconToAuto() {
  buildExpenseIconDraft = null;
  closeModal();
  updateBuildExpenseIconPreviewLive();
  const preview = document.getElementById('buildExpenseIconPreview');
  const label = preview ? preview.parentElement.querySelector('p') : null;
  if (label) label.textContent = 'Icon auto-detected';
}
// ---------- Store picker (Phase 2 — shared with Finance's Stores list) ----------
function openBuildStorePickerModal() {
  DB.getAll('payees').then((payeesRaw) => {
    const payees = payeesRaw.slice().sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById('modalSheet').innerHTML = `
      <div class="sheet-handle"></div>
      <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:14px">Select store</p>
      <input placeholder="Search stores..." oninput="filterPickerList(this,'buildStorePickerList')" style="margin-bottom:12px">
      <button class="btn btn-primary" style="margin-bottom:14px" onclick="closeModal();goAddStore('buildExpense')"><i class="ti ti-plus"></i> Add new store</button>
      <div class="check-list" id="buildStorePickerList" style="max-height:55vh">
        ${payees.map((p) => `
          <div class="list-row" onclick="selectBuildExpenseStore('${p.id}')">
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
  });
}
async function selectBuildExpenseStore(id) {
  const payees = await DB.getAll('payees');
  const p = payees.find((x) => x.id === id);
  if (!p) return;
  buildExpenseStoreDraft = { id: p.id, name: p.name };
  closeModal();
  const el = document.getElementById('buildExpenseStoreButtonContent');
  if (el) el.textContent = p.name;
}
// Quick inline "+ New" category creation — full manage-categories UI (rename/delete)
// lives in Settings (renderBuildCategoriesManager); this just needs to unblock adding
// an expense without leaving the form.
function openAddBuildCategoryModal() {
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:16px">New category</p>
    <div class="field"><label class="field-label">Name</label><input id="bc_name" placeholder="e.g. Electrical"></div>
    <button class="btn btn-primary" onclick="saveBuildCategoryInline()">Save</button>
  `;
  openModal();
}
async function saveBuildCategoryInline() {
  const name = document.getElementById('bc_name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  const cat = { id: uid(), name, icon: 'ti-receipt', hidden: false, synced: false };
  await DB.put('buildCategories', cat);
  Sync.pushEntry('BuildCategories', cat).then(() => { cat.synced = true; DB.put('buildCategories', cat); });
  closeModal();
  window.__buildExpenseCategoryDraft = cat.id;
  renderAddBuildExpense();
}
async function saveBuildExpense() {
  const description = document.getElementById('be_description').value.trim();
  const amount = parseFloat(document.getElementById('be_amount').value) || 0;
  if (!description) { alert('Description is required.'); return; }
  if (!window.__buildExpenseCategoryDraft) { alert('Pick or create a category first.'); return; }
  const btn = document.getElementById('saveBuildExpenseBtn');
  if (countFailedUploads('buildExp') > 0) {
    const proceed = confirm(`${countFailedUploads('buildExp')} photo${countFailedUploads('buildExp') === 1 ? '' : 's'} couldn't reach Drive and will only be visible on this device. Save anyway?`);
    if (!proceed) return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  await waitForPendingUploads('buildExp');
  const e = buildExpenseEditId ? await DB.get('buildExpenses', buildExpenseEditId) : { id: uid(), subBuildId: currentSubBuildId };
  Object.assign(e, {
    description,
    amount,
    categoryId: window.__buildExpenseCategoryDraft,
    storeId: buildExpenseStoreDraft ? buildExpenseStoreDraft.id : null,
    storeName: buildExpenseStoreDraft ? buildExpenseStoreDraft.name : '',
    icon: buildExpenseIconDraft || null, // null means "keep auto-detecting from description" going forward
    date: document.getElementById('be_date').value || todayStr(),
    photos: [...buildExpPhotoDrafts],
    photoLinks: [...keptExistingLinks(e.photoLinks || [], 'buildExp'), ...photoUploadLinks.buildExp.filter(Boolean)],
    synced: false
  });
  await DB.put('buildExpenses', e);
  const { photos, ...syncableEx } = e;
  Sync.pushEntry('BuildExpenses', syncableEx).then(() => { e.synced = true; DB.put('buildExpenses', e); });
  buildExpenseEditId = null; buildExpPhotoDrafts = []; existingLinksRemoved.buildExp = []; buildExpenseIconDraft = null; buildExpenseStoreDraft = null;
  currentView = 'subBuildDetail'; route();
}

// ============================================================
// CONTRACTOR / PHASE TRACKING (Phase 3)
// ============================================================
function renderContractorCard(sb) {
  const c = sb.contractor || {};
  const phases = c.phases || [];
  const currentIdx = phases.reduce((last, p, i) => (p.done ? i : last), -1);
  return `
    <div class="card tight" style="margin-bottom:16px;cursor:pointer" onclick="goContractorForm('${sb.id}')">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <i class="ti ti-building-cottage" style="font-size:18px;color:var(--gold)"></i>
        <span style="font-size:15px;font-weight:600;flex:1">${esc(c.name) || 'Contractor'}</span>
        <i class="ti ti-chevron-right" style="color:var(--ink-soft);font-size:14px"></i>
      </div>
      ${c.contractTotal ? `
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
          <span style="font-size:18px;font-weight:500">${fmtMoney(c.amountPaid || 0)}</span>
          <span style="font-size:13px;color:var(--ink-soft)">paid of ${fmtMoney(c.contractTotal)}</span>
        </div>
        <div style="height:6px;background:var(--line);border-radius:4px;overflow:hidden;margin-bottom:10px"><div style="width:${Math.min(100, ((c.amountPaid || 0) / c.contractTotal) * 100)}%;height:100%;background:var(--gold)"></div></div>
      ` : ''}
      ${currentIdx >= 0 ? `
        <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding-top:8px">
          <span style="font-size:13px;color:var(--ink-soft)">Current phase</span>
          <span style="font-size:13px;font-weight:500">${esc(phases[currentIdx].name)}</span>
        </div>
      ` : `<p style="font-size:12px;color:var(--ink-soft)">No phase set yet — tap to edit</p>`}
    </div>
  `;
}

let contractorFormSubBuildId = null;
function goContractorForm(subBuildId) { contractorFormSubBuildId = subBuildId; currentView = 'contractorForm'; route(); }

async function renderContractorForm() {
  const sb = await DB.get('subBuilds', contractorFormSubBuildId);
  if (!sb.contractor) sb.contractor = { name: '', scope: '', contractTotal: null, amountPaid: null, phases: DEFAULT_CONTRACTOR_PHASES.map((label) => ({ id: uid(), name: label, done: false })) };
  const c = sb.contractor;
  const phases = c.phases || [];

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="openSubBuild('${sb.id}')"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Contractor details</span></div>
    <div class="field"><label class="field-label">Contractor / company name</label><input id="ct_name" placeholder="e.g. ABC Construction" value="${esc(c.name || '')}"></div>
    <div class="field"><label class="field-label">Scope of work</label><input id="ct_scope" placeholder="e.g. Permit, foundation, framing, roofing" value="${esc(c.scope || '')}"></div>
    <div class="field-row" style="margin-bottom:14px">
      <div><label class="field-label">Contract total</label><input type="number" step="0.01" id="ct_total" placeholder="$0.00" value="${c.contractTotal || ''}"></div>
      <div><label class="field-label">Amount paid so far</label><input type="number" step="0.01" id="ct_paid" placeholder="$0.00" value="${c.amountPaid || ''}"></div>
    </div>

    <p style="font-size:13px;font-weight:600;margin-bottom:8px">Phases</p>
    <div id="contractorPhaseList">${renderContractorPhaseList(phases)}</div>
    <p style="font-size:11px;color:var(--ink-soft);margin:0 0 14px">Tap a phase to mark it as current — earlier phases auto-complete. Use the arrows to reorder, or the × to remove one.</p>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <input id="ct_newPhase" placeholder="Add a phase..." style="flex:1">
      <button type="button" class="btn" style="width:44px;flex-shrink:0;padding:0" onclick="addContractorPhase()"><i class="ti ti-plus"></i></button>
    </div>

    <button class="btn btn-primary" onclick="saveContractorForm()">Save changes</button>
  `;
  window.__contractorPhasesDraft = phases.map((p) => ({ ...p }));
}
function renderContractorPhaseList(phases) {
  const currentIdx = phases.reduce((last, p, i) => (p.done ? i : last), -1);
  return phases.map((p, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--line);${i === currentIdx ? 'background:var(--gold-soft);border-radius:8px;padding-left:8px' : ''}">
      <i class="ti ${i < currentIdx ? 'ti-circle-check' : i === currentIdx ? 'ti-circle-dot' : 'ti-circle'}" style="font-size:18px;color:${i <= currentIdx ? 'var(--gold)' : 'var(--ink-soft)'};cursor:pointer" onclick="markContractorPhaseCurrent(${i})"></i>
      <span style="font-size:14px;flex:1;${i < currentIdx ? 'text-decoration:line-through;color:var(--ink-soft)' : ''}${i === currentIdx ? 'font-weight:600' : ''}" onclick="markContractorPhaseCurrent(${i})">${esc(p.name)}</span>
      ${i === currentIdx ? `<span style="font-size:11px;color:var(--gold);background:var(--surface-raised);border-radius:10px;padding:2px 8px">current</span>` : ''}
      <i class="ti ti-arrow-up" style="font-size:14px;color:var(--ink-soft);cursor:pointer;${i === 0 ? 'opacity:0.25;pointer-events:none' : ''}" onclick="moveContractorPhase(${i},-1)"></i>
      <i class="ti ti-arrow-down" style="font-size:14px;color:var(--ink-soft);cursor:pointer;${i === phases.length - 1 ? 'opacity:0.25;pointer-events:none' : ''}" onclick="moveContractorPhase(${i},1)"></i>
      <i class="ti ti-x" style="font-size:14px;color:var(--red);cursor:pointer" onclick="removeContractorPhase(${i})"></i>
    </div>
  `).join('');
}
function refreshContractorPhaseList() {
  const el = document.getElementById('contractorPhaseList');
  if (el) el.innerHTML = renderContractorPhaseList(window.__contractorPhasesDraft);
}
function markContractorPhaseCurrent(index) {
  window.__contractorPhasesDraft.forEach((p, i) => { p.done = i <= index; });
  refreshContractorPhaseList();
}
function moveContractorPhase(index, dir) {
  const arr = window.__contractorPhasesDraft;
  const target = index + dir;
  if (target < 0 || target >= arr.length) return;
  [arr[index], arr[target]] = [arr[target], arr[index]];
  refreshContractorPhaseList();
}
function removeContractorPhase(index) {
  window.__contractorPhasesDraft.splice(index, 1);
  refreshContractorPhaseList();
}
function addContractorPhase() {
  const input = document.getElementById('ct_newPhase');
  const name = input.value.trim();
  if (!name) return;
  window.__contractorPhasesDraft.push({ id: uid(), name, done: false });
  input.value = '';
  refreshContractorPhaseList();
}
async function saveContractorForm() {
  const sb = await DB.get('subBuilds', contractorFormSubBuildId);
  const totalRaw = document.getElementById('ct_total').value;
  const paidRaw = document.getElementById('ct_paid').value;
  sb.contractor = {
    name: document.getElementById('ct_name').value.trim(),
    scope: document.getElementById('ct_scope').value.trim(),
    contractTotal: totalRaw ? parseFloat(totalRaw) : null,
    amountPaid: paidRaw ? parseFloat(paidRaw) : null,
    phases: window.__contractorPhasesDraft
  };
  sb.synced = false;
  await DB.put('subBuilds', sb);
  const { photos, ...syncableSb } = sb;
  Sync.pushEntry('SubBuilds', syncableSb).then(() => { sb.synced = true; DB.put('subBuilds', sb); });
  currentSubBuildId = sb.id;
  currentView = 'subBuildDetail'; route();
}

// ============================================================
// SETTINGS > BUILD CATEGORIES MANAGER (Phase 5)
// ============================================================
let showHiddenBuildCategories = false;
async function renderBuildCategoriesManager() {
  const allCategories = (await DB.getAll('buildCategories')).sort((a, b) => a.name.localeCompare(b.name));
  const expenses = (await DB.getAll('buildExpenses')).filter((e) => !e.deleted);
  const usageCount = {};
  expenses.forEach((e) => { usageCount[e.categoryId] = (usageCount[e.categoryId] || 0) + 1; });
  const visible = showHiddenBuildCategories ? allCategories : allCategories.filter((c) => !c.hidden);
  const hiddenCount = allCategories.filter((c) => c.hidden).length;

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="moreView='main';renderMore()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Build categories</span></div>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:14px">Shared across all Build projects — synced to your Google Sheet.</p>
    <button class="btn btn-primary" style="margin-bottom:14px" onclick="goAddBuildCategory()"><i class="ti ti-plus"></i> Add category</button>
    ${hiddenCount ? `<div class="list-row" onclick="showHiddenBuildCategories=!showHiddenBuildCategories;renderBuildCategoriesManager()" style="margin-bottom:8px"><span style="font-size:12px;color:var(--ink-soft)">${showHiddenBuildCategories ? 'Hide' : 'Show'} ${hiddenCount} hidden categor${hiddenCount === 1 ? 'y' : 'ies'}</span><i class="ti ti-chevron-${showHiddenBuildCategories ? 'down' : 'right'}"></i></div>` : ''}
    <div>${visible.map((c) => renderBuildCategoryRow(c, usageCount[c.id] || 0)).join('') || '<div class="empty-state">No categories yet.</div>'}</div>
  `;
}
function renderBuildCategoryRow(c, count) {
  if (c.hidden) {
    return `<div class="list-row" onclick="restoreBuildCategory('${c.id}')" style="opacity:0.55">
      <div style="display:flex;align-items:center"><div class="icon-badge" style="background:var(--gold-soft)"><i class="ti ${c.icon || 'ti-receipt'}"></i></div><span>${esc(c.name)} (hidden)</span></div>
      <span style="font-size:11px;color:var(--ink-soft)">Tap to restore</span>
    </div>`;
  }
  return `<div class="list-row">
    <div style="display:flex;align-items:center;cursor:pointer;flex:1" onclick="goEditBuildCategory('${c.id}')"><div class="icon-badge" style="background:var(--gold-soft)"><i class="ti ${c.icon || 'ti-receipt'}"></i></div><span>${esc(c.name)}</span></div>
    <span style="font-size:11px;color:var(--ink-soft);margin-right:10px">${count ? `used ${count}x` : 'unused'}</span>
    ${count ? `<i class="ti ti-pencil" style="color:var(--ink-soft);cursor:pointer" onclick="goEditBuildCategory('${c.id}')"></i>` : `<i class="ti ti-trash" style="color:var(--red);cursor:pointer" onclick="deleteBuildCategoryPermanently('${c.id}')"></i>`}
  </div>`;
}
let buildCategoryFormEditId = null;
let buildCategoryIconDraft = null;
function goAddBuildCategory() { buildCategoryFormEditId = null; buildCategoryIconDraft = 'ti-receipt'; moreView = 'buildCategoryForm'; renderMore(); }
function goEditBuildCategory(id) { buildCategoryFormEditId = id; moreView = 'buildCategoryForm'; renderMore(); }
async function renderBuildCategoryForm() {
  const existing = buildCategoryFormEditId ? await DB.get('buildCategories', buildCategoryFormEditId) : null;
  buildCategoryIconDraft = existing ? (existing.icon || 'ti-receipt') : (buildCategoryIconDraft || 'ti-receipt');
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="moreView='buildCategories';renderMore()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${existing ? 'Edit' : 'Add'} category</span></div>
    <div class="field"><label class="field-label">Name</label><input id="bcat_name" placeholder="e.g. Electrical" value="${existing ? esc(existing.name) : ''}"></div>
    <label class="field-label">Icon</label>
    <div id="bcatIconPicker" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      ${BUILD_EXPENSE_ICON_CHOICES.map((ic) => `<button type="button" data-icon="${ic}" onclick="selectBuildCategoryIcon('${ic}')" style="width:40px;height:40px;border-radius:10px;border:1px solid var(--line);background:${buildCategoryIconDraft === ic ? 'var(--gold-soft)' : 'var(--surface-raised)'};display:flex;align-items:center;justify-content:center;cursor:pointer"><i class="ti ${ic}" style="font-size:18px;color:var(--ink)"></i></button>`).join('')}
    </div>
    <button class="btn btn-primary" onclick="saveBuildCategoryForm()">${existing ? 'Save changes' : 'Add category'}</button>
    ${existing ? `<button class="btn" style="margin-top:10px;background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="hideBuildCategory('${existing.id}')">Hide from lists</button>` : ''}
  `;
}
function selectBuildCategoryIcon(icon) {
  buildCategoryIconDraft = icon;
  document.querySelectorAll('#bcatIconPicker button').forEach((btn) => { btn.style.background = btn.dataset.icon === icon ? 'var(--gold-soft)' : 'var(--surface-raised)'; });
}
async function saveBuildCategoryForm() {
  const name = document.getElementById('bcat_name').value.trim();
  if (!name) { alert('Category needs a name.'); return; }
  const cat = buildCategoryFormEditId ? await DB.get('buildCategories', buildCategoryFormEditId) : { id: uid(), hidden: false };
  cat.name = name;
  cat.icon = buildCategoryIconDraft || 'ti-receipt';
  cat.synced = false;
  await DB.put('buildCategories', cat);
  Sync.pushEntry('BuildCategories', cat).then(() => { cat.synced = true; DB.put('buildCategories', cat); });
  buildCategoryFormEditId = null;
  moreView = 'buildCategories'; renderMore();
}
async function hideBuildCategory(id) {
  if (!confirm('Hide this category from all pickers? Past expenses that used it are unaffected — you can restore it later.')) return;
  const cat = await DB.get('buildCategories', id);
  cat.hidden = true; cat.synced = false;
  await DB.put('buildCategories', cat);
  Sync.pushEntry('BuildCategories', cat).then(() => { cat.synced = true; DB.put('buildCategories', cat); });
  moreView = 'buildCategories'; renderMore();
}
async function restoreBuildCategory(id) {
  const cat = await DB.get('buildCategories', id);
  cat.hidden = false; cat.synced = false;
  await DB.put('buildCategories', cat);
  Sync.pushEntry('BuildCategories', cat).then(() => { cat.synced = true; DB.put('buildCategories', cat); });
  renderBuildCategoriesManager();
}
// Only reachable from the manager when usage count is genuinely zero (see
// renderBuildCategoryRow) — a real delete, not a soft-hide, since nothing references it.
async function deleteBuildCategoryPermanently(id) {
  if (!confirm('Delete this category? It has no expenses using it, so this is permanent.')) return;
  const cat = await DB.get('buildCategories', id);
  cat.deleted = true; cat.synced = false;
  await DB.put('buildCategories', cat);
  Sync.pushEntry('BuildCategories', cat).then(() => { cat.synced = true; DB.put('buildCategories', cat); });
  await DB.delete('buildCategories', id);
  renderBuildCategoriesManager();
}
