// ============ GARAGE MODULE ============
let garageStatusTab = 'owned';
let garagePhotoDrafts = [];
let garageOwnershipDraft = null;
let currentVehicleId = null;
let garageReportKind = null; // 'owned' | 'flips'
let garageReportRange = 'all'; // '6m' | '1y' | 'all'
let garageReportVehicleFilter = null; // vehicle id, toggled via chart click
let garageReportMechDrill = false;

function goGarageMain() { currentView = 'main'; route(); }

async function computeVehicleTotals(vehicleId) {
  const costs = (await getActiveGarageCosts()).filter((c) => c.vehicleId === vehicleId);
  const vehicle = await DB.get('vehicles', vehicleId);
  const costSum = costs.reduce((s, c) => s + (c.totalCost || 0), 0);
  const totalSpent = (vehicle.boughtFor || 0) + costSum;
  const lastCost = costs.sort((a, b) => b.date.localeCompare(a.date))[0];
  const lastMileage = costs.filter((c) => c.mileage).sort((a, b) => (b.mileage||0) - (a.mileage||0))[0];
  const profit = vehicle.status === 'sold' ? (vehicle.soldFor || 0) - totalSpent : null;
  return { costs, costSum, totalSpent, lastCost, lastMileage: lastMileage ? lastMileage.mileage : null, profit };
}

async function renderGarageMain() {
  const vehicles = await DB.getAll('vehicles');
  const filtered = vehicles.filter((v) => (v.status || 'owned') === garageStatusTab);
  const ownedCount = vehicles.filter((v) => (v.status||'owned') === 'owned').length;
  const soldCount = vehicles.filter((v) => v.status === 'sold').length;

  const cards = await Promise.all(filtered.map(async (v) => {
    const t = await computeVehicleTotals(v.id);
    return `<div class="card tight" style="cursor:pointer" onclick="openVehicle('${v.id}')">
      <div style="width:100%;height:70px;background:var(--surface);border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:8px">
        ${v.photos && v.photos[0] ? `<img src="${v.photos[0]}" style="width:100%;height:100%;object-fit:cover;border-radius:10px">` : '<i class="ti ti-car" style="font-size:22px;color:var(--ink-soft)"></i>'}
      </div>
      <p style="font-size:13px;font-weight:600;margin:0">${esc(v.name)}</p>
      ${t.lastMileage ? `<p style="font-size:11px;color:var(--ink-soft);margin:2px 0 0">${t.lastMileage.toLocaleString()} km</p>` : ''}
      <p style="font-size:11px;color:var(--red);margin:2px 0 0">${fmtMoney(t.totalSpent)} spent</p>
    </div>`;
  }));

  $main.innerHTML = `
    <div class="chip-row">
      <button class="chip ${garageStatusTab==='owned'?'active':''}" onclick="switchGarageTab('owned')">Owned (${ownedCount})</button>
      <button class="chip ${garageStatusTab==='sold'?'active':''}" onclick="switchGarageTab('sold')">Sold (${soldCount})</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn" style="flex:1" onclick="goGarageAllRepairs()"><i class="ti ti-list"></i> All repairs</button>
      <button class="btn" style="flex:1" onclick="goGarageReport('owned')"><i class="ti ti-chart-bar"></i> Owned report</button>
    </div>
    <button class="btn" style="margin-bottom:14px" onclick="goGarageReport('flips')"><i class="ti ti-trending-up"></i> Flips report</button>
    <div class="search-box"><i class="ti ti-search"></i><input id="garageSearch" placeholder="Search vehicles..." oninput="filterGarageVehicles(this.value)"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px" id="garageGrid">${cards.join('') || '<div class="empty-state">No vehicles yet.</div>'}</div>
  `;
}
function switchGarageTab(t) { garageStatusTab = t; renderGarageMain(); }
async function filterGarageVehicles(q) {
  q = q.trim().toLowerCase();
  const grid = document.getElementById('garageGrid');
  const vehicles = (await DB.getAll('vehicles')).filter((v) => (v.status||'owned') === garageStatusTab && v.name.toLowerCase().includes(q));
  const cards = await Promise.all(vehicles.map(async (v) => {
    const t = await computeVehicleTotals(v.id);
    return `<div class="card tight" style="cursor:pointer" onclick="openVehicle('${v.id}')"><p style="font-size:13px;font-weight:600">${esc(v.name)}</p><p style="font-size:11px;color:var(--red)">${fmtMoney(t.totalSpent)} spent</p></div>`;
  }));
  grid.innerHTML = cards.join('') || '<div class="empty-state">No matches.</div>';
}

