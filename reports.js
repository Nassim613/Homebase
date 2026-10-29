// Homebase — Reports sheet
// ---------------------------------------------------------------
// Pick a report (weekly, monthly, yearly, category, store), then preview it,
// download it as a PDF, or email the PDF. Every PDF made here (emailed or just
// downloaded) is saved to "Homebase Reports" in Drive and listed in Report
// history, where it can be opened, downloaded or sent again.
//
// The reports themselves are built on this device by report-builder.js, from
// the same data the app shows. Apps Script only stores, emails and logs them.
//
// Loaded from index.html after report-builder.js and before app.js. The way in
// is the "Reports" button in Finance → Reports, which calls HomebaseReports.open().

window.HomebaseReports = (function () {
  'use strict';

  var STYLES = [
    '.hbr-overlay { position: fixed; inset: 0; z-index: 900; background: rgba(43,38,64,.45); display: flex; align-items: flex-end; justify-content: center; overflow-y: auto; }',
    '.hbr-sheet { width: 100%; max-width: 480px; background: #F7F3E9; border-radius: 22px 22px 0 0; padding: 20px 18px calc(28px + env(safe-area-inset-bottom)); font-family: Georgia, serif; color: #2B2640; max-height: 92vh; overflow-y: auto; }',
    '@media (min-width: 520px) { .hbr-overlay { align-items: center; } .hbr-sheet { border-radius: 22px; } }',
    '.hbr-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }',
    '.hbr-title { font-size: 20px; font-weight: 600; }',
    '.hbr-x { background: none; border: none; font-size: 26px; line-height: 1; color: #8a8296; cursor: pointer; padding: 0 4px; }',
    '.hbr-label { font-size: 11px; color: #8a8296; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 8px; }',
    '.hbr-note { font-size: 12px; color: #8a8296; margin: 0 0 16px; }',
    '.hbr-rowhead { display: flex; align-items: baseline; justify-content: space-between; margin-top: 18px; }',
    '.hbr-types { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; }',
    '.hbr-type { font-family: inherit; font-size: 13px; padding: 7px 13px; border-radius: 18px; border: 1px solid #E4DCC8; background: #FFFDF7; color: #2B2640; cursor: pointer; }',
    '.hbr-type.is-on { background: #2B2640; border-color: #2B2640; color: #F7F3E9; }',
    '.hbr-period { display: flex; align-items: center; justify-content: space-between; width: 100%; border: 1px solid #E4DCC8; background: #FFFDF7; border-radius: 10px; padding: 11px 12px; margin-bottom: 6px; font-family: inherit; font-size: 14px; color: #2B2640; text-align: left; cursor: pointer; }',
    '.hbr-period.is-on { background: #EFE7D5; border-color: #BA7517; font-weight: 600; }',
    '.hbr-period em { font-style: normal; font-size: 11px; color: #8a8296; font-weight: normal; }',
    '.hbr-check { color: #BA7517; }',
    '.hbr-more { margin-bottom: 6px; }',
    '.hbr-more summary { font-size: 12px; color: #8a6412; cursor: pointer; padding: 6px 0; list-style: none; }',
    '.hbr-select { width: 100%; box-sizing: border-box; border: 1px solid #E4DCC8; border-radius: 10px; padding: 11px 12px; font-family: inherit; font-size: 14px; color: #2B2640; background: #FFFDF7; margin-bottom: 6px; }',
    '.hbr-seg { display: flex; background: #EFE7D5; border-radius: 10px; padding: 3px; margin-bottom: 6px; }',
    '.hbr-seg button { flex: 1; padding: 8px 0; border: none; background: none; border-radius: 8px; font-family: inherit; font-size: 13px; color: #8a8296; cursor: pointer; }',
    '.hbr-seg button.is-on { background: #F7F3E9; color: #2B2640; border: 1px solid #E4DCC8; }',
    '.hbr-checkrow { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 14px; }',
    '.hbr-checkrow input { width: 18px; height: 18px; accent-color: #BA7517; flex: none; }',
    '.hbr-checkrow em { font-style: normal; font-size: 11px; color: #8a8296; }',
    '.hbr-card { border: 1px solid #E4DCC8; background: #FFFDF7; border-radius: 10px; padding: 12px; margin-bottom: 8px; }',
    '.hbr-cardrow { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }',
    '.hbr-cardrow em { display: block; font-style: normal; font-size: 11px; color: #8a8296; }',
    '.hbr-meta { display: block; font-style: normal; font-size: 11px; color: #8a8296; margin-top: 6px; }',
    '.hbr-cardactions { display: flex; gap: 6px; margin-top: 10px; }',
    '.hbr-badge { font-size: 10px; padding: 2px 7px; border-radius: 8px; background: #EFE7D5; color: #6b5a33; white-space: nowrap; }',
    '.hbr-edit { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }',
    '.hbr-edit input, .hbr-add input, .hbr-input { border: 1px solid #E4DCC8; border-radius: 10px; padding: 10px 11px; font-family: inherit; font-size: 14px; background: #FFFDF7; color: #2B2640; width: 100%; box-sizing: border-box; }',
    '.hbr-add { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 20px; }',
    '.hbr-add input { border-style: dashed; background: transparent; }',
    '.hbr-btn { flex: 1; border: 1px solid #C9C2B2; background: #F7F3E9; border-radius: 10px; padding: 11px 12px; font-family: inherit; font-size: 14px; color: #2B2640; cursor: pointer; }',
    '.hbr-btn[disabled] { opacity: .55; cursor: default; }',
    '.hbr-btn--primary { background: #2B2640; border-color: #2B2640; color: #F7F3E9; }',
    '.hbr-btn--good { background: #0F6E56; border-color: #0F6E56; color: #fff; }',
    '.hbr-btn--danger { background: #F4E3E5; border-color: #E3C4C7; color: #C9564F; }',
    '.hbr-row { display: flex; gap: 8px; }',
    '.hbr-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 18px; }',
    '.hbr-link { background: none; border: none; font-family: inherit; font-size: 12px; color: #8a6412; cursor: pointer; padding: 0; }',
    '.hbr-link--center { display: block; width: 100%; text-align: center; margin-top: 14px; }',
    '.hbr-error { font-size: 13px; color: #C9564F; margin: 14px 0 0; }',
    '.hbr-ok { font-size: 13px; color: #0F6E56; margin: 14px 0 0; }',
    '.hbr-busy { font-size: 13px; color: #8a6412; margin: 14px 0 0; }',
    '.hbr-preview { position: fixed; inset: 0; z-index: 950; background: #5d5870; display: flex; flex-direction: column; }',
    '.hbr-previewbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #F7F3E9; padding: 10px 14px; padding-top: calc(10px + env(safe-area-inset-top)); font-family: Georgia, serif; font-size: 14px; color: #2B2640; }',
    '.hbr-previewbar .hbr-btn { flex: none; padding: 8px 12px; font-size: 13px; }',
    '.hbr-pages { flex: 1; overflow: auto; -webkit-overflow-scrolling: touch; padding: 14px 0 30px; }',
    '.hbr-pagewrap { margin: 0 auto 14px; box-shadow: 0 2px 10px rgba(0,0,0,.25); background: #fff; overflow: hidden; }',
    '.hbr-pagewrap > .page { transform-origin: 0 0; }',
    '.hbr-stage { position: absolute; left: -20000px; top: 0; width: 816px; pointer-events: none; }'
  ].join('\n');

  var TYPES = [
    { id: 'weekly', label: 'Weekly' }, { id: 'monthly', label: 'Monthly' }, { id: 'yearly', label: 'Yearly' },
    { id: 'category', label: 'Category' }, { id: 'store', label: 'Store' }
  ];
  var MAX_INLINE = 4;      // periods shown before "More"

  var root = null;
  var opts = null;         // pickers from the builder
  var state = {
    screen: 'send',        // send | manage | history
    type: 'monthly',
    pick: { weekly: 0, monthly: 0, yearly: 0 },
    category: '', store: '', scope: 'all',
    recipients: [], checked: {}, oneOff: '',
    log: [], sentIndex: {},
    busy: '', error: '', notice: '',
    ready: null            // { blob, name } waiting for a tap to save (phones)
  };

  // ---------- small helpers ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    var v = Number(n) || 0;
    return (v < 0 ? '−' : '') + '$' + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function isPhone() { return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || ''); }
  function nameFor(email) {
    var r = state.recipients.filter(function (x) { return x.email === email; })[0];
    return r ? r.name : (email ? String(email).split('@')[0] : '');
  }
  function whoAmI() {
    var email = (typeof Auth !== 'undefined' && Auth.email) || '';
    var r = state.recipients.filter(function (x) { return x.email === email; })[0];
    return r ? r.name : (email ? email.split('@')[0] : '');
  }

  // ---------- server ----------

  function endpoint() {
    if (typeof DB === 'undefined') return Promise.reject(new Error('Homebase hasn’t finished loading yet.'));
    return DB.get('settings', 'meta').then(function (meta) {
      if (!meta || !meta.sheetUrl) throw new Error('No Google Sheet connected yet. Set one under Settings, Sync & data.');
      return meta.sheetUrl;
    });
  }
  // auth.js declares Auth with const, so it lives in the shared global scope,
  // not on window. ensureToken() also renews an expired token silently.
  function token() {
    if (typeof Auth === 'undefined') return Promise.reject(new Error('Sign-in hasn’t loaded yet.'));
    return Promise.resolve(Auth.ensureToken()).then(function (t) {
      if (!t) throw new Error('You’re signed out. Sign in again, then retry.');
      return t;
    });
  }
  function post(payload) {
    return Promise.all([endpoint(), token()]).then(function (r) {
      return fetch(r[0], { method: 'POST', body: JSON.stringify(Object.assign({ token: r[1] }, payload)) });
    }).then(function (res) {
      if (!res.ok) throw new Error('Your Sheet returned an error (' + res.status + '). Try again.');
      return res.json();
    }).then(function (data) {
      // Apps Script answers 200 even when something failed, so check the body.
      if (!data || data.ok !== true) throw new Error((data && data.error) || 'That didn’t go through. Try again.');
      return data;
    });
  }

  function loadRecipients() {
    return post({ action: 'reportRecipients' }).then(function (data) {
      state.recipients = data.recipients || [];
      state.recipients.forEach(function (r) { if (state.checked[r.email] === undefined) state.checked[r.email] = true; });
    });
  }
  function saveRecipients() {
    return post({ action: 'reportRecipients', recipients: state.recipients }).then(function (data) { state.recipients = data.recipients || []; });
  }
  function loadLog() {
    return post({ action: 'reportLog', limit: 60 }).then(function (data) {
      state.log = data.log || [];
      state.sentIndex = {};
      state.log.forEach(function (r) {
        var key = r.type + '|' + r.start;
        if (r.kind !== 'downloaded' && !state.sentIndex[key]) state.sentIndex[key] = r.sentAt;
      });
    });
  }
  function selectedRecipients() {
    var out = state.recipients.filter(function (r) { return state.checked[r.email]; });
    var once = String(state.oneOff || '').trim();
    if (once && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(once)) out = out.concat([{ name: once, email: once }]);
    return out;
  }

  // ---------- what's selected ----------

  function periodList() {
    if (!opts) return [];
    return state.type === 'weekly' ? opts.weeks : state.type === 'monthly' ? opts.months : state.type === 'yearly' ? opts.years : [];
  }
  function request() {
    var t = state.type, req = { type: t, user: whoAmI() };
    if (t === 'category') { req.value = state.category; req.scope = state.scope; }
    else if (t === 'store') { req.value = state.store; req.scope = state.scope; }
    else { var p = periodList()[state.pick[t]]; req.value = p ? p.value : null; }
    if (!req.value) throw new Error(t === 'category' ? 'Pick a category first.' : t === 'store' ? 'Pick a store first.' : 'There’s nothing to report on yet.');
    return req;
  }
  function sentLabel(type, value) {
    var start = type === 'weekly' ? value : type === 'monthly' ? value + '-01' : value + '-01-01';
    var at = state.sentIndex[type + '|' + start];
    if (!at) return '';
    var d = new Date(at);
    return 'sent ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ---------- rendering ----------

  function render() {
    if (!root) return;
    var body = state.screen === 'manage' ? renderManage() : state.screen === 'history' ? renderHistory() : renderSend();
    var sheet = root.querySelector('.hbr-sheet');
    var top = sheet.scrollTop;
    sheet.innerHTML = body;
    sheet.scrollTop = top;
  }

  function renderSend() {
    var chosen = selectedRecipients();
    var dis = state.busy ? ' disabled' : '';
    var h = '<div class="hbr-head"><span class="hbr-title">Reports</span><button class="hbr-x" data-act="close" aria-label="Close">&times;</button></div>';
    h += '<p class="hbr-label">Report</p><div class="hbr-types">' + TYPES.map(function (t) {
      return '<button class="hbr-type' + (state.type === t.id ? ' is-on' : '') + '" data-act="type" data-type="' + t.id + '">' + t.label + '</button>';
    }).join('') + '</div>';

    if (!opts) {
      h += '<p class="hbr-note">Loading your data…</p>';
    } else if (state.type === 'category' || state.type === 'store') {
      var isCat = state.type === 'category';
      var list = isCat ? opts.categories : opts.stores;
      var cur = isCat ? state.category : state.store;
      h += '<p class="hbr-label">' + (isCat ? 'Category' : 'Store') + '</p>';
      h += '<select class="hbr-select" data-act="' + (isCat ? 'category' : 'store') + '"><option value="">Choose a ' + (isCat ? 'category' : 'store') + '…</option>' +
        list.map(function (o) { return '<option value="' + esc(o.value) + '"' + (o.value === cur ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>';
      var sel = list.filter(function (o) { return o.value === cur; })[0];
      var startLabel = new Date(opts.catStart + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
      h += '<p class="hbr-note">' + (sel ? 'Since ' + startLabel + ' · ' + sel.count + ' entries' : 'Covers ' + startLabel + ' to today.') + '</p>';
      h += '<p class="hbr-label">Entries to include</p><div class="hbr-seg">' +
        '<button data-act="scope" data-scope="all"' + (state.scope === 'all' ? ' class="is-on"' : '') + '>All since ' + esc(startLabel) + '</button>' +
        '<button data-act="scope" data-scope="12"' + (state.scope === '12' ? ' class="is-on"' : '') + '>Last 12 months</button></div>';
      if (sel) {
        var est = 2 + Math.ceil((state.scope === 'all' ? sel.count : Math.round(sel.count * 12 / Math.max(monthsSince(opts.catStart), 1))) / 44);
        h += '<p class="hbr-note">About ' + est + ' pages</p>';
      }
    } else {
      var periods = periodList(), idx = state.pick[state.type] || 0;
      h += '<p class="hbr-label">' + (state.type === 'weekly' ? 'Week' : state.type === 'monthly' ? 'Month' : 'Year') + '</p>';
      if (!periods.length) h += '<p class="hbr-note">Nothing to report on yet.</p>';
      var row = function (o, i) {
        var tag = sentLabel(state.type, o.value);
        return '<button class="hbr-period' + (i === idx ? ' is-on' : '') + '" data-act="period" data-index="' + i + '"><span>' + esc(o.label) +
          (o.sub ? ' <em>· ' + esc(o.sub) + '</em>' : '') + '</span>' + '<span>' + (tag ? '<em>' + esc(tag) + '</em>' : '') + (i === idx ? ' <span class="hbr-check">&#10003;</span>' : '') + '</span></button>';
      };
      periods.slice(0, MAX_INLINE).forEach(function (o, i) { h += row(o, i); });
      if (periods.length > MAX_INLINE) {
        h += '<details class="hbr-more"' + (idx >= MAX_INLINE ? ' open' : '') + '><summary>More ' + (state.type === 'weekly' ? 'weeks' : state.type === 'monthly' ? 'months' : 'years') + '</summary>';
        periods.slice(MAX_INLINE).forEach(function (o, i) { h += row(o, i + MAX_INLINE); });
        h += '</details>';
      }
    }

    h += '<div class="hbr-rowhead"><p class="hbr-label">Send to</p><button class="hbr-link" data-act="manage">Manage</button></div>';
    if (!state.recipients.length) h += '<p class="hbr-note">No saved recipients yet.</p>';
    state.recipients.forEach(function (r) {
      h += '<label class="hbr-checkrow"><input type="checkbox" data-act="recipient" data-email="' + esc(r.email) + '"' + (state.checked[r.email] ? ' checked' : '') + '>' +
        '<span>' + esc(r.name) + ' <em>' + esc(r.email) + '</em></span></label>';
    });

    if (state.busy) h += '<p class="hbr-busy">' + esc(state.busy) + '</p>';
    if (state.error) h += '<p class="hbr-error">' + esc(state.error) + '</p>';
    if (state.notice) h += '<p class="hbr-ok">' + esc(state.notice) + '</p>';

    h += '<div class="hbr-actions">';
    if (state.ready) h += '<button class="hbr-btn hbr-btn--good" data-act="save-ready">Save ' + esc(state.ready.name) + '</button>';
    h += '<div class="hbr-row"><button class="hbr-btn" data-act="preview"' + dis + '>Preview PDF</button><button class="hbr-btn" data-act="download"' + dis + '>Download</button></div>' +
      '<button class="hbr-btn hbr-btn--primary" data-act="send"' + dis + '>' + (chosen.length ? 'Email PDF to ' + chosen.length + (chosen.length === 1 ? ' person' : ' people') : 'Email PDF') + '</button></div>';
    h += '<button class="hbr-link hbr-link--center" data-act="history">Report history</button>';
    return h;
  }

  function monthsSince(startISO) {
    var s = new Date(startISO + 'T00:00:00'), n = new Date();
    return (n.getFullYear() - s.getFullYear()) * 12 + n.getMonth() - s.getMonth() + 1;
  }

  function renderManage() {
    var h = '<div class="hbr-head"><span class="hbr-title">Recipients</span><button class="hbr-x" data-act="back" aria-label="Back">&times;</button></div>' +
      '<p class="hbr-note">Shared list · everyone signed in sees the same one</p>';
    state.recipients.forEach(function (r, i) {
      h += '<div class="hbr-card"><div class="hbr-cardrow"><div><strong>' + esc(r.name) + '</strong><em>' + esc(r.email) + '</em></div>' +
        '<button class="hbr-link" data-act="toggle-edit" data-index="' + i + '">' + (r._editing ? 'Done' : 'Edit') + '</button></div>';
      if (r._editing) {
        h += '<div class="hbr-edit"><input type="text" data-act="edit-name" data-index="' + i + '" value="' + esc(r.name) + '" placeholder="Name">' +
          '<input type="email" data-act="edit-email" data-index="' + i + '" value="' + esc(r.email) + '" placeholder="name@example.com">' +
          '<button class="hbr-btn hbr-btn--danger" data-act="remove" data-index="' + i + '">Remove</button></div>';
      }
      h += '</div>';
    });
    h += '<div class="hbr-add"><input type="text" data-act="new-name" placeholder="Name"><input type="email" data-act="new-email" placeholder="name@example.com">' +
      '<button class="hbr-btn" data-act="add">Add</button></div>';
    h += '<p class="hbr-label">Send once, don’t save</p><input class="hbr-input" type="email" data-act="oneoff" placeholder="name@example.com" value="' + esc(state.oneOff) + '">';
    if (state.error) h += '<p class="hbr-error">' + esc(state.error) + '</p>';
    h += '<div class="hbr-actions"><button class="hbr-btn hbr-btn--primary" data-act="save"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Saving…' : 'Done') + '</button></div>';
    return h;
  }

  var TYPE_LABEL = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', category: 'Category', store: 'Store', week: 'Weekly', month: 'Monthly', custom: 'Custom' };

  function renderHistory() {
    var h = '<div class="hbr-head"><span class="hbr-title">Report history</span><button class="hbr-x" data-act="back" aria-label="Back">&times;</button></div>' +
      '<p class="hbr-note">Shared between you both · PDFs live in “Homebase Reports” in Drive</p>';
    if (state.busy) h += '<p class="hbr-busy">' + esc(state.busy) + '</p>';
    if (!state.log.length && !state.busy) h += '<p class="hbr-note">No reports yet.</p>';
    state.log.forEach(function (r) {
      var when = r.sentAt ? new Date(r.sentAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      var who = (r.recipients || []).map(function (x) { return x.name || x.email; }).join(', ');
      var what = r.kind === 'downloaded' ? 'Downloaded ' + when + ' by ' + nameFor(r.sentBy) : 'Sent ' + when + ' by ' + nameFor(r.sentBy) + ' · to ' + who + (r.resend ? ' · resend' : '');
      var money_ = (r.type === 'category' || r.type === 'store') ? '<span class="hbr-badge">' + (r.pages ? r.pages + ' pages' : 'PDF') + '</span>'
        : '<span style="color:' + ((r.net || 0) >= 0 ? '#0F6E56' : '#C9564F') + ';font-weight:600">' + ((r.net || 0) >= 0 ? '+' : '') + money(r.net) + '</span>';
      h += '<div class="hbr-card"><div class="hbr-cardrow"><strong>' + esc(TYPE_LABEL[r.type] || 'Report') + ' · ' + esc(r.label) + '</strong>' + money_ + '</div>' +
        '<em class="hbr-meta">' + esc(what) + '</em><div class="hbr-cardactions">' +
        '<button class="hbr-btn" data-act="view-log" data-id="' + esc(r.id) + '">View</button>' +
        (r.fileId ? '<button class="hbr-btn" data-act="download-log" data-id="' + esc(r.id) + '">Download</button>' : '') +
        '<button class="hbr-btn" data-act="resend" data-id="' + esc(r.id) + '">Send again</button></div></div>';
    });
    if (state.error) h += '<p class="hbr-error">' + esc(state.error) + '</p>';
    if (state.notice) h += '<p class="hbr-ok">' + esc(state.notice) + '</p>';
    return h;
  }

  // ---------- building ----------

  // Builds the selected report into real pages on an off-screen stage.
  function buildPages() {
    var req = request();
    return HomebaseReportBuilder.build(req).then(function (rep) {
      var stage = document.querySelector('.hbr-stage');
      if (!stage) { stage = document.createElement('div'); stage.className = 'hbr-stage'; document.body.appendChild(stage); }
      var pages = HomebaseReportBuilder.render(rep, stage);
      return waitForImages(stage).then(function () { return { rep: rep, pages: pages }; });
    });
  }
  function waitForImages(node) {
    var imgs = Array.prototype.slice.call(node.querySelectorAll('img'));
    return Promise.all(imgs.map(function (img) {
      if (img.complete) return null;
      return new Promise(function (res) { img.onload = img.onerror = res; setTimeout(res, 4000); });
    }));
  }
  function makePdf(built) {
    return HomebaseReportBuilder.toPdf(built.pages, function (i, n) {
      state.busy = 'Making the PDF — page ' + i + ' of ' + n + '…';
      render();
    });
  }
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1]); };
      r.onerror = function () { reject(new Error('Couldn’t read the PDF.')); };
      r.readAsDataURL(blob);
    });
  }
  function base64ToBlob(b64) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: 'application/pdf' });
  }

  // Phones: the share sheet (Save to Files, AirDrop, Drive…). Computers: a normal download.
  function saveBlob(blob, name) {
    try {
      var file = new File([blob], name, { type: 'application/pdf' });
      if (isPhone() && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: name }).catch(function (e) { if (e && e.name !== 'AbortError') throw e; });
      }
    } catch (e) { /* fall through to a plain download */ }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 8000);
    return Promise.resolve();
  }
  // On a phone the share sheet needs a fresh tap, so a finished PDF waits on a button.
  function deliver(blob, name) {
    if (isPhone()) { state.ready = { blob: blob, name: name }; return Promise.resolve(); }
    return saveBlob(blob, name);
  }

  function logMeta(rep, pages) {
    return Object.assign({}, rep.meta, { label: rep.label, pages: pages, fileName: rep.fileName, subject: rep.subject });
  }

  function run(fn) {
    state.busy = 'Working…'; state.error = ''; state.notice = '';
    render();
    return Promise.resolve().then(fn).catch(function (err) {
      state.error = (err && err.message) || String(err);
    }).then(function () { state.busy = ''; render(); });
  }

  function doPreview() {
    return run(function () {
      state.busy = 'Building the report…'; render();
      return buildPages().then(function (b) { showPreview(b); });
    });
  }

  function doDownload() {
    return run(function () {
      state.busy = 'Building the report…'; render();
      return buildPages().then(function (b) {
        return makePdf(b).then(function (blob) {
          return deliver(blob, b.rep.fileName).then(function () {
            state.busy = 'Saving a copy to Drive…'; render();
            return blobToBase64(blob).then(function (b64) {
              return post({ action: 'reportSave', pdf: b64, meta: logMeta(b.rep, b.pages.length), html: HomebaseReportBuilder.emailHtml(b.rep, b.pages.length) });
            }).then(function () {
              state.notice = state.ready ? 'Ready. Tap Save to keep it on this phone. A copy is in Drive and Report history.' : 'Downloaded. A copy is in Drive and Report history.';
            }).catch(function (err) {
              state.notice = state.ready ? 'Ready. Tap Save to keep it.' : 'Downloaded.';
              state.error = 'Couldn’t save a copy to Drive: ' + err.message;
            });
          });
        });
      });
    });
  }

  function doSend() {
    var chosen = selectedRecipients();
    if (!chosen.length) { state.error = 'Tick at least one person to send to.'; return render(); }
    return run(function () {
      state.busy = 'Building the report…'; render();
      return buildPages().then(function (b) {
        return makePdf(b).then(function (blob) {
          state.busy = 'Sending…'; render();
          return blobToBase64(blob).then(function (b64) {
            return post({
              action: 'reportSend', pdf: b64, recipients: chosen, meta: logMeta(b.rep, b.pages.length),
              subject: b.rep.subject, html: HomebaseReportBuilder.emailHtml(b.rep, b.pages.length)
            });
          }).then(function (data) {
            state.notice = 'Sent to ' + data.sent + (data.sent === 1 ? ' person' : ' people') + '. A copy is in Drive.';
            state.oneOff = '';
            return loadLog().catch(function () {});
          });
        });
      });
    });
  }

  function doViewLog(id) {
    var rec = state.log.filter(function (r) { return r.id === id; })[0];
    if (rec && rec.fileUrl) { window.open(rec.fileUrl, '_blank', 'noopener'); return; }
    return run(function () {
      return post({ action: 'reportView', logId: id }).then(function (data) { showHtml(data.html); });
    });
  }
  function doDownloadLog(id) {
    var rec = state.log.filter(function (r) { return r.id === id; })[0];
    return run(function () {
      state.busy = 'Fetching the PDF from Drive…'; render();
      return post({ action: 'reportFile', logId: id }).then(function (data) {
        return deliver(base64ToBlob(data.pdf), data.fileName || (rec && rec.fileName) || 'Homebase report.pdf');
      }).then(function () { if (state.ready) state.notice = 'Ready. Tap Save to keep it.'; });
    });
  }
  function doResend(id) {
    var chosen = selectedRecipients();
    return run(function () {
      state.busy = 'Sending…'; render();
      return post({ action: 'reportResend', logId: id, recipients: chosen }).then(function (data) {
        state.notice = 'Sent again to ' + data.sent + (data.sent === 1 ? ' person' : ' people') + '.';
        return loadLog();
      });
    });
  }

  // ---------- preview ----------

  function showPreview(built) {
    var ov = document.createElement('div');
    ov.className = 'hbr-preview';
    ov.innerHTML = '<div class="hbr-previewbar"><span>' + esc(built.rep.label) + ' · ' + built.pages.length + (built.pages.length === 1 ? ' page' : ' pages') + '</span>' +
      '<span style="display:flex;gap:6px"><button class="hbr-btn" data-act="pv-download">Download</button><button class="hbr-x" data-act="pv-close" aria-label="Close preview">&times;</button></span></div>' +
      '<div class="hbr-pages hbrp"></div>';
    document.body.appendChild(ov);
    var holder = ov.querySelector('.hbr-pages');
    var avail = Math.min(holder.clientWidth - 24, 816);
    var scale = avail / 816;
    built.pages.forEach(function (p) {
      var wrap = document.createElement('div');
      wrap.className = 'hbr-pagewrap';
      wrap.style.width = Math.round(816 * scale) + 'px';
      wrap.style.height = Math.round(1056 * scale) + 'px';
      var clone = p.cloneNode(true);
      clone.style.transform = 'scale(' + scale + ')';
      wrap.appendChild(clone);
      holder.appendChild(wrap);
    });
    history.pushState({ hbPreview: true }, '');
    function close(fromPop) {
      ov.remove();
      window.removeEventListener('popstate', onPop);
      // Stepping history back fires popstate; tell the sheet it isn't for it.
      if (!fromPop && history.state && history.state.hbPreview) { ignorePop = true; history.back(); }
    }
    function onPop() { close(true); }
    window.addEventListener('popstate', onPop);
    ov.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      if (!t) return;
      if (t.getAttribute('data-act') === 'pv-close') close(false);
      if (t.getAttribute('data-act') === 'pv-download') { close(false); doDownload(); }
    });
  }

  // Older reports (before PDFs) are stored as HTML.
  function showHtml(html) {
    var ov = document.createElement('div');
    ov.className = 'hbr-preview';
    ov.innerHTML = '<div class="hbr-previewbar"><span>Report</span><button class="hbr-x" data-act="pv-close" aria-label="Close">&times;</button></div><iframe sandbox="" title="Report" style="flex:1;border:none;background:#F7F3E9"></iframe>';
    document.body.appendChild(ov);
    ov.querySelector('iframe').srcdoc = '<body style="margin:0;background:#F7F3E9">' + html + '</body>';
    ov.addEventListener('click', function (e) { if (e.target.closest('[data-act="pv-close"]')) ov.remove(); });
  }

  // ---------- events ----------

  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    var act = el.getAttribute('data-act');
    if (act === 'close') return close();
    if (act === 'back') { state.screen = 'send'; state.error = ''; return render(); }
    if (act === 'manage') { state.screen = 'manage'; state.error = ''; return render(); }
    if (act === 'history') { state.screen = 'history'; state.error = ''; state.notice = ''; return run(function () { state.busy = 'Loading…'; render(); return loadLog(); }); }
    if (act === 'type') { state.type = el.getAttribute('data-type'); state.error = ''; state.notice = ''; state.ready = null; return render(); }
    if (act === 'period') { state.pick[state.type] = Number(el.getAttribute('data-index')); state.ready = null; return render(); }
    if (act === 'scope') { state.scope = el.getAttribute('data-scope'); state.ready = null; return render(); }
    if (act === 'toggle-edit') { var i = Number(el.getAttribute('data-index')); state.recipients[i]._editing = !state.recipients[i]._editing; return render(); }
    if (act === 'remove') { state.recipients.splice(Number(el.getAttribute('data-index')), 1); return render(); }
    if (act === 'add') {
      var nameEl = root.querySelector('[data-act="new-name"]'), emailEl = root.querySelector('[data-act="new-email"]');
      var email = String(emailEl.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { state.error = 'That doesn’t look like an email address.'; return render(); }
      if (state.recipients.length >= 10) { state.error = 'Ten recipients is the most.'; return render(); }
      state.recipients.push({ name: String(nameEl.value || '').trim() || email, email: email });
      state.checked[email] = true; state.error = '';
      return render();
    }
    if (act === 'save') {
      state.recipients.forEach(function (r) { delete r._editing; });
      return run(function () { return saveRecipients().then(function () { state.screen = 'send'; }); });
    }
    if (act === 'save-ready') { var r = state.ready; state.ready = null; render(); return saveBlob(r.blob, r.name).catch(function (err) { state.error = err.message; render(); }); }
    if (act === 'preview') return doPreview();
    if (act === 'download') return doDownload();
    if (act === 'send') return doSend();
    if (act === 'view-log') return doViewLog(el.getAttribute('data-id'));
    if (act === 'download-log') return doDownloadLog(el.getAttribute('data-id'));
    if (act === 'resend') return doResend(el.getAttribute('data-id'));
  }

  function onChange(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'recipient') { state.checked[el.getAttribute('data-email')] = el.checked; return render(); }
    if (act === 'category') { state.category = el.value; state.ready = null; return render(); }
    if (act === 'store') { state.store = el.value; state.ready = null; return render(); }
    if (act === 'oneoff') { state.oneOff = el.value; return; }
    if (act === 'edit-name') { state.recipients[Number(el.getAttribute('data-index'))].name = el.value; return; }
    if (act === 'edit-email') { state.recipients[Number(el.getAttribute('data-index'))].email = el.value; return; }
  }

  // ---------- open / close ----------

  function injectStyles() {
    if (document.getElementById('hbr-styles')) return;
    var tag = document.createElement('style');
    tag.id = 'hbr-styles';
    tag.textContent = STYLES;
    document.head.appendChild(tag);
  }

  function open(preset) {
    if (root) return;
    injectStyles();
    state.screen = 'send'; state.error = ''; state.notice = ''; state.busy = ''; state.ready = null;
    if (preset && preset.type) state.type = preset.type;
    if (preset && preset.category) state.category = preset.category;
    if (preset && preset.store) state.store = preset.store;
    root = document.createElement('div');
    root.className = 'hbr-overlay';
    root.innerHTML = '<div class="hbr-sheet"></div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) { if (e.target === root) close(); else onClick(e); });
    root.addEventListener('change', onChange);
    root.addEventListener('input', function (e) { var a = e.target.getAttribute('data-act'); if (a === 'oneoff' || a === 'edit-name' || a === 'edit-email') onChange(e); });
    // A phone back press closes the sheet rather than leaving the app.
    history.pushState({ hbReports: true }, '');
    window.addEventListener('popstate', onPop);
    render();
    HomebaseReportBuilder.options().then(function (o) { opts = o; render(); }).catch(function (err) { state.error = err.message; render(); });
    loadRecipients().then(render).catch(function (err) { state.error = err.message; render(); });
    loadLog().then(render).catch(function () { /* history is optional here */ });
  }
  var ignorePop = false;
  function onPop() {
    if (ignorePop) { ignorePop = false; return; }
    if (root && !document.querySelector('.hbr-preview')) close(true);
  }
  function close(fromPop) {
    if (!root) return;
    root.remove();
    root = null;
    var stage = document.querySelector('.hbr-stage');
    if (stage) stage.remove();
    window.removeEventListener('popstate', onPop);
    if (!fromPop && history.state && history.state.hbReports) history.back();
  }

  return { open: open, close: close };
})();
