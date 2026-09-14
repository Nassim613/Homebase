// Homebase — report sending
// ---------------------------------------------------------------
// Drop-in. Add ONE line to index.html, before </body>:
//
//   <script src="reports.js"></script>
//
// It injects its own styles, finds the Apps Script endpoint and the signed-in
// Google token by looking through the page the way sync.js stores them, and
// mounts a "Send report" button. Nothing in app.js needs touching.
//
// If the auto-detection ever misses (renamed variables, a different storage
// key), override it explicitly and everything else keeps working:
//
//   HomebaseReports.init({ endpoint: API_URL, getToken: () => idToken });
//
// To place the button yourself instead of using the floating one, give any
// element id="hb-send-report" — or call HomebaseReports.open() from your own
// button and set HomebaseReports.init({ floatingButton: false }).

window.HomebaseReports = (function () {
  'use strict';

  var STYLES = '/* Homebase — report sending sheet\n   Append to styles.css. Everything is namespaced .hbr- so it can\'t collide\n   with existing rules. */\n\n.hbr-overlay {\n  position: fixed;\n  inset: 0;\n  z-index: 900;\n  background: rgba(43, 38, 64, 0.45);\n  display: flex;\n  align-items: flex-end;\n  justify-content: center;\n  overflow-y: auto;\n}\n\n.hbr-sheet {\n  width: 100%;\n  max-width: 480px;\n  background: #F7F3E9;\n  border-radius: 22px 22px 0 0;\n  padding: 20px 18px calc(28px + env(safe-area-inset-bottom));\n  font-family: Georgia, serif;\n  color: #2B2640;\n  max-height: 92vh;\n  overflow-y: auto;\n}\n\n@media (min-width: 520px) {\n  .hbr-overlay { align-items: center; }\n  .hbr-sheet { border-radius: 22px; }\n}\n\n.hbr-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }\n.hbr-title { font-size: 20px; font-weight: 600; }\n.hbr-x {\n  background: none; border: none; font-size: 24px; line-height: 1;\n  color: #8a8296; cursor: pointer; padding: 0 4px;\n}\n\n.hbr-tabs {\n  display: flex; background: #EFE7D5; border-radius: 10px; padding: 3px; margin-bottom: 18px;\n}\n.hbr-tab {\n  flex: 1; padding: 9px 0; border: none; background: none; border-radius: 8px;\n  font-family: inherit; font-size: 14px; color: #8a8296; cursor: pointer;\n}\n.hbr-tab.is-on {\n  background: #F7F3E9; color: #2B2640; font-weight: 600;\n  border: 1px solid #E4DCC8;\n}\n\n.hbr-label {\n  font-size: 11px; color: #8a8296; letter-spacing: 0.06em;\n  text-transform: uppercase; margin: 0 0 8px;\n}\n.hbr-note { font-size: 12px; color: #8a8296; margin: 0 0 18px; }\n.hbr-rowhead { display: flex; align-items: baseline; justify-content: space-between; margin-top: 20px; }\n\n.hbr-period {\n  display: flex; align-items: center; justify-content: space-between; width: 100%;\n  border: 1px solid #E4DCC8; background: #FFFDF7; border-radius: 10px;\n  padding: 11px 12px; margin-bottom: 8px; font-family: inherit; font-size: 14px;\n  color: #2B2640; text-align: left; cursor: pointer;\n}\n.hbr-period.is-on { background: #EFE7D5; border-color: #BA7517; font-weight: 600; }\n.hbr-period em { font-style: normal; font-size: 11px; color: #8a8296; }\n.hbr-check { color: #BA7517; }\n\n.hbr-more { margin-bottom: 8px; }\n.hbr-more summary {\n  font-size: 12px; color: #8a6412; cursor: pointer; padding: 6px 0; list-style: none;\n}\n\n.hbr-range { display: flex; gap: 10px; margin-bottom: 14px; }\n.hbr-field { flex: 1; display: block; }\n.hbr-field span { display: block; font-size: 11px; color: #8a8296; margin-bottom: 5px; }\n.hbr-field input,\n.hbr-input {\n  width: 100%; box-sizing: border-box; border: 1px solid #E4DCC8; border-radius: 10px;\n  padding: 10px 11px; font-family: inherit; font-size: 14px; color: #2B2640; background: #FFFDF7;\n}\n\n.hbr-chips { display: flex; gap: 6px; margin-bottom: 8px; }\n.hbr-chip {\n  flex: 1; border: 1px solid #E4DCC8; background: #FFFDF7; border-radius: 20px;\n  padding: 7px 0; font-family: inherit; font-size: 12px; color: #2B2640; cursor: pointer;\n}\n\n.hbr-checkrow { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 14px; }\n.hbr-checkrow input { width: 18px; height: 18px; accent-color: #BA7517; flex: none; }\n.hbr-checkrow em { font-style: normal; font-size: 11px; color: #8a8296; }\n\n.hbr-card {\n  border: 1px solid #E4DCC8; background: #FFFDF7; border-radius: 10px;\n  padding: 12px; margin-bottom: 8px;\n}\n.hbr-cardrow { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }\n.hbr-cardrow em { display: block; font-style: normal; font-size: 11px; color: #8a8296; }\n.hbr-meta { display: block; font-style: normal; font-size: 11px; color: #8a8296; margin-top: 6px; }\n.hbr-cardactions { display: flex; gap: 6px; margin-top: 10px; }\n.hbr-pos { color: #0F6E56; font-weight: 600; }\n.hbr-neg { color: #C9564F; font-weight: 600; }\n\n.hbr-edit { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }\n.hbr-edit input {\n  border: 1px solid #E4DCC8; border-radius: 8px; padding: 9px 10px;\n  font-family: inherit; font-size: 14px; background: #F7F3E9; color: #2B2640;\n}\n\n.hbr-add { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 20px; }\n.hbr-add input {\n  border: 1px dashed #C9C2B2; border-radius: 10px; padding: 10px 11px;\n  font-family: inherit; font-size: 14px; background: transparent; color: #2B2640;\n}\n\n.hbr-btn {\n  flex: 1; border: 1px solid #C9C2B2; background: #F7F3E9; border-radius: 10px;\n  padding: 11px 12px; font-family: inherit; font-size: 14px; color: #2B2640; cursor: pointer;\n}\n.hbr-btn[disabled] { opacity: 0.55; cursor: default; }\n.hbr-btn--primary { background: #2B2640; border-color: #2B2640; color: #F7F3E9; }\n.hbr-btn--danger { background: #F4E3E5; border-color: #E3C4C7; color: #C9564F; }\n\n.hbr-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 20px; }\n\n.hbr-link {\n  background: none; border: none; font-family: inherit; font-size: 12px;\n  color: #8a6412; cursor: pointer; padding: 0;\n}\n.hbr-link--center { display: block; width: 100%; text-align: center; margin-top: 14px; }\n\n.hbr-error { font-size: 13px; color: #C9564F; margin: 14px 0 0; }\n.hbr-ok { font-size: 13px; color: #0F6E56; margin: 14px 0 0; }\n.hbr-warn {\n  font-size: 12px; color: #854F0B; background: #FAEEDA;\n  padding: 10px 14px; margin: 0;\n}\n\n.hbr-preview {\n  position: fixed; inset: 0; z-index: 950; background: rgba(43, 38, 64, 0.6);\n  display: flex; flex-direction: column;\n}\n.hbr-previewbar {\n  display: flex; align-items: center; justify-content: space-between;\n  background: #F7F3E9; padding: 12px 16px; font-family: Georgia, serif;\n  font-size: 14px; color: #2B2640; padding-top: calc(12px + env(safe-area-inset-top));\n}\n.hbr-preview iframe { flex: 1; width: 100%; border: none; background: #F7F3E9; }\n\n.hbr-fab {\n  position: fixed;\n  right: 16px;\n  bottom: calc(76px + env(safe-area-inset-bottom));\n  z-index: 880;\n  border: 1px solid #2B2640;\n  background: #2B2640;\n  color: #F7F3E9;\n  font-family: Georgia, serif;\n  font-size: 14px;\n  padding: 11px 16px;\n  border-radius: 22px;\n  box-shadow: 0 4px 14px rgba(43, 38, 64, 0.25);\n  cursor: pointer;\n}\n';

  var cfg = { endpoint: null, getToken: null, floatingButton: true };
  var found = { endpoint: null, tokenSource: null };
  var root = null;

  var state = {
    screen: 'send',        // send | manage | history
    tab: 'week',           // week | month | custom
    weekIndex: 0,
    monthIndex: 0,
    customStart: null,
    customEnd: null,
    includeEntries: true,
    recipients: [],
    checked: {},
    oneOff: '',
    log: [],
    busy: false,
    error: '',
    notice: ''
  };

  // ---------- dates ----------

  function iso(d) {
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function parseISO(s) { return new Date(s + 'T00:00:00'); }
  function addDays(s, n) { var d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); }
  function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }

  // Monday-start weeks, matching the week numbering used elsewhere in the app.
  function mondayOf(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var shift = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - shift);
    return d;
  }
  function isoWeekNumber(dateStr) {
    var d = parseISO(dateStr);
    var target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
    var firstThursday = new Date(target.getFullYear(), 0, 4);
    firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
    return 1 + Math.round((target - firstThursday) / (7 * 86400000));
  }
  function fmtShort(s) {
    return parseISO(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function fmtLong(s) {
    return parseISO(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function fmtMonth(s) {
    return parseISO(s).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  function money(n) {
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function signedMoney(n) { return (n >= 0 ? '+' : '') + money(n); }

  // The last 12 completed Mon–Sun weeks, newest first. The current week only
  // appears once it has actually finished.
  function weekOptions() {
    var out = [];
    var thisMonday = mondayOf(new Date());
    for (var i = 1; i <= 12; i++) {
      var start = iso(new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7 * i));
      var end = addDays(start, 6);
      out.push({ start: start, end: end, label: fmtShort(start) + ' – ' + fmtShort(end), sub: 'week ' + isoWeekNumber(start) });
    }
    return out;
  }

  // The last 12 completed months, newest first.
  function monthOptions() {
    var out = [];
    var now = new Date();
    for (var i = 1; i <= 12; i++) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var start = iso(d);
      var end = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      out.push({ start: start, end: end, label: fmtMonth(start), sub: '' });
    }
    return out;
  }

  function currentPeriod() {
    if (state.tab === 'week') {
      var w = weekOptions()[state.weekIndex];
      return { type: 'week', start: w.start, end: w.end, label: w.label };
    }
    if (state.tab === 'month') {
      var m = monthOptions()[state.monthIndex];
      return { type: 'month', start: m.start, end: m.end, label: m.label };
    }
    return {
      type: 'custom',
      start: state.customStart,
      end: state.customEnd,
      label: fmtShort(state.customStart) + ' – ' + fmtShort(state.customEnd)
    };
  }

  // ---------- config ----------

  // Config resolution. Both of these come straight out of the app: the Web App
  // URL is what saveSheetUrl() stores under settings/meta.sheetUrl, and the ID
  // token hangs off the Auth object auth.js sets up. init() can override either,
  // but normally neither is needed.
  function resolveEndpoint() {
    if (cfg.endpoint) return Promise.resolve(cfg.endpoint);
    if (typeof DB === 'undefined') return Promise.reject(new Error('storage.js has not loaded yet'));
    return DB.get('settings', 'meta').then(function (meta) {
      if (!meta || !meta.sheetUrl) throw new Error('No Google Sheet connected yet — set one under Settings, Sync & data.');
      return meta.sheetUrl;
    });
  }

  // Re-read on every request rather than cached: Google ID tokens expire after
  // an hour, so one that worked earlier in the session may already be dead.
  function resolveToken() {
    if (cfg.getToken) {
      try { var t = cfg.getToken(); if (t) return t; } catch (e) { /* fall through */ }
    }
    if (!window.Auth) return null;
    return Auth.token || Auth.idToken || Auth.credential || Auth.id_token || null;
  }

  // ---------- server ----------

  function post(payload) {
    return resolveEndpoint().then(function (endpoint) {
      var token = resolveToken();
      if (!token) throw new Error('Not signed in, or the session expired — sign in again and reopen this.');
      return send(endpoint, token, payload);
    });
  }

  function send(endpoint, token, payload) {
    return fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(Object.assign({ token: token }, payload))
    }).then(function (res) {
      if (!res.ok) throw new Error('Server returned ' + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || data.ok !== true) throw new Error((data && data.error) || 'Request failed');
      return data;
    });
  }

  function loadRecipients() {
    return post({ action: 'reportRecipients' }).then(function (data) {
      state.recipients = data.recipients || [];
      state.recipients.forEach(function (r) {
        if (state.checked[r.email] === undefined) state.checked[r.email] = true;
      });
    });
  }

  function saveRecipients() {
    return post({ action: 'reportRecipients', recipients: state.recipients }).then(function (data) {
      state.recipients = data.recipients || [];
    });
  }

  function loadLog() {
    return post({ action: 'reportLog', limit: 50 }).then(function (data) {
      state.log = data.log || [];
    });
  }

  function selectedRecipients() {
    var out = state.recipients.filter(function (r) { return state.checked[r.email]; });
    var once = String(state.oneOff || '').trim();
    if (once && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(once)) out = out.concat([{ name: once, email: once }]);
    return out;
  }

  // ---------- rendering ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render() {
    if (!root) return;
    var body;
    if (state.screen === 'manage') body = renderManage();
    else if (state.screen === 'history') body = renderHistory();
    else body = renderSend();
    root.querySelector('.hbr-sheet').innerHTML = body;
  }

  function renderSend() {
    var p = currentPeriod();
    var chosen = selectedRecipients();

    var html = '<div class="hbr-head"><span class="hbr-title">Send report</span>' +
      '<button class="hbr-x" data-act="close" aria-label="Close">&times;</button></div>';

    html += '<div class="hbr-tabs">' +
      ['week', 'month', 'custom'].map(function (t) {
        return '<button class="hbr-tab' + (state.tab === t ? ' is-on' : '') + '" data-act="tab" data-tab="' + t + '">' +
          t.charAt(0).toUpperCase() + t.slice(1) + '</button>';
      }).join('') + '</div>';

    if (state.tab === 'custom') {
      html += '<div class="hbr-range">' +
        '<label class="hbr-field"><span>From</span><input type="date" data-act="start" value="' + esc(state.customStart) + '"></label>' +
        '<label class="hbr-field"><span>To</span><input type="date" data-act="end" value="' + esc(state.customEnd) + '"></label></div>';
      html += '<div class="hbr-chips">' +
        '<button class="hbr-chip" data-act="preset" data-preset="3m">Last 3 mo</button>' +
        '<button class="hbr-chip" data-act="preset" data-preset="6m">Last 6 mo</button>' +
        '<button class="hbr-chip" data-act="preset" data-preset="ytd">Year to date</button></div>';
      var days = daysBetween(state.customStart, state.customEnd) + 1;
      var priorEnd = addDays(state.customStart, -1);
      var priorStart = addDays(priorEnd, -(days - 1));
      html += '<p class="hbr-note">' + days + ' days · compares against ' + fmtShort(priorStart) + ' – ' + fmtShort(priorEnd) + '</p>';
    } else {
      var options = state.tab === 'week' ? weekOptions() : monthOptions();
      var activeIndex = state.tab === 'week' ? state.weekIndex : state.monthIndex;
      html += '<p class="hbr-label">Period</p>';
      options.slice(0, 4).forEach(function (o, i) {
        html += '<button class="hbr-period' + (i === activeIndex ? ' is-on' : '') + '" data-act="period" data-index="' + i + '">' +
          '<span>' + esc(o.label) + (o.sub ? ' <em>· ' + esc(o.sub) + '</em>' : '') + '</span>' +
          (i === activeIndex ? '<span class="hbr-check">&#10003;</span>' : '') + '</button>';
      });
      if (options.length > 4) {
        html += '<details class="hbr-more"><summary>Show more</summary>';
        options.slice(4).forEach(function (o, i) {
          var idx = i + 4;
          html += '<button class="hbr-period' + (idx === activeIndex ? ' is-on' : '') + '" data-act="period" data-index="' + idx + '">' +
            '<span>' + esc(o.label) + (o.sub ? ' <em>· ' + esc(o.sub) + '</em>' : '') + '</span></button>';
        });
        html += '</details>';
      }
    }

    html += '<div class="hbr-rowhead"><p class="hbr-label">Send to</p>' +
      '<button class="hbr-link" data-act="manage">Manage</button></div>';

    if (!state.recipients.length) {
      html += '<p class="hbr-note">No saved recipients yet.</p>';
    }
    state.recipients.forEach(function (r) {
      html += '<label class="hbr-checkrow"><input type="checkbox" data-act="recipient" data-email="' + esc(r.email) + '"' +
        (state.checked[r.email] ? ' checked' : '') + '>' +
        '<span>' + esc(r.name) + ' <em>' + esc(r.email) + '</em></span></label>';
    });

    html += '<label class="hbr-checkrow"><input type="checkbox" data-act="entries"' + (state.includeEntries ? ' checked' : '') + '>' +
      '<span>Include full entry list</span></label>';

    if (state.error) html += '<p class="hbr-error">' + esc(state.error) + '</p>';
    if (state.notice) html += '<p class="hbr-ok">' + esc(state.notice) + '</p>';

    html += '<div class="hbr-actions">' +
      '<button class="hbr-btn" data-act="preview"' + (state.busy ? ' disabled' : '') + '>Preview</button>' +
      '<button class="hbr-btn hbr-btn--primary" data-act="send"' + (state.busy ? ' disabled' : '') + '>' +
      (state.busy ? 'Working…' : 'Send to ' + chosen.length + (chosen.length === 1 ? ' person' : ' people')) + '</button></div>';

    html += '<button class="hbr-link hbr-link--center" data-act="history">Report history</button>';
    return html;
  }

  function renderManage() {
    var html = '<div class="hbr-head"><span class="hbr-title">Recipients</span>' +
      '<button class="hbr-x" data-act="back" aria-label="Back">&times;</button></div>' +
      '<p class="hbr-note">Shared list · everyone signed in sees the same one</p>';

    state.recipients.forEach(function (r, i) {
      html += '<div class="hbr-card">' +
        '<div class="hbr-cardrow"><div><strong>' + esc(r.name) + '</strong><em>' + esc(r.email) + '</em></div>' +
        '<button class="hbr-link" data-act="toggle-edit" data-index="' + i + '">' + (r._editing ? 'done' : 'edit') + '</button></div>';
      if (r._editing) {
        html += '<div class="hbr-edit">' +
          '<input type="text" data-act="edit-name" data-index="' + i + '" value="' + esc(r.name) + '" placeholder="Name">' +
          '<input type="email" data-act="edit-email" data-index="' + i + '" value="' + esc(r.email) + '" placeholder="name@example.com">' +
          '<button class="hbr-btn hbr-btn--danger" data-act="remove" data-index="' + i + '">Remove</button></div>';
      }
      html += '</div>';
    });

    html += '<div class="hbr-add">' +
      '<input type="text" data-act="new-name" placeholder="Name" value="">' +
      '<input type="email" data-act="new-email" placeholder="name@example.com" value="">' +
      '<button class="hbr-btn" data-act="add">Add</button></div>';

    html += '<p class="hbr-label">Send once, don\'t save</p>' +
      '<input class="hbr-input" type="email" data-act="oneoff" placeholder="name@example.com" value="' + esc(state.oneOff) + '">';

    if (state.error) html += '<p class="hbr-error">' + esc(state.error) + '</p>';

    html += '<div class="hbr-actions"><button class="hbr-btn hbr-btn--primary" data-act="save"' +
      (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Saving…' : 'Done') + '</button></div>';
    return html;
  }

  function renderHistory() {
    var html = '<div class="hbr-head"><span class="hbr-title">Report history</span>' +
      '<button class="hbr-x" data-act="back" aria-label="Back">&times;</button></div>' +
      '<p class="hbr-note">Last 50 · shared</p>';

    if (!state.log.length) html += '<p class="hbr-note">Nothing sent yet.</p>';

    state.log.forEach(function (r) {
      var when = r.sentAt ? new Date(r.sentAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      var who = (r.recipients || []).map(function (x) { return x.name || x.email; }).join(', ');
      var typeLabel = r.type === 'week' ? 'Weekly' : (r.type === 'month' ? 'Monthly' : 'Custom');
      html += '<div class="hbr-card">' +
        '<div class="hbr-cardrow"><strong>' + esc(typeLabel) + ' · ' + esc(r.label) + '</strong>' +
        '<span class="' + (r.net >= 0 ? 'hbr-pos' : 'hbr-neg') + '">' + signedMoney(r.net) + '</span></div>' +
        '<em class="hbr-meta">Sent ' + esc(when) + ' by ' + esc(r.sentBy || '') + ' · to ' + esc(who) + (r.resend ? ' · resend' : '') + '</em>' +
        '<div class="hbr-cardactions">' +
        '<button class="hbr-btn" data-act="view-log" data-id="' + esc(r.id) + '">View</button>' +
        '<button class="hbr-btn" data-act="resend" data-id="' + esc(r.id) + '">Send again</button></div></div>';
    });

    if (state.error) html += '<p class="hbr-error">' + esc(state.error) + '</p>';
    if (state.notice) html += '<p class="hbr-ok">' + esc(state.notice) + '</p>';
    return html;
  }

  // The preview renders inside an iframe so the email's own styling can't leak
  // into the app, and so what you approve is byte-for-byte what gets mailed.
  function showPreview(html, meta) {
    var overlay = document.createElement('div');
    overlay.className = 'hbr-preview';
    var warning = (meta && meta.entryCount > 150 && state.includeEntries)
      ? '<p class="hbr-warn">' + meta.entryCount + ' entries — Gmail may clip a message this long. Consider unticking the entry list.</p>'
      : '';
    overlay.innerHTML = '<div class="hbr-previewbar"><span>Preview</span>' +
      '<button class="hbr-x" data-act="close-preview" aria-label="Close preview">&times;</button></div>' +
      warning + '<iframe sandbox="" title="Report preview"></iframe>';
    document.body.appendChild(overlay);
    var frame = overlay.querySelector('iframe');
    frame.srcdoc = '<body style="margin:0;background:#F7F3E9">' + html + '</body>';
    overlay.addEventListener('click', function (e) {
      if (e.target.closest('[data-act="close-preview"]') || e.target === overlay) overlay.remove();
    });
  }

  // ---------- events ----------

  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');

    if (act === 'close') return close();
    if (act === 'back') { state.screen = 'send'; state.error = ''; return render(); }
    if (act === 'manage') { state.screen = 'manage'; state.error = ''; return render(); }
    if (act === 'history') {
      state.screen = 'history'; state.error = ''; state.notice = ''; render();
      return run(loadLog());
    }
    if (act === 'tab') { state.tab = el.getAttribute('data-tab'); state.error = ''; return render(); }
    if (act === 'period') {
      var idx = Number(el.getAttribute('data-index'));
      if (state.tab === 'week') state.weekIndex = idx; else state.monthIndex = idx;
      return render();
    }
    if (act === 'preset') {
      var today = iso(new Date());
      var preset = el.getAttribute('data-preset');
      if (preset === '3m') { state.customStart = addDays(today, -91); state.customEnd = today; }
      if (preset === '6m') { state.customStart = addDays(today, -182); state.customEnd = today; }
      if (preset === 'ytd') { state.customStart = today.substring(0, 4) + '-01-01'; state.customEnd = today; }
      // A long range with every entry attached gets unwieldy, so the list
      // switches itself off past roughly six weeks. Tick it back on if you
      // actually want it.
      if (daysBetween(state.customStart, state.customEnd) > 45) state.includeEntries = false;
      return render();
    }
    if (act === 'toggle-edit') {
      var i = Number(el.getAttribute('data-index'));
      state.recipients[i]._editing = !state.recipients[i]._editing;
      return render();
    }
    if (act === 'remove') {
      state.recipients.splice(Number(el.getAttribute('data-index')), 1);
      return render();
    }
    if (act === 'add') {
      var nameEl = root.querySelector('[data-act="new-name"]');
      var emailEl = root.querySelector('[data-act="new-email"]');
      var email = String(emailEl.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { state.error = 'That doesn\'t look like an email address.'; return render(); }
      if (state.recipients.length >= 10) { state.error = 'Ten recipients is the cap.'; return render(); }
      state.recipients.push({ name: String(nameEl.value || '').trim() || email, email: email });
      state.checked[email] = true;
      state.error = '';
      return render();
    }
    if (act === 'save') {
      state.recipients.forEach(function (r) { delete r._editing; });
      return run(saveRecipients().then(function () { state.screen = 'send'; }));
    }
    if (act === 'preview') return doPreview();
    if (act === 'send') return doSend();
    if (act === 'view-log') return doViewLog(el.getAttribute('data-id'));
    if (act === 'resend') return doResend(el.getAttribute('data-id'));
  }

  function onChange(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'recipient') { state.checked[el.getAttribute('data-email')] = el.checked; return render(); }
    if (act === 'entries') { state.includeEntries = el.checked; return render(); }
    if (act === 'start') { state.customStart = el.value; return render(); }
    if (act === 'end') { state.customEnd = el.value; return render(); }
    if (act === 'oneoff') { state.oneOff = el.value; return; }
    if (act === 'edit-name') { state.recipients[Number(el.getAttribute('data-index'))].name = el.value; return; }
    if (act === 'edit-email') { state.recipients[Number(el.getAttribute('data-index'))].email = el.value; return; }
  }

  function run(promise) {
    state.busy = true; state.error = ''; render();
    return promise.catch(function (err) {
      state.error = err.message || String(err);
    }).then(function () {
      state.busy = false;
      render();
    });
  }

  function doPreview() {
    var p = currentPeriod();
    return run(post({
      action: 'reportPreview', periodType: p.type, start: p.start, end: p.end, includeEntries: state.includeEntries
    }).then(function (data) {
      showPreview(data.html, data);
    }));
  }

  function doSend() {
    var p = currentPeriod();
    var chosen = selectedRecipients();
    if (!chosen.length) { state.error = 'Tick at least one recipient.'; return render(); }
    return run(post({
      action: 'reportSend', periodType: p.type, start: p.start, end: p.end,
      includeEntries: state.includeEntries, recipients: chosen
    }).then(function (data) {
      state.notice = 'Sent to ' + data.sent + (data.sent === 1 ? ' person' : ' people') + '.';
      state.oneOff = '';
    }));
  }

  function doViewLog(id) {
    return run(post({ action: 'reportView', logId: id }).then(function (data) {
      showPreview(data.html, null);
    }));
  }

  function doResend(id) {
    return run(post({ action: 'reportResend', logId: id }).then(function (data) {
      state.notice = 'Resent to ' + data.sent + (data.sent === 1 ? ' person' : ' people') + '.';
      return loadLog();
    }));
  }

  // ---------- open / close ----------

  function open() {
    if (root) return;
    var today = iso(new Date());
    state.customStart = state.customStart || addDays(today, -91);
    state.customEnd = state.customEnd || today;
    state.screen = 'send';
    state.error = '';
    state.notice = '';

    root = document.createElement('div');
    root.className = 'hbr-overlay';
    root.innerHTML = '<div class="hbr-sheet"></div>';
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onChange);

    // Matches the app's own back-button handling: a phone back press closes
    // this sheet rather than exiting the PWA.
    history.pushState({ hbReports: true }, '');
    window.addEventListener('popstate', onPop);

    render();
    run(loadRecipients());
  }

  function onPop() { if (root) close(true); }

  function close(fromPop) {
    if (!root) return;
    root.remove();
    root = null;
    window.removeEventListener('popstate', onPop);
    if (!fromPop && history.state && history.state.hbReports) history.back();
  }

  function init(options) {
    options = options || {};
    if (options.endpoint) cfg.endpoint = options.endpoint;
    if (options.getToken) cfg.getToken = options.getToken;
    if (options.floatingButton === false) cfg.floatingButton = false;
    if (cfg.floatingButton) mountButton();
    return api;
  }

  // ---------- self-mounting ----------

  function injectStyles() {
    if (document.getElementById('hbr-styles')) return;
    var tag = document.createElement('style');
    tag.id = 'hbr-styles';
    tag.textContent = STYLES;
    document.head.appendChild(tag);
  }

  // Prefers an element you placed yourself (id="hb-send-report"); falls back to
  // a floating button so the feature is reachable without editing app.js.
  function mountButton() {
    injectStyles();
    var existing = document.getElementById('hb-send-report');
    if (existing) {
      if (!existing.getAttribute('data-hbr-bound')) {
        existing.setAttribute('data-hbr-bound', '1');
        existing.addEventListener('click', function (e) { e.preventDefault(); open(); });
      }
      return;
    }
    if (!cfg.floatingButton || document.getElementById('hbr-fab')) return;
    var btn = document.createElement('button');
    btn.id = 'hbr-fab';
    btn.className = 'hbr-fab';
    btn.type = 'button';
    btn.textContent = 'Send report';
    btn.addEventListener('click', open);
    document.body.appendChild(btn);
  }

  function boot() {
    injectStyles();
    mountButton();
    // The button may need to wait for a sign-in screen to clear, or for the
    // app to render its own #hb-send-report. Check a few times, then stop.
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      mountButton();
      if (tries > 20) clearInterval(timer);
    }, 500);
  }

  // Boot whenever the DOM is ready enough, from whichever of these fires first.
  // Everything inside boot() is idempotent, so running it more than once is safe.
  if (document.body) boot();
  document.addEventListener('DOMContentLoaded', boot);
  window.addEventListener('load', boot);

  var api = { init: init, open: open, close: close, mountButton: mountButton };
  return api;
})();