// ---------- Add / Edit vehicle ----------
let vehicleEditId = null;
function goAddVehicle() { vehicleEditId = null; garagePhotoDrafts = []; garagePhotoLinkDrafts = []; pendingPhotoUploads.garage = []; existingLinksRemoved.vehicle = []; garageOwnershipDraft = null; currentView = 'addVehicle'; route(); }
function goEditVehicle(id) { vehicleEditId = id; garagePhotoDrafts = []; garagePhotoLinkDrafts = []; pendingPhotoUploads.garage = []; existingLinksRemoved.vehicle = []; currentView = 'addVehicle'; route(); }
async function renderAddVehicle() {
  const existing = vehicleEditId ? await DB.get('vehicles', vehicleEditId) : null;
  if (existing) { garagePhotoDrafts = [...(existing.photos || [])]; garageOwnershipDraft = existing.ownershipDoc || null; }
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="${existing ? `openVehicle('${existing.id}')` : 'goGarageMain()'}"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${existing ? 'Edit' : 'Add'} vehicle</span></div>
    ${renderExistingLinksGrid(existing && existing.photoLinks, 'vehicle', 'Existing photos (tap × to remove)')}
    <label class="field-label">Add photos (up to 6)</label>
    <div class="photo-grid" id="garagePhotoGrid">${renderPhotoGrid(garagePhotoDrafts, 'garage')}</div>
    <label class="field-label">Ownership picture</label>
    <div class="photo-slot" style="width:100%;height:70px;margin-bottom:14px" onclick="document.getElementById('ownershipInput').click()">
      ${garageOwnershipDraft ? `<img src="${garageOwnershipDraft}">` : '<i class="ti ti-file-upload"></i>'}
    </div>
    <input type="file" id="ownershipInput" accept="image/*,.pdf" style="display:none" onchange="handleOwnershipUpload(event)">

    <div class="field-row" style="margin-bottom:14px"><div><label class="field-label">Year</label><input id="v_year" placeholder="2009" value="${existing ? esc(existing.year||'') : ''}"></div><div><label class="field-label">Make</label><input id="v_make" placeholder="Honda" value="${existing ? esc(existing.make||'') : ''}"></div></div>
    <div class="field-row" style="margin-bottom:14px"><div><label class="field-label">Model</label><input id="v_model" placeholder="Ridgeline" value="${existing ? esc(existing.model||'') : ''}"></div><div><label class="field-label">Trim</label><input id="v_trim" placeholder="Optional" value="${existing ? esc(existing.trim||'') : ''}"></div></div>
    <div class="field"><label class="field-label">VIN</label><input id="v_vin" placeholder="Optional" value="${existing ? esc(existing.vin||'') : ''}"></div>
    <label class="field-label">US or Canada</label>
    <div class="btn-toggle-row" id="usCanToggle"><button class="btn-toggle" onclick="selectSimpleToggle(this,'usCanToggle','usCan','Canadian')">Canadian</button><button class="btn-toggle" onclick="selectSimpleToggle(this,'usCanToggle','usCan','US')">US</button></div>
    <label class="field-label">Transmission</label>
    <div class="btn-toggle-row" id="transToggle"><button class="btn-toggle" onclick="selectSimpleToggle(this,'transToggle','trans','Manual')">Manual</button><button class="btn-toggle" onclick="selectSimpleToggle(this,'transToggle','trans','Automatic')">Automatic</button><button class="btn-toggle" onclick="selectSimpleToggle(this,'transToggle','trans','CVT')">CVT</button></div>
    <div class="field-row" style="margin-bottom:14px"><div><label class="field-label">Color</label><input id="v_color" placeholder="e.g. Red" value="${existing ? esc(existing.color||'') : ''}"></div><div><label class="field-label">Condition</label><input id="v_condition" placeholder="e.g. Rebuilt title" value="${existing ? esc(existing.condition||'') : ''}"></div></div>

    <div class="divider"></div>
    <p class="section-label">Bought from</p>
    <div class="field"><label class="field-label">Seller name</label><input id="v_sellerName" placeholder="Optional" value="${existing ? esc(existing.sellerName||'') : ''}"></div>
    <div class="field-row" style="margin-bottom:14px"><div><label class="field-label">Seller email</label><input id="v_sellerEmail" placeholder="Optional" value="${existing ? esc(existing.sellerEmail||'') : ''}"></div><div><label class="field-label">Seller phone</label><input id="v_sellerPhone" placeholder="Optional" value="${existing ? esc(existing.sellerPhone||'') : ''}"></div></div>
    <div class="field"><label class="field-label">Date bought</label><input type="date" id="v_dateBought" value="${existing ? existing.dateBought : todayStr()}"></div>
    <div class="field-row" style="margin-bottom:20px"><div><label class="field-label">Bought for</label><input type="number" step="0.01" id="v_boughtFor" placeholder="$0.00" value="${existing ? existing.boughtFor : ''}"></div><div><label class="field-label">Mileage bought at</label><input type="number" id="v_mileageBought" placeholder="km" value="${existing && existing.mileageBoughtAt ? existing.mileageBoughtAt : ''}"></div></div>

    <button class="btn btn-primary" id="saveVehicleBtn" onclick="saveVehicle()">${existing ? 'Save changes' : 'Add vehicle'}</button>
  `;
  window.__usCan = existing ? existing.usOrCanada : 'Canadian';
  window.__trans = existing ? existing.transmission : 'Automatic';
  selectSimpleToggle(document.querySelector(`#usCanToggle button:nth-child(${window.__usCan==='US'?2:1})`), 'usCanToggle', 'usCan', window.__usCan);
  const transIdx = window.__trans === 'Manual' ? 1 : window.__trans === 'CVT' ? 3 : 2;
  selectSimpleToggle(document.querySelector(`#transToggle button:nth-child(${transIdx})`), 'transToggle', 'trans', window.__trans);
}
function selectSimpleToggle(btn, groupId, key, val) {
  document.getElementById(groupId).querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral'));
  if (btn) btn.classList.add('active-neutral');
  window['__' + key] = val;
}
function handleOwnershipUpload(e) {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => { garageOwnershipDraft = reader.result; renderAddVehicle(); };
  reader.readAsDataURL(f);
}
async function saveVehicle() {
  const year = document.getElementById('v_year').value.trim();
  const make = document.getElementById('v_make').value.trim();
  const model = document.getElementById('v_model').value.trim();
  const trim = document.getElementById('v_trim').value.trim();
  const name = [year, make, model, trim].filter(Boolean).join(' ');
  if (!name) { alert('At least year, make, or model is needed.'); return; }
  const btn = document.getElementById('saveVehicleBtn');
  if (pendingPhotoUploads.garage && pendingPhotoUploads.garage.length && btn) {
    btn.disabled = true; btn.textContent = 'Finishing photo upload…';
  }
  await waitForPendingUploads('garage');
  if (btn) btn.disabled = false;
  const existing = vehicleEditId ? await DB.get('vehicles', vehicleEditId) : null;
  const vehicle = existing || { id: uid(), status: 'owned', soldFor: null, dateSold: null, buyerName: null, buyerPhone: null };
  Object.assign(vehicle, {
    name, year, make, model, trim,
    vin: document.getElementById('v_vin').value.trim(),
    usOrCanada: window.__usCan, transmission: window.__trans,
    color: document.getElementById('v_color').value.trim(),
    condition: document.getElementById('v_condition').value.trim(),
    photos: [...garagePhotoDrafts], ownershipDoc: garageOwnershipDraft,
    photoLinks: [...keptExistingLinks(existing && existing.photoLinks ? existing.photoLinks : [], 'vehicle'), ...garagePhotoLinkDrafts],
    sellerName: document.getElementById('v_sellerName').value.trim(),
    sellerEmail: document.getElementById('v_sellerEmail').value.trim(),
    sellerPhone: document.getElementById('v_sellerPhone').value.trim(),
    dateBought: document.getElementById('v_dateBought').value || todayStr(),
    boughtFor: parseFloat(document.getElementById('v_boughtFor').value) || 0,
    mileageBoughtAt: parseFloat(document.getElementById('v_mileageBought').value) || null,
    synced: false
  });
  await DB.put('vehicles', vehicle);
  const { photos, ownershipDoc, ...syncable } = vehicle; // photos/doc stay local-only; syncing base64 images would blow past Sheet cell limits
  Sync.pushEntry('Vehicles', syncable).then(() => { vehicle.synced = true; DB.put('vehicles', vehicle); });
  garagePhotoDrafts = []; garagePhotoLinkDrafts = []; existingLinksRemoved.vehicle = []; garageOwnershipDraft = null; vehicleEditId = null;
  currentView = existing ? 'vehicleDetail' : 'main'; route();
}

