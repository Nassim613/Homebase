// ============ NOAH ============
// Noah's own tab: health issues (with temperatures, medication doses and doctor
// visits), growth measurements, and milestones/notes. Structured like Jazz —
// day-grouped list, issue threads with follow-up updates, resolve — but with the
// dog-specific fields (weather, stool, snow) replaced by kid-specific ones.
//
// Four local stores, four Sheet tabs:
//   noahIssues     -> Noah
//   noahGrowth     -> NoahGrowth
//   noahMilestones -> NoahMilestones
//   noahIssueTypes -> NoahIssueTypes
//   noahClinics    -> NoahClinics
//
// Doctor visits are deliberately NOT their own section: a visit always belongs to
// whatever was going on, so it's recorded on the health entry (or on one of its
// updates, since a visit usually happens on day 2 or 3, not day 1).

let noahSection = 'health';        // health | growth | milestones
let noahIssueId = null;            // issue currently open in the detail view
let noahEditSource = null;         // issue being edited (with __editId), or null
let noahMilestoneEditId = null;
let noahGrowthEditId = null;
let noahIssuePhotoDrafts = [];
let noahMilestonePhotoDrafts = [];

// Temperatures are °C and doses are mL throughout, per how this gets used day to day.
const NOAH_TEMP_UNIT = '°C';
const NOAH_DOSE_UNIT = 'mL';

async function getActiveNoahIssues() { return (await DB.getAll('noahIssues')).filter((r) => !r.deleted); }
async function getActiveNoahGrowth() { return (await DB.getAll('noahGrowth')).filter((r) => !r.deleted); }
async function getActiveNoahMilestones() { return (await DB.getAll('noahMilestones')).filter((r) => !r.deleted); }
async function getActiveNoahClinics() { return (await DB.getAll('noahClinics')).filter((r) => !r.deleted); }

function noahSectionSwitcher() {
  const tab = (key, icon, label) => `<button class="btn-toggle ${noahSection === key ? 'active-neutral' : ''}" onclick="setNoahSection('${key}')"><i class="ti ${icon}"></i> ${label}</button>`;
  return `<div class="btn-toggle-row">
    ${tab('health', 'ti-heartbeat', 'Health')}
    ${tab('growth', 'ti-ruler-measure', 'Growth')}
    ${tab('milestones', 'ti-star', 'Milestones')}
  </div>`;
}

function setNoahSection(section) {
  noahSection = section;
  route();
}

// The FAB adds whatever makes sense for the section you're looking at.
function noahFabAction() {
  if (noahSection === 'growth') { noahGrowthEditId = null; currentView = 'addNoahGrowth'; route(); return; }
  if (noahSection === 'milestones') {
    noahMilestoneEditId = null;
    noahMilestonePhotoDrafts = []; resetPhotoContext('noahMilestone');
    currentView = 'addNoahMilestone'; route(); return;
  }
  noahEditSource = null;
  noahIssuePhotoDrafts = []; resetPhotoContext('noahIssue');
  currentView = 'addNoahIssue'; route();
}

// ---------- main ----------

async function renderNoahMain() {
  if (noahSection === 'growth') return renderNoahGrowth();
  if (noahSection === 'milestones') return renderNoahMilestones();
  return renderNoahHealth();
}

async function renderNoahHealth() {
  const issues = (await getActiveNoahIssues()).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const types = await DB.getAll('noahIssueTypes');
  const typeById = Object.fromEntries(types.map((t) => [t.id, t]));
  const ongoing = issues.filter((i) => i.status === 'ongoing');

  const byDay = {};
  issues.forEach((i) => { (byDay[i.startDate] = byDay[i.startDate] || []).push(i); });
  const days = Object.keys(byDay).sort().reverse();

  $main.innerHTML = `
    ${noahSectionSwitcher()}
    ${ongoing.length ? ongoing.map((i) => renderNoahOngoingCard(i, typeById)).join('') : ''}
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn" style="flex:1;padding:12px 6px" onclick="currentView='noahReport';route()"><i class="ti ti-chart-bar"></i> Report</button>
      <button class="btn" style="flex:1;padding:12px 6px" onclick="currentView='noahPhotos';route()"><i class="ti ti-photo"></i> Photos</button>
      <button class="btn" style="flex:1;padding:12px 6px" onclick="noahFabAction()"><i class="ti ti-plus"></i> Log</button>
    </div>
    <div class="search-box"><i class="ti ti-search"></i><input id="noahSearch" placeholder="Search issues, meds, notes..."></div>
    ${collapseAllControls('noahList')}
    <div id="noahList">${days.length ? days.map((d, i) => renderNoahDayGroup(d, byDay[d], typeById, dayOpenByDefault(i, byDay[d], noahIssueOngoing))).join('') : '<div class="empty-state">Nothing logged yet. Tap + to log an issue.</div>'}</div>
  `;
  const search = document.getElementById('noahSearch');
  if (search) search.addEventListener('input', (e) => filterNoahHealth(e.target.value, days, byDay, typeById));
}

// The card at the top of the list for anything still ongoing: the latest temperature
// and the last dose given, with how long ago it was, which is the thing you actually
// want to know at 2am.
function renderNoahOngoingCard(issue, typeById) {
  const type = typeById[issue.typeId] || {};
  const day = noahDayCount(issue);
  const temp = noahLatestTemp(issue);
  const med = noahLatestMed(issue);
  return `<div class="card tight" style="background:var(--gold-soft);cursor:pointer" onclick="openNoahIssue('${issue.id}')">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <span style="font-size:14px;font-weight:600;color:#8a6412"><i class="ti ${type.icon || 'ti-virus'}"></i> ${esc(type.name || 'Issue')}, day ${day}</span>
      <span class="pill-sm pill-ongoing">Ongoing</span>
    </div>
    ${temp ? `<p style="font-size:12px;color:#8a6412;margin-top:4px">Last temp ${temp.value}${NOAH_TEMP_UNIT}${temp.time ? ' at ' + esc(temp.time) : ''}</p>` : ''}
    ${med ? `<p style="font-size:12px;color:#8a6412">Last med ${esc(med.name)}${med.dose ? ' ' + esc(med.dose) : ''}${med.time ? ' at ' + esc(med.time) : ''}${noahAgo(med) ? ' (' + noahAgo(med) + ')' : ''}</p>` : ''}
  </div>`;
}

function noahDayCount(issue) {
  const end = issue.endDate || todayStr();
  return Math.max(1, Math.round((new Date(end + 'T00:00:00') - new Date(issue.startDate + 'T00:00:00')) / 86400000) + 1);
}

