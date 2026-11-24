// ============ DEBTS ============
// What's owed, where it lives, and the fastest way to get rid of it. Built around how
// the debt actually gets managed: 0% balance-transfer promos that must be moved before
// they jump to 18–23%, lines of credit with intro rates, and extra money always going to
// whatever is costing the most right now. The mortgage is deliberately not part of this.
//
// Local stores and the Sheet tabs they sync to:
//   debts        -> Debts         one row per account (line of credit, card, loan)
//   debtActivity -> DebtActivity  starting balances, balance checks, manual payments,
//                                 charges, and balance moves between accounts
//
// A debt's balance is never stored as a single number. It's worked out from the most
// recent balance check (or the starting balance), then everything after it: payments
// logged in Finance against the debt (category with the "Debt" extra field), manual
// payments, charges and fees, and money moved in or out. So editing or deleting a
// Finance payment fixes the balance by itself.
//
// Rates are a list of periods, each { from, rate, promo }. The current rate is the last
// period that has started; a future period is a scheduled change (an intro rate ending,
// a 0% promo ending). That one list covers rate history, intro rates and promos alike.

let debtCurrentId = null;      // debt open in the detail view
let debtEditId = null;         // debt being edited in the form, or null for a new one
let debtFormDraft = null;      // the debt form's working copy, kept across re-renders
let debtMoveDraft = null;      // Move balance form
let debtOfferDraft = null;     // New 0% offer form
let debtShowClosed = false;

const DEBT_KINDS = {
  loc: { label: 'Line of credit', icon: 'ti-building-bank' },
  card: { label: 'Credit card', icon: 'ti-credit-card' },
  loan: { label: 'Loan', icon: 'ti-receipt' },
  other: { label: 'Other', icon: 'ti-cash' }
};
const DEBT_HOLDERS = ['Nassim', 'Safia'];
const DEBT_ALERT_DAYS = 120;   // promo ends / rate changes shown at the top this far ahead
const DEBT_EPS = 0.005;