// ---------- Vehicle detail ----------
function openVehicle(id) { currentVehicleId = id; currentView = 'vehicleDetail'; route(); }
async function renderVehicleDetail() {
  const vehicle = await DB.get('vehicles', currentVehicleId);
  const t = await computeVehicleTotals(currentVehicleId);
  const expenseTypes = await DB.getAll('expenseTypes');
  const repairTypes = await DB.getAll('repairTypes');
  const typeById = Object.fromEntries(expenseTypes.map((e) => [e.id, e]));
  const repairById = Object.fromEntries(repairTypes.map((r) => [r.id, r]));

  const sortedCosts = [...t.costs].sort((a, b) => b.date.localeCompare(a.date));

  $main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div class="back" style="cursor:pointer" onclick="goGarageMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:16px;margin-left:6px">${esc(vehicle.name)}</span></div>
      <i class="ti ti-edit" style="font-size:18px;color:var(--ink-soft);cursor:pointer" onclick="goEditVehicle('${vehicle.id}')"></i>
    </div>
    <div style="width:100%;height:120px;background:var(--surface-raised);border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:14px">
      ${(() => {
        const heroLink = vehicle.photoLinks && vehicle.photoLinks.find((p) => p.isImage);
        const heroSrc = heroLink ? heroLink.url : (vehicle.photos && vehicle.photos[0]);
        return heroSrc ? `<img src="${heroSrc}" style="width:100%;height:100%;object-fit:contain;background:var(--surface-raised);border-radius:12px">` : '<i class="ti ti-car" style="font-size:28px;color:var(--ink-soft)"></i>';
      })()}
    </div>
    <span class="pill-sm ${vehicle.status==='owned'?'pill-resolved':''}" style="background:${vehicle.status==='owned'?'var(--sage-soft)':'var(--surface-raised)'};display:inline-block;margin-bottom:14px">${vehicle.status==='owned'?'Owned':'Sold'}</span>

    <div class="stat-grid">
      <div class="stat"><p class="label">Bought for</p><p class="value">${fmtMoney(vehicle.boughtFor)}</p></div>
      <div class="stat"><p class="label">${vehicle.status==='sold'?'Sold for':'Last mileage'}</p><p class="value">${vehicle.status==='sold' ? fmtMoney(vehicle.soldFor) : (t.lastMileage ? t.lastMileage.toLocaleString()+' km' : '—')}</p></div>
    </div>
    <div class="stat" style="margin-bottom:8px"><p class="label">Total spent</p><p class="value">${fmtMoney(t.totalSpent)}</p></div>
    ${vehicle.status==='sold' ? `<div class="stat" style="background:${t.profit>=0?'var(--sage-soft)':'var(--rose-soft)'};margin-bottom:14px"><p class="label">Profit / loss</p><p class="value" style="color:${t.profit>=0?'#0F6E56':'var(--red)'}">${t.profit>=0?'+':''}${fmtMoney(t.profit)}</p></div>` : ''}

    <div class="card tight">
      ${vehicle.vin ? `<div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">VIN</span><span style="font-size:12px">${esc(vehicle.vin)}</span></div>` : ''}
      ${vehicle.condition ? `<div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Condition</span><span style="font-size:12px">${esc(vehicle.condition)}</span></div>` : ''}
      <div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Date bought</span><span style="font-size:12px">${fmtDateFull(vehicle.dateBought)}</span></div>
    </div>
    ${renderLinkPreviewList(vehicle.photoLinks, 'Photo')}

    ${vehicle.status === 'owned' ? `<button class="btn" style="margin-bottom:10px" onclick="goSellVehicle()"><i class="ti ti-tag"></i> Mark as sold</button>` : `<div class="card tight"><div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Buyer</span><span style="font-size:12px">${esc(vehicle.buyerName||'—')}</span></div><div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Date sold</span><span style="font-size:12px">${fmtDate(vehicle.dateSold)}</span></div></div>`}

    <button class="btn btn-primary" style="margin-bottom:16px" onclick="goAddCost()"><i class="ti ti-plus"></i> Add a cost</button>

    <p class="section-label">Related costs (${sortedCosts.length})</p>
    ${sortedCosts.length ? (() => {
      const byMonth = {};
      sortedCosts.forEach((c) => { const mk = monthKey(c.date); (byMonth[mk] = byMonth[mk] || []).push(c); });
      const months = Object.keys(byMonth).sort().reverse();
      const controls = months.length > 1 ? collapseAllControls('relatedCostsList') : '';
      const body = months.map((mk, i) => {
        const monthCosts = byMonth[mk];
        const total = monthCosts.reduce((s, c) => s + (c.totalCost || 0), 0);
        const label = new Date(mk + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        return `
          <div class="section-title" style="cursor:pointer" onclick="toggleCollapse(this)">
            <span>${label} <i class="ti collapse-chevron ti-chevron-${i===0?'down':'right'}" style="font-size:11px;vertical-align:-1px"></i></span>
            <span class="amt neg">${fmtMoney(total)}</span>
          </div>
          <div class="collapse-body" style="display:${i===0?'block':'none'}">${monthCosts.map((c) => renderCostRow(c, typeById, repairById)).join('')}</div>
        `;
      }).join('');
      return controls + `<div id="relatedCostsList">${body}</div>`;
    })() : '<div class="empty-state">No costs logged yet.</div>'}
  `;
}
function renderCostRow(c, typeById, repairById) {
  const type = typeById[c.expenseTypeId] || {};
  const repair = c.repairTypeId ? (repairById[c.repairTypeId] || {}).name : '';
  return `<div class="entry-row" onclick="openCostDetail('${c.id}')">
    <div class="entry-icon"><i class="ti ${type.icon || 'ti-tool'}" style="color:var(--gold)"></i></div>
    <div class="entry-body">
      <div class="entry-top"><span class="entry-title">${esc(type.name||'')}${repair?' — '+esc(repair):''}${c.receiptLinks && c.receiptLinks.length ? ' <i class="ti ti-paperclip" style="font-size:12px;color:var(--ink-soft)"></i>' : ''}</span><span class="entry-value">${c.totalCost ? fmtMoney(c.totalCost) : '—'}</span></div>
      <div class="entry-meta">${fmtDate(c.date)}${c.mileage ? ' · '+c.mileage.toLocaleString()+' km' : ''}</div>
      ${c.comments ? `<div class="entry-desc">${esc(c.comments)}</div>` : ''}
    </div>
  </div>`;
}

let costDetailId = null;
async function openCostDetail(id) {
  costDetailId = id;
  const cost = await DB.get('garageCosts', id);
  const expenseTypes = await DB.getAll('expenseTypes');
  const repairTypes = await DB.getAll('repairTypes');
  const type = expenseTypes.find((t) => t.id === cost.expenseTypeId) || {};
  const repair = cost.repairTypeId ? (repairTypes.find((t) => t.id === cost.repairTypeId) || {}).name : '';
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:16px">${esc(type.name||'')}${repair?' — '+esc(repair):''}</p>
    <div class="card tight">
      <div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Date</span><span style="font-size:12px">${fmtDate(cost.date)}</span></div>
      <div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Cost</span><span style="font-size:12px">${cost.totalCost ? fmtMoney(cost.totalCost) : '—'}</span></div>
      ${cost.mileage ? `<div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Mileage</span><span style="font-size:12px">${cost.mileage.toLocaleString()} km</span></div>` : ''}
      ${cost.comments ? `<div class="list-row" style="cursor:default"><span style="color:var(--ink-soft);font-size:12px">Comments</span><span style="font-size:12px;text-align:right;max-width:60%">${esc(cost.comments)}</span></div>` : ''}
    </div>
    ${renderLinkPreviewList(cost.receiptLinks, 'Receipt')}
    <button class="btn" style="margin-bottom:10px" onclick="editCostFromDetail()"><i class="ti ti-edit"></i> Edit</button>
    <button class="btn" style="background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="deleteCostFromDetail()"><i class="ti ti-trash"></i> Delete</button>
  `;
  openModal();
}
function editCostFromDetail() {
  costEditId = costDetailId;
  garagePhotoDrafts = []; garage2PhotoLinkDrafts = []; pendingPhotoUploads.garage2 = []; existingLinksRemoved.cost = [];
  closeModal();
  currentView = 'addCost'; route();
}
async function deleteCostFromDetail() {
  if (!confirm('Delete this cost entry? This removes it everywhere it syncs to.')) return;
  const cost = await DB.get('garageCosts', costDetailId);
  cost.deleted = true;
  cost.synced = false;
  await DB.put('garageCosts', cost);
  const { photos, ...syncableCost } = cost;
  Sync.pushEntry('GarageCosts', syncableCost).then(() => { cost.synced = true; DB.put('garageCosts', cost); });
  closeModal();
  renderVehicleDetail();
}

// ---------- Add cost ----------
let costEditId = null;
function goAddCost() { costEditId = null; garagePhotoDrafts = []; garage2PhotoLinkDrafts = []; pendingPhotoUploads.garage2 = []; existingLinksRemoved.cost = []; currentView = 'addCost'; route(); }
async function renderAddCost() {
  const vehicle = await DB.get('vehicles', currentVehicleId);
  const expenseTypes = await DB.getAll('expenseTypes');
  const repairTypes = await DB.getAll('repairTypes');
  const places = await DB.getAll('garagePlaces');
  const existing = costEditId ? await DB.get('garageCosts', costEditId) : null;
  if (existing) garagePhotoDrafts = [...(existing.photos || [])];

  $main.innerHTML = `
    <div class="back" style="margin-bottom:6px;cursor:pointer" onclick="${existing ? `openVehicle('${currentVehicleId}')` : `openVehicle('${currentVehicleId}')`}"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${existing ? 'Edit' : 'Add'} a cost</span></div>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:14px">${esc(vehicle.name)}</p>
    <div class="field"><label class="field-label">Date</label><input type="date" id="c_date" value="${existing ? existing.date : todayStr()}"></div>
    <div class="field"><label class="field-label">Expense type</label>
      <select id="c_expenseType" onchange="onExpenseTypeChange()">
        ${expenseTypes.map((t) => `<option value="${t.id}" data-repair="${t.hasRepairSubtype?1:0}" ${existing && existing.expenseTypeId===t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        <option value="__new">+ Add expense type</option>
      </select>
    </div>
    <div id="repairTypeArea"></div>
    <div class="field"><label class="field-label">Total cost</label><input type="number" step="0.01" id="c_cost" placeholder="$0.00 (optional)" value="${existing && existing.totalCost ? existing.totalCost : ''}"></div>
    <div class="field"><label class="field-label">Mileage</label><input type="number" id="c_mileage" placeholder="km at time of service" value="${existing && existing.mileage ? existing.mileage : ''}"></div>
    <div class="field"><label class="field-label">Place</label>
      <div style="display:flex;gap:6px">
        <select id="c_place" style="flex:1">
          ${places.map((p) => `<option value="${p.id}" ${existing && existing.place===p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn" style="width:44px;flex-shrink:0;padding:0" onclick="openGaragePlaceModal()"><i class="ti ti-plus"></i></button>
      </div>
    </div>
    <div class="field"><label class="field-label">Comments</label><textarea id="c_comments" placeholder="What was done, what to check next time...">${existing ? esc(existing.comments||'') : ''}</textarea></div>
    ${renderExistingLinksGrid(existing && existing.receiptLinks, 'cost', 'Existing receipts (tap × to remove)')}
    <label class="field-label">Add receipt & photos</label>
    <div class="photo-grid" id="garage2PhotoGrid">${renderPhotoGrid(garagePhotoDrafts, 'garage2')}</div>
    <button class="btn btn-primary" id="saveCostBtn" onclick="saveCost()">${existing ? 'Save changes' : 'Save cost'}</button>
  `;
  window.__repairTypesCache = repairTypes;
  window.__expenseTypesCache = expenseTypes;
  onExpenseTypeChange();
  if (existing && existing.repairTypeId) setTimeout(() => { const sel = document.getElementById('c_repairType'); if (sel) sel.value = existing.repairTypeId; }, 0);
}
function onExpenseTypeChange() {
  const sel = document.getElementById('c_expenseType');
  const val = sel.value;
  if (val === '__new') { openGarageExpenseTypeModal(); return; }
  const opt = sel.selectedOptions[0];
  const area = document.getElementById('repairTypeArea');
  if (opt && opt.dataset.repair === '1') {
    area.innerHTML = `<div class="card tight" style="background:var(--surface)"><label class="field-label"><i class="ti ti-settings"></i> Repair type</label><div style="display:flex;gap:6px"><select id="c_repairType" style="flex:1">${(window.__repairTypesCache||[]).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select><button type="button" class="btn" style="width:44px;flex-shrink:0;padding:0" onclick="openGarageRepairTypeModal()"><i class="ti ti-plus"></i></button></div></div>`;
  } else {
    area.innerHTML = '';
  }
}

// ---------- Modal forms for expense type / repair type / place ----------
function openGarageExpenseTypeModal() {
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:16px">Add expense type</p>
    <div class="field"><label class="field-label">Name</label><input id="get_name" placeholder="e.g. Detailing"></div>
    <label class="field-label">Needs a repair subtype dropdown?</label>
    <div class="btn-toggle-row" id="getRepairToggle">
      <button type="button" class="btn-toggle active-neutral" onclick="selectGetRepair(this,false)">No</button>
      <button type="button" class="btn-toggle" onclick="selectGetRepair(this,true)">Yes</button>
    </div>
    <button class="btn btn-primary" onclick="saveGarageExpenseType()">Save</button>
  `;
  window.__getHasRepair = false;
  openModal();
}
function selectGetRepair(btn, val) {
  btn.parentElement.querySelectorAll('.btn-toggle').forEach((b) => b.classList.remove('active-neutral'));
  btn.classList.add('active-neutral');
  window.__getHasRepair = val;
}
async function saveGarageExpenseType() {
  const name = document.getElementById('get_name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  const t = { id: uid(), name, icon: 'ti-tool', hasRepairSubtype: !!window.__getHasRepair, synced: false };
  await DB.put('expenseTypes', t);
  Sync.pushEntry('ExpenseTypes', t).then(() => DB.put('expenseTypes', t));
  closeModal();
  renderAddCost().then(() => { const sel = document.getElementById('c_expenseType'); if (sel) { sel.value = t.id; onExpenseTypeChange(); } });
}
function openGarageRepairTypeModal() {
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:16px">Add repair type</p>
    <div class="field"><label class="field-label">Name</label><input id="grt_name" placeholder="e.g. Timing belt"></div>
    <button class="btn btn-primary" onclick="saveGarageRepairType()">Save</button>
  `;
  openModal();
}
async function saveGarageRepairType() {
  const name = document.getElementById('grt_name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  const t = { id: uid(), name, synced: false };
  await DB.put('repairTypes', t);
  Sync.pushEntry('RepairTypes', t).then(() => DB.put('repairTypes', t));
  closeModal();
  renderAddCost().then(() => { onExpenseTypeChange(); setTimeout(() => { const sel = document.getElementById('c_repairType'); if (sel) sel.value = t.id; }, 0); });
}
function openGaragePlaceModal() {
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p style="font-family:'Fraunces',serif;font-size:17px;font-weight:600;margin-bottom:16px">Add place</p>
    <div class="field"><label class="field-label">Name</label><input id="gp_name" placeholder="e.g. Canadian Tire"></div>
    <button class="btn btn-primary" onclick="saveGaragePlace()">Save</button>
  `;
  openModal();
}
async function saveGaragePlace() {
  const name = document.getElementById('gp_name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  const p = { id: uid(), name, synced: false };
  await DB.put('garagePlaces', p);
  Sync.pushEntry('Places', p).then(() => DB.put('garagePlaces', p));
  closeModal();
  renderAddCost().then(() => { const sel = document.getElementById('c_place'); if (sel) sel.value = p.id; });
}

async function saveCost() {
  const btn = document.getElementById('saveCostBtn');
  if (pendingPhotoUploads.garage2 && pendingPhotoUploads.garage2.length && btn) {
    btn.disabled = true; btn.textContent = 'Finishing photo upload…';
  }
  await waitForPendingUploads('garage2');
  if (btn) btn.disabled = false;
  const repairSel = document.getElementById('c_repairType');
  const cost = costEditId ? await DB.get('garageCosts', costEditId) : { id: uid(), vehicleId: currentVehicleId };
  Object.assign(cost, {
    date: document.getElementById('c_date').value || todayStr(),
    expenseTypeId: document.getElementById('c_expenseType').value,
    repairTypeId: repairSel ? repairSel.value : null,
    totalCost: parseFloat(document.getElementById('c_cost').value) || 0,
    mileage: parseFloat(document.getElementById('c_mileage').value) || null,
    place: document.getElementById('c_place').value,
    comments: document.getElementById('c_comments').value.trim(),
    photos: [...garagePhotoDrafts],
    receiptLinks: [...keptExistingLinks(cost.receiptLinks || [], 'cost'), ...garage2PhotoLinkDrafts],
    synced: false
  });
  await DB.put('garageCosts', cost);
  const { photos, ...syncableCost } = cost;
  Sync.pushEntry('GarageCosts', syncableCost).then(() => { cost.synced = true; DB.put('garageCosts', cost); });
  garagePhotoDrafts = []; garage2PhotoLinkDrafts = []; existingLinksRemoved.cost = []; costEditId = null;
  currentView = 'vehicleDetail'; route();
}

// ---------- Sell vehicle ----------
function goSellVehicle() { currentView = 'sellVehicle'; route(); }
async function renderSellVehicle() {
  const vehicle = await DB.get('vehicles', currentVehicleId);
  const t = await computeVehicleTotals(currentVehicleId);
  $main.innerHTML = `
    <div class="back" style="margin-bottom:6px;cursor:pointer" onclick="openVehicle('${currentVehicleId}')"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Mark as sold</span></div>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:14px">${esc(vehicle.name)}</p>
    <div class="field"><label class="field-label">Sold for</label><input type="number" step="0.01" id="s_soldFor" oninput="updateSellPreview(${t.totalSpent})" placeholder="$0.00"></div>
    <div class="field"><label class="field-label">Date sold</label><input type="date" id="s_dateSold" value="${todayStr()}"></div>
    <div class="field"><label class="field-label">Buyer name</label><input id="s_buyerName" placeholder="Optional"></div>
    <div class="field"><label class="field-label">Buyer phone</label><input id="s_buyerPhone" placeholder="Optional"></div>
    <div class="card tight" id="sellPreview">
      <p style="font-size:11px;color:var(--ink-soft);margin-bottom:8px">Preview</p>
      <div class="list-row" style="cursor:default"><span style="font-size:12px">Total spent</span><span style="font-size:12px">${fmtMoney(t.totalSpent)}</span></div>
      <div class="list-row" style="cursor:default"><span style="font-size:12px;font-weight:600">Profit</span><span id="profitPreview" style="font-size:12px;font-weight:600">$0.00</span></div>
    </div>
    <button class="btn btn-primary" onclick="confirmSale(${t.totalSpent})">Confirm sale</button>
  `;
}
function updateSellPreview(totalSpent) {
  const soldFor = parseFloat(document.getElementById('s_soldFor').value) || 0;
  const profit = soldFor - totalSpent;
  const el = document.getElementById('profitPreview');
  el.textContent = (profit>=0?'+':'') + fmtMoney(profit);
  el.style.color = profit>=0 ? '#0F6E56' : 'var(--red)';
}
async function confirmSale(totalSpent) {
  const vehicle = await DB.get('vehicles', currentVehicleId);
  vehicle.status = 'sold';
  vehicle.soldFor = parseFloat(document.getElementById('s_soldFor').value) || 0;
  vehicle.dateSold = document.getElementById('s_dateSold').value || todayStr();
  vehicle.buyerName = document.getElementById('s_buyerName').value.trim();
  vehicle.buyerPhone = document.getElementById('s_buyerPhone').value.trim();
  await DB.put('vehicles', vehicle);
  const { photos, ownershipDoc, ...syncable } = vehicle;
  Sync.pushEntry('Vehicles', syncable).then(() => { vehicle.synced = true; DB.put('vehicles', vehicle); });
  currentView = 'vehicleDetail'; route();
}

// ---------- All Repairs ----------
function goGarageAllRepairs() { currentView = 'allRepairs'; route(); }
async function renderAllRepairs() {
  const costs = (await getActiveGarageCosts()).sort((a, b) => b.date.localeCompare(a.date));
  const vehicles = await DB.getAll('vehicles');
  const expenseTypes = await DB.getAll('expenseTypes');
  const repairTypes = await DB.getAll('repairTypes');
  const vById = Object.fromEntries(vehicles.map((v) => [v.id, v]));
  const typeById = Object.fromEntries(expenseTypes.map((t) => [t.id, t]));
  const repairById = Object.fromEntries(repairTypes.map((r) => [r.id, r]));

  const byCar = {};
  costs.forEach((c) => { (byCar[c.vehicleId] = byCar[c.vehicleId] || []).push(c); });
  const carIds = Object.keys(byCar).sort((a, b) => (vById[a]?.name||'').localeCompare(vById[b]?.name||''));

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goGarageMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">All repairs</span></div>
    <div class="search-box"><i class="ti ti-search"></i><input placeholder="Search comments, place, type..." oninput="filterAllRepairs(this.value)"></div>
    ${collapseAllControls('allRepairsList')}
    <div id="allRepairsList">${carIds.map((vid, i) => {
      const carCosts = byCar[vid];
      const total = carCosts.reduce((s, c) => s + (c.totalCost || 0), 0);
      const vehicle = vById[vid];
      return `
        <div class="section-title" style="cursor:pointer" onclick="toggleCollapse(this)">
          <span>${esc(vehicle ? vehicle.name : 'Unknown vehicle')} <i class="ti collapse-chevron ti-chevron-${i===0?'down':'right'}" style="font-size:11px;vertical-align:-1px"></i></span>
          <span class="amt neg">${fmtMoney(total)}</span>
        </div>
        <div class="collapse-body" style="display:${i===0?'block':'none'}">${carCosts.map((c) => renderAllRepairsRow(c, vehicle, typeById, repairById)).join('')}</div>
      `;
    }).join('') || '<div class="empty-state">No costs logged yet.</div>'}</div>
  `;
}
function renderAllRepairsRow(c, vehicle, typeById, repairById) {
  const type = typeById[c.expenseTypeId] || {};
  const repair = c.repairTypeId ? (repairById[c.repairTypeId]||{}).name : '';
  return `<div class="entry-row" onclick="openCostDetail('${c.id}')"><div class="entry-icon"><i class="ti ${type.icon||'ti-tool'}" style="color:var(--gold)"></i></div>
    <div class="entry-body"><div class="entry-top"><span class="entry-title">${esc(type.name||'')}${repair?' — '+esc(repair):''}${c.receiptLinks && c.receiptLinks.length ? ' <i class="ti ti-paperclip" style="font-size:12px;color:var(--ink-soft)"></i>' : ''}</span><span class="entry-value">${c.totalCost?fmtMoney(c.totalCost):'—'}</span></div>
    <div class="entry-meta">${fmtDate(c.date)}${c.mileage ? ' · '+c.mileage.toLocaleString()+' km' : ''}</div>
    ${c.comments ? `<div class="entry-desc">${esc(c.comments)}</div>` : ''}</div></div>`;
}
function toggleMonthSection(el) {
  const body = el.nextElementSibling;
  const icon = el.querySelector('i');
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  icon.className = 'ti ti-chevron-' + (open ? 'right' : 'down');
}
async function filterAllRepairs(q) {
  q = q.trim().toLowerCase();
  const costs = (await getActiveGarageCosts()).sort((a, b) => b.date.localeCompare(a.date));
  const vehicles = await DB.getAll('vehicles');
  const expenseTypes = await DB.getAll('expenseTypes');
  const repairTypes = await DB.getAll('repairTypes');
  const vById = Object.fromEntries(vehicles.map((v) => [v.id, v]));
  const typeById = Object.fromEntries(expenseTypes.map((t) => [t.id, t]));
  const repairById = Object.fromEntries(repairTypes.map((r) => [r.id, r]));
  const filtered = costs.filter((c) => {
    const v = vById[c.vehicleId] || {}; const t = typeById[c.expenseTypeId] || {};
    return `${v.name||''} ${t.name||''} ${c.comments||''}`.toLowerCase().includes(q);
  });
  document.getElementById('allRepairsList').innerHTML = filtered.length ? filtered.map((c) => renderAllRepairsRow(c, vById[c.vehicleId], typeById, repairById)).join('') : '<div class="empty-state">No matches.</div>';
}

// ---------- Reports ----------
function goGarageReport(kind) { garageReportKind = kind; garageReportRange = 'all'; garageReportVehicleFilter = null; garageReportMechDrill = false; currentView = 'garageReport'; route(); }

function withinRange(dateStr, range) {
  if (range === 'all') return true;
  const d = new Date(dateStr);
  const now = new Date();
  const months = range === '3m' ? 3 : range === '6m' ? 6 : 12;
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
  return d >= cutoff;
}

async function renderGarageReport() {
  const vehicles = await DB.getAll('vehicles');
  const costs = await getActiveGarageCosts();
  const expenseTypes = await DB.getAll('expenseTypes');
  const repairTypes = await DB.getAll('repairTypes');
  const typeById = Object.fromEntries(expenseTypes.map((t) => [t.id, t]));

  const isFlips = garageReportKind === 'flips';
  let relevantVehicles = vehicles.filter((v) => (isFlips ? v.status === 'sold' : (v.status||'owned') === 'owned'));
  if (isFlips) relevantVehicles = relevantVehicles.filter((v) => withinRange(v.dateSold, garageReportRange));

  const vIds = new Set(relevantVehicles.map((v) => v.id));
  let relevantCosts = costs.filter((c) => vIds.has(c.vehicleId));
  if (!isFlips) relevantCosts = relevantCosts.filter((c) => withinRange(c.date, garageReportRange));
  if (garageReportVehicleFilter) relevantCosts = relevantCosts.filter((c) => c.vehicleId === garageReportVehicleFilter);

  const vehicleSpend = {};
  relevantVehicles.forEach((v) => { vehicleSpend[v.id] = v.boughtFor || 0; });
  costs.filter((c) => vIds.has(c.vehicleId)).forEach((c) => { vehicleSpend[c.vehicleId] = (vehicleSpend[c.vehicleId]||0) + (c.totalCost||0); });

  const typeSpend = {};
  relevantCosts.forEach((c) => { const n = (typeById[c.expenseTypeId]||{}).name || 'Other'; typeSpend[n] = (typeSpend[n]||0) + (c.totalCost||0); });

  const totalSpent = Object.values(vehicleSpend).reduce((s,v)=>s+v,0);
  const totalProfit = isFlips ? relevantVehicles.reduce((s,v)=>s+((v.soldFor||0)-vehicleSpend[v.id]),0) : null;

  const header = `<div class="back" style="margin-bottom:6px;cursor:pointer" onclick="goGarageMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${isFlips?'Flips':'Owned vehicles'} report</span></div>`;
  const rangeChips = `<div class="chip-row">
    <button class="chip ${garageReportRange==='6m'?'active':''}" onclick="setGarageRange('6m')">6M</button>
    <button class="chip ${garageReportRange==='1y'?'active':''}" onclick="setGarageRange('1y')">1Y</button>
    <button class="chip ${garageReportRange==='all'?'active':''}" onclick="setGarageRange('all')">All time</button>
  </div>`;

  const statGrid = isFlips
    ? `<div class="stat-grid"><div class="stat"><p class="label">Total spent</p><p class="value">${fmtMoney(totalSpent)}</p></div><div class="stat" style="background:${totalProfit>=0?'var(--sage-soft)':'var(--rose-soft)'}"><p class="label">Total profit</p><p class="value" style="color:${totalProfit>=0?'#0F6E56':'var(--red)'}">${totalProfit>=0?'+':''}${fmtMoney(totalProfit)}</p></div></div>`
    : `<div class="stat-grid"><div class="stat"><p class="label">Total spent</p><p class="value">${fmtMoney(totalSpent)}</p></div><div class="stat"><p class="label">Vehicles</p><p class="value">${relevantVehicles.length}</p></div></div>`;

  const vehicleList = Object.entries(vehicleSpend).sort((a,b) => isFlips ? 0 : b[1]-a[1]);
  const vehicleListRows = relevantVehicles
    .map((v) => ({ v, spend: vehicleSpend[v.id], profit: isFlips ? (v.soldFor||0)-vehicleSpend[v.id] : null }))
    .sort((a,b) => isFlips ? b.profit - a.profit : b.spend - a.spend)
    .map((r) => `<div class="list-row" onclick="openVehicle('${r.v.id}')"><span>${esc(r.v.name)}</span><span style="font-weight:600;${isFlips?`color:${r.profit>=0?'#0F6E56':'var(--red)'}`:''}">${isFlips ? (r.profit>=0?'+':'')+fmtMoney(r.profit) : fmtMoney(r.spend)}</span></div>`).join('');

  $main.innerHTML = `
    ${header}
    ${isFlips ? rangeChips : rangeChips}
    ${statGrid}
    <p class="section-label">Spend by vehicle <span style="font-weight:400;color:var(--ink-soft);font-size:11px">· tap a bar to filter</span></p>
    <div style="position:relative;width:100%;height:${Math.max(120, relevantVehicles.length*36)}px;margin-bottom:20px"><canvas id="garageVehicleChart"></canvas></div>
    <p class="section-label">Spend by expense type <span style="font-weight:400;color:var(--ink-soft);font-size:11px">· tap Mechanical repairs to drill in</span></p>
    <div style="position:relative;width:100%;height:${Math.max(120, Object.keys(typeSpend).length*36)}px;margin-bottom:${garageReportMechDrill?'12px':'20px'}"><canvas id="garageTypeChart"></canvas></div>
    ${garageReportMechDrill ? renderMechDrillChart(relevantCosts, repairTypes) : ''}
    <p class="section-label">${isFlips?'Vehicles by profit':'Vehicles by spend'}</p>
    ${vehicleListRows || '<div class="empty-state">No vehicles in range.</div>'}
  `;

  drawGarageVehicleChart(relevantVehicles, vehicleSpend, isFlips);
  drawGarageTypeChart(typeSpend);
}

function renderMechDrillChart(costs, repairTypes) {
  return `<div style="position:relative;width:100%;height:${Math.max(120, repairTypes.length*30)}px;margin-bottom:20px"><canvas id="garageMechChart"></canvas></div>`;
}

function setGarageRange(r) { garageReportRange = r; renderGarageReport(); }

let gVehicleChart, gTypeChart, gMechChart;
function drawGarageVehicleChart(vehicles, vehicleSpend, isFlips) {
  const ctx = document.getElementById('garageVehicleChart');
  if (!ctx || !window.Chart) return;
  if (gVehicleChart) gVehicleChart.destroy();
  const labels = vehicles.map((v) => v.name);
  const data = vehicles.map((v) => vehicleSpend[v.id]);
  const colors = vehicles.map((v) => (garageReportVehicleFilter === v.id ? '#eb6834' : '#e0dfd8'));
  gVehicleChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: garageReportVehicleFilter ? colors : '#eb6834', borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: (v) => '$' + Math.round(v/1000) + 'k' } } },
      onClick: (evt, els) => {
        if (!els.length) return;
        const v = vehicles[els[0].index];
        garageReportVehicleFilter = garageReportVehicleFilter === v.id ? null : v.id;
        renderGarageReport();
      }
    }
  });
}
function drawGarageTypeChart(typeSpend) {
  const ctx = document.getElementById('garageTypeChart');
  if (!ctx || !window.Chart) return;
  if (gTypeChart) gTypeChart.destroy();
  const labels = Object.keys(typeSpend);
  const data = Object.values(typeSpend);
  const colors = labels.map((l) => (garageReportMechDrill && l === 'Mechanical repairs' ? '#2a78d6' : '#e0dfd8'));
  gTypeChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: garageReportMechDrill ? colors : '#2a78d6', borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: (v) => '$' + Math.round(v/1000) + 'k' } } },
      onClick: (evt, els) => {
        if (!els.length) return;
        const label = labels[els[0].index];
        if (label === 'Mechanical repairs') { garageReportMechDrill = !garageReportMechDrill; renderGarageReport(); }
      }
    }
  });
  if (garageReportMechDrill) drawMechChart();
}
async function drawMechChart() {
  const ctx = document.getElementById('garageMechChart');
  if (!ctx || !window.Chart) return;
  const costs = await getActiveGarageCosts();
  const repairTypes = await DB.getAll('repairTypes');
  const expenseTypes = await DB.getAll('expenseTypes');
  const mechType = expenseTypes.find((t) => t.name === 'Mechanical repairs');
  const repairById = Object.fromEntries(repairTypes.map((r) => [r.id, r]));
  let mechCosts = costs.filter((c) => c.expenseTypeId === (mechType||{}).id);
  if (garageReportVehicleFilter) mechCosts = mechCosts.filter((c) => c.vehicleId === garageReportVehicleFilter);
  const byRepair = {};
  mechCosts.forEach((c) => { const n = (repairById[c.repairTypeId]||{}).name || 'Other'; byRepair[n] = (byRepair[n]||0) + (c.totalCost||0); });
  if (gMechChart) gMechChart.destroy();
  gMechChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: Object.keys(byRepair), datasets: [{ data: Object.values(byRepair), backgroundColor: '#eb6834', borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: (v) => '$' + Math.round(v/1000) + 'k' } } } }
  });
}