// Temps and meds can be recorded on the issue itself or on any of its updates —
// these walk both, newest last, so "latest" really is the latest.
function noahAllTemps(issue) {
  const out = [];
  if (issue.temp) out.push({ date: issue.startDate, time: issue.tempTime || '', value: issue.temp });
  (issue.updates || []).forEach((u) => { if (u.temp) out.push({ date: u.date, time: u.time || '', value: u.temp }); });
  return out;
}
function noahAllMeds(issue) {
  const out = [];
  if (issue.medName) out.push({ date: issue.startDate, time: issue.medTime || '', name: issue.medName, dose: issue.medDose || '' });
  (issue.updates || []).forEach((u) => { if (u.medName) out.push({ date: u.date, time: u.time || '', name: u.medName, dose: u.medDose || '' }); });
  return out;
}
function noahLatestTemp(issue) { const all = noahAllTemps(issue); return all.length ? all[all.length - 1] : null; }
function noahLatestMed(issue) { const all = noahAllMeds(issue); return all.length ? all[all.length - 1] : null; }

// "1h ago" for a dose given earlier today. Deliberately only ever reports elapsed
// time — it never suggests when a next dose is due, since that's a medical judgement
// that depends on the child, the medication and the doctor's instructions.
function noahAgo(med) {
  if (!med.date || !med.time) return '';
  const stamp = new Date(med.date + 'T' + noah24h(med.time));
  if (isNaN(stamp)) return '';
  const mins = Math.round((Date.now() - stamp) / 60000);
  if (mins < 0 || mins > 2880) return '';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  return hrs + 'h ago';
}
// Times are stored exactly as typed so nothing is lost; this only normalises for the
// "how long ago" maths above, and gives up rather than guessing.
function noah24h(t) {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return '00:00';
  let h = parseInt(m[1], 10);
  const suffix = (m[3] || '').toLowerCase();
  if (suffix === 'pm' && h < 12) h += 12;
  if (suffix === 'am' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + m[2];
}

function noahIssueName(issue, typeById) { return (typeById[issue.typeId] || {}).name || 'Issue'; }
function noahIssueOngoing(issue) { return issue.status === 'ongoing'; }

function renderNoahDayGroup(date, dayIssues, typeById, openByDefault) {
  const open = openByDefault !== false;
  const summary = daySummaryLabel(dayIssues, (i) => noahIssueName(i, typeById));
  const hasOngoing = dayIssues.some(noahIssueOngoing);
  return `
    <div class="section-title" style="cursor:pointer" onclick="toggleCollapse(this)">
      <span>${fmtDateYear(date)} <i class="ti collapse-chevron ti-chevron-${open ? 'down' : 'right'}" style="font-size:11px;vertical-align:-1px"></i>${summary ? `<span class="day-summary"> · ${esc(summary)}</span>` : ''}</span>
      <span>${hasOngoing ? '<span class="pill-sm pill-ongoing">Ongoing</span>' : ''}</span>
    </div>
    <div class="collapse-body" style="display:${open ? 'block' : 'none'}">${dayIssues.map((i) => renderNoahIssueRow(i, typeById)).join('')}</div>
  `;
}

function renderNoahIssueRow(issue, typeById) {
  const type = typeById[issue.typeId] || {};
  const firstPhoto = issue.photoLinks && issue.photoLinks.find((p) => p.isImage);
  const temp = noahLatestTemp(issue);
  const meta = [issue.severity, temp ? temp.value + NOAH_TEMP_UNIT : '', issue.doctorVisit ? 'doctor visit' : '', issue.missedSchool ? 'missed daycare' : ''].filter(Boolean).join(' · ');
  return `<div class="entry-row" onclick="openNoahIssue('${issue.id}')">
    <div class="entry-icon" style="width:60px;height:60px;border-radius:12px">${firstPhoto ? `<img src="${firstPhoto.url}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : `<i class="ti ${type.icon || 'ti-virus'}" style="color:var(--ink-soft)"></i>`}</div>
    <div class="entry-body">
      <div class="entry-top"><span class="entry-title">${esc(type.name || 'Issue')}</span><span class="pill-sm ${issue.status === 'ongoing' ? 'pill-ongoing' : 'pill-resolved'}">${issue.status === 'ongoing' ? 'Ongoing' : 'Resolved'}</span></div>
      <div class="entry-meta">${esc(meta)}</div>
      ${issue.description ? `<div class="entry-desc">${esc(issue.description)}</div>` : ''}
    </div>
  </div>`;
}

function filterNoahHealth(term, days, byDay, typeById) {
  const q = term.trim().toLowerCase();
  const list = document.getElementById('noahList');
  if (!q) { list.innerHTML = days.map((d, i) => renderNoahDayGroup(d, byDay[d], typeById, dayOpenByDefault(i, byDay[d], noahIssueOngoing))).join(''); return; }
  const hits = [];
  days.forEach((d) => {
    byDay[d].forEach((issue) => {
      const type = typeById[issue.typeId] || {};
      const haystack = [type.name, issue.description, issue.severity, issue.visitNotes, ...noahAllMeds(issue).map((m) => m.name), ...(issue.updates || []).map((u) => u.note)].filter(Boolean).join(' ').toLowerCase();
      if (haystack.includes(q)) hits.push(issue);
    });
  });
  list.innerHTML = hits.length ? hits.map((i) => renderNoahIssueRow(i, typeById)).join('') : '<div class="empty-state">No matches.</div>';
}

// ---------- health: add / edit ----------

async function renderAddNoahIssue() {
  const types = (await DB.getAll('noahIssueTypes')).filter((t) => !t.hidden && !t.deleted);
  const clinics = await getActiveNoahClinics();
  const past = await getActiveNoahIssues();
  const medHistory = [...new Set(past.flatMap((i) => noahAllMeds(i).map((m) => m.name)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const src = noahEditSource;

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goNoahMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${src && src.__editId ? 'Edit' : 'Log an'} issue</span></div>

    <div class="field"><label class="field-label">Started</label><input type="date" id="n_date" value="${src ? src.startDate : todayStr()}"></div>
    <div class="field"><label class="field-label">Issue type</label>
      <div style="display:flex;gap:6px">
        <select id="n_type" style="flex:1">
          ${types.map((t) => `<option value="${t.id}" ${src && src.typeId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn" style="width:44px;flex-shrink:0;padding:0" onclick="openNoahIssueTypeModal()"><i class="ti ti-plus"></i></button>
      </div>
    </div>

    <label class="field-label">Severity</label>
    <div class="btn-toggle-row" id="noahSeverityToggle">
      <button class="btn-toggle" onclick="selectNoahSeverity(this,'Mild')">Mild</button>
      <button class="btn-toggle" onclick="selectNoahSeverity(this,'Moderate')">Moderate</button>
      <button class="btn-toggle" onclick="selectNoahSeverity(this,'Severe')">Severe</button>
    </div>

    <label class="field-label">Status</label>
    <div class="btn-toggle-row" id="noahStatusToggle">
      <button class="btn-toggle" onclick="selectNoahStatus(this,'ongoing')">Ongoing</button>
      <button class="btn-toggle" onclick="selectNoahStatus(this,'resolved')">Resolved</button>
    </div>

    <div class="field"><label class="field-label">Description</label><textarea id="n_description" placeholder="Symptoms, when it started, anything you noticed...">${src ? esc(src.description || '') : ''}</textarea></div>

    <div class="card tight" style="background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label class="field-label" style="margin:0">Temperature</label>
        <button type="button" class="chip" id="noahTempToggle" onclick="toggleNoahTemp()">${src && src.temp ? 'Yes' : 'No'}</button>
      </div>
      <div id="noahTempFields" style="display:${src && src.temp ? 'block' : 'none'}">
        <div class="field-row">
          <input id="n_temp" type="number" step="0.1" placeholder="38.4 ${NOAH_TEMP_UNIT}" value="${src && src.temp ? src.temp : ''}">
          <input id="n_tempTime" placeholder="7:10 pm" value="${src && src.tempTime ? esc(src.tempTime) : ''}">
        </div>
      </div>
    </div>

    <div class="card tight" style="background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label class="field-label" style="margin:0">Medication given</label>
        <button type="button" class="chip" id="noahMedToggle" onclick="toggleNoahMed()">${src && src.medName ? 'Yes' : 'No'}</button>
      </div>
      <div id="noahMedFields" style="display:${src && src.medName ? 'block' : 'none'}">
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <input id="n_medName" list="noahMedList" placeholder="Tylenol" style="flex:1" value="${src && src.medName ? esc(src.medName) : ''}">
          <datalist id="noahMedList">${medHistory.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
        </div>
        <div class="field-row">
          <input id="n_medDose" placeholder="5 ${NOAH_DOSE_UNIT}" value="${src && src.medDose ? esc(src.medDose) : ''}">
          <input id="n_medTime" placeholder="6:00 pm" value="${src && src.medTime ? esc(src.medTime) : ''}">
        </div>
      </div>
    </div>

    <div class="card tight" style="background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label class="field-label" style="margin:0">Doctor visit</label>
        <button type="button" class="chip" id="noahVisitToggle" onclick="toggleNoahVisit()">${src && src.doctorVisit ? 'Yes' : 'No'}</button>
      </div>
      <div id="noahVisitFields" style="display:${src && src.doctorVisit ? 'block' : 'none'}">
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <select id="n_clinic" style="flex:1">
            ${clinics.map((c) => `<option value="${c.id}" ${src && src.clinicId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <button type="button" class="btn" style="width:44px;flex-shrink:0;padding:0" onclick="openNoahClinicModal()"><i class="ti ti-plus"></i></button>
        </div>
        <input type="date" id="n_visitDate" style="margin-bottom:8px" value="${src && src.visitDate ? src.visitDate : (src ? src.startDate : todayStr())}">
        <textarea id="n_visitNotes" placeholder="What the doctor said, diagnosis, prescription...">${src && src.visitNotes ? esc(src.visitNotes) : ''}</textarea>
      </div>
    </div>

    <div class="card tight" style="background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <label class="field-label" style="margin:0">Missed daycare/school</label>
        <button type="button" class="chip" id="noahSchoolToggle" onclick="toggleNoahSchool()">${src && src.missedSchool ? 'Yes' : 'No'}</button>
      </div>
    </div>

    ${renderExistingLinksGrid(src && src.photoLinks, 'noahIssue', 'Existing photos (tap × to remove)')}
    <label class="field-label">Add photos</label>
    <div class="photo-grid" id="noahIssuePhotoGrid">${renderPhotoGrid(noahIssuePhotoDrafts, 'noahIssue')}</div>

    <button class="btn btn-primary" id="saveNoahIssueBtn" onclick="saveNoahIssue()">${src && src.__editId ? 'Save changes' : 'Save entry'}</button>
  `;

  const sevIdx = { Mild: 0, Moderate: 1, Severe: 2 }[src ? src.severity : 'Mild'] || 0;
  selectNoahSeverity(document.querySelectorAll('#noahSeverityToggle .btn-toggle')[sevIdx], src ? src.severity : 'Mild');
  const statIdx = src && src.status === 'resolved' ? 1 : 0;
  selectNoahStatus(document.querySelectorAll('#noahStatusToggle .btn-toggle')[statIdx], src ? src.status : 'ongoing');
  window.__noahTemp = !!(src && src.temp);
  window.__noahMed = !!(src && src.medName);
  window.__noahVisit = !!(src && src.doctorVisit);
  window.__noahSchool = !!(src && src.missedSchool);
}

function selectNoahSeverity(btn, val) { if (!btn) return; btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral')); btn.classList.add('active-neutral'); window.__noahSeverity = val; }
function selectNoahStatus(btn, val) { if (!btn) return; btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral')); btn.classList.add('active-neutral'); window.__noahStatus = val; }
function toggleNoahTemp() { window.__noahTemp = !window.__noahTemp; document.getElementById('noahTempToggle').textContent = window.__noahTemp ? 'Yes' : 'No'; document.getElementById('noahTempFields').style.display = window.__noahTemp ? 'block' : 'none'; }
function toggleNoahMed() { window.__noahMed = !window.__noahMed; document.getElementById('noahMedToggle').textContent = window.__noahMed ? 'Yes' : 'No'; document.getElementById('noahMedFields').style.display = window.__noahMed ? 'block' : 'none'; }
function toggleNoahVisit() { window.__noahVisit = !window.__noahVisit; document.getElementById('noahVisitToggle').textContent = window.__noahVisit ? 'Yes' : 'No'; document.getElementById('noahVisitFields').style.display = window.__noahVisit ? 'block' : 'none'; }
function toggleNoahSchool() { window.__noahSchool = !window.__noahSchool; document.getElementById('noahSchoolToggle').textContent = window.__noahSchool ? 'Yes' : 'No'; }

async function saveNoahIssue() {
  const btn = document.getElementById('saveNoahIssueBtn');
  const originalText = noahEditSource && noahEditSource.__editId ? 'Save changes' : 'Save entry';
  if (pendingPhotoUploads.noahIssue && pendingPhotoUploads.noahIssue.length && btn) { btn.disabled = true; btn.textContent = 'Finishing photo upload…'; }
  await waitForPendingUploads('noahIssue');
  if (btn) { btn.disabled = false; btn.textContent = originalText; }
  const failed = countFailedUploads('noahIssue');
  if (failed > 0 && !confirm(`${failed} photo${failed === 1 ? '' : 's'} couldn't reach Drive and will only be visible on this device. Save anyway?`)) return;

  const typeId = document.getElementById('n_type').value;
  if (!typeId) { alert('Pick an issue type first — tap + next to the list to add one.'); return; }
  const isEdit = noahEditSource && noahEditSource.__editId;
  const issue = {
    id: isEdit ? noahEditSource.__editId : uid(),
    typeId,
    startDate: document.getElementById('n_date').value || todayStr(),
    endDate: isEdit ? noahEditSource.endDate : null,
    severity: window.__noahSeverity || 'Mild',
    status: window.__noahStatus || 'ongoing',
    description: document.getElementById('n_description').value.trim(),
    temp: window.__noahTemp ? parseFloat(document.getElementById('n_temp').value) || null : null,
    tempTime: window.__noahTemp ? document.getElementById('n_tempTime').value.trim() : '',
    medName: window.__noahMed ? document.getElementById('n_medName').value.trim() : '',
    medDose: window.__noahMed ? document.getElementById('n_medDose').value.trim() : '',
    medTime: window.__noahMed ? document.getElementById('n_medTime').value.trim() : '',
    doctorVisit: !!window.__noahVisit,
    clinicId: window.__noahVisit ? document.getElementById('n_clinic').value : null,
    visitDate: window.__noahVisit ? document.getElementById('n_visitDate').value : '',
    visitNotes: window.__noahVisit ? document.getElementById('n_visitNotes').value.trim() : '',
    missedSchool: !!window.__noahSchool,
    photos: [...noahIssuePhotoDrafts],
    photoLinks: [...keptExistingLinks(isEdit && noahEditSource.photoLinks ? noahEditSource.photoLinks : [], 'noahIssue'), ...photoUploadLinks.noahIssue.filter(Boolean)],
    updates: isEdit ? noahEditSource.updates || [] : [],
    synced: false
  };
  await DB.put('noahIssues', issue);
  Sync.pushEntry('Noah', issue).then(() => DB.put('noahIssues', issue));

  noahIssuePhotoDrafts = []; resetPhotoContext('noahIssue');
  noahEditSource = null;
  if (isEdit) { noahIssueId = issue.id; currentView = 'noahIssueDetail'; } else { currentView = 'main'; }
  route();
}

function editNoahIssue(id) {
  DB.get('noahIssues', id).then((issue) => {
    noahEditSource = { ...issue, __editId: issue.id };
    noahIssuePhotoDrafts = []; resetPhotoContext('noahIssue');
    currentView = 'addNoahIssue';
    route();
  });
}

async function deleteNoahIssue(id) {
  if (!confirm('Delete this entry? This removes it everywhere, including the Sheet.')) return;
  const issue = await DB.get('noahIssues', id);
  issue.deleted = true; issue.synced = false;
  await DB.put('noahIssues', issue);
  Sync.pushEntry('Noah', issue).then(() => DB.put('noahIssues', issue));
  currentView = 'main';
  route();
}

// ---------- health: detail thread ----------

function openNoahIssue(id) { noahIssueId = id; currentView = 'noahIssueDetail'; route(); }
function goNoahMain() { currentView = 'main'; noahEditSource = null; route(); }

async function renderNoahIssueDetail() {
  const issue = await DB.get('noahIssues', noahIssueId);
  if (!issue) { currentView = 'main'; return route(); }
  const types = await DB.getAll('noahIssueTypes');
  const type = types.find((t) => t.id === issue.typeId) || {};
  const clinics = await getActiveNoahClinics();
  const clinicName = (id) => (clinics.find((c) => c.id === id) || {}).name || '';
  const day = noahDayCount(issue);

  const firstMeta = [issue.severity, issue.temp ? issue.temp + NOAH_TEMP_UNIT : '', issue.medName ? esc(issue.medName) + (issue.medDose ? ' ' + esc(issue.medDose) : '') : ''].filter(Boolean).join(' · ');

  $main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <div class="back" style="cursor:pointer" onclick="goNoahMain()"><i class="ti ti-arrow-left"></i> <i class="ti ${type.icon || 'ti-virus'}" style="margin-left:8px"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${esc(type.name || 'Issue')}</span></div>
      <span class="pill-sm ${issue.status === 'ongoing' ? 'pill-ongoing' : 'pill-resolved'}">${issue.status === 'ongoing' ? 'Ongoing' : 'Resolved'}</span>
    </div>
    <p style="font-size:11px;color:var(--ink-soft);margin-bottom:16px">Started ${fmtDate(issue.startDate)} · ${day} day${day === 1 ? '' : 's'}${issue.missedSchool ? ' · missed daycare/school' : ''}</p>

    <div class="thread-item">
      <p class="meta">${fmtDate(issue.startDate)}${firstMeta ? ' · ' + firstMeta : ''}</p>
      ${issue.description ? `<p class="note">${esc(issue.description)}</p>` : ''}
    </div>
    ${issue.doctorVisit ? `<div class="thread-item" style="border-left-color:var(--gold)">
      <p class="meta"><i class="ti ti-stethoscope"></i> ${fmtDate(issue.visitDate || issue.startDate)} · Doctor visit${clinicName(issue.clinicId) ? ' · ' + esc(clinicName(issue.clinicId)) : ''}</p>
      ${issue.visitNotes ? `<p class="note">${esc(issue.visitNotes)}</p>` : ''}
    </div>` : ''}
    ${renderLinkPreviewList(issue.photoLinks, 'Photo')}
    ${updatesHeading((issue.updates || []).length, 'goAddNoahUpdate()')}
    ${(issue.updates || []).length
      ? issue.updates.map((u) => renderNoahUpdate(u, clinicName)).join('')
      : '<p style="font-size:12px;color:var(--ink-soft);margin-bottom:14px">No updates yet.</p>'}

    <button class="btn" style="margin-bottom:10px" onclick="goAddNoahUpdate()"><i class="ti ti-plus"></i> Add update</button>
    <button class="btn" style="margin-bottom:10px" onclick="editNoahIssue('${issue.id}')"><i class="ti ti-edit"></i> Edit</button>
    ${issue.status === 'ongoing' ? `<button class="btn" style="margin-bottom:10px;background:var(--sage-soft);color:#0F6E56;border-color:var(--sage)" onclick="resolveNoahIssue()"><i class="ti ti-check"></i> Mark resolved</button>` : ''}
    <button class="btn" style="color:var(--red);border-color:var(--red-soft)" onclick="deleteNoahIssue('${issue.id}')"><i class="ti ti-trash"></i> Delete</button>
  `;
}

// Temperature, dose and visit stay folded into the update's header line rather than
// becoming separate rows — one glance down the thread reads as a timeline.
function renderNoahUpdate(u, clinicName) {
  const meta = [fmtDate(u.date), u.time || '', u.severity || '', u.temp ? u.temp + NOAH_TEMP_UNIT : '', u.medName ? u.medName + (u.medDose ? ' ' + u.medDose : '') : ''].filter(Boolean).join(' · ');
  const visitSuffix = u.doctorVisit ? ' · Doctor visit' + (u.clinicId && clinicName(u.clinicId) ? ' · ' + clinicName(u.clinicId) : '') : '';
  const html = renderUpdateThreadItem(u, meta + visitSuffix);
  return u.doctorVisit ? html.replace('class="thread-item thread-update"', 'class="thread-item thread-update" style="border-left-color:var(--gold)"') : html;
}

// An update is its own page rather than a popup: a doctor visit or a new dose
// usually happens partway through an illness, and it's a natural place to attach a
// photo of a rash or a prescription label — cramped in a sheet, fine on a page.
let noahUpdatePhotoDrafts = [];

function goAddNoahUpdate() {
  noahUpdatePhotoDrafts = [];
  resetPhotoContext('noahUpdate');
  currentView = 'addNoahUpdate';
  route();
}

async function renderAddNoahUpdate() {
  const issue = await DB.get('noahIssues', noahIssueId);
  if (!issue) { currentView = 'main'; return route(); }
  const types = await DB.getAll('noahIssueTypes');
  const type = types.find((t) => t.id === issue.typeId) || {};
  const clinics = await getActiveNoahClinics();
  const past = await getActiveNoahIssues();
  const medHistory = [...new Set(past.flatMap((i) => noahAllMeds(i).map((m) => m.name)).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  $main.innerHTML = `
    <div class="back" style="margin-bottom:6px;cursor:pointer" onclick="currentView='noahIssueDetail';route()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Add update</span></div>
    <p style="font-size:11px;color:var(--ink-soft);margin-bottom:16px">${esc(type.name || 'Issue')} · started ${fmtDate(issue.startDate)}</p>

    <div class="field-row" style="margin-bottom:14px">
      <div><label class="field-label">Date</label><input type="date" id="nu_date" value="${todayStr()}"></div>
      <div><label class="field-label">Time</label><input id="nu_time" placeholder="7:10 pm"></div>
    </div>
    <label class="field-label">Severity now</label>
    <div class="btn-toggle-row" id="noahUpdateSeverity">
      <button class="btn-toggle" onclick="selectNoahUpdateSeverity(this,'Mild')">Mild</button>
      <button class="btn-toggle" onclick="selectNoahUpdateSeverity(this,'Moderate')">Moderate</button>
      <button class="btn-toggle" onclick="selectNoahUpdateSeverity(this,'Severe')">Severe</button>
    </div>
    <div class="field-row" style="margin-bottom:14px">
      <div><label class="field-label">Temperature</label><input id="nu_temp" type="number" step="0.1" placeholder="38.4 ${NOAH_TEMP_UNIT}"></div>
      <div><label class="field-label">Medication</label><input id="nu_medName" list="noahUpdateMedList" placeholder="Tylenol"><datalist id="noahUpdateMedList">${medHistory.map((m) => `<option value="${esc(m)}">`).join('')}</datalist></div>
    </div>
    <div class="field"><label class="field-label">Dose</label><input id="nu_medDose" placeholder="5 ${NOAH_DOSE_UNIT}"></div>

    <div class="card tight" style="background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label class="field-label" style="margin:0">Doctor visit</label>
        <button type="button" class="chip" id="nuVisitToggle" onclick="toggleNoahUpdateVisit()">No</button>
      </div>
      <div id="nuVisitFields" style="display:none">
        <div style="display:flex;gap:6px">
          <select id="nu_clinic" style="flex:1">${clinics.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
          <button type="button" class="btn" style="width:44px;flex-shrink:0;padding:0" onclick="openNoahClinicModal(true)"><i class="ti ti-plus"></i></button>
        </div>
      </div>
    </div>

    <div class="field"><label class="field-label">Notes</label><textarea id="nu_note" placeholder="How he's doing, what changed..."></textarea></div>
    <label class="field-label">Add photos</label>
    <div class="photo-grid" id="noahUpdatePhotoGrid">${renderPhotoGrid(noahUpdatePhotoDrafts, 'noahUpdate')}</div>
    <button class="btn btn-primary" id="saveNoahUpdateBtn" onclick="saveNoahUpdate()">Save update</button>
  `;
  window.__noahUpdateVisit = false;
  selectNoahUpdateSeverity(document.querySelector('#noahUpdateSeverity .btn-toggle'), issue.severity || 'Mild');
}

function selectNoahUpdateSeverity(btn, val) {
  if (!btn) return;
  btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral'));
  btn.classList.add('active-neutral');
  window.__noahUpdateSeverity = val;
}
function toggleNoahUpdateVisit() {
  window.__noahUpdateVisit = !window.__noahUpdateVisit;
  document.getElementById('nuVisitToggle').textContent = window.__noahUpdateVisit ? 'Yes' : 'No';
  document.getElementById('nuVisitFields').style.display = window.__noahUpdateVisit ? 'block' : 'none';
}

async function saveNoahUpdate() {
  const btn = document.getElementById('saveNoahUpdateBtn');
  if (pendingPhotoUploads.noahUpdate && pendingPhotoUploads.noahUpdate.length && btn) { btn.disabled = true; btn.textContent = 'Finishing photo upload…'; }
  await waitForPendingUploads('noahUpdate');
  if (btn) { btn.disabled = false; btn.textContent = 'Save update'; }
  const issue = await DB.get('noahIssues', noahIssueId);
  if (!issue) return;
  const clinicSel = document.getElementById('nu_clinic');
  const update = {
    date: document.getElementById('nu_date').value || todayStr(),
    time: document.getElementById('nu_time').value.trim(),
    severity: window.__noahUpdateSeverity || 'Mild',
    temp: parseFloat(document.getElementById('nu_temp').value) || null,
    medName: document.getElementById('nu_medName').value.trim(),
    medDose: document.getElementById('nu_medDose').value.trim(),
    doctorVisit: !!window.__noahUpdateVisit,
    clinicId: window.__noahUpdateVisit && clinicSel ? clinicSel.value : null,
    note: document.getElementById('nu_note').value.trim(),
    photoLinks: photoUploadLinks.noahUpdate.filter(Boolean)
  };
  if (!update.note && !update.photoLinks.length && !update.temp && !update.medName && !update.doctorVisit) {
    alert('Add something to the update first — a note, a photo, a temperature, a dose or a visit.');
    return;
  }
  issue.updates = issue.updates || [];
  issue.updates.push(update);
  // Any severity change on an update becomes the issue's current severity, so the list
  // row and the ongoing card reflect where things stand now rather than day one.
  issue.severity = update.severity;
  issue.synced = false;
  await DB.put('noahIssues', issue);
  Sync.pushEntry('Noah', issue).then(() => DB.put('noahIssues', issue));
  noahUpdatePhotoDrafts = [];
  resetPhotoContext('noahUpdate');
  currentView = 'noahIssueDetail';
  route();
}

async function resolveNoahIssue() {
  const issue = await DB.get('noahIssues', noahIssueId);
  issue.status = 'resolved';
  issue.endDate = todayStr();
  issue.synced = false;
  await DB.put('noahIssues', issue);
  Sync.pushEntry('Noah', issue).then(() => DB.put('noahIssues', issue));
  renderNoahIssueDetail();
}

// ---------- issue types and clinics ----------

let noahIssueTypeIcon = 'ti-virus';
const NOAH_TYPE_ICONS = ['ti-virus', 'ti-temperature', 'ti-ear', 'ti-eye', 'ti-lungs', 'ti-stomach', 'ti-dental', 'ti-bandage', 'ti-rash', 'ti-vaccine', 'ti-pill', 'ti-mood-sick'];

function openNoahIssueTypeModal() {
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:14px">Add issue type</p>
    <div class="field"><label class="field-label">Name</label><input id="nt_name" placeholder="Ear infection"></div>
    <label class="field-label">Icon</label>
    <div class="chip-row" id="noahTypeIcons">${NOAH_TYPE_ICONS.map((ic) => `<button type="button" class="chip ${ic === noahIssueTypeIcon ? 'active' : ''}" onclick="pickNoahTypeIcon('${ic}')"><i class="ti ${ic}"></i></button>`).join('')}</div>
    <button class="btn btn-primary" onclick="saveNoahIssueType()">Add</button>
  `;
  openModal();
}
function pickNoahTypeIcon(icon) {
  noahIssueTypeIcon = icon;
  document.querySelectorAll('#noahTypeIcons .chip').forEach((c) => c.classList.remove('active'));
  const btns = [...document.querySelectorAll('#noahTypeIcons .chip')];
  const idx = NOAH_TYPE_ICONS.indexOf(icon);
  if (btns[idx]) btns[idx].classList.add('active');
}
async function saveNoahIssueType() {
  const name = document.getElementById('nt_name').value.trim();
  if (!name) { alert('Issue type needs a name.'); return; }
  const type = { id: uid(), name, icon: noahIssueTypeIcon, hidden: false, synced: false };
  await DB.put('noahIssueTypes', type);
  Sync.pushEntry('NoahIssueTypes', type).then(() => DB.put('noahIssueTypes', type));
  closeModal();
  if (currentTab === 'noah' && currentView === 'addNoahIssue') {
    renderAddNoahIssue().then(() => { const sel = document.getElementById('n_type'); if (sel) sel.value = type.id; });
  } else if (moreView === 'noahIssueTypes') {
    renderNoahIssueTypesManager();
  }
}

function openNoahClinicModal(fromUpdate) {
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:14px">Add clinic</p>
    <div class="field"><label class="field-label">Name</label><input id="nc_name" placeholder="Walk-in clinic, Bank St"></div>
    <button class="btn btn-primary" onclick="saveNoahClinic(${fromUpdate ? 'true' : 'false'})">Add</button>
  `;
  openModal();
}
async function saveNoahClinic(fromUpdate) {
  const name = document.getElementById('nc_name').value.trim();
  if (!name) { alert('Clinic needs a name.'); return; }
  const clinic = { id: uid(), name, synced: false };
  await DB.put('noahClinics', clinic);
  Sync.pushEntry('NoahClinics', clinic).then(() => DB.put('noahClinics', clinic));
  closeModal();
  // Adding a clinic from the update page: the page is still underneath, so just drop
  // the new clinic into its picker rather than rebuilding the whole form and losing
  // whatever's already typed into it.
  if (fromUpdate) {
    const updateSel = document.getElementById('nu_clinic');
    if (updateSel) {
      const opt = document.createElement('option');
      opt.value = clinic.id; opt.textContent = clinic.name;
      updateSel.appendChild(opt); updateSel.value = clinic.id;
    }
    return;
  }
  const sel = document.getElementById('n_clinic');
  if (sel) {
    const opt = document.createElement('option');
    opt.value = clinic.id; opt.textContent = clinic.name;
    sel.appendChild(opt); sel.value = clinic.id;
  } else if (moreView === 'noahClinics') {
    renderNoahClinicsManager();
  }
}

// Settings → Noah → Issue types
async function renderNoahIssueTypesManager() {
  const types = (await DB.getAll('noahIssueTypes')).filter((t) => !t.deleted).sort((a, b) => a.name.localeCompare(b.name));
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMoreMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Noah's issue types</span></div>
    ${types.map((t) => `<div class="list-row"><span><i class="ti ${t.icon || 'ti-virus'}"></i> ${esc(t.name)}${t.hidden ? ' <span class="pill-sm" style="background:var(--line)">hidden</span>' : ''}</span>
      <button class="chip" onclick="toggleNoahTypeHidden('${t.id}')">${t.hidden ? 'Restore' : 'Hide'}</button></div>`).join('') || '<div class="empty-state">No issue types yet.</div>'}
    <button class="btn" style="margin-top:14px" onclick="openNoahIssueTypeModal()"><i class="ti ti-plus"></i> Add issue type</button>
  `;
}
async function toggleNoahTypeHidden(id) {
  const t = await DB.get('noahIssueTypes', id);
  t.hidden = !t.hidden; t.synced = false;
  await DB.put('noahIssueTypes', t);
  Sync.pushEntry('NoahIssueTypes', t).then(() => DB.put('noahIssueTypes', t));
  renderNoahIssueTypesManager();
}

// Settings → Noah → Clinics
async function renderNoahClinicsManager() {
  const clinics = (await getActiveNoahClinics()).sort((a, b) => a.name.localeCompare(b.name));
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goMoreMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Noah's clinics</span></div>
    ${clinics.map((c) => `<div class="list-row"><span><i class="ti ti-stethoscope"></i> ${esc(c.name)}</span><button class="chip" onclick="deleteNoahClinic('${c.id}')">Delete</button></div>`).join('') || '<div class="empty-state">No clinics yet.</div>'}
    <button class="btn" style="margin-top:14px" onclick="openNoahClinicModal()"><i class="ti ti-plus"></i> Add clinic</button>
  `;
}
async function deleteNoahClinic(id) {
  if (!confirm('Delete this clinic? Past visits that used it keep their record.')) return;
  const c = await DB.get('noahClinics', id);
  c.deleted = true; c.synced = false;
  await DB.put('noahClinics', c);
  Sync.pushEntry('NoahClinics', c).then(() => DB.put('noahClinics', c));
  renderNoahClinicsManager();
}

// ---------- growth ----------

async function renderNoahGrowth() {
  const all = (await getActiveNoahGrowth()).sort((a, b) => b.date.localeCompare(a.date));
  const withHeight = all.filter((m) => m.heightCm);
  const withWeight = all.filter((m) => m.weightLbs);
  const latestH = withHeight[0];
  const latestW = withWeight[0];
  const prevH = withHeight[1];
  const prevW = withWeight[1];

  $main.innerHTML = `
    ${noahSectionSwitcher()}
    <div class="stat-grid">
      <div class="stat"><p class="label">Height</p><p class="value">${latestH ? latestH.heightCm + ' cm' : '—'}</p>${prevH ? `<p class="label" style="color:#0F6E56">${noahDelta(latestH.heightCm - prevH.heightCm, 'cm')} since ${fmtDate(prevH.date)}</p>` : ''}</div>
      <div class="stat"><p class="label">Weight</p><p class="value">${latestW ? latestW.weightLbs + ' lbs' : '—'}</p>${prevW ? `<p class="label" style="color:#0F6E56">${noahDelta(latestW.weightLbs - prevW.weightLbs, 'lbs')} since ${fmtDate(prevW.date)}</p>` : ''}</div>
    </div>
    <div class="card" style="padding:12px">
      <div class="btn-toggle-row" style="margin-bottom:10px">
        <button class="btn-toggle active-neutral" id="noahChartHeightBtn" onclick="setNoahChartMetric('height')">Height</button>
        <button class="btn-toggle" id="noahChartWeightBtn" onclick="setNoahChartMetric('weight')">Weight</button>
      </div>
      <canvas id="noahGrowthChart" height="150"></canvas>
    </div>
    <button class="btn" style="margin-bottom:14px" onclick="noahFabAction()"><i class="ti ti-plus"></i> Log measurement</button>
    ${all.length ? all.map((m) => `<div class="entry-row" onclick="editNoahGrowth('${m.id}')">
      <div class="entry-icon"><i class="ti ti-ruler-measure" style="color:var(--ink-soft)"></i></div>
      <div class="entry-body">
        <div class="entry-top"><span class="entry-title">${fmtDateYear(m.date)}</span><span class="entry-value">${[m.heightCm ? m.heightCm + ' cm' : '', m.weightLbs ? m.weightLbs + ' lbs' : ''].filter(Boolean).join(' · ')}</span></div>
        ${m.note ? `<div class="entry-desc">${esc(m.note)}</div>` : ''}
      </div>
    </div>`).join('') : '<div class="empty-state">No measurements yet.</div>'}
  `;
  window.__noahGrowthData = all;
  drawNoahGrowthChart('height');
}

function noahDelta(n, unit) {
  const rounded = Math.round(n * 10) / 10;
  return (rounded >= 0 ? '+' : '') + rounded + ' ' + unit;
}

function setNoahChartMetric(metric) {
  document.getElementById('noahChartHeightBtn').classList.toggle('active-neutral', metric === 'height');
  document.getElementById('noahChartWeightBtn').classList.toggle('active-neutral', metric === 'weight');
  drawNoahGrowthChart(metric);
}

function drawNoahGrowthChart(metric) {
  const canvas = document.getElementById('noahGrowthChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const field = metric === 'weight' ? 'weightLbs' : 'heightCm';
  const points = (window.__noahGrowthData || []).filter((m) => m[field]).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (window.__noahChart) window.__noahChart.destroy();
  if (!points.length) return;
  try {
    window.__noahChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: points.map((p) => fmtDate(p.date)),
        datasets: [{ data: points.map((p) => p[field]), borderColor: '#2A78D6', backgroundColor: 'rgba(42,120,214,0.12)', tension: 0.3, fill: true, pointRadius: 3 }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false } }, maintainAspectRatio: false }
    });
  } catch (err) {
    // Chart.js comes from a CDN — if it didn't load, the measurements list below is
    // still the real content, so don't let a missing chart take the screen down.
    console.warn('Growth chart could not be drawn:', err.message);
  }
}

async function renderAddNoahGrowth() {
  const existing = noahGrowthEditId ? await DB.get('noahGrowth', noahGrowthEditId) : null;
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goNoahMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${existing ? 'Edit' : 'Log'} measurement</span></div>
    <div class="field"><label class="field-label">Date</label><input type="date" id="ng_date" value="${existing ? existing.date : todayStr()}"></div>
    <div class="field-row" style="margin-bottom:14px">
      <div><label class="field-label">Height (cm)</label><input id="ng_height" type="number" step="0.1" value="${existing && existing.heightCm ? existing.heightCm : ''}"></div>
      <div><label class="field-label">Weight (lbs)</label><input id="ng_weight" type="number" step="0.1" value="${existing && existing.weightLbs ? existing.weightLbs : ''}"></div>
    </div>
    <div class="field"><label class="field-label">Note</label><textarea id="ng_note" placeholder="Checkup, growth spurt, anything worth remembering">${existing && existing.note ? esc(existing.note) : ''}</textarea></div>
    <button class="btn btn-primary" onclick="saveNoahGrowth()">${existing ? 'Save changes' : 'Save'}</button>
    ${existing ? `<button class="btn" style="margin-top:10px;color:var(--red);border-color:var(--red-soft)" onclick="deleteNoahGrowth('${existing.id}')"><i class="ti ti-trash"></i> Delete</button>` : ''}
  `;
}

async function saveNoahGrowth() {
  const height = parseFloat(document.getElementById('ng_height').value) || null;
  const weight = parseFloat(document.getElementById('ng_weight').value) || null;
  if (!height && !weight) { alert('Enter a height, a weight, or both.'); return; }
  const existing = noahGrowthEditId ? await DB.get('noahGrowth', noahGrowthEditId) : null;
  const rec = {
    id: existing ? existing.id : uid(),
    date: document.getElementById('ng_date').value || todayStr(),
    heightCm: height,
    weightLbs: weight,
    note: document.getElementById('ng_note').value.trim(),
    synced: false
  };
  await DB.put('noahGrowth', rec);
  Sync.pushEntry('NoahGrowth', rec).then(() => DB.put('noahGrowth', rec));
  noahGrowthEditId = null;
  noahSection = 'growth';
  currentView = 'main';
  route();
}

function editNoahGrowth(id) { noahGrowthEditId = id; currentView = 'addNoahGrowth'; route(); }

async function deleteNoahGrowth(id) {
  if (!confirm('Delete this measurement?')) return;
  const rec = await DB.get('noahGrowth', id);
  rec.deleted = true; rec.synced = false;
  await DB.put('noahGrowth', rec);
  Sync.pushEntry('NoahGrowth', rec).then(() => DB.put('noahGrowth', rec));
  noahGrowthEditId = null;
  currentView = 'main';
  route();
}

// ---------- milestones ----------

async function renderNoahMilestones() {
  const all = (await getActiveNoahMilestones()).sort((a, b) => b.date.localeCompare(a.date));
  $main.innerHTML = `
    ${noahSectionSwitcher()}
    <button class="btn" style="margin-bottom:14px" onclick="noahFabAction()"><i class="ti ti-plus"></i> Add milestone or note</button>
    ${all.length ? all.map((m) => `<div class="thread-item" style="${m.kind === 'milestone' ? 'border-left-color:var(--gold)' : ''};cursor:pointer" onclick="editNoahMilestone('${m.id}')">
      <p class="meta">${fmtDateYear(m.date)} · ${m.kind === 'milestone' ? 'Milestone' : 'Note'}</p>
      ${m.title ? `<p class="note" style="font-weight:600">${esc(m.title)}</p>` : ''}
      ${m.note ? `<p class="note">${esc(m.note)}</p>` : ''}
      ${renderLinkPreviewList(m.photoLinks, 'Photo')}
    </div>`).join('') : '<div class="empty-state">Nothing here yet. Tap + to add a milestone or a note.</div>'}
  `;
}

async function renderAddNoahMilestone() {
  const existing = noahMilestoneEditId ? await DB.get('noahMilestones', noahMilestoneEditId) : null;
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goNoahMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${existing ? 'Edit' : 'Add'} milestone or note</span></div>
    <div class="field"><label class="field-label">Date</label><input type="date" id="nm_date" value="${existing ? existing.date : todayStr()}"></div>
    <label class="field-label">Type</label>
    <div class="btn-toggle-row" id="noahKindToggle">
      <button class="btn-toggle" onclick="selectNoahKind(this,'milestone')">Milestone</button>
      <button class="btn-toggle" onclick="selectNoahKind(this,'note')">Note</button>
    </div>
    <div class="field"><label class="field-label">Title</label><input id="nm_title" placeholder="Rode his bike without training wheels" value="${existing && existing.title ? esc(existing.title) : ''}"></div>
    <div class="field"><label class="field-label">Details</label><textarea id="nm_note" placeholder="Anything worth remembering">${existing && existing.note ? esc(existing.note) : ''}</textarea></div>
    ${renderExistingLinksGrid(existing && existing.photoLinks, 'noahMilestone', 'Existing photos (tap × to remove)')}
    <label class="field-label">Add photos</label>
    <div class="photo-grid" id="noahMilestonePhotoGrid">${renderPhotoGrid(noahMilestonePhotoDrafts, 'noahMilestone')}</div>
    <button class="btn btn-primary" id="saveNoahMilestoneBtn" onclick="saveNoahMilestone()">${existing ? 'Save changes' : 'Save'}</button>
    ${existing ? `<button class="btn" style="margin-top:10px;color:var(--red);border-color:var(--red-soft)" onclick="deleteNoahMilestone('${existing.id}')"><i class="ti ti-trash"></i> Delete</button>` : ''}
  `;
  const kindIdx = existing && existing.kind === 'note' ? 1 : 0;
  selectNoahKind(document.querySelectorAll('#noahKindToggle .btn-toggle')[kindIdx], existing ? existing.kind : 'milestone');
}
function selectNoahKind(btn, val) { if (!btn) return; btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral')); btn.classList.add('active-neutral'); window.__noahKind = val; }

async function saveNoahMilestone() {
  const btn = document.getElementById('saveNoahMilestoneBtn');
  if (pendingPhotoUploads.noahMilestone && pendingPhotoUploads.noahMilestone.length && btn) { btn.disabled = true; btn.textContent = 'Finishing photo upload…'; }
  await waitForPendingUploads('noahMilestone');
  if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  const title = document.getElementById('nm_title').value.trim();
  const note = document.getElementById('nm_note').value.trim();
  if (!title && !note) { alert('Add a title or some details first.'); return; }
  const existing = noahMilestoneEditId ? await DB.get('noahMilestones', noahMilestoneEditId) : null;
  const rec = {
    id: existing ? existing.id : uid(),
    date: document.getElementById('nm_date').value || todayStr(),
    kind: window.__noahKind || 'milestone',
    title, note,
    photos: [...noahMilestonePhotoDrafts],
    photoLinks: [...keptExistingLinks(existing && existing.photoLinks ? existing.photoLinks : [], 'noahMilestone'), ...photoUploadLinks.noahMilestone.filter(Boolean)],
    synced: false
  };
  await DB.put('noahMilestones', rec);
  Sync.pushEntry('NoahMilestones', rec).then(() => DB.put('noahMilestones', rec));
  noahMilestonePhotoDrafts = []; resetPhotoContext('noahMilestone');
  noahMilestoneEditId = null;
  noahSection = 'milestones';
  currentView = 'main';
  route();
}

function editNoahMilestone(id) {
  noahMilestoneEditId = id;
  noahMilestonePhotoDrafts = []; resetPhotoContext('noahMilestone');
  currentView = 'addNoahMilestone';
  route();
}

async function deleteNoahMilestone(id) {
  if (!confirm('Delete this?')) return;
  const rec = await DB.get('noahMilestones', id);
  rec.deleted = true; rec.synced = false;
  await DB.put('noahMilestones', rec);
  Sync.pushEntry('NoahMilestones', rec).then(() => DB.put('noahMilestones', rec));
  noahMilestoneEditId = null;
  currentView = 'main';
  route();
}

// ---------- photos ----------

// Both places Noah's photos live: health entries and milestones. A milestone tile is
// captioned with its title rather than a type, since that's what identifies it.
async function renderNoahPhotos() {
  const issues = await getActiveNoahIssues();
  const milestones = await getActiveNoahMilestones();
  const typeById = Object.fromEntries((await DB.getAll('noahIssueTypes')).map((t) => [t.id, t]));
  const photos = [];
  issues.forEach((issue) => {
    const label = (typeById[issue.typeId] || {}).name || 'Issue';
    (issue.photoLinks || []).forEach((link) => {
      if (!link || !link.isImage || !link.url) return;
      photos.push({ url: link.url, date: issue.startDate, label, onclick: `openNoahIssue('${issue.id}')` });
    });
    (issue.updates || []).forEach((u) => {
      (u.photoLinks || []).forEach((link) => {
        if (!link || !link.isImage || !link.url) return;
        photos.push({ url: link.url, date: u.date || issue.startDate, label, onclick: `openNoahIssue('${issue.id}')` });
      });
    });
  });
  milestones.forEach((m) => {
    (m.photoLinks || []).forEach((link) => {
      if (!link || !link.isImage || !link.url) return;
      photos.push({ url: link.url, date: m.date, label: m.title || (m.kind === 'note' ? 'Note' : 'Milestone'), onclick: `editNoahMilestone('${m.id}')` });
    });
  });
  $main.innerHTML = renderPhotoGallery(photos, "Noah's photos", 'goNoahMain()', 'No photos yet. Add one to an entry or a milestone and it\'ll show up here.');
}

// ---------- report ----------

async function renderNoahReport() {
  const issues = await getActiveNoahIssues();
  const types = await DB.getAll('noahIssueTypes');
  const typeById = Object.fromEntries(types.map((t) => [t.id, t]));
  const growth = (await getActiveNoahGrowth()).sort((a, b) => b.date.localeCompare(a.date));
  const year = todayStr().slice(0, 4);
  const thisYear = issues.filter((i) => i.startDate.startsWith(year));
  const sickDays = thisYear.filter((i) => i.missedSchool).length;
  const visits = thisYear.filter((i) => i.doctorVisit).length + thisYear.reduce((n, i) => n + (i.updates || []).filter((u) => u.doctorVisit).length, 0);

  const byType = {};
  thisYear.forEach((i) => { const name = (typeById[i.typeId] || {}).name || 'Other'; byType[name] = (byType[name] || 0) + 1; });
  const ranked = Object.entries(byType).sort((a, b) => b[1] - a[1]);

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goNoahMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Noah's health report</span></div>
    <div class="stat-grid">
      <div class="stat"><p class="label">Issues in ${year}</p><p class="value">${thisYear.length}</p></div>
      <div class="stat"><p class="label">Ongoing now</p><p class="value">${issues.filter((i) => i.status === 'ongoing').length}</p></div>
      <div class="stat"><p class="label">Doctor visits</p><p class="value">${visits}</p></div>
      <div class="stat"><p class="label">Days home sick</p><p class="value">${sickDays}</p></div>
    </div>
    <p class="section-title"><span>Most common this year</span></p>
    ${ranked.length ? ranked.map(([name, count]) => `<div class="list-row" style="cursor:default"><span>${esc(name)}</span><span>${count}</span></div>`).join('') : '<div class="empty-state">Nothing logged this year.</div>'}
    <p class="section-title"><span>Latest measurement</span></p>
    ${growth[0] ? `<div class="list-row" style="cursor:default"><span>${fmtDateYear(growth[0].date)}</span><span>${[growth[0].heightCm ? growth[0].heightCm + ' cm' : '', growth[0].weightLbs ? growth[0].weightLbs + ' lbs' : ''].filter(Boolean).join(' · ')}</span></div>` : '<div class="empty-state">No measurements yet.</div>'}
  `;
}