// ---------- small date helpers ----------
function debtAddMonths(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
function debtAddDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function debtDaysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
function debtMonthLabel(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
function debtPct(r) {
  const v = Number(r) || 0;
  return (Math.round(v * 100) / 100).toString() + '%';
}
function debtMoney0(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString();
}

// ---------- data ----------
async function getActiveDebts() { return (await DB.getAll('debts')).filter((r) => !r.deleted); }
async function getActiveDebtActivity() { return (await DB.getAll('debtActivity')).filter((r) => !r.deleted); }

function debtName(d) {
  if (!d) return 'Unknown debt';
  return d.name + (d.last4 ? ' ••' + d.last4 : '');
}
function debtIcon(d) { return (DEBT_KINDS[d && d.kind] || DEBT_KINDS.other).icon; }

function debtSortedRates(d) {
  return (Array.isArray(d.rates) ? d.rates : [])
    .filter((p) => p && p.from && p.rate !== '' && p.rate !== null && !isNaN(Number(p.rate)))
    .map((p) => ({ from: p.from, rate: Number(p.rate), promo: !!p.promo }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}
// The period in force on a date. Before the first period starts, the first one applies.
function debtRateAt(d, dateStr) {
  const rates = debtSortedRates(d);
  if (!rates.length) return { from: null, rate: 0, promo: false };
  let cur = rates[0];
  for (const p of rates) if (p.from <= dateStr) cur = p;
  return cur;
}
function debtSettledRate(d) {
  const rates = debtSortedRates(d);
  return rates.length ? rates[rates.length - 1].rate : 0;
}
function debtNextChange(d, dateStr) {
  return debtSortedRates(d).find((p) => p.from > dateStr) || null;
}
// "0% until Mar 3, 2027 → 17.99%" style summary of where the rate is headed.
function debtRateText(d, today) {
  const cur = debtRateAt(d, today);
  const next = debtNextChange(d, today);
  if (!debtSortedRates(d).length) return 'No rate set';
  if (next) {
    return `${debtPct(cur.rate)}${cur.promo ? ' promo' : ''} → ${debtPct(next.rate)} on ${fmtDateYear(next.from)}`;
  }
  return debtPct(cur.rate) + (cur.promo ? ' promo' : '');
}
function debtMinText(d) {
  if (d.minInterestOnly) return 'Interest-only minimum';
  if (Number(d.minPayment) > 0) return fmtMoney(d.minPayment) + '/mo minimum';
  return '';
}

// How a Finance entry moves a debt: an expense paid toward it lowers it, a refund on
// that category (negative amount) raises it. Transfers follow their direction.
function debtFinanceEffect(e) {
  const amt = Number(e.amount) || 0;
  if (e.type === 'transfer') return e.transferDirection === 'in' ? amt : -amt;
  if (e.type === 'income') return amt;
  return -amt;
}
function debtActivityEffect(a) {
  const amt = Number(a.amount) || 0;
  if (a.kind === 'payment' || a.kind === 'moveOut') return -amt;
  if (a.kind === 'charge' || a.kind === 'fee' || a.kind === 'interest' || a.kind === 'moveIn') return amt;
  return 0;
}
const DEBT_ACTIVITY_LABELS = {
  start: 'Starting balance', balance: 'Balance check', payment: 'Payment', charge: 'Charge', fee: 'Fee', interest: 'Interest charged', moveOut: 'Moved out', moveIn: 'Moved in'
};
// Within one day, order by when it was recorded, so a balance check entered after a
// same-day payment already includes it and one entered before doesn't.
function debtItemStamp(item) {
  // A Finance entry with no write stamp yet (just saved, not synced) is the newest thing there is.
  if (item.src === 'finance') return Number(item.rec._mt) || Number.MAX_SAFE_INTEGER;
  return item.rec.createdAt ? new Date(item.rec.createdAt).getTime() : (Number(item.rec._mt) || 0);
}

// Every activity row and linked Finance entry for one debt, oldest first, each with
// the running balance after it.
function debtTimeline(d, activity, financeEntries) {
  const items = [];
  activity.filter((a) => a.debtId === d.id).forEach((a) => items.push({ src: 'activity', rec: a, date: a.date }));
  financeEntries.filter((e) => e.debtId === d.id).forEach((e) => items.push({ src: 'finance', rec: e, date: e.date }));
  items.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : debtItemStamp(x) - debtItemStamp(y)));
  let bal = 0, asOf = null, started = false;
  items.forEach((it) => {
    if (it.src === 'activity' && (it.rec.kind === 'start' || it.rec.kind === 'balance')) {
      bal = Number(it.rec.amount) || 0; asOf = it.date; started = true;
      it.effect = null;
    } else {
      it.effect = it.src === 'finance' ? debtFinanceEffect(it.rec) : debtActivityEffect(it.rec);
      bal += it.effect;
    }
    it.balanceAfter = bal;
  });
  return { items, balance: Math.round(bal * 100) / 100, asOf, started };
}

async function loadDebtState() {
  const [debts, activity, entries] = await Promise.all([getActiveDebts(), getActiveDebtActivity(), DB.getAll('entries')]);
  const linked = entries.filter((e) => !e.deleted && e.debtId);
  const today = todayStr();
  const rows = debts.map((d) => {
    const tl = debtTimeline(d, activity, linked);
    const cur = debtRateAt(d, today);
    const limit = Number(d.limit) || 0;
    return {
      debt: d, timeline: tl, balance: tl.balance, rateNow: cur.rate, promoNow: cur.promo,
      next: debtNextChange(d, today), limit,
      room: limit > 0 ? Math.max(0, limit - Math.max(tl.balance, 0)) : 0
    };
  });
  return { debts: rows, activity, linked, today };
}

// ---------- saving ----------
async function saveDebtRec(rec) {
  rec.synced = false;
  await DB.put('debts', rec);
  Sync.pushEntry('Debts', rec).then(() => DB.put('debts', rec));
}
async function saveDebtActivityRec(rec) {
  rec.synced = false;
  if (!rec.createdAt) rec.createdAt = new Date().toISOString();
  await DB.put('debtActivity', rec);
  Sync.pushEntry('DebtActivity', rec).then(() => DB.put('debtActivity', rec));
}

// The Finance category payments get logged under. Fixed id, so two phones seeding at
// once write the same record instead of two copies. Only seeded after a real pull, the
// same rule the rest of the app's seeding follows.
async function ensureDebtPaymentCategory() {
  if (typeof Sync !== 'undefined' && (!Sync.hasPulledOnce || Sync.lastPullError)) return;
  const cats = await DB.getAll('categories');
  if (cats.some((c) => !c.deleted && c.conditionalField === 'debt')) return;
  const cat = { id: 'cat-debt-payment', name: 'Debt payment', type: 'expense', icon: 'ti-credit-card-pay', conditionalField: 'debt', defaultStoreId: null, defaultAmount: null, monthlyBudget: null, hidden: false, synced: false };
  await DB.put('categories', cat);
  Sync.pushEntry('Categories', cat).then(() => DB.put('categories', cat));
}

// Where money sitting on an expiring promo is cheapest to put: other accounts with
// room, lowest rate (as it'll be once the promo is over) first.
function debtCheapestHomes(state, sourceRow, amount, whenDate) {
  const homes = state.debts
    .filter((r) => r !== sourceRow && !r.debt.closed && r.limit > 0)
    .map((r) => {
      const atWhen = debtRateAt(r.debt, whenDate);
      return { row: r, rate: atWhen.rate, promo: atWhen.promo, room: r.room };
    })
    .filter((h) => !h.promo && h.room > 1)
    .sort((a, b) => a.rate - b.rate);
  const plan = [];
  let left = amount;
  for (const h of homes) {
    if (left <= DEBT_EPS) break;
    const amt = Math.min(left, h.room);
    plan.push({ row: h.row, amount: amt, rate: h.rate });
    left -= amt;
  }
  return { plan, left };
}

// ---------- overview ----------
function goDebtsMain() { currentTab = 'debts'; currentView = 'main'; route(); }
function openDebt(id) { debtCurrentId = id; currentView = 'debtDetail'; route(); }

async function renderDebtsMain() {
  ensureDebtPaymentCategory();
  const state = await loadDebtState();
  const { today } = state;
  const open = state.debts.filter((r) => !r.debt.closed);

  if (!state.debts.length) {
    $main.innerHTML = `
      <div class="card" style="text-align:center">
        <i class="ti ti-credit-card" style="font-size:30px;color:var(--gold)"></i>
        <p class="display" style="font-size:19px;margin:8px 0 4px">Track your debts</p>
        <p style="font-size:13px;color:var(--ink-soft);margin-bottom:14px">See what's owed, when each promo ends, and the fastest way to pay it all off.</p>
        <button class="btn btn-primary" style="margin-bottom:8px" onclick="seedMyDebts()"><i class="ti ti-wand"></i> Add my 5 accounts</button>
        <p style="font-size:11px;color:var(--ink-soft);margin-bottom:12px">Tangerine LOC ••5172 (Safia), MBNA ••1226 and ••0216, RBC LOC ••1591 and Tangerine LOC ••4632, with today's balances and rates.</p>
        <button class="btn" onclick="goAddDebt()"><i class="ti ti-plus"></i> Add one myself</button>
      </div>`;
    return;
  }

  const owing = open.filter((r) => r.balance > DEBT_EPS)
    .sort((a, b) => (b.rateNow - a.rateNow) || (b.balance - a.balance));
  // Room on a line still counts as available even when part of it is used.
  const available = open.filter((r) => r.limit > 0 && r.room > 0.5)
    // Cheapest first, judged by the rate each one settles at once intro rates and promos end.
    .sort((a, b) => debtSettledRate(a.debt) - debtSettledRate(b.debt));
  const paidNoLimit = open.filter((r) => r.balance <= DEBT_EPS && !(r.limit > 0));
  const closed = state.debts.filter((r) => r.debt.closed);

  const totalOwed = owing.reduce((s, r) => s + r.balance, 0);
  const interestNow = owing.reduce((s, r) => s + r.balance * r.rateNow / 1200, 0);
  const availableCredit = open.reduce((s, r) => s + r.room, 0);
  const startTotal = open.reduce((s, r) => {
    const first = r.timeline.items.find((it) => it.src === 'activity' && it.rec.kind === 'start');
    return s + (first ? Math.max(0, Number(first.rec.amount) || 0) : 0);
  }, 0);
  const paidSoFar = Math.max(0, startTotal - totalOwed);

  // What's coming: promos ending and rate changes within the next few months.
  const alerts = [];
  owing.forEach((r) => {
    if (!r.next) return;
    const days = debtDaysBetween(today, r.next.from);
    if (days > DEBT_ALERT_DAYS) return;
    if (r.promoNow) alerts.push({ r, days, promo: true });
    else alerts.push({ r, days, promo: false });
  });
  alerts.sort((a, b) => a.days - b.days);
  const promoGroups = {};
  alerts.filter((a) => a.promo).forEach((a) => { (promoGroups[a.r.next.from] = promoGroups[a.r.next.from] || []).push(a); });
  const promoHtml = Object.keys(promoGroups).sort().map((date) => {
    const group = promoGroups[date];
    const days = group[0].days;
    const amt = group.reduce((s, a) => s + a.r.balance, 0);
    const rates = group.map((a) => debtPct(a.r.next.rate)).join(' and ');
    const names = group.map((a) => esc(debtName(a.r.debt))).join(' and ');
    return `<div class="debt-alert warn">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><span style="font-weight:600"><i class="ti ti-alarm"></i> ${debtPct(group[0].r.rateNow)} ${group[0].r.rateNow > 0 ? 'intro rate' : 'promo'} ends in ${days} day${days === 1 ? '' : 's'}</span><span style="font-size:12px;white-space:nowrap">${fmtDateYear(date)}</span></div>
      <p>${fmtMoney(amt)} on ${names} goes to ${rates} after that. Move it or pay it off before then.</p>
    </div>`;
  }).join('');
  const rateHtml = alerts.filter((a) => !a.promo).map((a) => {
    const up = a.r.next.rate > a.r.rateNow;
    return `<div class="debt-alert info">
      <i class="ti ${up ? 'ti-trending-up' : 'ti-trending-down'}"></i> ${esc(debtName(a.r.debt))} goes from ${debtPct(a.r.rateNow)} to ${debtPct(a.r.next.rate)} on ${fmtDateYear(a.r.next.from)}${a.days >= 0 ? ` (${a.days} day${a.days === 1 ? '' : 's'})` : ''}, so interest ${up ? 'rises' : 'drops'} to about ${debtMoney0(a.r.balance * a.r.next.rate / 1200)}/mo.
    </div>`;
  }).join('');

  // Suggestion: where expiring promo money is cheapest to put; otherwise, a balance
  // sitting on a noticeably higher rate than a line with room.
  let suggestHtml = '';
  // The group whose promo ending costs the most per month gets the suggestion.
  const groupCost = (g) => g.reduce((s, a) => s + a.r.balance * (a.r.next.rate - a.r.rateNow) / 1200, 0);
  const promoDates = Object.keys(promoGroups).sort((a, b) => groupCost(promoGroups[b]) - groupCost(promoGroups[a]));
  if (promoDates.length) {
    const group = promoGroups[promoDates[0]];
    const amt = group.reduce((s, a) => s + a.r.balance, 0);
    const fake = { debt: { id: '__promo' } };
    // Every expiring promo is a source, never a destination.
    const sourceIds = new Set(alerts.filter((a) => a.promo).map((a) => a.r.debt.id));
    const st2 = { debts: state.debts.filter((r) => !sourceIds.has(r.debt.id)) };
    const { plan, left } = debtCheapestHomes(st2, fake, amt, promoDates[0]);
    if (plan.length) {
      const after = plan.reduce((s, p) => s + p.amount * p.rate / 1200, 0) + (left > 0 ? group.reduce((s, a) => s + a.r.next.rate, 0) / group.length * left / 1200 : 0);
      const stay = group.reduce((s, a) => s + a.r.balance * a.r.next.rate / 1200, 0);
      suggestHtml = `<div class="card tight debt-suggest">
        <p class="debt-suggest-head"><i class="ti ti-route"></i> Cheapest place for the promo money</p>
        ${plan.map((p) => `<div class="debt-line"><span>${debtMoney0(p.amount)} → ${esc(debtName(p.row.debt))}</span><span class="muted">${debtPct(p.rate)}</span></div>`).join('')}
        ${left > 1 ? `<div class="debt-line"><span style="color:var(--red)">${debtMoney0(left)} has nowhere cheaper to go</span><span></span></div>` : ''}
        <p class="debt-note">About ${debtMoney0(after)}/mo interest, compared with ${debtMoney0(stay)}/mo if it stays where it is.</p>
        <button class="btn" style="margin-top:8px" onclick="goDebtMove('${group[0].r.debt.id}')"><i class="ti ti-arrows-exchange"></i> Record a move</button>
      </div>`;
    }
  }
  if (!suggestHtml) {
    const in30 = debtAddDays(today, 30);
    let best = null;
    owing.forEach((r) => {
      const rate = debtRateAt(r.debt, in30);
      if (rate.promo) return;
      state.debts.forEach((t) => {
        if (t === r || t.debt.closed || t.room < 500) return;
        const tr = debtRateAt(t.debt, in30);
        if (tr.promo) return;
        const gap = rate.rate - tr.rate;
        if (gap < 0.25) return;
        const amt = Math.min(r.balance, t.room);
        const save = amt * gap / 100;
        if (!best || save > best.save) best = { r, t, amt, gap, save, from: rate.rate, to: tr.rate };
      });
    });
    if (best) {
      suggestHtml = `<div class="card tight debt-suggest">
        <p class="debt-suggest-head"><i class="ti ti-bulb"></i> A cheaper home</p>
        <p style="font-size:13px;margin:0">${esc(debtName(best.r.debt))} is at ${debtPct(best.from)}. Moving ${debtMoney0(best.amt)} to ${esc(debtName(best.t.debt))} at ${debtPct(best.to)} would save about ${debtMoney0(best.save)} a year.</p>
        <button class="btn" style="margin-top:8px" onclick="goDebtMove('${best.r.debt.id}','${best.t.debt.id}')"><i class="ti ti-arrows-exchange"></i> Move balance</button>
      </div>`;
    }
  }

  const focus = owing.slice().sort((a, b) => (b.rateNow - a.rateNow) || (a.balance - b.balance))[0];
  const holderChip = (d) => d.holder ? `<span class="debt-chip">${esc(d.holder)}</span>` : '';
  const owingRow = (r) => {
    const d = r.debt;
    const isFocus = focus && r === focus && owing.length > 1;
    const promoChip = r.promoNow && r.next ? `<span class="debt-chip warn">${debtPct(r.rateNow)} until ${fmtDate(r.next.from)}</span>` : '';
    return `<div class="debt-row" onclick="openDebt('${d.id}')">
      <div class="debt-row-top"><span><i class="ti ${debtIcon(d)}"></i> ${esc(debtName(d))}</span><span class="debt-amt">${fmtMoney(r.balance)}</span></div>
      <div class="debt-row-sub">${promoChip}${holderChip(d)}${isFocus ? '<span class="debt-chip good">Extra money goes here</span>' : ''}</div>
      <div class="debt-row-meta">${esc(debtRateText(d, today))}${debtMinText(d) ? ' · ' + esc(debtMinText(d)) : ''}${r.limit > 0 ? ' · ' + debtMoney0(r.room) + ' room' : ''}</div>
    </div>`;
  };
  const availRow = (r) => `<div class="debt-row" onclick="openDebt('${r.debt.id}')">
      <div class="debt-row-top"><span><i class="ti ${debtIcon(r.debt)}"></i> ${esc(debtName(r.debt))}</span><span class="debt-amt" style="color:#0F6E56">${debtMoney0(r.room)} free</span></div>
      <div class="debt-row-sub">${holderChip(r.debt)}${r.balance > DEBT_EPS ? `<span class="debt-chip">also ${debtMoney0(r.balance)} owing</span>` : ''}</div>
      <div class="debt-row-meta">${esc(debtRateText(r.debt, today))}${debtMinText(r.debt) ? ' · ' + esc(debtMinText(r.debt)) : ''}</div>
    </div>`;

  $main.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><p class="label">Total owed</p><p class="value">${fmtMoney(totalOwed)}</p>${paidSoFar > 1 ? `<p class="debt-note" style="color:#0F6E56;margin:2px 0 0">${debtMoney0(paidSoFar)} paid down</p>` : ''}</div>
      <div class="stat" style="cursor:pointer" onclick="openDebtInterestSheet()"><p class="label">Interest this month <i class="ti ti-chevron-right" style="font-size:11px"></i></p><p class="value">${fmtMoney(interestNow)}</p><p class="debt-note" style="margin:2px 0 0">estimated · tap for details</p></div>
      <div class="stat"><p class="label">Available credit</p><p class="value">${debtMoney0(availableCredit)}</p></div>
      <div class="stat"><p class="label">Accounts</p><p class="value">${owing.length} owing · ${available.filter((r) => r.balance <= DEBT_EPS).length} unused</p></div>
    </div>
    ${promoHtml}${rateHtml}
    ${suggestHtml}
    <p class="section-label" style="margin-top:14px">Owing <span class="muted" style="font-weight:400">· highest rate first</span></p>
    <div class="card tight debt-list">${owing.map(owingRow).join('') || '<div class="empty-state" style="padding:14px">Nothing owing.</div>'}</div>
    ${available.length ? `<p class="section-label" style="margin-top:14px">Available to use</p><div class="card tight debt-list">${available.map(availRow).join('')}</div>` : ''}
    ${paidNoLimit.length ? `<p class="section-label" style="margin-top:14px">Paid off</p><div class="card tight debt-list">${paidNoLimit.map((r) => `<div class="debt-row" onclick="openDebt('${r.debt.id}')"><div class="debt-row-top"><span style="color:var(--ink-soft)"><i class="ti ti-check"></i> ${esc(debtName(r.debt))}</span><span class="muted">Paid off</span></div></div>`).join('')}</div>` : ''}
    <div class="debt-actions">
      <button class="btn" onclick="goDebtMove()"><i class="ti ti-arrows-exchange"></i> Move balance</button>
      <button class="btn" onclick="goDebtOffer()"><i class="ti ti-gift"></i> New 0% offer</button>
      <button class="btn" onclick="goDebtRates()"><i class="ti ti-percentage"></i> Update rates</button>
    </div>
    ${closed.length ? `<button class="btn" style="margin-top:10px;background:transparent;box-shadow:none" onclick="debtShowClosed=!debtShowClosed;route()">${debtShowClosed ? 'Hide' : 'Show'} closed accounts (${closed.length})</button>
      ${debtShowClosed ? `<div class="card tight debt-list">${closed.map((r) => `<div class="debt-row" onclick="openDebt('${r.debt.id}')"><div class="debt-row-top"><span style="color:var(--ink-soft)"><i class="ti ti-archive"></i> ${esc(debtName(r.debt))}</span><span class="muted">${fmtMoney(r.balance)}</span></div></div>`).join('')}</div>` : ''}` : ''}
    <p class="debt-note" style="margin-top:14px">Payments come from Finance entries in the "${esc(await debtPaymentCategoryName())}" category. Balances don't include interest charged since your last balance check — update them from your statements now and then.</p>
  `;
}
async function debtPaymentCategoryName() {
  const cats = await DB.getAll('categories');
  const c = cats.find((x) => !x.deleted && x.conditionalField === 'debt');
  return c ? c.name : 'Debt payment';
}

// One tap to put in the five accounts as they stand today. Fixed ids, so tapping it
// on both phones (or twice) can't create doubles. Only the last 4 digits are kept.
async function seedMyDebts() {
  const existing = await DB.getAll('debts');
  if (existing.some((d) => !d.deleted)) { route(); return; }
  const today = todayStr();
  const now = new Date().toISOString();
  const debts = [
    { id: 'debt-tangerine-5172', name: 'Tangerine LOC', kind: 'loc', lender: 'Tangerine', last4: '5172', holder: 'Safia', limit: 25000,
      rates: [{ from: '2026-11-20', rate: 2.99, promo: true }, { from: '2027-02-18', rate: 7.70, promo: false }], minInterestOnly: true, minPayment: null, start: 20000 },
    { id: 'debt-mbna-1226', name: 'MBNA', kind: 'card', lender: 'MBNA', last4: '1226', holder: 'Nassim', limit: null,
      rates: [{ from: today, rate: 0, promo: true }, { from: '2027-03-03', rate: 17.99, promo: false }], minInterestOnly: false, minPayment: 10, start: 13730, notes: '3% transfer fee paid when the money was taken out.' },
    { id: 'debt-mbna-0216', name: 'MBNA', kind: 'card', lender: 'MBNA', last4: '0216', holder: 'Nassim', limit: null,
      rates: [{ from: today, rate: 0, promo: true }, { from: '2027-03-03', rate: 22.99, promo: false }], minInterestOnly: false, minPayment: 10, start: 7720, notes: '3% transfer fee paid when the money was taken out.' },
    { id: 'debt-rbc-1591', name: 'RBC LOC', kind: 'loc', lender: 'RBC', last4: '1591', holder: 'Nassim', limit: 20000,
      rates: [{ from: today, rate: 6.20, promo: false }], minInterestOnly: true, minPayment: null, start: 0 },
    { id: 'debt-tangerine-4632', name: 'Tangerine LOC', kind: 'loc', lender: 'Tangerine', last4: '4632', holder: 'Nassim', limit: 30000,
      rates: [{ from: today, rate: 6.70, promo: false }], minInterestOnly: true, minPayment: null, start: 0 }
  ];
  for (const d of debts) {
    const start = d.start; delete d.start;
    d.closed = false; d.createdAt = now;
    await saveDebtRec(d);
    await saveDebtActivityRec({ id: 'debtact-start-' + d.id, debtId: d.id, date: today, kind: 'start', amount: start, note: 'Tracking starts', createdAt: now });
  }
  route();
}

// ---------- detail ----------
async function renderDebtDetail() {
  const state = await loadDebtState();
  const r = state.debts.find((x) => x.debt.id === debtCurrentId);
  if (!r) { currentView = 'main'; return renderDebtsMain(); }
  const d = r.debt, today = state.today;
  const rates = debtSortedRates(d);
  const cur = debtRateAt(d, today);
  const lastCheck = r.timeline.asOf;
  const sinceDays = lastCheck ? Math.max(0, debtDaysBetween(lastCheck, today)) : 0;
  const estInterest = r.balance > 0 ? r.balance * cur.rate / 100 / 365 * sinceDays : 0;

  // Rate bar: today until the next change, then a slice after it.
  let barHtml = '';
  if (r.next) {
    const span = Math.max(1, debtDaysBetween(today, r.next.from));
    barHtml = `<div class="debt-ratebar"><div style="flex:${span};background:${cur.promo ? 'var(--gold)' : '#378ADD'}"></div><div style="flex:${Math.max(20, span * 0.4)};background:${r.next.rate > cur.rate ? 'var(--red)' : 'var(--sage)'}"></div></div>
      <div class="debt-ratebar-labels"><span>Today · ${debtPct(cur.rate)}</span><span>${fmtDateYear(r.next.from)} → ${debtPct(r.next.rate)}</span></div>`;
  }
  const items = r.timeline.items.slice().reverse();
  const actRow = (it) => {
    if (it.src === 'finance') {
      const e = it.rec;
      return `<div class="debt-act finance" onclick="openEntryDetail('${e.id}')">
        <div><p><i class="ti ti-link"></i> Payment from Finance</p><p class="sub">${fmtDateYear(e.date)}${e.storeName ? ' · ' + esc(e.storeName) : ''}${e.description ? ' · ' + esc(e.description) : ''}</p></div>
        <span class="${it.effect <= 0 ? 'pos' : 'neg'}">${it.effect <= 0 ? '−' : '+'}${fmtMoney(Math.abs(it.effect))}</span></div>`;
    }
    const a = it.rec;
    const isSnap = a.kind === 'start' || a.kind === 'balance';
    return `<div class="debt-act" onclick="openDebtActivitySheet('${a.id}')">
      <div><p>${DEBT_ACTIVITY_LABELS[a.kind] || a.kind}</p><p class="sub">${fmtDateYear(a.date)}${a.note ? ' · ' + esc(a.note) : ''}</p></div>
      <span class="${isSnap ? '' : (it.effect <= 0 ? 'pos' : 'neg')}">${isSnap ? fmtMoney(a.amount) : (it.effect <= 0 ? '−' : '+') + fmtMoney(Math.abs(it.effect))}</span></div>`;
  };

  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer;justify-content:space-between" onclick="goDebtsMain()">
      <span><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${esc(debtName(d))}</span></span>
      <button class="btn" style="width:auto;padding:6px 12px" onclick="event.stopPropagation();goEditDebt('${d.id}')"><i class="ti ti-edit"></i> Edit</button>
    </div>
    <div class="card">
      <p style="font-size:12px;color:var(--ink-soft);margin:0">${r.balance > DEBT_EPS ? 'Owing' : (r.limit > 0 ? 'Nothing owing' : 'Paid off')}</p>
      <p class="display" style="font-size:28px;font-weight:600;margin:2px 0">${fmtMoney(r.balance)}</p>
      <p style="font-size:12px;color:var(--ink-soft);margin:0 0 12px">${(DEBT_KINDS[d.kind] || DEBT_KINDS.other).label}${d.holder ? ' · Account holder: ' + esc(d.holder) : ''}${d.closed ? ' · Closed' : ''}</p>
      ${d.accountNumber ? `<div class="debt-acct"><div><p class="muted" style="font-size:11px;margin:0">Account number</p><p id="debtAcctNum" class="debt-acct-num" data-shown="0">${esc(debtMaskAccount(d.accountNumber))}</p></div>
        <div style="display:flex;gap:6px"><button class="btn" aria-label="Show account number" onclick="toggleDebtAccount('${d.id}')"><i class="ti ti-eye" id="debtAcctEye"></i></button><button class="btn" aria-label="Copy account number" onclick="copyDebtAccount('${d.id}')"><i class="ti ti-copy" id="debtAcctCopy"></i></button></div></div>` : ''}
      ${barHtml}
      <div class="list-row" style="cursor:default"><span class="muted">Rate now</span><span>${debtPct(cur.rate)}${cur.promo ? ' (promo)' : ''}</span></div>
      ${r.limit > 0 ? `<div class="list-row" style="cursor:default"><span class="muted">Credit limit</span><span>${fmtMoney(r.limit)} · ${debtMoney0(r.room)} free</span></div>` : ''}
      ${debtMinText(d) ? `<div class="list-row" style="cursor:default"><span class="muted">Minimum</span><span>${esc(debtMinText(d))}</span></div>` : ''}
      ${r.balance > DEBT_EPS ? `<div class="list-row" style="cursor:default"><span class="muted">Interest per month now</span><span>${fmtMoney(r.balance * cur.rate / 1200)}</span></div>` : ''}
      ${r.next && r.balance > DEBT_EPS ? `<div class="list-row" style="cursor:default"><span class="muted">After ${fmtDate(r.next.from)}</span><span${r.next.rate > cur.rate ? ' style="color:var(--red)"' : ''}>${fmtMoney(r.balance * r.next.rate / 1200)}/mo</span></div>` : ''}
      ${estInterest > 1 ? `<p class="debt-note" style="margin-top:8px">About ${fmtMoney(estInterest)} of interest has likely been charged since the last balance check (${fmtDate(lastCheck)}). Update the balance from your statement to stay exact.</p>` : ''}
    </div>
    <div class="debt-actions">
      <button class="btn" onclick="goDebtPayInFinance('${d.id}')"><i class="ti ti-report-money"></i> Log payment</button>
      <button class="btn" onclick="openDebtActivitySheet(null,'balance')"><i class="ti ti-refresh"></i> Update balance</button>
      ${r.balance > DEBT_EPS ? `<button class="btn" onclick="goDebtMove('${d.id}')"><i class="ti ti-arrows-exchange"></i> Move balance</button>` : `<button class="btn" onclick="goDebtMove(null,'${d.id}')"><i class="ti ti-arrows-exchange"></i> Move money here</button>`}
      <button class="btn" onclick="openDebtActivitySheet(null,'charge')"><i class="ti ti-plus"></i> Charge or fee</button>
    </div>
    <p class="section-label" style="margin-top:14px">Rates</p>
    <div class="card tight">
      ${rates.map((p) => {
        const isCur = p === rates.filter((x) => x.from <= today).slice(-1)[0] || (!rates.some((x) => x.from <= today) && p === rates[0]);
        const future = p.from > today;
        return `<div class="list-row" style="cursor:default"><span>${fmtDateYear(p.from)}${future ? ' <span class="debt-chip">Scheduled</span>' : ''}${isCur ? ' <span class="debt-chip good">Now</span>' : ''}</span><span>${debtPct(p.rate)}${p.promo ? ' promo' : ''}</span></div>`;
      }).join('') || '<p class="debt-note">No rates yet.</p>'}
      <button class="btn" style="margin-top:8px" onclick="openDebtRateSheet('${d.id}')"><i class="ti ti-percentage"></i> Change rate</button>
    </div>
    ${d.notes ? `<p class="section-label" style="margin-top:14px">Notes</p><div class="card tight"><p style="font-size:13px;white-space:pre-wrap">${esc(d.notes)}</p></div>` : ''}
    <p class="section-label" style="margin-top:14px">Activity</p>
    <div class="card tight">${items.map(actRow).join('') || '<p class="debt-note">Nothing yet.</p>'}</div>
    <p class="debt-note">Edit or delete a Finance payment and this balance updates too.</p>
  `;
}

// Payment / balance check / charge, added or edited in a sheet.
async function openDebtActivitySheet(activityId, kind) {
  const existing = activityId ? await DB.get('debtActivity', activityId) : null;
  const k = existing ? existing.kind : kind;
  const debt = await DB.get('debts', existing ? existing.debtId : debtCurrentId);
  if (!debt) return;
  const isMove = k === 'moveIn' || k === 'moveOut';
  const titles = { payment: 'Log payment', balance: 'Update balance', start: 'Starting balance', charge: 'Charge or fee', fee: 'Fee', interest: 'Interest charged', moveIn: 'Money moved in', moveOut: 'Money moved out' };
  const help = {
    payment: 'For a payment made outside Finance. Payments logged in Finance under the debt category count already — don\'t log them twice.',
    balance: 'The balance from your statement or banking app. Everything before this date is replaced by it.',
    start: 'Where tracking started.',
    charge: 'Anything that adds to what\'s owed: a purchase, a fee, interest charged.'
  };
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p class="display" style="font-size:18px;margin-bottom:4px">${titles[k] || 'Activity'}</p>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:12px">${esc(debtName(debt))}${help[k] ? ' · ' + help[k] : ''}</p>
    ${k === 'charge' || k === 'fee' || k === 'interest' ? `<div class="btn-toggle-row" id="dact_kind">
      ${['charge', 'fee', 'interest'].map((x) => `<button type="button" class="btn-toggle ${x === k ? 'active-neutral' : ''}" data-k="${x}" onclick="document.querySelectorAll('#dact_kind .btn-toggle').forEach(b=>b.classList.toggle('active-neutral',b===this))">${{ charge: 'Charge', fee: 'Fee', interest: 'Interest' }[x]}</button>`).join('')}
    </div>` : ''}
    <div class="field-row">
      <div class="field"><label class="field-label">${k === 'balance' || k === 'start' ? 'Balance owing' : 'Amount'}</label><input type="number" step="0.01" id="dact_amount" value="${existing ? existing.amount : ''}" ${isMove ? 'disabled' : ''}></div>
      <div class="field"><label class="field-label">Date</label><input type="date" id="dact_date" value="${existing ? existing.date : todayStr()}" ${isMove ? 'disabled' : ''}></div>
    </div>
    <div class="field"><label class="field-label">Note</label><input id="dact_note" placeholder="Optional" value="${existing ? esc(existing.note || '') : ''}"></div>
    ${isMove ? '<p class="debt-note" style="margin-bottom:10px">Part of a balance move. Deleting it removes both sides of the move.</p>' : ''}
    <button class="btn btn-primary" id="dactSaveBtn" onclick="saveDebtActivitySheet('${existing ? existing.id : ''}','${k}')">Save</button>
    ${existing ? `<button class="btn" style="margin-top:10px;background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="deleteDebtActivity('${existing.id}')"><i class="ti ti-trash"></i> Delete</button>` : ''}
    <button class="btn" style="margin-top:10px" onclick="closeModal()">Cancel</button>
  `;
  openModal();
}
async function saveDebtActivitySheet(existingId, kind) {
  const existing = existingId ? await DB.get('debtActivity', existingId) : null;
  const amountEl = document.getElementById('dact_amount');
  const amount = parseFloat(amountEl.value);
  if (isNaN(amount) || (kind !== 'balance' && kind !== 'start' && amount <= 0)) { alert('Enter an amount.'); return; }
  let k = kind;
  const kindRow = document.getElementById('dact_kind');
  if (kindRow) { const sel = kindRow.querySelector('.active-neutral'); if (sel) k = sel.dataset.k; }
  const rec = existing || { id: uid(), debtId: debtCurrentId };
  if (!(rec.kind === 'moveIn' || rec.kind === 'moveOut')) {
    rec.kind = k; rec.amount = amount; rec.date = document.getElementById('dact_date').value || todayStr();
  }
  rec.note = document.getElementById('dact_note').value.trim();
  await saveDebtActivityRec(rec);
  closeModal();
  route();
}
async function deleteDebtActivity(id) {
  const rec = await DB.get('debtActivity', id);
  if (!rec) return;
  const all = rec.moveId ? (await DB.getAll('debtActivity')).filter((a) => a.moveId === rec.moveId && !a.deleted) : [rec];
  if (!confirm(all.length > 1 ? `Delete this balance move (${all.length} records on both accounts)?` : 'Delete this?')) return;
  for (const a of all) { a.deleted = true; await saveDebtActivityRec(a); }
  closeModal();
  route();
}

// Quick rate change for one debt: a new rate from a date (today, or a known date ahead).
async function openDebtRateSheet(id) {
  const d = await DB.get('debts', id);
  const cur = debtRateAt(d, todayStr());
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p class="display" style="font-size:18px;margin-bottom:4px">Change rate</p>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:12px">${esc(debtName(d))} · now ${debtPct(cur.rate)}. Pick today for a change that already happened, or a date ahead for one you know is coming.</p>
    <div class="field-row">
      <div class="field"><label class="field-label">New rate %</label><input type="number" step="0.01" id="drate_rate" value=""></div>
      <div class="field"><label class="field-label">Starting</label><input type="date" id="drate_from" value="${todayStr()}"></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:14px"><input type="checkbox" id="drate_promo" style="width:auto"> This is a promo or intro rate</label>
    <button class="btn btn-primary" onclick="saveDebtRateSheet('${id}')">Save rate</button>
    <button class="btn" style="margin-top:10px" onclick="closeModal();goEditDebt('${id}')">Edit all rates</button>
    <button class="btn" style="margin-top:10px" onclick="closeModal()">Cancel</button>`;
  openModal();
}
function debtApplyRate(d, from, rate, promo) {
  const rates = (Array.isArray(d.rates) ? d.rates : []).filter((p) => p.from !== from);
  rates.push({ from, rate, promo: !!promo });
  rates.sort((a, b) => (a.from < b.from ? -1 : 1));
  d.rates = rates;
}
async function saveDebtRateSheet(id) {
  const rate = parseFloat(document.getElementById('drate_rate').value);
  const from = document.getElementById('drate_from').value || todayStr();
  if (isNaN(rate) || rate < 0) { alert('Enter the new rate.'); return; }
  const d = await DB.get('debts', id);
  debtApplyRate(d, from, rate, document.getElementById('drate_promo').checked);
  await saveDebtRec(d);
  closeModal();
  route();
}

// ---------- add / edit form ----------
function goAddDebt() { debtEditId = null; debtFormDraft = null; currentTab = 'debts'; currentView = 'addDebt'; route(); }
function goEditDebt(id) { debtEditId = id; debtFormDraft = null; currentTab = 'debts'; currentView = 'addDebt'; route(); }

async function renderAddDebt() {
  const existing = debtEditId ? await DB.get('debts', debtEditId) : null;
  if (!debtFormDraft) {
    debtFormDraft = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: uid(), name: '', kind: 'loc', lender: '', last4: '', holder: '', limit: null,
      rates: [{ from: todayStr(), rate: '', promo: false }], minInterestOnly: true, minPayment: null, notes: '', closed: false,
      __startBalance: '', __startDate: todayStr()
    };
    if (!Array.isArray(debtFormDraft.rates) || !debtFormDraft.rates.length) debtFormDraft.rates = [{ from: todayStr(), rate: '', promo: false }];
  }
  const f = debtFormDraft;
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="${existing ? `openDebt('${existing.id}')` : 'goDebtsMain()'}"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">${existing ? 'Edit debt' : 'Add debt'}</span></div>
    <label class="field-label">Type</label>
    <div class="btn-toggle-row" id="debtKindRow">${Object.keys(DEBT_KINDS).map((k) => `<button type="button" class="btn-toggle ${f.kind === k ? 'active-neutral' : ''}" onclick="debtFormSet('kind','${k}')">${DEBT_KINDS[k].label}</button>`).join('')}</div>
    <div class="field"><label class="field-label">Name</label><input id="df_name" placeholder="Tangerine LOC" value="${esc(f.name)}"></div>
    <div class="field-row">
      <div class="field"><label class="field-label">Bank</label><input id="df_lender" placeholder="Tangerine" value="${esc(f.lender || '')}"></div>
      <div class="field"><label class="field-label">Last 4 digits</label><input id="df_last4" inputmode="numeric" maxlength="4" placeholder="1234" value="${esc(f.last4 || '')}"></div>
    </div>
    <div class="field"><label class="field-label">Account number <span class="muted" style="font-weight:400">(optional — shown hidden, tap to reveal)</span></label><input id="df_acct" autocomplete="off" placeholder="Full account number" value="${esc(f.accountNumber || '')}"></div>
    <label class="field-label">Account holder <span class="muted" style="font-weight:400">(just where the debt lives)</span></label>
    <div class="chip-row">${DEBT_HOLDERS.map((h) => `<button type="button" class="chip ${f.holder === h ? 'active' : ''}" onclick="debtFormSet('holder', ${JSON.stringify(f.holder === h ? '' : h).replace(/"/g, '&quot;')})">${h}</button>`).join('')}</div>
    <div class="field"><label class="field-label">Credit limit <span class="muted" style="font-weight:400">(optional)</span></label><input type="number" step="0.01" id="df_limit" placeholder="Leave blank for a loan or if unknown" value="${f.limit || ''}"></div>
    ${existing ? '' : `<div class="field-row">
      <div class="field"><label class="field-label">Owing today</label><input type="number" step="0.01" id="df_start" placeholder="0.00" value="${f.__startBalance}"></div>
      <div class="field"><label class="field-label">As of</label><input type="date" id="df_startDate" value="${f.__startDate}"></div>
    </div>`}
    <label class="field-label">Minimum payment</label>
    <div class="card tight" style="background:var(--surface)">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:8px"><input type="checkbox" id="df_minInterest" style="width:auto" ${f.minInterestOnly ? 'checked' : ''} onchange="debtFormRead();route()"> Interest only</label>
      ${f.minInterestOnly ? '' : `<input type="number" step="0.01" id="df_minPayment" placeholder="10.00 a month" value="${f.minPayment || ''}">`}
    </div>
    <label class="field-label" style="margin-top:6px">Rates</label>
    <p class="debt-note" style="margin-bottom:8px">One line per rate, from the date it starts. Add a future line for a change you know is coming, like an intro rate ending or a 0% promo ending. Tick promo for 0% or intro rates.</p>
    <div class="card tight" style="background:var(--surface)" id="debtRatesEditor">
      ${f.rates.map((p, i) => `<div class="debt-rate-edit">
        <input type="date" value="${p.from || ''}" onchange="debtFormRate(${i},'from',this.value)">
        <input type="number" step="0.01" placeholder="%" value="${p.rate === '' || p.rate === null || p.rate === undefined ? '' : p.rate}" onchange="debtFormRate(${i},'rate',this.value)">
        <label><input type="checkbox" ${p.promo ? 'checked' : ''} onchange="debtFormRate(${i},'promo',this.checked)"> Promo</label>
        <button type="button" class="btn" aria-label="Remove rate" onclick="debtFormRemoveRate(${i})"><i class="ti ti-x"></i></button>
      </div>`).join('')}
      <button type="button" class="btn" style="margin-top:6px" onclick="debtFormAddRate()"><i class="ti ti-plus"></i> Add a rate change</button>
    </div>
    <div class="field" style="margin-top:6px"><label class="field-label">Notes</label><textarea id="df_notes" rows="2" placeholder="Promo terms, fees, anything to remember">${esc(f.notes || '')}</textarea></div>
    ${existing ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:14px"><input type="checkbox" id="df_closed" style="width:auto" ${f.closed ? 'checked' : ''}> Account closed (hide it from the lists)</label>` : ''}
    <button class="btn btn-primary" onclick="saveDebtForm()">${existing ? 'Save changes' : 'Add debt'}</button>
    ${existing ? `<button class="btn" style="margin-top:10px;background:var(--red-soft);color:var(--red);border-color:var(--red)" onclick="deleteDebt('${existing.id}')"><i class="ti ti-trash"></i> Delete debt</button>` : ''}
  `;
}
function debtFormRead() {
  const f = debtFormDraft; if (!f) return;
  const v = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
  if (v('df_name') !== undefined) f.name = v('df_name').trim();
  if (v('df_lender') !== undefined) f.lender = v('df_lender').trim();
  if (v('df_last4') !== undefined) f.last4 = v('df_last4').replace(/\D/g, '').slice(-4);
  if (v('df_acct') !== undefined) f.accountNumber = v('df_acct').trim();
  if (v('df_limit') !== undefined) f.limit = parseFloat(v('df_limit')) || null;
  if (v('df_start') !== undefined) f.__startBalance = v('df_start');
  if (v('df_startDate') !== undefined) f.__startDate = v('df_startDate');
  const mi = document.getElementById('df_minInterest'); if (mi) f.minInterestOnly = mi.checked;
  if (v('df_minPayment') !== undefined) f.minPayment = parseFloat(v('df_minPayment')) || null;
  if (v('df_notes') !== undefined) f.notes = v('df_notes');
  const cl = document.getElementById('df_closed'); if (cl) f.closed = cl.checked;
}
function debtFormSet(key, val) { debtFormRead(); debtFormDraft[key] = val; route(); }
function debtFormRate(i, key, val) { debtFormDraft.rates[i][key] = key === 'promo' ? !!val : val; }
function debtFormAddRate() {
  debtFormRead();
  const last = debtFormDraft.rates[debtFormDraft.rates.length - 1];
  debtFormDraft.rates.push({ from: last && last.from ? debtAddMonths(last.from, 3) : todayStr(), rate: '', promo: false });
  route();
}
function debtFormRemoveRate(i) { debtFormRead(); debtFormDraft.rates.splice(i, 1); route(); }

async function saveDebtForm() {
  debtFormRead();
  const f = debtFormDraft;
  if (!f.name) { alert('Give the debt a name.'); return; }
  const rates = f.rates.filter((p) => p.from && p.rate !== '' && !isNaN(parseFloat(p.rate))).map((p) => ({ from: p.from, rate: parseFloat(p.rate), promo: !!p.promo }));
  if (!rates.length) { alert('Add at least one rate.'); return; }
  rates.sort((a, b) => (a.from < b.from ? -1 : 1));
  const isNew = !debtEditId;
  const rec = isNew ? { id: f.id, createdAt: new Date().toISOString() } : await DB.get('debts', debtEditId);
  Object.assign(rec, {
    name: f.name, kind: f.kind, lender: f.lender, holder: f.holder, limit: f.limit,
    accountNumber: f.accountNumber || '',
    // Last 4 come from the account number when one is entered, so the two never disagree.
    last4: f.accountNumber && f.accountNumber.replace(/\D/g, '').length >= 4 ? f.accountNumber.replace(/\D/g, '').slice(-4) : f.last4,
    rates, minInterestOnly: !!f.minInterestOnly, minPayment: f.minInterestOnly ? null : f.minPayment,
    notes: f.notes || '', closed: !!f.closed
  });
  await saveDebtRec(rec);
  if (isNew) {
    await saveDebtActivityRec({ id: uid(), debtId: rec.id, date: f.__startDate || todayStr(), kind: 'start', amount: parseFloat(f.__startBalance) || 0, note: 'Tracking starts' });
  }
  debtFormDraft = null;
  openDebt(rec.id);
}
async function deleteDebt(id) {
  const linked = (await DB.getAll('entries')).filter((e) => !e.deleted && e.debtId === id).length;
  if (!confirm(`Delete this debt and its activity?${linked ? ` ${linked} Finance payment${linked === 1 ? '' : 's'} stay in Finance.` : ''} If the account is just paid off, tick "Account closed" instead to keep its history.`)) return;
  const d = await DB.get('debts', id);
  d.deleted = true;
  await saveDebtRec(d);
  for (const a of (await DB.getAll('debtActivity')).filter((x) => x.debtId === id && !x.deleted)) { a.deleted = true; await saveDebtActivityRec(a); }
  debtFormDraft = null;
  goDebtsMain();
}

// ---------- move balance ----------
// Records money going from one account to another (a balance transfer, or paying a
// card off with a line of credit), with any fee added to the destination. Shows
// whether it's worth it before saving.
function goDebtMove(fromId, toId) {
  debtMoveDraft = { fromId: fromId || null, toId: toId || null, amount: '', feePct: '', date: todayStr(), __touchedAmount: false };
  currentTab = 'debts'; currentView = 'debtMove'; route();
}
async function renderDebtMove() {
  if (!debtMoveDraft) debtMoveDraft = { fromId: null, toId: null, amount: '', feePct: '', date: todayStr() };
  const state = await loadDebtState();
  const m = debtMoveDraft;
  const open = state.debts.filter((r) => !r.debt.closed);
  const sources = open.filter((r) => r.balance > DEBT_EPS).sort((a, b) => b.rateNow - a.rateNow);
  if (!m.fromId && sources.length) m.fromId = sources[0].debt.id;
  const from = open.find((r) => r.debt.id === m.fromId);
  const dests = open.filter((r) => r.debt.id !== m.fromId);
  if (!m.toId || m.toId === m.fromId) {
    const cheapest = dests.filter((r) => r.room > 0 && !r.promoNow).sort((a, b) => a.rateNow - b.rateNow)[0] || dests[0];
    m.toId = cheapest ? cheapest.debt.id : null;
  }
  const to = open.find((r) => r.debt.id === m.toId);
  if (!m.__touchedAmount && from) {
    const room = to && to.limit > 0 ? to.room / (1 + (parseFloat(m.feePct) || 0) / 100) : Infinity;
    m.amount = (Math.floor(Math.min(from.balance, room) * 100) / 100).toFixed(2);
  }
  const opt = (r, sel) => `<option value="${r.debt.id}" ${sel === r.debt.id ? 'selected' : ''}>${esc(debtName(r.debt))} · ${r.balance > DEBT_EPS ? fmtMoney(r.balance) + ' owing' : debtMoney0(r.room) + ' free'}</option>`;
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goDebtsMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Move balance</span></div>
    ${!sources.length ? '<div class="empty-state">Nothing is owing, so there is nothing to move.</div>' : `
    <div class="field"><label class="field-label">From</label><select id="dm_from" onchange="debtMoveField('fromId',this.value)">${sources.map((r) => opt(r, m.fromId)).join('')}</select></div>
    <div class="field"><label class="field-label">To</label><select id="dm_to" onchange="debtMoveField('toId',this.value)">${dests.map((r) => opt(r, m.toId)).join('')}</select>
      <p class="debt-note" style="margin-top:4px">Moving to a new 0% card? Use <a href="#" onclick="event.preventDefault();goDebtOffer()">New 0% offer</a> to add the card and the move together.</p></div>
    <div class="field-row">
      <div class="field"><label class="field-label">Amount</label><input type="number" step="0.01" id="dm_amount" value="${m.amount}" oninput="debtMoveDraft.amount=this.value;debtMoveDraft.__touchedAmount=true;updateDebtMoveCheck()"></div>
      <div class="field"><label class="field-label">Fee %</label><input type="number" step="0.1" id="dm_fee" placeholder="0" value="${m.feePct}" oninput="debtMoveDraft.feePct=this.value;updateDebtMoveCheck()"></div>
    </div>
    <div class="field"><label class="field-label">Date</label><input type="date" id="dm_date" value="${m.date}" onchange="debtMoveDraft.date=this.value;updateDebtMoveCheck()"></div>
    <div id="debtMoveCheck"></div>
    <button class="btn btn-primary" style="margin-top:12px" onclick="saveDebtMove()">Record move</button>`}
  `;
  window.__debtMoveState = state;
  updateDebtMoveCheck();
}
function debtMoveField(key, val) { debtMoveDraft[key] = val; if (key === 'fromId') debtMoveDraft.__touchedAmount = false; route(); }

// The comparison: what this money costs where it is versus where it's going, over the
// destination's promo (if it has one) or the next 12 months.
function debtMoveComparison(from, to, amount, feePct, date) {
  const fee = amount * (feePct || 0) / 100;
  const toCur = debtRateAt(to.debt, date);
  const toNext = debtNextChange(to.debt, date);
  const months = toCur.promo && toNext ? Math.max(1, Math.round(debtDaysBetween(date, toNext.from) / 30.44)) : 12;
  const fromRateLater = (m) => debtRateAt(from.debt, debtAddMonths(date, m)).rate;
  const toRateLater = (m) => debtRateAt(to.debt, debtAddMonths(date, m)).rate;
  let costStay = 0, costMove = 0;
  for (let i = 0; i < months; i++) { costStay += amount * fromRateLater(i) / 1200; costMove += (amount + fee) * toRateLater(i) / 1200; }
  costMove += fee;
  const stayNow = amount * debtRateAt(from.debt, date).rate / 1200;
  const moveNow = (amount + fee) * toCur.rate / 1200;
  return { fee, months, costStay, costMove, save: costStay - costMove, stayNow, moveNow, promoMonths: toCur.promo && toNext ? months : 0 };
}
function updateDebtMoveCheck() {
  const el = document.getElementById('debtMoveCheck');
  const state = window.__debtMoveState;
  if (!el || !state || !debtMoveDraft) return;
  const m = debtMoveDraft;
  const from = state.debts.find((r) => r.debt.id === m.fromId);
  const to = state.debts.find((r) => r.debt.id === m.toId);
  const amount = parseFloat(m.amount) || 0;
  if (!from || !to || amount <= 0) { el.innerHTML = ''; return; }
  const c = debtMoveComparison(from, to, amount, parseFloat(m.feePct) || 0, m.date || todayStr());
  const rows = [
    ['Fee added to ' + debtName(to.debt), fmtMoney(c.fee)],
    ['Interest where it is now', fmtMoney(c.stayNow) + '/mo'],
    ['Interest after the move', fmtMoney(c.moveNow) + '/mo'],
    [`Total cost over ${c.months} months, staying`, fmtMoney(c.costStay)],
    [`Total cost over ${c.months} months, moving`, fmtMoney(c.costMove)]
  ];
  const overRoom = to.limit > 0 && amount + c.fee > to.room + 0.01;
  const overBal = amount > from.balance + 0.01;
  el.innerHTML = `<div class="card tight">${rows.map(([k, v]) => `<div class="list-row" style="cursor:default"><span class="muted" style="font-size:13px">${esc(k)}</span><span style="font-size:13px">${v}</span></div>`).join('')}</div>
    <div class="debt-alert ${c.save > 0 ? 'good' : 'bad'}"><i class="ti ${c.save > 0 ? 'ti-check' : 'ti-x'}"></i> ${c.save > 0 ? `Worth it: saves about ${fmtMoney(c.save)} over ${c.months} months.` : `Not worth it: costs about ${fmtMoney(-c.save)} more over ${c.months} months.`}</div>
    ${debtMoveTimingTip(from, to, amount, c, m.date || todayStr())}
    ${overRoom ? `<div class="debt-alert bad"><i class="ti ti-alert-triangle"></i> That's more than the ${debtMoney0(to.room)} of room on ${esc(debtName(to.debt))}.</div>` : ''}
    ${overBal ? `<div class="debt-alert bad"><i class="ti ti-alert-triangle"></i> That's more than the ${fmtMoney(from.balance)} owing on ${esc(debtName(from.debt))}.</div>` : ''}`;
}
// Moving money off a 0% promo early just starts paying interest sooner.
function debtMoveTimingTip(from, to, amount, c, date) {
  const cur = debtRateAt(from.debt, date), next = debtNextChange(from.debt, date);
  if (!cur.promo || !next) return '';
  const days = debtDaysBetween(date, next.from);
  if (days <= 14) return '';
  const extra = c.moveNow * days / 30.44 - amount * cur.rate / 1200 * days / 30.44;
  if (extra < 5) return '';
  return `<div class="debt-alert warn"><i class="ti ti-clock"></i> ${esc(debtName(from.debt))} stays at ${debtPct(cur.rate)} until ${fmtDateYear(next.from)}. Moving a few days before then instead of now saves about ${debtMoney0(extra)} more.</div>`;
}
async function debtRecordMove(fromId, toId, amount, fee, date, note) {
  const moveId = uid();
  const now = new Date().toISOString();
  await saveDebtActivityRec({ id: uid(), debtId: fromId, date, kind: 'moveOut', amount, moveId, note, createdAt: now });
  await saveDebtActivityRec({ id: uid(), debtId: toId, date, kind: 'moveIn', amount, moveId, note, createdAt: now });
  if (fee > 0.004) await saveDebtActivityRec({ id: uid(), debtId: toId, date, kind: 'fee', amount: Math.round(fee * 100) / 100, moveId, note: 'Transfer fee', createdAt: now });
}
async function saveDebtMove() {
  const state = window.__debtMoveState;
  const m = debtMoveDraft;
  const from = state.debts.find((r) => r.debt.id === m.fromId);
  const to = state.debts.find((r) => r.debt.id === m.toId);
  const amount = Math.round((parseFloat(m.amount) || 0) * 100) / 100;
  if (!from || !to || amount <= 0) { alert('Pick both accounts and an amount.'); return; }
  const fee = amount * (parseFloat(m.feePct) || 0) / 100;
  if (to.limit > 0 && amount + fee > to.room + 0.01 && !confirm(`That's more than the room left on ${debtName(to.debt)}. Record it anyway?`)) return;
  await debtRecordMove(from.debt.id, to.debt.id, amount, fee, m.date || todayStr(), `${debtName(from.debt)} → ${debtName(to.debt)}`);
  debtMoveDraft = null;
  goDebtsMain();
}

// ---------- new 0% offer ----------
// A new card with a 0% balance-transfer promo: enter the terms, see what's worth
// moving onto it (highest rate first), and save the card and the moves in one go.
function goDebtOffer() {
  debtOfferDraft = { name: 'MBNA', lender: 'MBNA', last4: '', holder: 'Nassim', limit: '', months: 12, feePct: 3, afterRate: 19.99, minPayment: 10, firstMinPct: 10, date: todayStr(), alloc: null };
  currentTab = 'debts'; currentView = 'debtOffer'; route();
}
async function renderDebtOffer() {
  if (!debtOfferDraft) goDebtOffer();
  const state = await loadDebtState();
  window.__debtOfferState = state;
  const o = debtOfferDraft;
  const inp = (id, label, val, type, extra) => `<div class="field"><label class="field-label">${label}</label><input id="${id}" type="${type || 'text'}" ${extra || ''} value="${esc(String(val === null || val === undefined ? '' : val))}" oninput="debtOfferRead();updateDebtOffer()"></div>`;
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goDebtsMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">New 0% offer</span></div>
    <div class="field-row">${inp('do_name', 'Card', o.name)}${inp('do_last4', 'Last 4 digits', o.last4, 'text', 'inputmode="numeric" maxlength="4"')}</div>
    <label class="field-label">Account holder</label>
    <div class="chip-row">${DEBT_HOLDERS.map((h) => `<button type="button" class="chip ${o.holder === h ? 'active' : ''}" onclick="debtOfferRead();debtOfferDraft.holder='${h}';route()">${h}</button>`).join('')}</div>
    <div class="field-row">${inp('do_limit', 'Credit limit', o.limit, 'number', 'step="100"')}${inp('do_months', '0% for (months)', o.months, 'number')}</div>
    <div class="field-row">${inp('do_fee', 'Transfer fee %', o.feePct, 'number', 'step="0.5"')}${inp('do_after', 'Rate after %', o.afterRate, 'number', 'step="0.01"')}</div>
    <div class="field-row">${inp('do_min', 'Monthly minimum', o.minPayment, 'number', 'step="1"')}${inp('do_firstMin', '1st-month minimum %', o.firstMinPct, 'number', 'step="1"')}</div>
    ${inp('do_date', 'Transfer date', o.date, 'date')}
    <p class="section-label" style="margin-top:6px">What to move <span class="muted" style="font-weight:400">· highest rate first</span></p>
    <div id="debtOfferAlloc"></div>
    <div id="debtOfferVerdict"></div>
    <button class="btn btn-primary" style="margin-top:12px" onclick="saveDebtOffer()">Add card and record moves</button>
  `;
  updateDebtOffer(true);
}
function debtOfferRead() {
  const o = debtOfferDraft;
  const v = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
  o.name = (v('do_name') || '').trim(); o.lender = o.name.split(' ')[0];
  o.last4 = (v('do_last4') || '').replace(/\D/g, '').slice(-4);
  o.limit = v('do_limit'); o.months = v('do_months'); o.feePct = v('do_fee'); o.afterRate = v('do_after');
  o.minPayment = v('do_min'); o.firstMinPct = v('do_firstMin'); o.date = v('do_date') || todayStr();
}
// Suggested amounts: fill the limit (less the fee) from the highest-rate balances.
function debtOfferSuggest(state, o) {
  const limit = parseFloat(o.limit) || 0, fp = (parseFloat(o.feePct) || 0) / 100;
  let room = limit / (1 + fp);
  const when = debtAddDays(o.date || todayStr(), 30);
  const sources = state.debts.filter((r) => !r.debt.closed && r.balance > DEBT_EPS)
    .map((r) => ({ r, rate: Math.max(debtRateAt(r.debt, when).rate, r.next && r.promoNow ? r.next.rate : 0) }))
    .sort((a, b) => b.rate - a.rate);
  const alloc = {};
  sources.forEach((s) => { const a = Math.max(0, Math.min(s.r.balance, room)); alloc[s.r.debt.id] = Math.floor(a); room -= alloc[s.r.debt.id]; });
  return { alloc, sources };
}
function updateDebtOffer(rebuild) {
  const state = window.__debtOfferState;
  const o = debtOfferDraft;
  if (!state || !o) return;
  const sugg = debtOfferSuggest(state, o);
  if (!o.alloc || !o.__touchedAlloc) o.alloc = sugg.alloc;
  const allocEl = document.getElementById('debtOfferAlloc');
  if (allocEl && (rebuild || !o.__touchedAlloc)) {
    allocEl.innerHTML = sugg.sources.length ? `<div class="card tight">${sugg.sources.map((s) => `<div class="debt-offer-row">
        <div><p>${esc(debtName(s.r.debt))}</p><p class="sub">${fmtMoney(s.r.balance)} owing · ${debtPct(s.rate)}${s.r.promoNow ? ' after promo' : ''}</p></div>
        <input type="number" step="1" value="${o.alloc[s.r.debt.id] || 0}" oninput="debtOfferDraft.__touchedAlloc=true;debtOfferDraft.alloc['${s.r.debt.id}']=parseFloat(this.value)||0;updateDebtOffer()">
      </div>`).join('')}</div>` : '<div class="empty-state" style="padding:10px">Nothing owing to move.</div>';
  }
  const fp = (parseFloat(o.feePct) || 0) / 100;
  const months = Math.max(1, parseInt(o.months) || 12);
  let total = 0, saved = 0;
  sugg.sources.forEach((s) => {
    const a = Math.min(Number(o.alloc[s.r.debt.id]) || 0, s.r.balance);
    if (a <= 0) return;
    total += a;
    for (let i = 0; i < months; i++) saved += a * debtRateAt(s.r.debt, debtAddMonths(o.date, i)).rate / 1200;
  });
  const fee = total * fp;
  const net = saved - fee;
  const avgRate = total > 0 ? saved / total / months * 1200 : 6.5;
  const breakEven = avgRate > 0 ? (fp * 100) / (avgRate / 12) : 0;
  const limit = parseFloat(o.limit) || 0;
  const firstMin = (total + fee) * (parseFloat(o.firstMinPct) || 0) / 100;
  const endDate = debtAddMonths(o.date, months);
  const vEl = document.getElementById('debtOfferVerdict');
  if (!vEl) return;
  if (total <= 0) { vEl.innerHTML = '<p class="debt-note">Enter the credit limit to see what to move.</p>'; return; }
  vEl.innerHTML = `
    <div class="card tight">
      <div class="list-row" style="cursor:default"><span class="muted" style="font-size:13px">Moving</span><span style="font-size:13px">${fmtMoney(total)}</span></div>
      <div class="list-row" style="cursor:default"><span class="muted" style="font-size:13px">Fee added to the card</span><span style="font-size:13px">${fmtMoney(fee)}</span></div>
      <div class="list-row" style="cursor:default"><span class="muted" style="font-size:13px">Interest avoided over ${months} months</span><span style="font-size:13px">${fmtMoney(saved)}</span></div>
      <div class="list-row" style="cursor:default"><span class="muted" style="font-size:13px">0% ends</span><span style="font-size:13px">${fmtDateYear(endDate)}</span></div>
    </div>
    <div class="debt-alert ${net > 0 ? 'good' : 'bad'}"><i class="ti ${net > 0 ? 'ti-check' : 'ti-x'}"></i> ${net > 0 ? `Worth it: about ${fmtMoney(net)} saved after the fee.` : `Not worth it: the ${fmtMoney(fee)} fee is more than the ${fmtMoney(saved)} of interest it avoids.`} Break-even is ${breakEven.toFixed(1)} months of promo.</div>
    ${firstMin > 0 ? `<div class="debt-alert warn"><i class="ti ti-alert-triangle"></i> First payment on the card is about ${fmtMoney(firstMin)} (${parseFloat(o.firstMinPct) || 0}%), then ${fmtMoney(parseFloat(o.minPayment) || 0)}/mo.</div>` : ''}
    ${limit > 0 && total + fee > limit + 0.5 ? `<div class="debt-alert bad"><i class="ti ti-alert-triangle"></i> That plus the fee is over the ${debtMoney0(limit)} limit.</div>` : ''}`;
}
async function saveDebtOffer() {
  debtOfferRead();
  const o = debtOfferDraft, state = window.__debtOfferState;
  if (!o.name) { alert('Give the card a name.'); return; }
  const months = Math.max(1, parseInt(o.months) || 12);
  const afterRate = parseFloat(o.afterRate);
  if (isNaN(afterRate)) { alert('Enter the rate after the promo.'); return; }
  const date = o.date || todayStr();
  const fp = (parseFloat(o.feePct) || 0) / 100;
  const card = {
    id: uid(), name: o.name, kind: 'card', lender: o.lender, last4: o.last4, holder: o.holder,
    limit: parseFloat(o.limit) || null,
    rates: [{ from: date, rate: 0, promo: true }, { from: debtAddMonths(date, months), rate: afterRate, promo: false }],
    minInterestOnly: false, minPayment: parseFloat(o.minPayment) || null,
    notes: `${(fp * 100).toFixed(1).replace(/\.0$/, '')}% transfer fee. ${parseFloat(o.firstMinPct) || 0}% minimum the first month.`,
    closed: false, createdAt: new Date().toISOString()
  };
  await saveDebtRec(card);
  await saveDebtActivityRec({ id: uid(), debtId: card.id, date, kind: 'start', amount: 0, note: 'New card' });
  for (const r of state.debts) {
    const amt = Math.min(Number(o.alloc && o.alloc[r.debt.id]) || 0, r.balance);
    if (amt > 0) await debtRecordMove(r.debt.id, card.id, Math.round(amt * 100) / 100, amt * fp, date, `${debtName(r.debt)} → ${debtName(card)}`);
  }
  debtOfferDraft = null;
  openDebt(card.id);
}

// ---------- update several rates ----------
// Lines of credit follow prime, so a Bank of Canada move shifts them all at once.
async function goDebtRates() { currentTab = 'debts'; currentView = 'debtRates'; route(); }
async function renderDebtRates() {
  const today = todayStr();
  const debts = (await getActiveDebts()).filter((d) => !d.closed).sort((a, b) => debtName(a).localeCompare(debtName(b)));
  $main.innerHTML = `
    <div class="back" style="margin-bottom:14px;cursor:pointer" onclick="goDebtsMain()"><i class="ti ti-arrow-left"></i> <span style="font-family:'Fraunces',serif;font-size:17px;margin-left:6px">Update rates</span></div>
    <p class="debt-note" style="margin-bottom:10px">Change the ones that moved; leave the rest. Promos and scheduled changes stay as they are.</p>
    <div class="field"><label class="field-label">New rates start on</label><input type="date" id="drs_from" value="${today}"></div>
    <div class="card tight">${debts.map((d) => {
      const cur = debtRateAt(d, today);
      return `<div class="debt-offer-row"><div><p>${esc(debtName(d))}</p><p class="sub">Now ${debtPct(cur.rate)}${cur.promo ? ' promo' : ''}${d.holder ? ' · ' + esc(d.holder) : ''}</p></div>
        <input type="number" step="0.01" data-debt="${d.id}" data-cur="${cur.rate}" value="${cur.rate}"></div>`;
    }).join('') || '<p class="debt-note">No debts yet.</p>'}</div>
    <button class="btn btn-primary" style="margin-top:12px" onclick="saveDebtRates()">Save rates</button>
  `;
}
async function saveDebtRates() {
  const from = document.getElementById('drs_from').value || todayStr();
  const inputs = [...document.querySelectorAll('input[data-debt]')];
  let changed = 0;
  for (const el of inputs) {
    const v = parseFloat(el.value);
    if (isNaN(v) || Math.abs(v - parseFloat(el.dataset.cur)) < 0.0001) continue;
    const d = await DB.get('debts', el.dataset.debt);
    debtApplyRate(d, from, v, false);
    await saveDebtRec(d);
    changed++;
  }
  if (!changed) { alert('No rates were changed.'); return; }
  goDebtsMain();
}

// ---------- interest breakdown ----------
// Where "Interest this month" comes from, debt by debt, and what it becomes as the
// scheduled rate changes land (if nothing is moved or paid).
async function openDebtInterestSheet() {
  const state = await loadDebtState();
  const today = state.today;
  const owing = state.debts.filter((r) => !r.debt.closed && r.balance > DEBT_EPS)
    .sort((a, b) => (b.balance * b.rateNow) - (a.balance * a.rateNow) || b.balance - a.balance);
  const total = owing.reduce((s, r) => s + r.balance * r.rateNow / 1200, 0);
  const changeDates = [...new Set(owing.map((r) => debtSortedRates(r.debt).filter((p) => p.from > today && debtDaysBetween(today, p.from) <= 366).map((p) => p.from)).flat())].sort();
  const future = changeDates.map((date) => {
    const changed = owing.filter((r) => debtSortedRates(r.debt).some((p) => p.from === date));
    const amt = owing.reduce((s, r) => s + r.balance * debtRateAt(r.debt, date).rate / 1200, 0);
    return { date, amt, what: changed.map((r) => `${debtName(r.debt)} to ${debtPct(debtRateAt(r.debt, date).rate)}`).join(', ') };
  });
  document.getElementById('modalSheet').innerHTML = `
    <div class="sheet-handle"></div>
    <p class="display" style="font-size:18px;margin-bottom:2px">Interest this month</p>
    <p style="font-size:12px;color:var(--ink-soft);margin-bottom:12px">Balance × rate ÷ 12, at today's rates</p>
    <div class="card tight">
      ${owing.map((r) => `<div class="list-row" style="cursor:default;align-items:flex-start"><div><p style="margin:0;font-size:14px">${esc(debtName(r.debt))}</p><p class="debt-note" style="margin:2px 0 0">${fmtMoney(r.balance)} × ${debtPct(r.rateNow)}${r.promoNow ? ' promo' : ''}</p></div><span style="font-weight:600;font-size:14px">${fmtMoney(r.balance * r.rateNow / 1200)}</span></div>`).join('')}
      <div class="list-row" style="cursor:default"><span style="font-weight:600">Total</span><span style="font-weight:600">${fmtMoney(total)}</span></div>
    </div>
    ${future.length ? `<p class="section-label" style="margin-top:12px">Coming up, if nothing moves</p>
    <div class="card tight">${future.map((f) => `<div class="list-row" style="cursor:default;align-items:flex-start"><div><p style="margin:0;font-size:14px">From ${fmtDateYear(f.date)}</p><p class="debt-note" style="margin:2px 0 0">${esc(f.what)}</p></div><span style="font-weight:600;font-size:14px${f.amt > total * 1.5 ? ';color:var(--red)' : ''}">${fmtMoney(f.amt)}/mo</span></div>`).join('')}</div>` : ''}
    <p class="debt-note" style="margin:8px 0 12px">Estimates. Your lender's statement is the real figure.</p>
    <button class="btn" onclick="closeModal()">Close</button>`;
  openModal();
}

// ---------- account number ----------
function debtMaskAccount(n) {
  const s = String(n || '');
  return s.length <= 4 ? s : '•'.repeat(Math.min(8, s.length - 4)) + s.slice(-4);
}
async function toggleDebtAccount(id) {
  const d = await DB.get('debts', id);
  const el = document.getElementById('debtAcctNum');
  if (!d || !el) return;
  const shown = el.dataset.shown === '1';
  el.textContent = shown ? debtMaskAccount(d.accountNumber) : d.accountNumber;
  el.dataset.shown = shown ? '0' : '1';
  const eye = document.getElementById('debtAcctEye');
  if (eye) eye.className = 'ti ' + (shown ? 'ti-eye' : 'ti-eye-off');
}
async function copyDebtAccount(id) {
  const d = await DB.get('debts', id);
  if (!d || !d.accountNumber) return;
  try { await navigator.clipboard.writeText(d.accountNumber); } catch (e) { return; }
  const ic = document.getElementById('debtAcctCopy');
  if (ic) { ic.className = 'ti ti-check'; setTimeout(() => { ic.className = 'ti ti-copy'; }, 1200); }
}

// ---------- Log payment → Finance ----------
// Payments are Finance entries: this opens Add entry with the Debt payment category
// and this debt already picked, so it's one place for all payments.
async function goDebtPayInFinance(id) {
  await ensureDebtPaymentCategory();
  const cats = await DB.getAll('categories');
  const cat = cats.find((c) => !c.deleted && !c.hidden && c.conditionalField === 'debt') || cats.find((c) => !c.deleted && c.conditionalField === 'debt');
  const d = await DB.get('debts', id);
  duplicateSource = { date: todayStr(), categoryId: cat ? cat.id : null, type: cat ? (cat.type || 'expense') : 'expense', debtId: id, debtName: debtName(d), amount: '', description: '' };
  goTab('finance', 'add');
}

// ---------- used by the Finance entry form ----------
// Debts to choose from on a Debt payment entry: anything open, owing first.
async function getDebtPickerList() {
  try {
    const state = await loadDebtState();
    return state.debts.filter((r) => !r.debt.closed)
      .sort((a, b) => (b.balance > DEBT_EPS) - (a.balance > DEBT_EPS) || b.rateNow - a.rateNow)
      .map((r) => ({ id: r.debt.id, name: debtName(r.debt), balance: r.balance }));
  } catch (e) { return []; }
}
