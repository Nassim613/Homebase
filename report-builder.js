// Homebase — report builder
// ---------------------------------------------------------------
// Builds the five finance reports (weekly, monthly, yearly, category, store)
// entirely on this device, from the same IndexedDB data the app already shows,
// and turns them into a PDF. Apps Script only stores, emails and logs the file.
//
// Loaded from index.html before reports.js:
//
//   <script src="report-builder.js"></script>
//
// Public API (used by reports.js):
//   HomebaseReportBuilder.options()            -> pickers for each report type
//   HomebaseReportBuilder.build(request)       -> { pages: [html], meta }
//   HomebaseReportBuilder.render(build, host)  -> paginated page elements in host
//   HomebaseReportBuilder.toPdf(pageEls)       -> Blob (application/pdf)
//
// Specs: reports/*-report-spec.md in the Homebase project.

window.HomebaseReportBuilder = (function () {
  'use strict';

  // ================================================================
  // SETTINGS — everything below matches categories by name, case-
  // insensitively, so "HYDRO OTTAWA" and "Hydro Ottawa" both work.
  // ================================================================

  // Data collection started May 2024. Comparisons never reach before this.
  var DATA_START = '2024-05-01';
  // Category and store reports start here.
  var CAT_START = '2025-01-01';

  // Always first in category tables, in this order. Each item lists the
  // name fragments that identify it.
  var FIXED_ORDER = [
    { label: 'Mortgage', match: ['mortgage'] },
    { label: 'Groceries + Meal Kit', match: ['groceries', 'meal kit'] },
    { label: 'Take Out / Eating Out', match: ['take out', 'takeout', 'take-out', 'eating out'] },
    { label: 'Date Night', match: ['date night'] },
    { label: 'Baby', match: ['baby'] },
    { label: 'House Maintenance', match: ['house maintenance'] },
    { label: 'Jazz Care', match: ['jazz care'] },
    { label: 'Jazz Food', match: ['jazz food'] },
    { label: 'Jazz Fund', match: ['jazz fund'] }
  ];
  var FOOD_LABEL = 'Groceries + Meal Kit';

  // Bills: the BILLS category, broken out by store (Enbridge Gas, Hydro Ottawa,
  // Telus Cellphones, Bell Internet, Water - City of Ottawa). One "Bills" row on
  // page 1, the per-store breakdown on page 2 — only these five stores, in this
  // order (other stores filed under Bills still count in the page-1 total).
  var BILLS_CATEGORY = 'bills';
  var BILLS = [
    { match: ['enbridge'], every: 1 },
    { match: ['hydro'], every: 1 },
    { match: ['telus'], every: 1 },
    { match: ['bell'], every: 1 },
    { match: ['water'], every: 2 }        // Water - City of Ottawa: billed every 2 months
  ];
  var BILLS_LABEL = 'Bills';
  var PAY_CATEGORY = 'pay';

  // Car categories (exact name for Gas, so "Enbridge Gas" never counts as gas).
  var CAR_PARTS = [
    { part: 'gas', label: 'Gas', test: function (n) { return n === 'gas'; } },
    { part: 'maint', label: 'Car Maintenance', test: function (n) { return n.indexOf('car maint') !== -1; } },
    { part: 'ins', label: 'Car Insurance', test: function (n) { return n.indexOf('car insur') !== -1; } }
  ];
  var CAR_EXCLUDE = ['tesla'];
  var ALL_CARS = 'all cars';

  var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MNL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  var BILL_COLORS = ['#D85A30', '#E2B866', '#7F77DD', '#378ADD', '#5DCAA5', '#D4537E', '#1D9E75'];
  var CAR_COLORS = ['#534AB7', '#1D9E75', '#D85A30', '#378ADD', '#D4537E', '#BA7517'];
  var PART_COLORS = { gas: '#E2B866', maint: '#B44A43', ins: '#2B2640' };
  var PART_NAMES = { gas: 'Gas', maint: 'Maintenance', ins: 'Insurance' };
  var DONUT_COLORS = ['#2B2640', '#8a6412', '#534AB7', '#1D9E75', '#D85A30', '#E2B866', '#378ADD', '#B44A43', '#5DCAA5', '#C9C2B2'];
  var CAT_PALETTE = ['#1D9E75', '#7F77DD', '#E2B866', '#378ADD', '#D85A30', '#D4537E', '#5DCAA5', '#8a6412', '#534AB7', '#B4B2A9'];

  // ================================================================
  // SMALL HELPERS
  // ================================================================

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Category names saved in capitals ("HYDRO OTTAWA") read better as "Hydro Ottawa".
  // Same for store names ("COSTCO" -> "Costco"). Short codes stay in capitals.
  var SMALL = { of: 1, and: 1, the: 1, a: 1, an: 1, to: 1, 'for': 1, on: 1, 'in': 1 };
  var KEEP_CAPS = { resp: 1, tfsa: 1, rbc: 1, td: 1, cra: 1, ccb: 1, caa: 1, iga: 1, ups: 1, bmw: 1, hso: 1, mbna: 1, nslsc: 1, etr: 1, cft: 1, gpt: 1, cheo: 1, usa: 1, ai: 1 };
  function display(name) {
    name = String(name || '');
    if (!/[A-Z]/.test(name) || name !== name.toUpperCase()) return name;
    var words = name.toLowerCase().split(' ');
    return words.map(function (w, i) {
      var bare = w.replace(/[^a-z&]/g, '');
      if (bare === 'mc' && /^\d/.test(words[i + 1] || '')) return 'MC';        // card names: "MBNA - MC 0216"
      if (KEEP_CAPS[bare] || (bare.indexOf('&') !== -1 && bare.length <= 3)) return w.toUpperCase();
      if (i > 0 && SMALL[w]) return w;
      return w.replace(/^([^a-z]*)([a-z])/, function (m, pre, ch) { return pre + ch.toUpperCase(); })
        .replace(/-([a-z])/g, function (m, ch) { return '-' + ch.toUpperCase(); });
    }).join(' ');
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function has(name, frags) { var n = norm(name); return frags.some(function (f) { return n.indexOf(f) !== -1; }); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function sum(arr, fn) { var t = 0; for (var i = 0; i < arr.length; i++) t += fn ? fn(arr[i], i) : arr[i]; return t; }
  function avg(arr) { return arr.length ? sum(arr) / arr.length : 0; }
  function maxBy(arr, fn) { var b = null, bv = -Infinity; arr.forEach(function (x) { var v = fn(x); if (v > bv) { bv = v; b = x; } }); return b; }
  function uniq(arr) { var s = {}, o = []; arr.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }

  function iso(d) {
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function parseISO(s) { return new Date(s + 'T00:00:00'); }
  function addDays(s, n) { var d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); }
  function mk(y, m) { return y + '-' + (m < 10 ? '0' : '') + m; }         // month key, m is 1-12
  function mkOf(dateStr) { return String(dateStr).substring(0, 7); }
  function mkParts(k) { return [Number(k.substring(0, 4)), Number(k.substring(5, 7))]; }
  function mkShift(k, n) { var p = mkParts(k); var d = new Date(p[0], p[1] - 1 + n, 1); return mk(d.getFullYear(), d.getMonth() + 1); }
  function mkStart(k) { return k + '-01'; }
  function mkEnd(k) { var p = mkParts(k); return iso(new Date(p[0], p[1], 0)); }
  function mkLabel(k) { var p = mkParts(k); return MN[p[1] - 1]; }
  function mkLong(k) { var p = mkParts(k); return MNL[p[1] - 1] + ' ' + p[0]; }
  function monthsBetween(a, b) { var o = [], k = a; while (k <= b) { o.push(k); k = mkShift(k, 1); } return o; }
  function wdIndex(dateStr) { return (parseISO(dateStr).getDay() + 6) % 7; }
  function shortDate(s) { var d = parseISO(s); return MN[d.getMonth()] + ' ' + d.getDate(); }
  function dayLabel(s) { var d = parseISO(s); return WD[wdIndex(s)] + ' ' + MN[d.getMonth()] + ' ' + d.getDate(); }
  function mondayOf(date) { var d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; }
  function isoWeek(dateStr) {
    var t = parseISO(dateStr);
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
    var f = new Date(t.getFullYear(), 0, 4);
    f.setDate(f.getDate() + 3 - ((f.getDay() + 6) % 7));
    return 1 + Math.round((t - f) / (7 * 86400000));
  }
  function todayISO() { return iso(new Date()); }
  function prettyToday() { var d = new Date(); return WD[(d.getDay() + 6) % 7] + ' ' + MN[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }

  function money(n, cents, sign) {
    n = num(n);
    var a = Math.abs(n);
    var s = cents ? a.toFixed(2) : String(Math.round(a));
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var pre = n < -0.005 ? '−' : (sign && n > 0.005 ? '+' : '');
    return pre + '$' + parts.join('.');
  }
  function pct(n) { return Math.round(n) + '%'; }

  // Coloured change chip. Spending up = red; pass invert for income.
  function chip(cur, base, invert) {
    cur = num(cur); base = num(base);
    if (!cur && !base) return '<span class="eq">—</span>';
    if (!base) return '<span class="eq"></span>';
    var p = (cur - base) / base * 100;
    if (Math.abs(p) < 5) return '<span class="eq">≈</span>';
    var up = p > 0;
    var cls = invert ? (up ? 'dn' : 'up') : (up ? 'up' : 'dn');
    var txt = p > 200 ? Math.round(cur / base) + '×' : Math.round(Math.abs(p)) + '%';
    return '<span class="' + cls + '">' + (up ? '▲' : '▼') + ' ' + txt + '</span>';
  }
  // Amount + chip in one cell (the "combined" comparison column).
  function cmpCell(cur, other, opts) {
    opts = opts || {};
    if (other == null) return '<td class="r ' + (opts.pl ? 'pl ' : '') + 'cmp"><span class="mut">—</span><span class="eq"></span></td>';
    var c = (cur && other) ? chip(cur, other, opts.invert) : '<span class="eq"></span>';
    return '<td class="r ' + (opts.pl ? 'pl ' : '') + 'cmp"><span class="mut">' + (opts.label || '') + (other ? money(other, opts.cents) : '—') + '</span> ' + c + '</td>';
  }
  function ratioBar(cur, base, scale) {
    var ratio = base ? cur / base : 1;
    var col = ratio >= 1.4 ? '#B44A43' : (ratio <= 0.7 ? '#0F6E56' : '#C9A35B');
    scale = scale || 1;
    return '<div class="bar"><i style="width:' + Math.min(cur / scale, 1) * 100 + '%;background:' + col + '"></i>' +
      (base ? '<b style="left:' + Math.min(base / scale, 1) * 100 + '%"></b>' : '') + '</div>';
  }
  function kpi(label, value, sub, good) {
    return '<div class="kpi' + (good ? ' good' : '') + '"><p class="l">' + label + '</p><p class="v">' + value + '</p><p class="s">' + (sub || '') + '</p></div>';
  }
  function legend(items) {
    return items.map(function (it) { return '<span class="sw" style="background:' + it[1] + '"></span>' + esc(it[0]); }).join('');
  }
  function listAnd(xs) {
    xs = xs.map(function (x) { return '<b>' + esc(x) + '</b>'; });
    if (xs.length <= 1) return xs.join('');
    return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
  }
  function block(title, legendHtml, body) {
    return '<div class="block"><h2>' + title + (legendHtml ? ' <span class="legend">' + legendHtml + '</span>' : '') + '</h2>' + body + '</div>';
  }
  function tag(text, kind) { return text ? '<span class="tag ' + (kind || 'car') + '">' + esc(text) + '</span>' : ''; }

  // ================================================================
  // CHARTS (inline SVG — the same drawings as the approved mockups)
  // ================================================================
  var SVGF = 'font-family="Georgia, serif"';

  function barsSvg(values, labels, o) {
    o = o || {};
    var W = o.W || 640, H = o.H || 110, n = values.length || 1;
    var mx = Math.max.apply(null, values.concat([o.avg || 0, 1])) * (o.inside ? 1.08 : 1.22);
    var bw = Math.min(40, W / n * 0.68), gap = n > 1 ? (W - bw * n) / (n - 1) : 0;
    var s = ['<svg width="' + W + '" height="' + (H + 26) + '" viewBox="0 0 ' + W + ' ' + (H + 26) + '">'];
    values.forEach(function (v, i) {
      var x = i * (bw + gap), h = v / mx * H, hl = o.highlight === i;
      var col = hl ? '#BA7517' : (o.colorFn ? o.colorFn(v, i) : '#D9CFB8');
      s.push('<rect x="' + x.toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(h, 0).toFixed(1) + '" rx="3" fill="' + col + '"/>');
      var label = o.fmt ? o.fmt(v) : (v / 1000).toFixed(1) + 'k';
      if (o.inside) s.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" font-size="9" text-anchor="middle" fill="' + (hl ? '#FFFDF7' : '#5f5873') + '" ' + SVGF + '>' + label + '</text>');
      else s.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - h - 4).toFixed(1) + '" font-size="9" text-anchor="middle" fill="#6b6380" ' + SVGF + '>' + label + '</text>');
      s.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H + 14) + '" font-size="10" text-anchor="middle" fill="' + (hl ? '#8a6412' : '#8a8296') + '" ' + SVGF + '>' + esc(labels[i]) + '</text>');
    });
    if (o.avg) {
      var ay = H - o.avg / mx * H;
      s.push('<line x1="0" x2="' + W + '" y1="' + ay.toFixed(1) + '" y2="' + ay.toFixed(1) + '" stroke="' + (o.avgColor || '#2B2640') + '" stroke-dasharray="3 3" stroke-width="0.8"/>');
    }
    s.push('</svg>');
    return s.join('');
  }

  // Income (green) vs spent (sand), with net under each month.
  function incomeSpentSvg(rows, o) {
    o = o || {};
    var W = 650, H = 118, n = rows.length || 1;
    var mx = Math.max.apply(null, rows.map(function (r) { return Math.max(r.income, r.spent); }).concat([1])) * 1.16;
    var grp = W / n, bw = grp * 0.34;
    var s = ['<svg width="' + W + '" height="' + (H + 40) + '" viewBox="0 0 ' + W + ' ' + (H + 40) + '">'];
    rows.forEach(function (r, i) {
      var last = o.highlightLast !== false && i === n - 1;
      var x0 = i * grp + (grp - 2 * bw - 3) / 2;
      [[r.income, '#9CC7B2', '#0F6E56'], [r.spent, '#D9CFB8', '#BA7517']].forEach(function (b, j) {
        var h = b[0] / mx * H, x = x0 + j * (bw + 3);
        s.push('<rect x="' + x.toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + (last ? b[2] : b[1]) + '"/>');
        s.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - h - 3).toFixed(1) + '" font-size="8" text-anchor="middle" fill="#6b6380" ' + SVGF + '>' + (b[0] / 1000).toFixed(1) + '</text>');
      });
      var cx = x0 + bw + 1.5, net = r.income - r.spent;
      s.push('<text x="' + cx.toFixed(1) + '" y="' + (H + 13) + '" font-size="10" text-anchor="middle" fill="' + (last ? '#8a6412' : '#8a8296') + '" ' + SVGF + '>' + esc(r.label) + '</text>');
      s.push('<text x="' + cx.toFixed(1) + '" y="' + (H + 27) + '" font-size="9" text-anchor="middle" fill="' + (net >= 0 ? '#0F6E56' : '#B44A43') + '" ' + SVGF + '>' + (net >= 0 ? '+' : '−') + '$' + Math.round(Math.abs(net)).toLocaleString('en-US') + '</text>');
    });
    s.push('</svg>');
    return s.join('');
  }

  // Vertical stacked bars; series = [{name, color, values[]}].
  function stackedSvg(labels, series, o) {
    o = o || {};
    var W = o.W || 650, H = o.H || 110, n = labels.length || 1;
    var totals = labels.map(function (_, i) { return sum(series, function (se) { return se.values[i] || 0; }); });
    var mx = Math.max.apply(null, totals.concat([1])) * 1.15;
    var grp = W / n, bw = grp * 0.56;
    var s = ['<svg width="' + W + '" height="' + (H + 18) + '" viewBox="0 0 ' + W + ' ' + (H + 18) + '">'];
    labels.forEach(function (lab, i) {
      var x = i * grp + (grp - bw) / 2, y = H;
      var last = o.highlightLast !== false && i === n - 1;
      series.forEach(function (se) {
        var v = se.values[i] || 0, h = v / mx * H;
        if (h <= 0) return;
        y -= h;
        s.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + se.color + '" opacity="' + (last || o.highlightLast === false ? 1 : 0.72) + '"/>');
        if (o.segLabels && h >= 10) s.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y + h / 2 + 3).toFixed(1) + '" font-size="7.5" text-anchor="middle" fill="#FFFFFF" ' + SVGF + '>' + Math.round(v).toLocaleString('en-US') + '</text>');
      });
      if (totals[i] > 0) s.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" font-size="' + (o.segLabels ? 9.5 : 8.5) + '" ' + (o.segLabels ? 'font-weight="bold" ' : '') + 'text-anchor="middle" fill="' + (last ? '#2B2640' : '#4a4360') + '" ' + SVGF + '>$' + Math.round(totals[i]).toLocaleString('en-US') + '</text>');
      s.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H + 13) + '" font-size="10" text-anchor="middle" fill="' + (last ? '#8a6412' : '#8a8296') + '" ' + SVGF + '>' + esc(lab) + '</text>');
    });
    s.push('</svg>');
    return s.join('');
  }

  // Horizontal stacked rows with amounts in the segments.
  function hstackRows(rows, parts, colors, scale) {
    var out = '<table style="font-size:10.5px">';
    rows.forEach(function (r) {
      var tot = sum(parts, function (p) { return r.vals[p] || 0; });
      var segs = '';
      parts.forEach(function (p) {
        var v = r.vals[p] || 0;
        if (v <= 0) return;
        var w = v / scale * 100;
        var txt = v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v).toLocaleString('en-US');
        segs += '<span style="display:inline-block;height:16px;line-height:16px;width:' + w.toFixed(2) + '%;background:' + colors[p] + ';color:#fff;font-size:8.5px;text-align:center;overflow:hidden;vertical-align:top">' + (w >= 9 ? txt : '') + '</span>';
      });
      out += '<tr><td style="width:20%;padding:5px 0">' + esc(r.label) + '</td><td style="padding:5px 8px"><div style="white-space:nowrap;font-size:0">' + segs + '</div></td><td class="r" style="width:16%"><b>' + money(tot) + '</b></td></tr>';
    });
    return out + '</table>';
  }

  function donutSvg(items, centreLabel) {
    var size = 150, cx = 75, cy = 75, R = 73, r = R * 0.58;
    var tot = sum(items, function (it) { return it[1]; }) || 1;
    var s = ['<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">'];
    var a0 = -Math.PI / 2;
    items.forEach(function (it, i) {
      var frac = it[1] / tot;
      if (frac >= 0.9999) frac = 0.9999;
      var a1 = a0 + frac * 2 * Math.PI, large = a1 - a0 > Math.PI ? 1 : 0;
      var p = 'M ' + (cx + R * Math.cos(a0)).toFixed(2) + ' ' + (cy + R * Math.sin(a0)).toFixed(2) +
        ' A ' + R + ' ' + R + ' 0 ' + large + ' 1 ' + (cx + R * Math.cos(a1)).toFixed(2) + ' ' + (cy + R * Math.sin(a1)).toFixed(2) +
        ' L ' + (cx + r * Math.cos(a1)).toFixed(2) + ' ' + (cy + r * Math.sin(a1)).toFixed(2) +
        ' A ' + r + ' ' + r + ' 0 ' + large + ' 0 ' + (cx + r * Math.cos(a0)).toFixed(2) + ' ' + (cy + r * Math.sin(a0)).toFixed(2) + ' Z';
      s.push('<path d="' + p + '" fill="' + DONUT_COLORS[i % DONUT_COLORS.length] + '" stroke="#fff" stroke-width="1"/>');
      a0 = a1;
    });
    s.push('<text x="' + cx + '" y="' + (cy - 2) + '" font-size="15" text-anchor="middle" fill="#2B2640" ' + SVGF + '>$' + Math.round(tot).toLocaleString('en-US') + '</text>');
    s.push('<text x="' + cx + '" y="' + (cy + 12) + '" font-size="8.5" text-anchor="middle" fill="#8a8296" ' + SVGF + '>' + esc(centreLabel || 'total spent') + '</text>');
    s.push('</svg>');
    return s.join('');
  }

  // Kept each month (bars) + running total (line).
  function keptSvg(rows) {
    var W = 330, H = 120, n = rows.length || 1;
    var cum = [], c = 0;
    rows.forEach(function (r) { c += r.net; cum.push(c); });
    var mx = Math.max.apply(null, cum.concat(rows.map(function (r) { return r.net; })).concat([1])) * 1.12;
    var mn = Math.min.apply(null, cum.concat([0]));
    var range = mx - Math.min(mn, 0);
    var y0 = H - (0 - Math.min(mn, 0)) / range * H;
    var grp = W / n, bw = grp * 0.5;
    var s = ['<svg width="' + W + '" height="' + (H + 30) + '" viewBox="0 0 ' + W + ' ' + (H + 30) + '">'];
    var pts = [];
    rows.forEach(function (r, i) {
      var x = i * grp + (grp - bw) / 2;
      var h = Math.abs(r.net) / range * H;
      var y = r.net >= 0 ? y0 - h : y0;
      s.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + (r.net >= 0 ? '#9CC7B2' : '#E3B4AE') + '"/>');
      s.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H + 13) + '" font-size="9.5" text-anchor="middle" fill="#8a8296" ' + SVGF + '>' + esc(r.label) + '</text>');
      s.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H + 25) + '" font-size="8" text-anchor="middle" fill="' + (r.net >= 0 ? '#0F6E56' : '#B44A43') + '" ' + SVGF + '>' + (r.net >= 0 ? '+' : '−') + (Math.abs(r.net) / 1000).toFixed(1) + 'k</text>');
      pts.push([x + bw / 2, y0 - cum[i] / range * H]);
    });
    s.push('<polyline points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="none" stroke="#0F6E56" stroke-width="2"/>');
    pts.forEach(function (p) { s.push('<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.6" fill="#0F6E56"/>'); });
    var lp = pts[pts.length - 1];
    if (lp) s.push('<text x="' + (lp[0] - 4).toFixed(1) + '" y="' + Math.max(lp[1] - 7, 10).toFixed(1) + '" font-size="10" font-weight="bold" text-anchor="end" fill="#0F6E56" ' + SVGF + '>' + money(cum[cum.length - 1]) + ' kept</text>');
    s.push('</svg>');
    return s.join('');
  }

  // Monthly trend for a category/store report, with year markers and optional budget line.
  function trendSvg(keys, values, budget) {
    var W = 650, H = 105, n = keys.length || 1;
    var mx = Math.max.apply(null, values.concat([budget || 0, 1])) * 1.18;
    var grp = W / n, bw = grp * 0.66;
    var s = ['<svg width="' + W + '" height="' + (H + 30) + '" viewBox="0 0 ' + W + ' ' + (H + 30) + '">'];
    keys.forEach(function (k, i) {
      var x = i * grp + (grp - bw) / 2, v = values[i], h = v / mx * H;
      var col = i === n - 1 ? '#BA7517' : (budget && v > budget ? '#D9A79F' : '#D9CFB8');
      s.push('<rect x="' + x.toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + col + '"/>');
      s.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - h - 3).toFixed(1) + '" font-size="7" text-anchor="middle" fill="#6b6380" ' + SVGF + '>' + Math.round(v) + '</text>');
      s.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H + 11) + '" font-size="8.5" text-anchor="middle" fill="' + (i === n - 1 ? '#8a6412' : '#8a8296') + '" ' + SVGF + '>' + mkLabel(k).charAt(0) + '</text>');
      if (k.substring(5) === '01' || i === 0) {
        var lx = x - (grp - bw) / 2;
        s.push('<line x1="' + lx.toFixed(1) + '" x2="' + lx.toFixed(1) + '" y1="' + (H + 14) + '" y2="' + (H + 28) + '" stroke="#CFC5AE"/>');
        s.push('<text x="' + (lx + 3).toFixed(1) + '" y="' + (H + 26) + '" font-size="9.5" fill="#8a6412" ' + SVGF + '>' + k.substring(0, 4) + '</text>');
      }
    });
    if (budget) {
      var by = H - budget / mx * H;
      s.push('<line x1="0" x2="' + W + '" y1="' + by.toFixed(1) + '" y2="' + by.toFixed(1) + '" stroke="#B44A43" stroke-dasharray="3 3" stroke-width="0.8"/>');
    }
    s.push('</svg>');
    return s.join('');
  }

  // ================================================================
  // DATA
  // ================================================================

  // Everything a report needs, read once from IndexedDB.
  async function loadData() {
    var all = await DB.getAll('entries');
    var categories = await DB.getAll('categories');
    var payees = await DB.getAll('payees');
    var cars = await DB.getAll('cars');
    var projects = await DB.getAll('projects');
    var recurring = [];
    try { recurring = (await DB.getAll('recurring')).filter(function (r) { return !r.deleted; }); } catch (e) { /* none */ }
    var meta = (await DB.get('settings', 'meta')) || {};
    return makeModel({
      entries: all.filter(function (e) { return !e.deleted && e.date; }),
      categories: categories.filter(function (c) { return !c.deleted; }),
      payees: payees.filter(function (p) { return !p.deleted; }),
      cars: cars.filter(function (c) { return !c.deleted; }),
      projects: projects.filter(function (p) { return !p.deleted; }),
      recurring: recurring,
      meta: meta
    });
  }

  // Turns raw records into the lookups every report shares.
  function makeModel(raw) {
    var M = { raw: raw };
    var fixCar = function (n) { return String(n || '').replace(/\bbmw\b/ig, 'BMW'); };
    raw.cars = raw.cars.map(function (c) { return Object.assign({}, c, { name: fixCar(c.name) }); });
    M.catById = {};
    raw.categories.forEach(function (c) { M.catById[c.id] = c; });
    M.storeById = {};
    raw.payees.forEach(function (p) { M.storeById[p.id] = p; });
    M.carById = {};
    raw.cars.forEach(function (c) { M.carById[c.id] = c; });

    M.catName = function (e) { var c = M.catById[e.categoryId]; return display((c && c.name) || e.categoryName || 'Other'); };
    M.storeName = function (e) { var s = M.storeById[e.storeId]; return display((s && s.name) || e.storeName || ''); };
    M.excluded = function (e) { var c = M.catById[e.categoryId]; return !!(c && c.excludeFromTotals); };
    // Only the Pay category is income. Income in any other category (a refund,
    // a reimbursement) is taken off that category's spending instead.
    M.isPay = function (e) { return e.type === 'income' && norm(M.catName(e)) === PAY_CATEGORY; };
    M.isSpend = function (e) { return e.type === 'expense' || (e.type === 'income' && !M.isPay(e)); };
    M.amt = function (e) { return e.type === 'expense' ? num(e.amount) : (M.isSpend(e) ? -num(e.amount) : 0); };

    // Cars shown in reports: real cars by name, then "All cars". Tesla left out.
    var carList = raw.cars.filter(function (c) { return !CAR_EXCLUDE.some(function (x) { return norm(c.name).indexOf(x) !== -1; }); });
    var real = carList.filter(function (c) { return norm(c.name) !== ALL_CARS; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var allCars = carList.filter(function (c) { return norm(c.name) === ALL_CARS; });
    M.cars = real.concat(allCars).map(function (c) { return c.name; });
    M.carColor = {};
    M.cars.forEach(function (n, i) { M.carColor[n] = norm(n) === ALL_CARS ? '#B4B2A9' : CAR_COLORS[i % CAR_COLORS.length]; });

    // Bills = stores used under the Bills category: configured ones first, then the rest.
    var isBillCat = function (e) { return norm(M.catName(e)) === BILLS_CATEGORY; };
    M.billName = function (e) { return M.storeName(e) || 'Other bills'; };
    var billTotals = {};
    raw.entries.forEach(function (e) { if (M.isSpend(e) && isBillCat(e)) { var b = M.billName(e); billTotals[b] = (billTotals[b] || 0) + M.amt(e); } });
    var billNames = Object.keys(billTotals);
    M.bills = [];
    BILLS.forEach(function (b) {
      var n = billNames.filter(function (x) { return has(x, b.match) && !M.bills.some(function (y) { return y.name === x; }); })[0];
      if (n) M.bills.push({ name: n, every: b.every });
    });
    M.billColor = {};
    M.bills.forEach(function (b, i) { M.billColor[b.name] = BILL_COLORS[i % BILL_COLORS.length]; });

    // Classifies one entry for reporting.
    M.classify = function (e) {
      var name = M.catName(e), n = norm(name);
      var out = { cat: name, bucket: name, bill: null, carPart: null };
      if (has(name, ['groceries', 'meal kit'])) out.bucket = FOOD_LABEL;
      if (n === BILLS_CATEGORY) { out.bill = M.billName(e); out.bucket = BILLS_LABEL; }
      CAR_PARTS.forEach(function (p) { if (p.test(n)) { out.carPart = p.part; out.bucket = p.label; } });
      return out;
    };

    // Splits a car-category entry across cars: carSplit shares if set, else its car.
    M.carShares = function (e) {
      var out = [];
      if (e.carSplit && e.carSplit.length) {
        e.carSplit.forEach(function (s) {
          var c = M.carById[s.carId];
          out.push({ car: c ? c.name : 'No car set', amount: num(s.amount) });
        });
        var got = sum(out, function (s) { return s.amount; });
        if (!got) out = out.map(function (s) { return { car: s.car, amount: M.amt(e) / out.length }; });
        else if (M.amt(e) < 0) out = out.map(function (s) { return { car: s.car, amount: -s.amount }; });
      } else {
        var car = M.carById[e.carId];
        out.push({ car: car ? car.name : (fixCar(e.carName) || 'No car set'), amount: M.amt(e) });
      }
      return out.filter(function (s) { return !CAR_EXCLUDE.some(function (x) { return norm(s.car).indexOf(x) !== -1; }); });
    };

    M.tagFor = function (e) {
      var k = M.classify(e);
      if (k.carPart) return { text: M.carShares(e).map(function (s) { return s.car; }).join(', '), kind: 'car' };
      if (e.projectName || e.projectId) return { text: e.projectName || '', kind: 'proj' };
      if (e.carName) return { text: fixCar(e.carName), kind: 'car' };
      return null;
    };

    // Budgets. Food group = sum of its members' budgets.
    M.budget = function (bucket) {
      if (bucket === BILLS_LABEL) return 0;
      var t = 0;
      raw.categories.forEach(function (c) {
        if (c.hidden && !num(c.monthlyBudget)) return;
        var b = num(c.monthlyBudget);
        if (!b) return;
        var cb = has(c.name, ['groceries', 'meal kit']) ? FOOD_LABEL : display(c.name);
        if (cb === bucket) t += b;
      });
      return t;
    };
    M.weeklyFoodBudget = num(raw.meta.groceryWeeklyBudget);

    // Aggregates one date range [start, end] inclusive. Cached.
    var cache = {};
    M.agg = function (start, end) {
      var key = start + '|' + end;
      if (cache[key]) return cache[key];
      var A = { start: start, end: end, income: 0, incomeBy: {}, spent: 0, by: {}, bill: {}, car: {}, entries: [], expenses: [], hasData: start >= DATA_START || end >= DATA_START };
      M.cars.forEach(function (c) { A.car[c] = { gas: 0, maint: 0, ins: 0 }; });
      raw.entries.forEach(function (e) {
        if (e.date < start || e.date > end) return;
        if (M.excluded(e)) return;
        var amt = M.amt(e);
        if (M.isPay(e)) {
          amt = num(e.amount);
          A.income += amt;
          var cn = M.catName(e);
          A.incomeBy[cn] = (A.incomeBy[cn] || 0) + amt;
          A.entries.push(e);
          return;
        }
        if (!M.isSpend(e)) return;
        var k = M.classify(e);
        A.spent += amt;
        A.by[k.bucket] = (A.by[k.bucket] || 0) + amt;
        if (k.bill) A.bill[k.bill] = (A.bill[k.bill] || 0) + amt;
        if (k.carPart) {
          M.carShares(e).forEach(function (s) {
            if (!A.car[s.car]) A.car[s.car] = { gas: 0, maint: 0, ins: 0 };
            A.car[s.car][k.carPart] += s.amount;
          });
        }
        A.entries.push(e);
        A.expenses.push(e);
      });
      cache[key] = A;
      return A;
    };
    M.month = function (k) { return M.agg(mkStart(k), mkEnd(k)); };
    M.carRows = function (A) {
      // Real cars + All cars, plus "No car set" only when something is unassigned.
      var names = M.cars.slice();
      Object.keys(A.car).forEach(function (c) { if (names.indexOf(c) === -1 && sum(['gas', 'maint', 'ins'], function (p) { return A.car[c][p]; }) > 0) names.push(c); });
      return names;
    };
    M.colorOfCar = function (c) { return M.carColor[c] || '#8a8296'; };

    // Stores: logo URL (only real links or uploaded images draw).
    M.logoOf = function (storeName) {
      var p = raw.payees.filter(function (x) { return display(x.name) === storeName; })[0];
      if (!p) return null;
      var cands = [p.logoLink, p.logo];
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        if (c && (/^https?:\/\//.test(c) || /^data:image\//.test(c))) return c;
      }
      return null;
    };
    return M;
  }

  // Store logo tile: initials underneath, real logo on top when it loads.
  var TILE_COLORS = ['#B44A43', '#2B2640', '#1D9E75', '#378ADD', '#BA7517', '#534AB7', '#D85A30', '#185FA5', '#5F5E5A'];
  function logoTile(M, name, size) {
    size = size || 20;
    var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    var col = TILE_COLORS[Math.abs(h) % TILE_COLORS.length];
    var ini = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?';
    var url = M.logoOf(name);
    return '<span class="logo" style="width:' + size + 'px;height:' + size + 'px;line-height:' + size + 'px;font-size:' + Math.round(size * 0.42) + 'px;background:' + col + '">' + esc(ini) +
      (url ? '<img src="' + esc(url) + '" crossorigin="anonymous" alt="" onerror="this.remove()">' : '') + '</span>';
  }

  // Shared bits
  function fixedIndex(bucket) {
    for (var i = 0; i < FIXED_ORDER.length; i++) {
      if (FIXED_ORDER[i].label === bucket) return i;
      if (bucket !== FOOD_LABEL && has(bucket, FIXED_ORDER[i].match) && FIXED_ORDER[i].label !== FOOD_LABEL) return i;
    }
    return -1;
  }
  // Fixed-order buckets first (only those present anywhere in `pool`), then the rest by amount.
  function orderBuckets(pool, amountOf) {
    var present = uniq(pool);
    var fixed = present.filter(function (b) { return fixedIndex(b) !== -1; }).sort(function (a, b) { return fixedIndex(a) - fixedIndex(b); });
    var rest = present.filter(function (b) { return fixedIndex(b) === -1; }).sort(function (a, b) { return amountOf(b) - amountOf(a); });
    return fixed.concat(rest);
  }
  function incomeOrder(names, amountOf) {
    return names.slice().sort(function (a, b) {
      var pa = norm(a) === 'pay' ? 0 : 1, pb = norm(b) === 'pay' ? 0 : 1;
      return pa - pb || amountOf(b) - amountOf(a);
    });
  }
  function noteForCars(M) {
    var parts = ['Car costs use each entry’s car split, the same as the Vehicles report.'];
    if (M.cars.some(function (c) { return norm(c) === ALL_CARS; })) parts.push('“All cars” is entries tagged to every car.');
    parts.push('Tesla is left out.');
    return '<p class="note">' + parts.join(' ') + '</p>';
  }

  // ================================================================
  // EXPORTS USED BY THE REPORT FILES BELOW
  // ================================================================
  var K = {
    DATA_START: DATA_START, CAT_START: CAT_START, FIXED_ORDER: FIXED_ORDER, FOOD_LABEL: FOOD_LABEL, BILLS_LABEL: BILLS_LABEL,
    MN: MN, MNL: MNL, WD: WD, PART_COLORS: PART_COLORS, PART_NAMES: PART_NAMES, DONUT_COLORS: DONUT_COLORS, CAT_PALETTE: CAT_PALETTE,
    esc: esc, norm: norm, has: has, num: num, sum: sum, avg: avg, maxBy: maxBy, uniq: uniq,
    iso: iso, parseISO: parseISO, addDays: addDays, mk: mk, mkOf: mkOf, mkParts: mkParts, mkShift: mkShift, mkStart: mkStart, mkEnd: mkEnd,
    mkLabel: mkLabel, mkLong: mkLong, monthsBetween: monthsBetween, wdIndex: wdIndex, shortDate: shortDate, dayLabel: dayLabel,
    mondayOf: mondayOf, isoWeek: isoWeek, todayISO: todayISO, prettyToday: prettyToday,
    money: money, pct: pct, chip: chip, cmpCell: cmpCell, ratioBar: ratioBar, kpi: kpi, legend: legend, listAnd: listAnd, block: block, tag: tag,
    barsSvg: barsSvg, incomeSpentSvg: incomeSpentSvg, stackedSvg: stackedSvg, hstackRows: hstackRows, donutSvg: donutSvg, keptSvg: keptSvg, trendSvg: trendSvg,
    logoTile: logoTile, orderBuckets: orderBuckets, incomeOrder: incomeOrder, fixedIndex: fixedIndex, noteForCars: noteForCars, makeModel: makeModel
  };

  // ================================================================
  // SHARED REPORT SECTIONS
  // ================================================================

  // Months in [k-11 .. k] that are inside the data window.
  function last12(k) {
    var out = [];
    for (var i = 11; i >= 0; i--) { var m = mkShift(k, -i); if (mkEnd(m) >= DATA_START) out.push(m); }
    return out;
  }
  function inData(k) { return mkEnd(k) >= DATA_START; }
  function keptPct(A) { return A.income ? (A.income - A.spent) / A.income * 100 : 0; }

  function budgetCell(v, b) {
    if (!b) return '<td class="r">—</td>';
    return '<td class="r"><span class="' + (v > b ? 'neg' : 'pos') + '">' + money(b) + '</span></td>';
  }

  // Previous actual bill for a bill paid every N months (skips empty months).
  function prevBill(M, name, k) {
    for (var i = 1; i <= 4; i++) {
      var m = mkShift(k, -i);
      if (!inData(m)) return null;
      var v = M.month(m).bill[name] || 0;
      if (v) return { k: m, v: v };
    }
    return null;
  }

  function billsMonthTable(M, k, l12k, ytdK) {
    var A = M.month(k), P = inData(mkShift(k, -1)) ? M.month(mkShift(k, -1)) : null;
    var lyk = mkShift(k, -12), LY = inData(lyk) ? M.month(lyk) : null;
    var rows = '';
    M.bills.forEach(function (b) {
      var v = A.bill[b.name] || 0, label = esc(b.name), prevCell, a;
      if (b.every > 1) {
        label += ' <span class="mut" style="font-size:9px">· every ' + b.every + ' months</span>';
        var pb = prevBill(M, b.name, k);
        prevCell = cmpCell(v, pb ? pb.v : null, { cents: true, label: pb ? mkLabel(pb.k) + ' ' : '' });
        var nz = l12k.map(function (m) { return M.month(m).bill[b.name] || 0; }).filter(Boolean);
        a = nz.length ? avg(nz) : 0;
      } else {
        prevCell = cmpCell(v, P ? (P.bill[b.name] || 0) : null, { cents: true });
        a = avg(l12k.map(function (m) { return M.month(m).bill[b.name] || 0; }));
      }
      rows += '<tr class="lines"><td>' + label + '</td><td class="r"><b>' + (v ? money(v, true) : '—') + '</b></td>' + prevCell +
        cmpCell(v, LY ? (LY.bill[b.name] || 0) : null, { cents: true, pl: true }) +
        '<td class="r mut">' + money(a, true) + (b.every > 1 ? ' <span style="font-size:9px">/bill</span>' : '') + '</td>' +
        '<td class="r">' + money(sum(ytdK, function (m) { return M.month(m).bill[b.name] || 0; })) + '</td></tr>';
    });
    var T = function (X) { return X ? sum(M.bills, function (b) { return X.bill[b.name] || 0; }) : null; };
    rows += '<tr class="tot"><td>All bills</td><td class="r">' + money(T(A), true) + '</td>' + cmpCell(T(A), T(P), { cents: true }) +
      cmpCell(T(A), T(LY), { cents: true, pl: true }) + '<td class="r">' + money(avg(l12k.map(function (m) { return T(M.month(m)); })), true) + '</td>' +
      '<td class="r">' + money(sum(ytdK, function (m) { return T(M.month(m)); })) + '</td></tr>';
    return '<table style="font-size:10.5px"><tr><th style="width:30%">Bill</th><th class="r">' + mkLabel(k) + '</th>' +
      '<th class="r" style="padding-right:50px">' + mkLabel(mkShift(k, -1)) + '</th><th class="r pl" style="padding-right:50px">' + mkLabel(lyk) + ' ' + lyk.substring(0, 4) + '</th>' +
      '<th class="r">12-mo avg</th><th class="r">YTD</th></tr>' + rows + '</table>';
  }

  function billsChart(M, keys, highlightLast) {
    return stackedSvg(keys.map(mkLabel), M.bills.map(function (b) {
      return { name: b.name, color: M.billColor[b.name], values: keys.map(function (m) { return M.month(m).bill[b.name] || 0; }) };
    }), { H: 132, segLabels: true, highlightLast: highlightLast });
  }

  function carTotals(A, c) { var v = A.car[c] || { gas: 0, maint: 0, ins: 0 }; return v.gas + v.maint + v.ins; }
  function carSum(M, keys, c, part) { return sum(keys, function (m) { var v = M.month(m).car[c]; return v ? v[part] : 0; }); }

  // Cars for one month: breakdown | compared with last month and the same month last year.
  function carsMonthTable(M, k) {
    var A = M.month(k), pk = mkShift(k, -1), lyk = mkShift(k, -12);
    var ytdK = monthsBetween(k.substring(0, 4) + '-01', k).filter(inData);
    var ytdOf = function (c) { return sum(ytdK, function (m) { return carTotals(M.month(m), c); }); };
    var P = inData(pk) ? M.month(pk) : null, LY = inData(lyk) ? M.month(lyk) : null;
    var dash = function (x) { return x ? money(x) : '—'; };
    var cmp = function (tot, other) {
      if (other == null) return '<td class="cmpl"><span class="mut">—</span></td>';
      return '<td class="cmpl"><span class="mut">' + dash(other) + '</span>' + (tot && other ? ' ' + chip(tot, other) : '') + '</td>';
    };
    var names = M.carRows(A);
    var rows = '', T = { gas: 0, maint: 0, ins: 0 }, PT = 0, LT = 0, YT = 0;
    names.forEach(function (c) {
      var v = A.car[c] || { gas: 0, maint: 0, ins: 0 }, tot = v.gas + v.maint + v.ins;
      T.gas += v.gas; T.maint += v.maint; T.ins += v.ins;
      var p = P ? carTotals(P, c) : null, l = LY ? carTotals(LY, c) : null;
      var y = ytdOf(c);
      PT += p || 0; LT += l || 0; YT += y;
      rows += '<tr class="lines"><td>' + esc(c) + '</td><td class="r">' + dash(v.gas) + '</td><td class="r">' + dash(v.maint) + '</td><td class="r">' + dash(v.ins) + '</td><td class="r"><b>' + dash(tot) + '</b></td><td class="gap"></td>' + cmp(tot, p) + cmp(tot, l) + '<td class="r">' + dash(y) + '</td></tr>';
    });
    var tt = T.gas + T.maint + T.ins;
    rows += '<tr class="tot"><td>Total</td><td class="r">' + dash(T.gas) + '</td><td class="r">' + dash(T.maint) + '</td><td class="r">' + dash(T.ins) + '</td><td class="r">' + dash(tt) + '</td><td class="gap"></td>' +
      cmp(tt, P ? PT : null) + cmp(tt, LY ? LT : null) + '<td class="r">' + dash(YT) + '</td></tr>';
    return '<table style="font-size:10.5px;table-layout:fixed"><colgroup><col style="width:13%"><col style="width:9%"><col style="width:9%"><col style="width:10%"><col style="width:9%"><col style="width:4%"><col style="width:17%"><col style="width:17%"><col style="width:12%"></colgroup>' +
      '<tr><th></th><th colspan="4" class="c" style="color:#8a6412">' + mkLong(k) + '</th><th class="gap"></th><th colspan="3" style="color:#8a6412">Total compared with</th></tr>' +
      '<tr><th>Car</th><th class="r">Gas</th><th class="r">Maint.</th><th class="r">Insurance</th><th class="r">Total</th><th class="gap"></th><th>' + MNL[mkParts(pk)[1] - 1] + '</th><th>' + mkLabel(lyk) + ' ' + lyk.substring(0, 4) + '</th><th class="r">' + k.substring(0, 4) + ' total</th></tr>' + rows + '</table>';
  }

  // Cost of ownership, two periods side by side: Gas, Maintenance, Insurance, Per month.
  function ownershipTable(M, keysA, labelA, keysB, labelB) {
    var dash = function (x) { return x ? money(x) : '—'; };
    var namesSet = {};
    keysA.concat(keysB || []).forEach(function (m) { M.carRows(M.month(m)).forEach(function (c) { namesSet[c] = 1; }); });
    var names = M.cars.filter(function (c) { return namesSet[c]; }).concat(Object.keys(namesSet).filter(function (c) { return M.cars.indexOf(c) === -1; }));
    function half(cs, keys) {
      if (!keys || !keys.length) return '';
      var g = sum(cs, function (c) { return carSum(M, keys, c, 'gas'); }), mm = sum(cs, function (c) { return carSum(M, keys, c, 'maint'); }), ins = sum(cs, function (c) { return carSum(M, keys, c, 'ins'); });
      return '<td class="r">' + dash(g) + '</td><td class="r">' + dash(mm) + '</td><td class="r">' + dash(ins) + '</td><td class="r"><b>' + dash((g + mm + ins) / keys.length) + '</b></td>';
    }
    var rows = '';
    names.concat(['Total']).forEach(function (c) {
      var cs = c === 'Total' ? names : [c];
      rows += '<tr class="' + (c === 'Total' ? 'tot' : 'lines') + '"><td>' + esc(c) + '</td>' + half(cs, keysA) + (keysB ? '<td class="gap"></td>' + half(cs, keysB) : '') + '</tr>';
    });
    var sub = '<th class="r">Gas</th><th class="r">Maintenance</th><th class="r">Insurance</th><th class="r">Per month</th>';
    return '<table style="font-size:10.5px"><tr><th></th><th colspan="4" class="c" style="color:#8a6412">' + labelA + '</th>' +
      (keysB ? '<th class="gap"></th><th colspan="4" class="c" style="color:#8a6412">' + labelB + '</th>' : '') + '</tr>' +
      '<tr><th style="width:12%">Car</th>' + sub + (keysB ? '<th class="gap"></th>' + sub : '') + '</tr>' + rows + '</table>';
  }

  function carCharts(M, mixKeys, mixLabel, monthKeys, highlightLast) {
    var rows = M.cars.map(function (c) { return { label: c, vals: { gas: carSum(M, mixKeys, c, 'gas'), maint: carSum(M, mixKeys, c, 'maint'), ins: carSum(M, mixKeys, c, 'ins') } }; })
      .filter(function (r) { return r.vals.gas + r.vals.maint + r.vals.ins > 0; });
    var scale = Math.max.apply(null, rows.map(function (r) { return r.vals.gas + r.vals.maint + r.vals.ins; }).concat([1])) * 1.02;
    var mix = rows.length ? hstackRows(rows, ['gas', 'maint', 'ins'], PART_COLORS, scale) : '<p class="note">No car costs in this period.</p>';
    var byMonth = stackedSvg(monthKeys.map(mkLabel), M.cars.map(function (c) {
      return { name: c, color: M.colorOfCar(c), values: monthKeys.map(function (m) { return carTotals(M.month(m), c); }) };
    }), { W: 330, H: 100, highlightLast: highlightLast });
    return '<div class="cols2">' +
      block('What each car costs · ' + mixLabel, '', mix + '<p class="legend" style="margin:4px 0 0">' + legend([['Gas', PART_COLORS.gas], ['Maintenance', PART_COLORS.maint], ['Insurance', PART_COLORS.ins]]) + '</p>') +
      block('Car costs by month', '', byMonth + '<p class="legend" style="margin:2px 0 0">' + legend(M.cars.map(function (c) { return [c, M.colorOfCar(c)]; })) + '</p>') + '</div>';
  }

  function donutBlock(byBucket, title) {
    var spend = Object.keys(byBucket).filter(function (b) { return byBucket[b] > 0; }).map(function (b) { return [b, byBucket[b]]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    var items = spend.slice(0, 9);
    var rest = sum(spend.slice(9), function (x) { return x[1]; });
    if (rest) items.push(['Everything else', rest]);
    var tot = sum(items, function (x) { return x[1]; }) || 1;
    var lg = items.map(function (it, i) {
      return '<tr><td style="width:14px"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' + DONUT_COLORS[i % DONUT_COLORS.length] + '"></span></td>' +
        '<td>' + esc(it[0]) + '</td><td class="r">' + money(it[1]) + '</td><td class="r mut" style="width:34px">' + pct(it[1] / tot * 100) + '</td></tr>';
    }).join('');
    return block(title, '', '<div style="display:flex;gap:14px;align-items:center">' + donutSvg(items) + '<table style="font-size:10px">' + lg + '</table></div>');
  }

  function storeTotals(M, expenses) {
    var t = {}, days = {};
    expenses.forEach(function (e) {
      var s = M.storeName(e);
      if (!s) return;
      t[s] = (t[s] || 0) + M.amt(e);
      (days[s] = days[s] || {})[e.date] = 1;
    });
    return Object.keys(t).map(function (s) { return { name: s, total: t[s], visits: Object.keys(days[s]).length }; })
      .sort(function (a, b) { return b.total - a.total; });
  }
  function topStoresBlock(M, expenses, n, title) {
    var st = storeTotals(M, expenses.filter(function (e) { return !isMortgage(M, e); })).slice(0, n);
    if (!st.length) return block(title, '', '<p class="note">No stores recorded.</p>');
    var mx = st[0].total || 1;
    return block(title, '', '<table style="font-size:10.5px">' + st.map(function (s) {
      return '<tr><td style="width:26px;padding:3px 0">' + logoTile(M, s.name) + '</td><td style="width:36%">' + esc(s.name) + ' <span class="mut" style="font-size:9.5px">· ' + s.visits + '×</span></td>' +
        '<td style="padding:0 8px"><div class="bar"><i style="width:' + (s.total / mx * 100).toFixed(0) + '%"></i></div></td><td class="r" style="width:17%">' + money(s.total) + '</td></tr>';
    }).join('') + '</table>');
  }

  function isMortgage(M, e) { return fixedIndex(M.classify(e).bucket) === 0; }

  function largestRows(M, expenses, n, withYear) {
    return expenses.filter(function (e) { return !isMortgage(M, e); })
      .sort(function (a, b) { return M.amt(b) - M.amt(a); }).slice(0, n)
      .map(function (e) {
        var t = M.tagFor(e);
        var d = parseISO(e.date);
        return '<tr class="lines"><td class="mut" style="width:' + (withYear ? 70 : 46) + 'px">' + MN[d.getMonth()] + ' ' + d.getDate() + (withYear ? ', ' + d.getFullYear() : '') + '</td>' +
          '<td style="width:19%">' + esc(M.storeName(e) || '—') + '</td><td style="width:30%">' + esc(M.catName(e)) + (t && t.text ? ' ' + tag(t.text, t.kind) : '') + '</td>' +
          '<td class="mut">' + esc(e.description || '—') + '</td><td class="r" style="width:11%">' + money(M.amt(e), true) + '</td></tr>';
      }).join('');
  }

  function budgetsRow(M, byBucket, months) {
    var cells = '';
    Object.keys(byBucket).concat(FIXED_ORDER.map(function (f) { return f.label; })).filter(function (b, i, arr) { return arr.indexOf(b) === i; }).forEach(function (b) {
      var bud = M.budget(b) * months;
      if (!bud) return;
      var v = byBucket[b] || 0, over = v > bud;
      cells += '<td style="padding-right:14px;vertical-align:top"><div style="font-size:10px">' + esc(b) + '</div>' +
        '<div class="bar" style="margin:4px 0 3px"><i style="width:' + Math.min(v / bud, 1) * 100 + '%;background:' + (over ? '#B44A43' : '#0F6E56') + '"></i></div>' +
        '<div style="font-size:9.5px" class="' + (over ? 'neg' : 'mut') + '">' + money(v) + ' / ' + money(bud) + '</div></td>';
    });
    return cells ? '<table style="table-layout:fixed"><tr>' + cells + '</tr></table>' : '';
  }

  function ytdRows(M, keys) {
    var rows = keys.map(function (m) {
      var A = M.month(m), n = A.income - A.spent;
      return '<tr class="lines"><td>' + mkLabel(m) + '</td><td class="r pos">' + money(A.income) + '</td><td class="r neg">' + money(A.spent) + '</td><td class="r">' + money(n, false, true) + '</td><td class="r mut">' + (A.income ? pct(n / A.income * 100) : '—') + '</td></tr>';
    }).join('');
    var ti = sum(keys, function (m) { return M.month(m).income; }), ts = sum(keys, function (m) { return M.month(m).spent; });
    rows += '<tr class="tot"><td>Total</td><td class="r">' + money(ti) + '</td><td class="r">' + money(ts) + '</td><td class="r">' + money(ti - ts, false, true) + '</td><td class="r">' + (ti ? pct((ti - ts) / ti * 100) : '—') + '</td></tr>';
    return '<table style="font-size:10px"><tr><th>Month</th><th class="r">Income</th><th class="r">Spent</th><th class="r">Net</th><th class="r">Kept</th></tr>' + rows + '</table>';
  }

  function prepared(user) {
    return 'Prepared ' + prettyToday() + (user ? '<br>By ' + esc(user) : '');
  }

  // ================================================================
  // MONTHLY
  // ================================================================
  function monthlyReport(M, k, opt) {
    var A = M.month(k), pk = mkShift(k, -1), lyk = mkShift(k, -12);
    var P = inData(pk) ? M.month(pk) : null, LY = inData(lyk) ? M.month(lyk) : null;
    var l12k = last12(k), L = l12k.map(function (m) { return M.month(m); });
    var ytdK = monthsBetween(k.substring(0, 4) + '-01', k).filter(inData);
    var a12 = function (b) { return avg(L.map(function (X) { return X.by[b] || 0; })); };
    var a12s = avg(L.map(function (X) { return X.spent; })), a12i = avg(L.map(function (X) { return X.income; }));
    var a12kept = avg(L.filter(function (X) { return X.income; }).map(keptPct));
    var kept = keptPct(A), net = A.income - A.spent;
    var month = mkLong(k), pmn = mkLabel(pk);

    var buckets = orderBuckets([].concat(Object.keys(A.by), P ? Object.keys(P.by) : [], LY ? Object.keys(LY.by) : [], Object.keys(L[L.length - 1] ? L[L.length - 1].by : {})), function (b) { return A.by[b] || 0; });
    // Biggest movers only, so the headline stays a sentence, not a list.
    var high = buckets.filter(function (b) { var a = a12(b); return a > 50 && (A.by[b] || 0) / a >= 1.4; })
      .sort(function (x, y) { return ((A.by[y] || 0) - a12(y)) - ((A.by[x] || 0) - a12(x)); });
    var low = buckets.filter(function (b) { var a = a12(b); return a > 50 && (A.by[b] || 0) / a <= 0.6; })
      .sort(function (x, y) { return (a12(y) - (A.by[y] || 0)) - (a12(x) - (A.by[x] || 0)); });
    var allHigh = high;
    high = high.slice(0, 3); low = low.slice(0, 2);

    var lede = (A.income ? 'You kept <b>' + pct(kept) + '</b> of what came in' + (L.length > 1 ? ', against a usual ' + pct(a12kept) + '. ' : '. ') : 'No income was recorded this month. ') +
      (L.length > 1 ? 'Total spending was ' + money(Math.abs(A.spent - a12s)) + ' ' + (A.spent > a12s ? 'above' : 'below') + ' your 12-month average' : 'You spent ' + money(A.spent)) +
      (high.length ? '. ' + listAnd(high) + ' ran well above usual' : '') +
      (low.length ? (high.length ? ', while ' : '. ') + listAnd(low) + ' came in well under.' : '.');
    var worth = allHigh.slice(0, 5).map(function (b) { return esc(b) + ' ' + money(A.by[b]) + ' — ' + ((A.by[b] || 0) / a12(b)).toFixed(1) + '× usual'; });
    buckets.forEach(function (b) { var bud = M.budget(b); if (bud && (A.by[b] || 0) > bud) worth.push(esc(b) + ' over its ' + money(bud) + ' budget by ' + money(A.by[b] - bud)); });

    // Categories table
    var scale = Math.max.apply(null, buckets.filter(function (b) { return fixedIndex(b) !== 0; }).map(function (b) { return Math.max(A.by[b] || 0, a12(b)); }).concat([1])) * 1.15;
    var ytdBy = function (b) { return sum(ytdK, function (m) { return M.month(m).by[b] || 0; }); };
    var incomes = incomeOrder(uniq([].concat(Object.keys(A.incomeBy), P ? Object.keys(P.incomeBy) : [])), function (n) { return A.incomeBy[n] || 0; });
    var rows = incomes.map(function (n) {
      var v = A.incomeBy[n] || 0;
      return '<tr class="lines" style="background:#F1F7F3"><td class="pos">' + esc(n) + '</td><td class="r pos"><b>' + money(v) + '</b></td>' +
        cmpCell(v, P ? (P.incomeBy[n] || 0) : null, { invert: true }) + cmpCell(v, LY ? (LY.incomeBy[n] || 0) : null, { invert: true, pl: true }) +
        '<td class="pl"></td><td class="r mut">' + money(avg(L.map(function (X) { return X.incomeBy[n] || 0; }))) + '</td><td class="r">—</td>' +
        '<td class="r">' + money(sum(ytdK, function (m) { return M.month(m).incomeBy[n] || 0; })) + '</td></tr>';
    }).join('');
    rows += buckets.map(function (b) {
      var v = A.by[b] || 0, sc = fixedIndex(b) === 0 ? Math.max(v, a12(b), 1) * 1.1 : scale;
      return '<tr class="lines"><td>' + esc(b) + '</td><td class="r"><b>' + money(v) + '</b></td>' +
        cmpCell(v, P ? (P.by[b] || 0) : null) + cmpCell(v, LY ? (LY.by[b] || 0) : null, { pl: true }) +
        '<td class="pl" style="width:15%">' + ratioBar(v, a12(b), sc) + '</td><td class="r mut">' + money(a12(b)) + '</td>' + budgetCell(v, M.budget(b)) +
        '<td class="r">' + money(ytdBy(b)) + '</td></tr>';
    }).join('');
    rows += '<tr class="tot"><td>Total spent</td><td class="r">' + money(A.spent) + '</td>' + cmpCell(A.spent, P ? P.spent : null) + cmpCell(A.spent, LY ? LY.spent : null, { pl: true }) +
      '<td></td><td class="r">' + money(a12s) + '</td><td></td><td class="r">' + money(sum(ytdK, function (m) { return M.month(m).spent; })) + '</td></tr>';
    var catTable = '<table style="font-size:10.5px"><tr><th style="width:22%">Category</th><th class="r">' + mkLabel(k) + '</th><th class="r" style="padding-right:50px">' + pmn + '</th>' +
      '<th class="r pl" style="padding-right:50px">' + mkLabel(lyk) + ' ' + lyk.substring(0, 4) + '</th><th class="pl">vs usual</th><th class="r">12-mo avg</th><th class="r">Budget</th><th class="r">YTD</th></tr>' + rows + '</table>';

    var kp = function (lab, v, pv, av, good) { return kpi(lab, v, (P ? pmn + ' ' + pv + ' · ' : '') + 'avg ' + av, good); };
    var page1 = {
      head: '<div class="band"><div><p class="kicker">Homebase · Monthly report</p><h1>' + month + '</h1></div><div class="meta">' + prepared(opt.user) + '</div></div>',
      blocks: [
        '<p class="lede">' + lede + '</p>',
        '<div class="kpis">' + kp('Income', money(A.income), P ? money(P.income) : '', money(a12i)) + kp('Spent', money(A.spent), P ? money(P.spent) : '', money(a12s)) +
          kp('Net', money(net, false, true), P ? money(P.income - P.spent, false, true) : '', money(a12i - a12s, false, true), net >= 0) +
          kp('Kept', A.income ? pct(kept) : '—', P && P.income ? pct(keptPct(P)) : '—', pct(a12kept)) + '</div>',
        worth.length ? '<div class="callout"><b>Worth a look:</b> ' + worth.join(' · ') + '</div>' : '',
        block('Income and spending, last ' + l12k.length + ' months', legend([['Income', '#9CC7B2'], ['Spent', '#D9CFB8']]) + ' · in $1,000s · net below each month',
          incomeSpentSvg(L.map(function (X, i) { return { label: mkLabel(l12k[i]), income: X.income, spent: X.spent }; }))),
        { table: catTable, fit: true, title: 'Categories', legend: '<span class="mk"></span>12-month average' }
      ]
    };
    var page2 = {
      title: 'Bills and cars',
      blocks: [
        M.bills.length ? block('Bills', '', billsMonthTable(M, k, l12k, ytdK)) : '',
        M.bills.length ? block('Bills, last ' + l12k.length + ' months', legend(M.bills.map(function (b) { return [b.name, M.billColor[b.name]]; })), billsChart(M, l12k, true) +
          (M.bills.some(function (b) { return b.every > 1; }) ? '<p class="note">' + M.bills.filter(function (b) { return b.every > 1; }).map(function (b) { return esc(b.name); }).join(', ') + ' is billed every two months, so it’s compared with its previous bill and its average is per bill.</p>' : '')) : '',
        block('Cars · ' + MNL[mkParts(k)[1] - 1], '', carsMonthTable(M, k)),
        carCharts(M, ytdK, k.substring(0, 4) + ' so far', l12k, true),
        block('Cost of ownership', '', ownershipTable(M, ytdK, k.substring(0, 4) + ' so far · ' + ytdK.length + ' months', l12k, 'Last ' + l12k.length + ' months') + noteForCars(M))
      ]
    };
    var largest = largestRows(M, A.expenses, 10, false);
    var page3 = {
      title: 'Where the money went',
      blocks: [
        '<div class="cols2" style="grid-template-columns:1.05fr 1fr">' + donutBlock(A.by, 'Spending by category · ' + MNL[mkParts(k)[1] - 1]) + topStoresBlock(M, A.expenses, 8, 'Top stores · ' + MNL[mkParts(k)[1] - 1]) + '</div>',
        '<div class="cols2">' + block('Kept so far · ' + k.substring(0, 4), legend([['each month', '#9CC7B2']]) + ' · <span style="color:#0F6E56">—</span> running total',
          keptSvg(ytdK.map(function (m) { var X = M.month(m); return { label: mkLabel(m), net: X.income - X.spent }; }))) + block('Year to date · ' + k.substring(0, 4), '', ytdRows(M, ytdK)) + '</div>',
        largest ? { table: '<table style="font-size:10.5px"><tr><th>Date</th><th>Store</th><th>Category</th><th>Description</th><th class="r">Amount</th></tr>' + largest + '</table>', title: 'Largest expenses · ' + MNL[mkParts(k)[1] - 1], legend: 'Mortgage left out' } : '',
        (function () { var b = budgetsRow(M, A.by, 1); return b ? block('Budgets · ' + MNL[mkParts(k)[1] - 1], '', b) : ''; })()
      ]
    };
    return {
      kind: 'monthly', label: month, footer: 'Monthly report · ' + month,
      fileName: 'Homebase Monthly ' + k + '.pdf', subject: 'Homebase — monthly report: ' + month,
      pages: [page1, page2, page3],
      summary: { lede: lede, figures: [['Income', money(A.income)], ['Spent', money(A.spent)], ['Net', money(net, false, true)], ['Kept', A.income ? pct(kept) : '—']] },
      meta: { type: 'monthly', start: mkStart(k), end: mkEnd(k), income: A.income, expense: A.spent, net: net, entryCount: A.entries.length }
    };
  }

  // ================================================================
  // YEARLY
  // ================================================================
  function yearlyReport(M, y, opt) {
    var nowK = mkOf(todayISO());
    var lastK = (y + '-12' <= nowK) ? y + '-12' : mkShift(nowK, -1);
    if (lastK.substring(0, 4) !== String(y)) lastK = nowK;      // January: show the month in progress
    var ms = monthsBetween(y + '-01', lastK).filter(inData);
    var full = ms.length === 12 && lastK === y + '-12';
    var cmpOk = (y - 1) + '-01-01' >= DATA_START;               // a full previous year exists
    var cms = cmpOk ? ms.map(function (m) { return mkShift(m, -12); }) : [];
    var span = full ? '' : ' so far (' + mkLabel(ms[0]) + '–' + mkLabel(ms[ms.length - 1]) + ')';
    var nm = ms.length || 1;
    var tot = function (keys, f) { return sum(keys, function (m) { return f(M.month(m)); }); };
    var I = tot(ms, function (X) { return X.income; }), S = tot(ms, function (X) { return X.spent; }), N = I - S;
    var pI = tot(cms, function (X) { return X.income; }), pS = tot(cms, function (X) { return X.spent; }), pN = pI - pS;
    var kept = I ? N / I * 100 : 0, pkept = pI ? pN / pI * 100 : 0;
    var by = {}, pby = {}, incomeBy = {}, pincomeBy = {}, expenses = [];
    ms.forEach(function (m) { var X = M.month(m); Object.keys(X.by).forEach(function (b) { by[b] = (by[b] || 0) + X.by[b]; }); Object.keys(X.incomeBy).forEach(function (b) { incomeBy[b] = (incomeBy[b] || 0) + X.incomeBy[b]; }); expenses = expenses.concat(X.expenses); });
    cms.forEach(function (m) { var X = M.month(m); Object.keys(X.by).forEach(function (b) { pby[b] = (pby[b] || 0) + X.by[b]; }); Object.keys(X.incomeBy).forEach(function (b) { pincomeBy[b] = (pincomeBy[b] || 0) + X.incomeBy[b]; }); });
    var buckets = orderBuckets(Object.keys(by).concat(Object.keys(pby)), function (b) { return by[b] || 0; });
    var best = maxBy(ms, function (m) { var X = M.month(m); return X.income - X.spent; });
    var worst = maxBy(ms, function (m) { return M.month(m).spent; });

    var lede = 'You kept <b>' + pct(kept) + '</b> of what came in' + span;
    if (cmpOk && pI) {
      var up = buckets.filter(function (b) { return (pby[b] || 0) > 300 && ((by[b] || 0) - pby[b]) / pby[b] > 0.15; }).sort(function (a, b) { return (by[b] - pby[b]) - (by[a] - pby[a]); }).slice(0, 2);
      var dn = buckets.filter(function (b) { return (pby[b] || 0) > 300 && ((by[b] || 0) - pby[b]) / pby[b] < -0.15; }).sort(function (a, b) { return ((by[a] || 0) - pby[a]) - ((by[b] || 0) - pby[b]); }).slice(0, 2);
      lede += ', ' + (kept > pkept ? 'up' : 'down') + ' from ' + pct(pkept) + ' in ' + (y - 1) + '. Spending ' + (S > pS ? 'rose' : 'fell') + ' ' + (Math.abs(S - pS) / (pS || 1) * 100).toFixed(1) + '% to ' + money(S) +
        (up.length ? '; ' + listAnd(up) + ' grew the most' : '') + (dn.length ? (up.length ? ', while ' : '; ') + listAnd(dn) + ' came down' : '');
    } else {
      lede += ', spending ' + money(S) + ' against ' + money(I) + ' of income';
    }
    lede += best === worst ? '. ' + MNL[mkParts(best)[1] - 1] + ' was both the best month for saving and the most expensive.'
      : '. ' + MNL[mkParts(best)[1] - 1] + ' was the best month for saving and ' + MNL[mkParts(worst)[1] - 1] + ' the most expensive.';
    var worth = [];
    if (cmpOk) buckets.forEach(function (b) { if ((pby[b] || 0) > 300 && Math.abs((by[b] || 0) - pby[b]) / pby[b] >= 0.25) worth.push(esc(b) + ' ' + money(by[b] || 0) + ', ' + ((by[b] || 0) > pby[b] ? 'up' : 'down') + ' ' + pct(Math.abs((by[b] || 0) - pby[b]) / pby[b] * 100) + ' on ' + (y - 1)); });
    buckets.forEach(function (b) { var bud = M.budget(b) * nm; if (bud && (by[b] || 0) > bud) worth.push(esc(b) + ' over its ' + money(bud) + ' budget for the year by ' + money(by[b] - bud)); });

    var scale = Math.max.apply(null, buckets.filter(function (b) { return fixedIndex(b) !== 0; }).map(function (b) { return Math.max(by[b] || 0, pby[b] || 0); }).concat([1])) * 1.12;
    var peakCell = function (b) {
      var vals = ms.map(function (m) { return M.month(m).by[b] || 0; });
      if (uniq(vals.map(function (v) { return Math.round(v); })).length === 1) return '<span class="mut">same monthly</span>';
      var i = vals.indexOf(Math.max.apply(null, vals));
      return '<span class="mut">' + mkLabel(ms[i]) + ' ' + money(vals[i]) + '</span>';
    };
    var incomes = incomeOrder(Object.keys(incomeBy), function (n) { return incomeBy[n]; });
    var rows = incomes.map(function (n) {
      var vals = ms.map(function (m) { return M.month(m).incomeBy[n] || 0; }), i = vals.indexOf(Math.max.apply(null, vals));
      return '<tr class="lines" style="background:#F1F7F3"><td class="pos">' + esc(n) + '</td><td class="r pos"><b>' + money(incomeBy[n]) + '</b></td>' +
        (cmpOk ? cmpCell(incomeBy[n], pincomeBy[n] || 0, { invert: true, pl: true }) + '<td></td>' : '') +
        '<td class="r">' + money(incomeBy[n] / nm) + '</td><td class="r"><span class="mut">' + mkLabel(ms[i]) + ' ' + money(vals[i]) + '</span></td><td class="r">—</td></tr>';
    }).join('');
    rows += buckets.map(function (b) {
      var v = by[b] || 0, p = pby[b] || 0, bud = M.budget(b) * nm;
      var sc = fixedIndex(b) === 0 ? Math.max(v, p, 1) * 1.1 : scale;
      return '<tr class="lines"><td>' + esc(b) + '</td><td class="r"><b>' + money(v) + '</b></td>' +
        (cmpOk ? cmpCell(v, p, { pl: true }) + '<td class="pl" style="width:16%">' + ratioBar(v, p, sc) + '</td>' : '') +
        '<td class="r">' + money(v / nm) + '</td><td class="r">' + peakCell(b) + '</td>' +
        (bud ? '<td class="r"><span class="' + (v > bud ? 'neg' : 'pos') + '">' + money(bud) + '</span></td>' : '<td class="r">—</td>') + '</tr>';
    }).join('');
    rows += '<tr class="tot"><td>Total spent</td><td class="r">' + money(S) + '</td>' + (cmpOk ? '<td class="r pl cmp">' + money(pS) + ' ' + chip(S, pS) + '</td><td></td>' : '') +
      '<td class="r">' + money(S / nm) + '</td><td></td><td></td></tr>';
    var catTable = '<table style="font-size:10.5px"><tr><th style="width:22%">Category</th><th class="r">' + y + '</th>' +
      (cmpOk ? '<th class="r pl" style="padding-right:50px">' + (y - 1) + (full ? '' : ' same months') + '</th><th class="pl">vs ' + (y - 1) + '</th>' : '') +
      '<th class="r">Per month</th><th class="r">Highest month</th><th class="r">Budget</th></tr>' + rows + '</table>';

    var title = full ? y + ' in review' : y + ' so far';
    var page1 = {
      head: '<div class="band"><div><p class="kicker">Homebase · Yearly report</p><h1>' + title + '</h1></div><div class="meta">' + prepared(opt.user) + '</div></div>',
      blocks: [
        '<p class="lede">' + lede + '</p>',
        '<div class="kpis">' +
          kpi('Income', money(I), cmpOk ? (y - 1) + ' ' + money(pI) + ' · ' + chip(I, pI, true) : 'per month ' + money(I / nm)) +
          kpi('Spent', money(S), cmpOk ? (y - 1) + ' ' + money(pS) + ' · ' + chip(S, pS) : 'per month ' + money(S / nm)) +
          kpi('Net', money(N, false, true), cmpOk ? (y - 1) + ' ' + money(pN, false, true) : 'per month ' + money(N / nm, false, true), N >= 0) +
          kpi('Kept', pct(kept), (cmpOk ? (y - 1) + ' ' + pct(pkept) + ' · ' : '') + 'avg month ' + money(N / nm, false, true)) + '</div>',
        worth.length ? '<div class="callout"><b>Worth a look:</b> ' + worth.join(' · ') + '</div>' : '',
        block('Income and spending by month', legend([['Income', '#9CC7B2'], ['Spent', '#D9CFB8']]) + ' · in $1,000s · net below each month',
          incomeSpentSvg(ms.map(function (m) { var X = M.month(m); return { label: mkLabel(m), income: X.income, spent: X.spent }; }), { highlightLast: false })),
        { table: catTable, fit: true, title: 'Categories', legend: cmpOk ? '<span class="mk"></span>' + (y - 1) + ' total' : '' }
      ]
    };

    // Bills, whole year
    var brow = function (name, vals, pvals, cls, perBill) {
      var t = sum(vals), pt = sum(pvals || []), nz = vals.filter(Boolean);
      var a = perBill && nz.length ? avg(nz) : t / nm;
      var hi = vals.indexOf(Math.max.apply(null, vals));
      return '<tr class="' + cls + '"><td>' + name + '</td><td class="r"><b>' + money(t) + '</b></td>' + (cmpOk ? cmpCell(t, pt, { pl: true }) : '') +
        '<td class="r">' + money(a, true) + (perBill ? ' <span class="mut">/bill</span>' : '') + '</td><td class="r mut">' + (vals[hi] ? mkLabel(ms[hi]) + ' ' + money(vals[hi], true) : '—') + '</td><td class="r mut">' + nz.length + '</td></tr>';
    };
    var bRows = M.bills.map(function (b) {
      return brow(esc(b.name) + (b.every > 1 ? ' <span class="mut" style="font-size:9px">· every ' + b.every + ' months</span>' : ''),
        ms.map(function (m) { return M.month(m).bill[b.name] || 0; }), cms.map(function (m) { return M.month(m).bill[b.name] || 0; }), 'lines', b.every > 1);
    }).join('');
    var bt = function (m) { return sum(M.bills, function (b) { return M.month(m).bill[b.name] || 0; }); };
    bRows += brow('All bills', ms.map(bt), cms.map(bt), 'tot', false);
    var billsTbl = '<table style="font-size:10.5px"><tr><th style="width:32%">Bill</th><th class="r">' + y + '</th>' + (cmpOk ? '<th class="r pl" style="padding-right:50px">' + (y - 1) + '</th>' : '') +
      '<th class="r">Per month</th><th class="r">Highest month</th><th class="r">Bills</th></tr>' + bRows + '</table>';

    // Cars, whole year
    var dash = function (x) { return x ? money(x) : '—'; };
    var carNames = M.cars.slice();
    ms.forEach(function (m) { M.carRows(M.month(m)).forEach(function (c) { if (carNames.indexOf(c) === -1) carNames.push(c); }); });
    var cRows = '', T = { gas: 0, maint: 0, ins: 0 }, PT = 0;
    carNames.concat(['Total']).forEach(function (c) {
      var v, pv;
      if (c === 'Total') { v = T; pv = PT; }
      else {
        v = { gas: carSum(M, ms, c, 'gas'), maint: carSum(M, ms, c, 'maint'), ins: carSum(M, ms, c, 'ins') };
        pv = sum(['gas', 'maint', 'ins'], function (p) { return carSum(M, cms, c, p); });
        T.gas += v.gas; T.maint += v.maint; T.ins += v.ins; PT += pv;
      }
      var t = v.gas + v.maint + v.ins;
      cRows += '<tr class="' + (c === 'Total' ? 'tot' : 'lines') + '"><td>' + esc(c) + '</td><td class="r">' + dash(v.gas) + '</td><td class="r">' + dash(v.maint) + '</td><td class="r">' + dash(v.ins) + '</td><td class="r"><b>' + dash(t) + '</b></td><td class="gap"></td>' +
        (cmpOk ? '<td class="cmpl"><span class="mut">' + dash(pv) + '</span>' + (t && pv ? ' ' + chip(t, pv) : '') + '</td>' : '') + '<td class="r">' + dash(t / nm) + '</td></tr>';
    });
    var carsTbl = '<table style="font-size:10.5px;table-layout:fixed"><colgroup><col style="width:15%"><col style="width:11%"><col style="width:11%"><col style="width:11%"><col style="width:11%"><col style="width:7%">' + (cmpOk ? '<col style="width:20%">' : '') + '<col style="width:14%"></colgroup>' +
      '<tr><th></th><th colspan="4" class="c" style="color:#8a6412">' + y + span + '</th><th class="gap"></th><th colspan="' + (cmpOk ? 2 : 1) + '" style="color:#8a6412">' + (cmpOk ? 'Compared with' : '') + '</th></tr>' +
      '<tr><th>Car</th><th class="r">Gas</th><th class="r">Maint.</th><th class="r">Insurance</th><th class="r">Total</th><th class="gap"></th>' + (cmpOk ? '<th>' + (y - 1) + ' total</th>' : '') + '<th class="r">Per month</th></tr>' + cRows + '</table>';

    var page2 = {
      title: 'Bills and cars',
      blocks: [
        M.bills.length ? block('Bills · ' + y, '', billsTbl) : '',
        M.bills.length ? block('Bills by month', legend(M.bills.map(function (b) { return [b.name, M.billColor[b.name]]; })), billsChart(M, ms, false) +
          (M.bills.some(function (b) { return b.every > 1; }) ? '<p class="note">Bills paid every two months show their average per bill.</p>' : '')) : '',
        block('Cars · ' + y, '', carsTbl),
        carCharts(M, ms, String(y), ms, false),
        block('Cost of ownership', '', ownershipTable(M, ms, y + span, cmpOk ? cms : null, (y - 1) + (full ? '' : ' same months')) + noteForCars(M))
      ]
    };
    var largest = largestRows(M, expenses, 10, false);
    var page3 = {
      title: 'Where the money went',
      blocks: [
        '<div class="cols2" style="grid-template-columns:1.05fr 1fr">' + donutBlock(by, 'Spending by category · ' + y) + topStoresBlock(M, expenses, 10, 'Top stores · ' + y) + '</div>',
        '<div class="cols2">' + block('Kept through the year', legend([['each month', '#9CC7B2']]) + ' · <span style="color:#0F6E56">—</span> running total',
          keptSvg(ms.map(function (m) { var X = M.month(m); return { label: mkLabel(m), net: X.income - X.spent }; }))) + block('Month by month', '', ytdRows(M, ms)) + '</div>',
        largest ? { table: '<table style="font-size:10.5px"><tr><th>Date</th><th>Store</th><th>Category</th><th>Description</th><th class="r">Amount</th></tr>' + largest + '</table>', title: 'Largest expenses · ' + y, legend: 'Mortgage left out' } : '',
        (function () { var b = budgetsRow(M, by, nm); return b ? block('Budgets · ' + y, '', b) : ''; })()
      ]
    };
    return {
      kind: 'yearly', label: title, footer: 'Yearly report · ' + y,
      fileName: 'Homebase Yearly ' + y + (full ? '' : ' so far') + '.pdf', subject: 'Homebase — yearly report: ' + title,
      pages: [page1, page2, page3],
      summary: { lede: lede, figures: [['Income', money(I)], ['Spent', money(S)], ['Net', money(N, false, true)], ['Kept', pct(kept)]] },
      meta: { type: 'yearly', start: y + '-01-01', end: mkEnd(ms[ms.length - 1]), income: I, expense: S, net: N, entryCount: expenses.length }
    };
  }

  // ================================================================
  // WEEKLY
  // ================================================================
  function weeklyReport(M, start, opt) {
    var end = addDays(start, 6), wk = isoWeek(start);
    var A = M.agg(start, end), P = M.agg(addDays(start, -7), addDays(start, -1));
    var prevWeeks = [];
    for (var i = 1; i <= 8; i++) { var s = addDays(start, -7 * i); if (s >= DATA_START) prevWeeks.push(M.agg(s, addDays(s, 6))); }
    var a8 = function (f) { return prevWeeks.length ? avg(prevWeeks.map(f)) : 0; };
    var usual = a8(function (X) { return X.spent; }), diff = usual - A.spent;
    var title = 'Week ' + wk + ' · ' + shortDate(start) + ' – ' + (parseISO(start).getMonth() === parseISO(end).getMonth() ? parseISO(end).getDate() : shortDate(end)) + ', ' + end.substring(0, 4);
    var food = A.by[FOOD_LABEL] || 0, fb = M.weeklyFoodBudget;
    var buckets = orderBuckets(Object.keys(A.by).concat(Object.keys(P.by)), function (b) { return A.by[b] || 0; });
    var hi = buckets.filter(function (b) { var a = a8(function (X) { return X.by[b] || 0; }); return a > 20 && (A.by[b] || 0) / a >= 1.4; }).slice(0, 3);

    var lede = 'You spent <b>' + money(A.spent, true) + '</b> this week' +
      (prevWeeks.length ? ', <span class="' + (diff >= 0 ? 'pos' : 'neg') + '">' + money(Math.abs(diff)) + ' ' + (diff >= 0 ? 'less' : 'more') + '</span> than a usual week' : '') +
      ' and ' + money(Math.abs(A.spent - P.spent)) + ' ' + (A.spent > P.spent ? 'more' : 'less') + ' than last week. ' +
      (fb ? 'Food is ' + (food <= fb ? 'under' : 'over') + ' budget with ' + money(Math.abs(fb - food), true) + (food <= fb ? ' left. ' : ' over. ') : '') +
      (hi.length ? listAnd(hi) + ' ran well above usual.' : '');

    var days = [];
    for (var d = 0; d < 7; d++) { var ds = addDays(start, d); days.push({ date: ds, total: sum(A.expenses.filter(function (e) { return e.date === ds; }), function (e) { return M.amt(e); }) }); }
    var hiDay = days.indexOf(maxBy(days, function (x) { return x.total; }));
    var daySvg = barsSvg(days.map(function (x) { return x.total; }), WD, { W: 330, H: 100, highlight: hiDay, avg: usual / 7, fmt: function (v) { return '$' + Math.round(v).toLocaleString('en-US'); } });

    var incomes = incomeOrder(uniq(Object.keys(A.incomeBy).concat(Object.keys(P.incomeBy))), function (n) { return A.incomeBy[n] || 0; });
    var rows = incomes.map(function (n) {
      var v = A.incomeBy[n] || 0;
      return '<tr class="lines" style="background:#F1F7F3"><td class="pos">' + esc(n) + '</td><td class="r pos"><b>' + (v ? money(v, true) : '—') + '</b></td>' +
        cmpCell(v, P.incomeBy[n] || 0, { invert: true, cents: true }) + '<td class="pl"></td><td class="r mut">' + money(a8(function (X) { return X.incomeBy[n] || 0; })) + '</td></tr>';
    }).join('');
    rows += buckets.map(function (b) {
      var v = A.by[b] || 0, a = a8(function (X) { return X.by[b] || 0; });
      var sc = Math.max(v, a, fixedIndex(b) === 0 ? 1 : 300, 1) * 1.05;
      return '<tr class="lines"><td>' + esc(b) + '</td><td class="r"><b>' + (v ? money(v, true) : '—') + '</b></td>' + cmpCell(v, P.by[b] || 0, { cents: true }) +
        '<td class="pl" style="width:22%">' + ratioBar(v, a, sc) + '</td><td class="r mut">' + money(a) + '</td></tr>';
    }).join('');
    rows += '<tr class="tot"><td>Total spent</td><td class="r">' + money(A.spent, true) + '</td><td class="r cmp">' + money(P.spent, true) + ' ' + chip(A.spent, P.spent) + '</td><td></td><td class="r">' + money(usual) + '</td></tr>';
    var catTable = '<table style="font-size:10.5px"><tr><th style="width:30%">Category</th><th class="r">This week</th><th class="r" style="padding-right:50px">Last week</th><th class="pl">vs usual</th><th class="r">8-week avg</th></tr>' + rows + '</table>';

    // Cars this week
    var dash = function (x) { return x ? money(x, true) : '—'; };
    var names = M.carRows(A), T = { gas: 0, maint: 0, ins: 0 };
    var carRows = names.map(function (c) {
      var v = A.car[c] || { gas: 0, maint: 0, ins: 0 };
      T.gas += v.gas; T.maint += v.maint; T.ins += v.ins;
      return '<tr class="lines"><td>' + esc(c) + '</td><td class="r">' + dash(v.gas) + '</td><td class="r">' + dash(v.maint) + '</td><td class="r">' + dash(v.ins) + '</td><td class="r"><b>' + dash(v.gas + v.maint + v.ins) + '</b></td></tr>';
    }).join('') + '<tr class="tot"><td>Total</td><td class="r">' + dash(T.gas) + '</td><td class="r">' + dash(T.maint) + '</td><td class="r">' + dash(T.ins) + '</td><td class="r">' + dash(T.gas + T.maint + T.ins) + '</td></tr>';

    var big = A.expenses.slice().sort(function (a, b) { return M.amt(b) - M.amt(a); }).slice(0, 5).map(function (e) {
      return '<tr class="lines"><td>' + esc(M.storeName(e) || '—') + ' <span class="mut">· ' + WD[wdIndex(e.date)] + '</span></td><td class="mut">' + esc(M.catName(e)) + '</td><td class="r">' + money(M.amt(e), true) + '</td></tr>';
    }).join('');

    // Coming up: recurring rules due in the week after this one.
    var coming = [];
    if (typeof window.nextOccurrence === 'function') {
      M.raw.recurring.forEach(function (r) {
        try {
          var cur = window.nextOccurrence(r, end), guard = 0;
          while (cur && cur <= addDays(end, 7) && guard++ < 10) { coming.push({ date: cur, name: display(r.storeName || r.description || r.categoryName || 'Recurring'), cat: display(r.categoryName || ''), amount: num(r.amount) }); cur = window.nextOccurrence(r, cur); }
        } catch (e) { /* skip a malformed rule */ }
      });
    }
    coming.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var comingRows = coming.slice(0, 8).map(function (c) {
      return '<tr class="lines"><td>' + esc(c.name) + ' <span class="mut">· ' + WD[wdIndex(c.date)] + ' ' + parseISO(c.date).getDate() + '</span></td><td class="mut">' + esc(c.cat) + '</td><td class="r">' + money(c.amount, true) + '</td></tr>';
    }).join('');

    var foodCard = fb ? block('Food budget', '', '<div class="card"><table><tr><td>' + FOOD_LABEL + '</td><td class="r">' + money(food, true) + ' <span class="mut">/ ' + money(fb) + '</span></td></tr></table>' +
      '<div class="bar" style="margin:8px 0 6px;height:9px"><i style="width:' + Math.min(food / fb, 1) * 100 + '%;height:9px;background:' + (food <= fb ? '#0F6E56' : '#B44A43') + '"></i></div>' +
      '<p style="font-size:10.5px;margin:0" class="' + (food <= fb ? 'pos' : 'neg') + '">' + money(Math.abs(fb - food), true) + (food <= fb ? ' left' : ' over') + '</p></div>') : '';

    var page1 = {
      head: '<div class="band"><div><p class="kicker">Homebase · Weekly report</p><h1>' + title + '</h1></div><div class="meta">' + prepared(opt.user) + '</div></div>',
      blocks: [
        '<p class="lede">' + lede + '</p>',
        '<div class="kpis">' + kpi('Income', money(A.income, true), 'Last week ' + money(P.income) + ' · avg ' + money(a8(function (X) { return X.income; }))) +
          kpi('Spent', money(A.spent, true), A.expenses.length + ' expenses · last week ' + money(P.spent)) +
          kpi('Net', money(A.income - A.spent, true, true), A.income ? 'kept ' + pct((A.income - A.spent) / A.income * 100) : 'no income this week', A.income - A.spent >= 0) +
          kpi('Vs usual week', prevWeeks.length ? '<span class="' + (diff >= 0 ? 'pos' : 'neg') + '">' + (diff >= 0 ? '−' : '+') + pct(Math.abs(diff) / (usual || 1) * 100) + '</span>' : '—', prevWeeks.length + '-week avg ' + money(usual)) + '</div>',
        '<div class="cols">' + block('Day by day', '- - - usual day ' + money(usual / 7), daySvg) +
          '<div>' + foodCard + block('Coming up · ' + shortDate(addDays(end, 1)) + ' – ' + shortDate(addDays(end, 7)), '', comingRows ? '<table style="font-size:10.5px">' + comingRows + '</table>' : '<p class="note">Nothing scheduled.</p>') + '</div></div>',
        '<div class="cols2">' + block('Cars this week', '', '<table style="font-size:10.5px"><tr><th>Car</th><th class="r">Gas</th><th class="r">Maint.</th><th class="r">Insurance</th><th class="r">Total</th></tr>' + carRows + '</table>') +
          block('Biggest purchases', '', big ? '<table style="font-size:10.5px">' + big + '</table>' : '<p class="note">No expenses.</p>') + '</div>',
        { table: catTable, fit: true, title: 'Categories', legend: '<span class="mk"></span>8-week average' }
      ]
    };
    var entryRows = [];
    for (var di = 0; di < 7; di++) {
      var dd = addDays(start, di);
      var es = A.expenses.filter(function (e) { return e.date === dd; });
      if (!es.length) continue;
      entryRows.push({ group: true, html: '<tr class="day"><td colspan="4">' + dayLabel(dd) + ' · ' + es.length + (es.length === 1 ? ' entry' : ' entries') + '</td><td class="r">' + money(sum(es, function (e) { return M.amt(e); }), true) + '</td></tr>' });
      es.forEach(function (e) {
        var t = M.tagFor(e);
        entryRows.push({ html: '<tr class="lines"><td style="width:18%">' + esc(M.storeName(e) || '—') + '</td><td style="width:22%">' + esc(M.catName(e)) + '</td><td style="width:14%">' + (t && t.text ? tag(t.text, t.kind) : '') + '</td><td class="mut">' + esc(e.description || '—') + '</td><td class="r" style="width:11%">' + money(M.amt(e), true) + '</td></tr>' });
      });
    }
    entryRows.push({ html: '<tr class="tot"><td colspan="4">Total · ' + A.expenses.length + ' expenses</td><td class="r">' + money(A.spent, true) + '</td></tr>' });
    var page2 = {
      title: 'All entries this week',
      blocks: [{ head: '<table style="font-size:10.5px"><tr><th>Store</th><th>Category</th><th>Car / project</th><th>Description</th><th class="r">Amount</th></tr>', rows: entryRows, foot: '</table>' },
        '<p class="note" style="margin-top:12px">Income and transfers aren’t listed.</p>']
    };
    return {
      kind: 'weekly', label: shortDate(start) + ' – ' + shortDate(end) + ' (week ' + wk + ')', footer: 'Weekly report · ' + shortDate(start) + ' – ' + shortDate(end) + ', ' + end.substring(0, 4),
      fileName: 'Homebase Weekly ' + start.substring(0, 4) + '-W' + (wk < 10 ? '0' : '') + wk + '.pdf', subject: 'Homebase — weekly report: ' + title,
      pages: [page1, page2],
      summary: { lede: lede, figures: [['Income', money(A.income, true)], ['Spent', money(A.spent, true)], ['Net', money(A.income - A.spent, true, true)]] },
      meta: { type: 'weekly', start: start, end: end, income: A.income, expense: A.spent, net: A.income - A.spent, entryCount: A.entries.length }
    };
  }

  // ================================================================
  // CATEGORY and STORE (shared engine — one filters by category,
  // the other by store)
  // ================================================================
  function focusReport(M, mode, name, opt) {
    var startK = mkOf(CAT_START), nowK = mkOf(todayISO());
    var keys = monthsBetween(startK, nowK).reverse();            // newest first, includes the month in progress
    var chrono = keys.slice().reverse();
    var lastFull = mkShift(nowK, -1);
    var isCat = mode === 'category';
    var bucketOf = function (e) { return M.classify(e).bucket; };
    // A category report on Groceries + Meal Kit or Bills covers every member category.
    var match = isCat ? function (e) { var k = M.classify(e); return k.bucket === name || k.cat === name; } : function (e) { return M.storeName(e) === name; };
    var entries = M.raw.entries.filter(function (e) { return M.isSpend(e) && e.date >= CAT_START && match(e); })
      .sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : M.amt(b) - M.amt(a)); });
    var by = {};
    entries.forEach(function (e) { var k = mkOf(e.date); (by[k] = by[k] || []).push(e); });
    var val = function (k) { return sum(by[k] || [], function (e) { return M.amt(e); }); };
    var visits = function (k) { return uniq((by[k] || []).map(function (e) { return e.date; })).length; };
    var count = isCat ? function (k) { return (by[k] || []).length; } : visits;
    var countWord = isCat ? 'entries' : 'visits';
    var total = sum(keys, val), nTotal = sum(keys, count);
    var full = keys.filter(function (k) { return k <= lastFull; });
    var l12f = full.slice(0, 12);
    var a12 = avg(l12f.map(val));
    var years = uniq(keys.map(function (k) { return k.substring(0, 4); }));      // newest first
    var curY = nowK.substring(0, 4);
    var ytd = keys.filter(function (k) { return k.substring(0, 4) === curY; });
    var lyS = ytd.map(function (k) { return mkShift(k, -12); }).filter(function (k) { return k >= startK; });
    var ytdT = sum(ytd, val), lyT = lyS.length === ytd.length ? sum(lyS, val) : 0;
    var bud = isCat ? M.budget(name) : 0;
    var over = bud ? full.filter(function (k) { return val(k) > bud; }) : [];
    var perMonth = full.length ? sum(full, val) / full.length : total;

    // Breakdown: stores for a category, categories for a store.
    var parts = {}, partCnt = {};
    entries.forEach(function (e) {
      var p = isCat ? (M.storeName(e) || 'No store') : M.catName(e);
      parts[p] = (parts[p] || 0) + M.amt(e); partCnt[p] = (partCnt[p] || 0) + 1;
    });
    var partNames = Object.keys(parts).sort(function (a, b) { return parts[b] - parts[a]; });
    var partColor = {};
    partNames.forEach(function (p, i) { partColor[p] = CAT_PALETTE[i % CAT_PALETTE.length]; });
    var top = partNames[0];

    // Car / project split
    var tagTot = {}, tagCnt = {}, tagKind = null;
    entries.forEach(function (e) {
      var k = M.classify(e);
      if (k.carPart) { tagKind = tagKind || 'car'; M.carShares(e).forEach(function (s) { tagTot[s.car] = (tagTot[s.car] || 0) + s.amount; tagCnt[s.car] = (tagCnt[s.car] || 0) + 1; }); }
      else if (e.projectName) { tagKind = tagKind || 'proj'; tagTot[e.projectName] = (tagTot[e.projectName] || 0) + M.amt(e); tagCnt[e.projectName] = (tagCnt[e.projectName] || 0) + 1; }
    });
    var tagNames = Object.keys(tagTot).sort(function (a, b) { return tagTot[b] - tagTot[a]; });
    if (tagKind === 'car') tagNames = M.cars.filter(function (c) { return tagTot[c]; }).concat(tagNames.filter(function (c) { return M.cars.indexOf(c) === -1; }));
    var tagColor = function (t, i) { return tagKind === 'car' ? M.colorOfCar(t) : CAT_PALETTE[i % CAT_PALETTE.length]; };

    // Headline
    var lede = 'Since January ' + startK.substring(0, 4) + ' you’ve spent <b>' + money(total) + '</b> ' + (isCat ? 'on ' + esc(name) + ' across ' + nTotal + ' entries' : 'at ' + esc(name) + ' over <b>' + nTotal + ' visits</b>') +
      ', about <b>' + money(perMonth) + ' a month</b>' + (!isCat && nTotal ? ' and ' + money(total / nTotal) + ' a visit' : '') + '. ';
    if (lyT) lede += curY + ' so far is ' + (ytdT > lyT ? 'up' : 'down') + ' ' + pct(Math.abs(ytdT - lyT) / lyT * 100) + ' on the same months of ' + (curY - 1) + '. ';
    if (bud && full.length) lede += 'You went over the ' + money(bud) + ' budget in <b>' + over.length + ' of ' + full.length + ' months</b>. ';
    if (tagKind === 'car' && tagNames.length) { var tc = maxBy(tagNames, function (t) { return tagTot[t]; }); lede += 'The ' + esc(tc) + ' accounts for the most, ' + money(tagTot[tc]) + ' (' + pct(tagTot[tc] / (total || 1) * 100) + '). '; }
    if (top) {
      if (isCat) lede += esc(top) + ' is where most of it goes (' + money(parts[top]) + ').';
      else {
        var allTop = sum(M.raw.entries.filter(function (e) { return M.isSpend(e) && e.date >= CAT_START && M.catName(e) === top; }), function (e) { return M.amt(e); });
        lede += 'Most of it is <b>' + esc(top) + '</b> (' + pct(parts[top] / (total || 1) * 100) + ')' + (allTop ? ', and ' + esc(name) + ' is where ' + pct(parts[top] / allTop * 100) + ' of all your ' + esc(top) + ' spending goes.' : '.');
      }
    }

    // Tiles
    var prevYears = years.filter(function (y) { return y !== curY; }).sort();
    var yTile = function (y) {
      var ks = keys.filter(function (k) { return k.substring(0, 4) === y; });
      var t = sum(ks, val);
      return kpi(y, money(t), sum(ks, count) + ' ' + countWord + ' · ' + money(t / (ks.length || 1)) + ' a month');
    };
    var tiles = kpi('Since Jan ' + startK.substring(0, 4), money(total), nTotal + ' ' + countWord + ' · ' + keys.length + ' months') +
      prevYears.map(yTile).join('') +
      kpi(curY + ' so far', money(ytdT), lyT ? 'same months ' + (curY - 1) + ' ' + money(lyT) + ' · ' + chip(ytdT, lyT) : ytd.length + ' months') +
      kpi('Per month', money(a12), 'last ' + l12f.length + ' months · ' + mkLabel(nowK) + ' so far ' + money(val(nowK))) +
      (isCat ? (bud ? kpi('Over budget', over.length + ' of ' + full.length, 'months over ' + money(bud)) : kpi('Average entry', money(total / (nTotal || 1), true), nTotal + ' entries'))
        : kpi('Per visit', money(total / (nTotal || 1), true), (nTotal / (keys.length || 1)).toFixed(1) + ' visits a month'));
    var nTiles = 4 + prevYears.length + (isCat ? 0 : 0);

    var chart = isCat ? trendSvg(chrono, chrono.map(val), bud)
      : stackedSvg(chrono.map(mkLabel), partNames.map(function (p) { return { name: p, color: partColor[p], values: chrono.map(function (k) { return sum((by[k] || []).filter(function (e) { return M.catName(e) === p; }), function (e) { return M.amt(e); }); }) }; }), { H: 110 });

    var perYear = years.map(function (y) {
      var ks = keys.filter(function (k) { return k.substring(0, 4) === y; });
      var t = sum(ks, val), prevK = ks.map(function (k) { return mkShift(k, -12); }).filter(function (k) { return k >= startK; });
      var pt = prevK.length === ks.length ? sum(prevK, val) : 0, n = sum(ks, count);
      var h = maxBy(ks, val), fks = ks.filter(function (k) { return k <= lastFull; });
      return '<tr class="lines"><td>' + y + (ks.length < 12 ? ' <span class="mut" style="font-size:9px">· ' + ks.length + ' months</span>' : '') + '</td><td class="r"><b>' + money(t) + '</b></td>' +
        '<td class="r cmp">' + (pt ? '<span class="mut">' + money(pt) + '</span> ' + chip(t, pt) : '<span class="mut">—</span><span class="eq"></span>') + '</td>' +
        '<td class="r">' + money(t / (ks.length || 1)) + '</td><td class="r">' + n + '</td><td class="r">' + money(t / (n || 1), true) + '</td>' +
        '<td class="r mut">' + (h && val(h) ? mkLabel(h) + ' ' + money(val(h)) : '—') + '</td>' +
        (bud ? '<td class="r"><span class="' + (fks.filter(function (k) { return val(k) > bud; }).length ? 'neg' : 'pos') + '">' + fks.filter(function (k) { return val(k) > bud; }).length + ' of ' + fks.length + '</span></td>' : '') + '</tr>';
    }).join('');
    var yearTbl = '<table style="font-size:10.5px"><tr><th style="width:18%">Year</th><th class="r">Total</th><th class="r" style="padding-right:50px">Same months, year before</th><th class="r">Per month</th><th class="r">' + (isCat ? 'Entries' : 'Visits') + '</th>' +
      '<th class="r">' + (isCat ? 'Avg entry' : 'Per visit') + '</th><th class="r">Highest month</th>' + (bud ? '<th class="r">Over budget</th>' : '') + '</tr>' + perYear + '</table>';

    var vmx = Math.max.apply(null, keys.map(val).concat([1])) * 1.05;
    var mRows = keys.map(function (k) {
      var v = val(k), ly = mkShift(k, -12), lyv = ly >= startK ? val(ly) : null;
      return '<tr class="lines"><td>' + mkLabel(k) + ' ' + k.substring(0, 4) + (k === nowK ? ' <span class="mut" style="font-size:8.5px">so far</span>' : '') + '</td><td class="r"><b>' + money(v) + '</b></td><td class="r" style="padding-left:6px">' + count(k) + '</td>' +
        '<td class="pl" style="width:22%">' + ratioBar(v, a12, vmx) + '</td>' +
        '<td class="r cmp">' + (lyv != null ? '<span class="mut">' + money(lyv) + '</span> ' + (v && lyv ? chip(v, lyv) : '<span class="eq"></span>') : '<span class="mut">—</span><span class="eq"></span>') + '</td>' +
        (bud ? '<td class="r"><span class="' + (v > bud ? 'neg' : 'pos') + '">' + (v > bud ? money(v - bud, false, true) : money(bud - v) + ' left') + '</span></td>' : '') + '</tr>';
    });
    var half = Math.ceil(mRows.length / 2);
    var mHead = '<table style="font-size:10px"><tr><th>Month</th><th class="r">Spent</th><th class="r" style="padding-left:6px">' + (isCat ? '#' : 'Visits') + '</th><th class="pl">vs usual</th><th class="r" style="padding-right:50px">Year before</th>' + (bud ? '<th class="r">Budget</th>' : '') + '</tr>';

    var kicker = isCat ? 'Homebase · Category report' : 'Homebase · Store report';
    var heading = isCat ? esc(name) : logoTile(M, name, 38).replace('class="logo"', 'class="logo big"') + esc(name);
    var range = mkLabel(startK) + ' ' + startK.substring(0, 4) + ' – ' + mkLabel(nowK) + ' ' + nowK.substring(0, 4);
    var page1 = {
      head: '<div class="band"><div><p class="kicker">' + kicker + '</p><h1>' + heading + '</h1></div><div class="meta">' + range + '<br>' + prepared(opt.user) + '</div></div>',
      blocks: [
        '<p class="lede">' + lede + '</p>',
        '<div class="kpis" style="grid-template-columns:repeat(' + nTiles + ',1fr)">' + tiles + '</div>',
        block('Every month since Jan ' + startK.substring(0, 4), (isCat ? (bud ? '<span style="color:#B44A43">- - -</span> budget ' + money(bud) + ' · pink = over budget · ' : '') : legend(partNames.slice(0, 7).map(function (p) { return [p, partColor[p]]; })) + ' · ') + 'oldest on the left', chart),
        block('Year by year', '', yearTbl),
        block('Month by month', 'newest first · <span class="mk"></span>average of last 12 months', '<div class="cols2" style="gap:20px">' + mHead + mRows.slice(0, half).join('') + '</table>' + mHead + mRows.slice(half).join('') + '</table></div>')
      ]
    };

    // Page 2
    var p2 = [];
    if (tagNames.length && (isCat || tagKind === 'car')) {
      var tmx = tagTot[tagNames[0]] || 1;
      tmx = Math.max.apply(null, tagNames.map(function (t) { return tagTot[t]; }));
      var tRows = tagNames.map(function (t, i) {
        var yv = years.map(function (y) {
          var s = 0;
          entries.forEach(function (e) {
            if (e.date.substring(0, 4) !== y) return;
            if (tagKind === 'car' && M.classify(e).carPart) M.carShares(e).forEach(function (x) { if (x.car === t) s += x.amount; });
            else if (e.projectName === t) s += M.amt(e);
          });
          return '<td class="r mut">' + money(s) + '</td>';
        }).join('');
        return '<tr class="lines"><td><span class="sw" style="background:' + tagColor(t, i) + ';margin-left:0"></span>' + esc(t) + '</td><td class="r mut">' + tagCnt[t] + '×</td>' +
          '<td style="padding:0 8px;width:20%"><div class="bar"><i style="width:' + (tagTot[t] / tmx * 100).toFixed(0) + '%;background:' + tagColor(t, i) + '"></i></div></td>' +
          '<td class="r"><b>' + money(tagTot[t]) + '</b></td><td class="r mut">' + pct(tagTot[t] / (total || 1) * 100) + '</td>' + yv +
          '<td class="r">' + money(tagTot[t] / (keys.length || 1)) + '</td><td class="r">' + money(tagTot[t] / tagCnt[t], true) + '</td></tr>';
      }).join('');
      var who = tagKind === 'car' ? 'car' : 'project';
      if (isCat) {
        p2.push(block('By ' + who, '', '<table style="font-size:10.5px"><tr><th>' + (who === 'car' ? 'Car' : 'Project') + '</th><th class="r">Entries</th><th></th><th class="r">Total</th><th class="r">Share</th>' +
          years.map(function (y) { return '<th class="r">' + y + '</th>'; }).join('') + '<th class="r">Per month</th><th class="r">Avg entry</th></tr>' + tRows + '</table>'));
        p2.push(block((who === 'car' ? 'Each car' : 'Each project') + ' by month', legend(tagNames.map(function (t, i) { return [t, tagColor(t, i)]; })),
          stackedSvg(chrono.map(mkLabel), tagNames.map(function (t, i) {
            return { name: t, color: tagColor(t, i), values: chrono.map(function (k) {
              var s = 0;
              (by[k] || []).forEach(function (e) {
                if (tagKind === 'car' && M.classify(e).carPart) M.carShares(e).forEach(function (x) { if (x.car === t) s += x.amount; });
                else if (e.projectName === t) s += M.amt(e);
              });
              return s;
            }) };
          }), { H: 95 })));
      }
    }
    // Breakdown table (stores / categories)
    var pmx = parts[top] || 1;
    var pRows = partNames.map(function (p) {
      var yv = years.map(function (y) { return '<td class="r mut">' + money(sum(entries.filter(function (e) { return e.date.substring(0, 4) === y && (isCat ? (M.storeName(e) || 'No store') : M.catName(e)) === p; }), function (e) { return M.amt(e); })) + '</td>'; }).join('');
      return '<tr class="lines">' + (isCat ? '<td style="width:26px;padding:3px 0">' + logoTile(M, p) + '</td><td>' + esc(p) + '</td>' : '<td><span class="sw" style="background:' + partColor[p] + ';margin-left:0"></span>' + esc(p) + '</td>') +
        '<td class="r mut">' + partCnt[p] + '×</td><td style="padding:0 8px;width:22%"><div class="bar"><i style="width:' + (parts[p] / pmx * 100).toFixed(0) + '%' + (isCat ? '' : ';background:' + partColor[p]) + '"></i></div></td>' +
        '<td class="r"><b>' + money(parts[p]) + '</b></td>' + (isCat ? '' : '<td class="r mut">' + pct(parts[p] / (total || 1) * 100) + '</td>') + yv + '<td class="r">' + money(parts[p] / partCnt[p], true) + '</td></tr>';
    });
    var yHeads = years.map(function (y) { return '<th class="r">' + y + '</th>'; }).join('');
    var pHead = isCat ? '<table style="font-size:10.5px"><tr><th></th><th>Store</th><th class="r">Visits</th><th></th><th class="r">Total</th>' + yHeads + '<th class="r">Avg visit</th></tr>'
      : '<table style="font-size:10.5px"><tr><th>Category</th><th class="r">Entries</th><th></th><th class="r">Total</th><th class="r">Share</th>' + yHeads + '<th class="r">Avg entry</th></tr>';
    p2.push({ head: pHead, rows: pRows.map(function (h) { return { html: h }; }), foot: '</table>', title: isCat ? 'Stores' : 'By category' });

    if (!isCat) {
      // Share of each category spent here + gas by car + visit sizes
      var shareRows = partNames.map(function (p) {
        var all = sum(M.raw.entries.filter(function (e) { return M.isSpend(e) && e.date >= CAT_START && M.catName(e) === p; }), function (e) { return M.amt(e); });
        if (!all) return '';
        return '<tr><td style="width:40%">' + esc(p) + '</td><td style="padding:3px 8px"><div class="bar" style="height:10px"><i style="height:10px;width:' + (parts[p] / all * 100).toFixed(0) + '%;background:' + partColor[p] + '"></i></div></td>' +
          '<td class="r" style="width:40px"><b>' + pct(parts[p] / all * 100) + '</b></td><td class="r mut" style="width:120px">' + money(parts[p]) + ' of ' + money(all) + '</td></tr>';
      }).join('');
      var carBlock = '';
      if (tagKind === 'car' && tagNames.length) {
        carBlock = block('Car costs here, by car', '', '<table style="font-size:10.5px">' + tagNames.map(function (t) {
          return '<tr class="lines"><td><span class="sw" style="background:' + M.colorOfCar(t) + ';margin-left:0"></span>' + esc(t) + '</td><td class="r mut">' + tagCnt[t] + ' entries</td><td class="r"><b>' + money(tagTot[t]) + '</b></td></tr>';
        }).join('') + '</table>');
      }
      var vis = [];
      keys.forEach(function (k) { var dd = {}; (by[k] || []).forEach(function (e) { dd[e.date] = (dd[e.date] || 0) + M.amt(e); }); Object.keys(dd).forEach(function (x) { vis.push(dd[x]); }); });
      var vb = [[0, 50, 'Under $50'], [50, 100, '$50–100'], [100, 200, '$100–200'], [200, 300, '$200–300'], [300, 1e12, '$300+']];
      var sz = vb.map(function (b) { var v = vis.filter(function (x) { return x >= b[0] && x < b[1]; }); return [b[2], v.length, sum(v)]; });
      var szmx = Math.max.apply(null, sz.map(function (x) { return x[1]; }).concat([1]));
      var szRows = sz.map(function (x) { return '<tr><td style="width:70px">' + x[0] + '</td><td style="padding:3px 8px"><div class="bar" style="height:10px"><i style="height:10px;width:' + (x[1] / szmx * 100).toFixed(0) + '%;background:#534AB7"></i></div></td><td class="r mut" style="width:36px">' + x[1] + '×</td><td class="r" style="width:60px">' + money(x[2]) + '</td></tr>'; }).join('');
      p2.push('<div class="cols2">' + block('Share of each category spent here', 'since Jan ' + startK.substring(0, 4), '<table style="font-size:10.5px">' + shareRows + '</table>') +
        '<div>' + carBlock + block('Visit sizes', 'one visit = same-day entries', '<table style="font-size:10.5px">' + szRows + '</table>') + '</div></div>');
    }
    var cal = MN.map(function (_, i) { var ks = keys.filter(function (k) { return Number(k.substring(5)) === i + 1 && k <= lastFull; }); return ks.length ? avg(ks.map(val)) : 0; });
    var season = barsSvg(cal, MN, { W: isCat ? 330 : 650, H: isCat ? 95 : 80, highlight: cal.indexOf(Math.max.apply(null, cal)), fmt: function (v) { return String(Math.round(v)); } });
    var bigRows = entries.slice().sort(function (a, b) { return M.amt(b) - M.amt(a); }).slice(0, 10).map(function (e) {
      var t = M.tagFor(e);
      return '<tr class="lines"><td class="mut" style="width:18%">' + dayLabel(e.date) + ', ' + e.date.substring(0, 4) + '</td><td style="width:22%">' + esc(isCat ? (M.storeName(e) || '—') : M.catName(e)) + '</td>' +
        '<td style="width:16%">' + (t && t.text ? tag(t.text, t.kind) : '') + '</td><td class="mut">' + esc(e.description || '—') + '</td><td class="r">' + money(M.amt(e), true) + '</td></tr>';
    }).join('');
    if (isCat) {
      var eb = [[0, 20], [20, 40], [40, 60], [60, 90], [90, 1e12]];
      if (M.classify(entries[0] || {}).carPart === 'gas') eb = [[0, 30], [30, 50], [50, 70], [70, 90], [90, 1e12]];
      var esz = eb.map(function (b) { var v = entries.filter(function (e) { return M.amt(e) >= b[0] && M.amt(e) < b[1]; }); return [(b[1] > 1e11 ? '$' + b[0] + '+' : (b[0] ? '$' + b[0] + '–' + b[1] : 'Under $' + b[1])), v.length, sum(v, function (e) { return M.amt(e); })]; });
      var eszmx = Math.max.apply(null, esz.map(function (x) { return x[1]; }).concat([1]));
      p2.push('<div class="cols2">' + block('Typical month', 'average for each month, ' + startK.substring(0, 4) + ' on', season) +
        block('Entry sizes', '', '<table style="font-size:10.5px">' + esz.map(function (x) { return '<tr><td style="width:66px">' + x[0] + '</td><td style="padding:3px 8px"><div class="bar" style="height:10px"><i style="height:10px;width:' + (x[1] / eszmx * 100).toFixed(0) + '%;background:#534AB7"></i></div></td><td class="r mut" style="width:36px">' + x[1] + '×</td><td class="r" style="width:60px">' + money(x[2]) + '</td></tr>'; }).join('') + '</table>') + '</div>');
    } else {
      p2.push(block('Typical month', 'average for each month, ' + startK.substring(0, 4) + ' on', season));
    }
    if (bigRows) p2.push({ table: '<table style="font-size:10.5px">' + bigRows + '</table>', title: 'Biggest entries' });

    // Entries pages
    var scopeAll = opt.scope !== '12';
    var eKeys = scopeAll ? keys : keys.slice(0, 12);
    var eRows = [];
    eKeys.forEach(function (k) {
      var es = by[k] || [];
      if (!es.length) return;
      eRows.push({ group: true, html: '<tr class="day"><td colspan="4">' + mkLong(k) + ' · ' + count(k) + ' ' + countWord + '</td><td class="r">' + money(val(k), true) + '</td></tr>' });
      es.forEach(function (e) {
        var t = M.tagFor(e);
        var mid = isCat ? esc(M.storeName(e) || '—') : '<span class="sw" style="background:' + partColor[M.catName(e)] + ';margin-left:0"></span>' + esc(M.catName(e));
        eRows.push({ html: '<tr class="lines"><td class="mut" style="width:13%">' + dayLabel(e.date) + '</td><td style="width:' + (isCat ? 20 : 24) + '%">' + mid + '</td><td style="width:14%">' + (t && t.text ? tag(t.text, t.kind) : '') + '</td><td class="mut">' + esc(e.description || '—') + '</td><td class="r" style="width:12%">' + money(M.amt(e), true) + '</td></tr>' });
      });
    });
    var anyTag = entries.some(function (e) { var t = M.tagFor(e); return t && t.text; });
    var page3 = {
      title: (scopeAll ? 'All entries since Jan ' + startK.substring(0, 4) : 'Entries, last 12 months') + ', newest first',
      blocks: eRows.length ? [{ head: '<table style="font-size:10px"><tr><th>Date</th><th>' + (isCat ? 'Store' : 'Category') + '</th><th>' + (anyTag ? 'Car / project' : '') + '</th><th>Description</th><th class="r">Amount</th></tr>', rows: eRows, foot: '</table>' }] : ['<p class="note">No entries.</p>']
    };
    var label = name;
    return {
      kind: mode, label: label, footer: (isCat ? 'Category report · ' : 'Store report · ') + name,
      fileName: 'Homebase ' + (isCat ? 'Category' : 'Store') + ' ' + name.replace(/[\\\/:*?"<>|]+/g, '-') + ' ' + todayISO() + '.pdf',
      subject: 'Homebase — ' + (isCat ? 'category' : 'store') + ' report: ' + name,
      pages: [page1, { title: isCat ? 'Where it goes' : 'What you buy here', blocks: p2 }, page3],
      summary: { lede: lede, figures: [['Since Jan ' + startK.substring(0, 4), money(total)], [curY + ' so far', money(ytdT)], ['Per month', money(a12)]] },
      meta: { type: mode, start: CAT_START, end: todayISO(), income: 0, expense: total, net: -total, entryCount: entries.length, subject: name }
    };
  }

  // ================================================================
  // PICKERS
  // ================================================================
  function options(M) {
    var today = todayISO(), nowK = mkOf(today);
    var weeks = [], mon = mondayOf(new Date());
    for (var i = 1; i <= 12; i++) {
      var s = iso(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 7 * i));
      if (s < DATA_START) break;
      weeks.push({ value: s, label: shortDate(s) + ' – ' + shortDate(addDays(s, 6)), sub: 'week ' + isoWeek(s) });
    }
    var months = [];
    for (var k = mkShift(nowK, -1); mkEnd(k) >= DATA_START && months.length < 24; k = mkShift(k, -1)) months.push({ value: k, label: mkLong(k) });
    var years = [];
    for (var y = Number(nowK.substring(0, 4)); y >= Number(CAT_START.substring(0, 4)); y--) {
      var cur = String(y) === nowK.substring(0, 4);
      if (cur && nowK.substring(5) === '01') continue;            // nothing finished yet this year
      years.push({ value: y, label: cur ? y + ' so far' : y + (y === Number(CAT_START.substring(0, 4)) ? '' : '') });
    }
    // Categories with spending since CAT_START (food and bills offered as groups too).
    var catTotals = {}, storeTotals = {};
    M.raw.entries.forEach(function (e) {
      if (!M.isSpend(e) || e.date < CAT_START) return;
      var k = M.classify(e);
      catTotals[k.cat] = (catTotals[k.cat] || 0) + 1;
      if (k.bucket === FOOD_LABEL || k.bucket === BILLS_LABEL) catTotals[k.bucket] = (catTotals[k.bucket] || 0) + 1;
      var s = M.storeName(e);
      if (s) storeTotals[s] = (storeTotals[s] || 0) + 1;
    });
    var cats = Object.keys(catTotals).sort(function (a, b) { return a.localeCompare(b); }).map(function (c) { return { value: c, label: c, count: catTotals[c] }; });
    var stores = Object.keys(storeTotals).sort(function (a, b) { return a.localeCompare(b); }).map(function (s) { return { value: s, label: s, count: storeTotals[s] }; });
    return { weeks: weeks, months: months, years: years, categories: cats, stores: stores, catStart: CAT_START };
  }

  function buildWith(M, req) {
    var opt = { user: req.user || '', scope: req.scope || 'all' };
    if (req.type === 'weekly') return weeklyReport(M, req.value, opt);
    if (req.type === 'monthly') return monthlyReport(M, req.value, opt);
    if (req.type === 'yearly') return yearlyReport(M, Number(req.value), opt);
    if (req.type === 'category') return focusReport(M, 'category', req.value, opt);
    if (req.type === 'store') return focusReport(M, 'store', req.value, opt);
    throw new Error('Unknown report type: ' + req.type);
  }

  // ================================================================
  // PAGES, PDF, EMAIL BODY
  // ================================================================

  // Page geometry: US Letter at 96 px per inch.
  var PAGE_W = 816, PAGE_H = 1056, PAD_BOTTOM = 58;

  // Every rule is scoped under .hbrp so none of it can reach the app.
  var CSS = [
    '.hbrp, .hbrp * { box-sizing: border-box; }',
    '.hbrp { font-family: Georgia, "Times New Roman", serif; color: #2B2640; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    '.hbrp .page { width: 816px; height: 1056px; padding: 48px 57.6px 57.6px; position: relative; overflow: hidden; background: #ffffff; }',
    '.hbrp .band { background: #2B2640; color: #F7F3E9; margin: -48px -57.6px 20px; padding: 24px 57.6px 20px; display: flex; justify-content: space-between; align-items: flex-end; }',
    '.hbrp .band.slim { padding: 12px 57.6px 11px; margin-bottom: 18px; align-items: center; }',
    '.hbrp .band.slim h1 { font-size: 15px; }',
    '.hbrp .band .kicker { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #E2B866; margin: 0 0 6px; }',
    '.hbrp .band h1 { font-size: 26px; font-weight: normal; margin: 0; display: flex; align-items: center; }',
    '.hbrp .band .meta { text-align: right; font-size: 10.5px; color: #C9C2D6; line-height: 1.6; }',
    '.hbrp p { margin: 0; }',
    '.hbrp .lede { font-size: 14.5px; line-height: 1.55; margin: 0 0 16px; color: #3d3654; }',
    '.hbrp .lede b { font-weight: bold; }',
    '.hbrp .pos { color: #0F6E56; } .hbrp .neg { color: #B44A43; } .hbrp .mut { color: #8a8296; }',
    '.hbrp .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }',
    '.hbrp .kpi { border: 1px solid #E4DCC8; background: #FFFDF7; border-radius: 10px; padding: 9px 12px; }',
    '.hbrp .kpi.good { background: #E3EFE7; border-color: #CBE2D3; }',
    '.hbrp .kpi .l { font-size: 9.5px; color: #8a8296; text-transform: uppercase; letter-spacing: .08em; margin: 0; }',
    '.hbrp .kpi .v { font-size: 21px; margin: 3px 0 2px; }',
    '.hbrp .kpi .s { font-size: 10px; color: #8a8296; margin: 0; line-height: 1.45; }',
    '.hbrp .kpi.good .l, .hbrp .kpi.good .v, .hbrp .kpi.good .s { color: #0F6E56; }',
    '.hbrp h2 { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: #8a6412; font-weight: normal; margin: 0 0 8px; padding-bottom: 5px; border-bottom: 1px solid #E4DCC8; }',
    '.hbrp h2 .legend { float: right; text-transform: none; letter-spacing: 0; }',
    '.hbrp .cols { display: grid; grid-template-columns: 1.35fr 1fr; gap: 24px; }',
    '.hbrp .cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }',
    '.hbrp .cols > *, .hbrp .cols2 > * { min-width: 0; }',
    '.hbrp .block { margin-bottom: 18px; }',
    '.hbrp table { width: 100%; border-collapse: collapse; font-size: 11px; }',
    '.hbrp td, .hbrp th { padding: 3.5px 0; vertical-align: middle; }',
    '.hbrp th { font-weight: normal; font-size: 9px; color: #8a8296; text-transform: uppercase; letter-spacing: .05em; text-align: left; padding-bottom: 5px; border-bottom: 1px solid #EEE7D8; }',
    '.hbrp .r { text-align: right; } .hbrp .c { text-align: center; }',
    '.hbrp td.pl, .hbrp th.pl { padding-left: 10px; }',
    '.hbrp .bar { background: #EFE7D5; height: 7px; border-radius: 4px; position: relative; }',
    '.hbrp .bar > i { display: block; height: 7px; border-radius: 4px; background: #C9A35B; }',
    '.hbrp .bar > b { position: absolute; top: -3px; width: 2px; height: 13px; background: #2B2640; margin-left: -1px; }',
    '.hbrp td.gap, .hbrp th.gap { width: 30px; border: none !important; background: transparent !important; }',
    '.hbrp td.cmpl { padding-left: 4px; }',
    '.hbrp .cmpl .up, .hbrp .cmpl .dn, .hbrp .cmpl .eq { padding-left: 6px; }',
    '.hbrp .cmp .up, .hbrp .cmp .dn, .hbrp .cmp .eq { display: inline-block; width: 50px; text-align: left; padding-left: 6px; }',
    '.hbrp .up { color: #B44A43; font-size: 9.5px; } .hbrp .dn { color: #0F6E56; font-size: 9.5px; } .hbrp .eq { color: #8a8296; font-size: 9.5px; }',
    '.hbrp .card { border: 1px solid #E4DCC8; background: #FFFDF7; border-radius: 10px; padding: 11px 13px; }',
    '.hbrp .callout { background: #FAEEDA; border-radius: 10px; padding: 9px 13px; font-size: 11px; color: #854F0B; margin-bottom: 16px; line-height: 1.5; }',
    '.hbrp .lines td { border-bottom: 1px solid #F2ECDF; }',
    '.hbrp .tot td { border-top: 1px solid #CFC5AE; font-weight: bold; padding-top: 5px; }',
    '.hbrp .tag { display: inline-block; font-size: 9px; padding: 1px 6px; border-radius: 8px; background: #EFE7D5; color: #6b5a33; white-space: nowrap; }',
    '.hbrp .tag.car { background: #E6EEF7; color: #2C4A6E; } .hbrp .tag.proj { background: #EDE7F4; color: #4E3C6E; }',
    '.hbrp .day td { background: #F4EEE0; font-size: 10px; color: #6b5a33; padding: 4px 6px; letter-spacing: .04em; }',
    '.hbrp .foot { position: absolute; left: 57.6px; right: 57.6px; bottom: 28.8px; display: flex; justify-content: space-between; font-size: 9px; color: #a49cb0; border-top: 1px solid #EEE7D8; padding-top: 6px; }',
    '.hbrp .legend { font-size: 9.5px; color: #8a8296; }',
    '.hbrp .mk { display: inline-block; width: 2px; height: 9px; background: #2B2640; vertical-align: -1px; margin-right: 3px; }',
    '.hbrp .sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; vertical-align: -1px; margin: 0 3px 0 8px; }',
    '.hbrp .note { font-size: 9.5px; color: #8a8296; margin: 5px 0 0; line-height: 1.45; }',
    '.hbrp .logo { display: inline-block; position: relative; overflow: hidden; border-radius: 5px; color: #fff; text-align: center; vertical-align: middle; font-family: Georgia, serif; }',
    '.hbrp .logo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #fff; }',
    '.hbrp .logo.big { border-radius: 9px; margin-right: 12px; border: 2px solid #F7F3E9; }',
    '.hbrp svg { display: block; max-width: 100%; height: auto; }',
    '.hbrp .tight table { font-size: 9.8px !important; } .hbrp .tight td { padding-top: 2px; padding-bottom: 2px; }',
    '.hbrp .tighter table { font-size: 9.2px !important; } .hbrp .tighter td { padding-top: 1px; padding-bottom: 1px; } .hbrp .tighter .bar, .hbrp .tighter .bar > i { height: 5px; } .hbrp .tighter .bar > b { height: 10px; top: -2.5px; }',
    '.hbrp .tightest table { font-size: 8.6px !important; } .hbrp .tightest td { padding-top: 0; padding-bottom: 0; line-height: 1.25; } .hbrp .tightest .bar, .hbrp .tightest .bar > i { height: 4px; } .hbrp .tightest .bar > b { height: 8px; top: -2px; } .hbrp .tightest .up, .hbrp .tightest .dn, .hbrp .tightest .eq { font-size: 8.5px; }'
  ].join('\n');

  function ensureStyle() {
    if (document.getElementById('hbrp-styles')) return;
    var s = document.createElement('style');
    s.id = 'hbrp-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild;
  }
  function rowEl(html) {
    var t = document.createElement('table');
    t.innerHTML = '<tbody>' + html + '</tbody>';
    return t.querySelector('tr');
  }

  // Lays the report's logical pages out onto real pages. Anything that
  // doesn't fit continues on a new page; long tables split row by row and
  // repeat their header row.
  function render(rep, host) {
    ensureStyle();
    host.classList.add('hbrp');
    host.innerHTML = '';
    var pages = [];
    var limit = PAGE_H - PAD_BOTTOM - 14;

    function newPage(headHtml) {
      var p = document.createElement('div');
      p.className = 'page';
      p.innerHTML = headHtml;
      host.appendChild(p);
      pages.push(p);
      return p;
    }
    function slim(title) { return '<div class="band slim"><h1>' + title + '</h1><div class="meta">' + esc(rep.footer) + '</div></div>'; }
    function bottomOf(p) {
      var last = p.lastElementChild;
      if (!last) return 0;
      var cs = window.getComputedStyle(last);
      return last.getBoundingClientRect().bottom - p.getBoundingClientRect().top + (parseFloat(cs.marginBottom) || 0) * 0;
    }
    function fits(p) { return bottomOf(p) <= limit; }
    function onlyBand(p) { return p.children.length <= 1; }

    rep.pages.forEach(function (lp, li) {
      var title = lp.title || rep.label;
      var page = newPage(li === 0 && lp.head ? lp.head : slim(title));
      var contTitle = title + ' (continued)';
      (lp.blocks || []).forEach(function (b) {
        if (!b) return;
        if (typeof b === 'string') {
          var node = el('<div>' + b + '</div>');
          page.appendChild(node);
          if (!fits(page) && page.children.length > 2) {
            page.removeChild(node);
            page = newPage(slim(contTitle));
            page.appendChild(node);
          }
          return;
        }
        // Splittable table. Either {table: '<table>…'} or {head, rows, foot}.
        var headerTr, tableShell, rows;
        if (b.table) {
          var t = el(b.table);
          var trs = Array.prototype.slice.call(t.querySelectorAll('tr'));
          headerTr = trs.shift();
          tableShell = t.cloneNode(false);
          rows = trs.map(function (r) { return { node: r, group: r.classList.contains('day') }; });
        } else {
          var t2 = el(b.head + (b.foot || '</table>'));
          headerTr = t2.querySelector('tr');
          tableShell = t2.cloneNode(false);
          rows = b.rows.map(function (r) { return { node: rowEl(r.html), group: !!r.group }; });
        }
        var titleHtml = b.title ? '<h2>' + b.title + (b.legend ? ' <span class="legend">' + b.legend + '</span>' : '') + '</h2>' : '';
        // Tables that must stay on one page get smaller type before they're ever split.
        if (b.fit) {
          var whole = el('<div class="block">' + titleHtml + '</div>');
          var full = tableShell.cloneNode(false), ftb = document.createElement('tbody');
          if (headerTr) ftb.appendChild(headerTr.cloneNode(true));
          rows.forEach(function (r) { ftb.appendChild(r.node.cloneNode(true)); });
          full.appendChild(ftb); whole.appendChild(full);
          page.appendChild(whole);
          var steps = ['', 'tight', 'tighter', 'tightest'];
          for (var si = 1; si < steps.length && !fits(page); si++) whole.className = 'block ' + steps[si];
          if (fits(page)) return;
          page.removeChild(whole);
          if (!onlyBand(page)) {                       // try it alone on a fresh page
            page = newPage(slim(contTitle));
            page.appendChild(whole);
            whole.className = 'block';
            for (var sj = 1; sj < steps.length && !fits(page); sj++) whole.className = 'block ' + steps[sj];
            if (fits(page)) return;
            page.removeChild(whole);
          }
        }
        function startBlock(isCont) {
          var wrap = el('<div class="block">' + (b.title ? (isCont ? '<h2>' + b.title + ' (continued)</h2>' : titleHtml) : '') + '</div>');
          var tbl = tableShell.cloneNode(false);
          var tb = document.createElement('tbody');
          if (headerTr) tb.appendChild(headerTr.cloneNode(true));
          tbl.appendChild(tb);
          wrap.appendChild(tbl);
          page.appendChild(wrap);
          return { wrap: wrap, tb: tb, count: 0 };
        }
        var cur = startBlock(false);
        for (var i = 0; i < rows.length; i++) {
          cur.tb.appendChild(rows[i].node);
          cur.count++;
          if (fits(page)) continue;
          cur.tb.removeChild(rows[i].node);
          cur.count--;
          // Never end a page on a month/day header row.
          var carry = [];
          while (cur.count > 0 && cur.tb.lastElementChild && cur.tb.lastElementChild.classList.contains('day')) {
            carry.unshift(cur.tb.lastElementChild);
            cur.tb.removeChild(cur.tb.lastElementChild);
            cur.count--;
          }
          if (cur.count === 0) {
            page.removeChild(cur.wrap);
            if (onlyBand(page)) { page.appendChild(cur.wrap); carry.forEach(function (c) { cur.tb.appendChild(c); }); cur.tb.appendChild(rows[i].node); cur.count = 1 + carry.length; continue; }
            page = newPage(slim(contTitle));
            cur = startBlock(false);
          } else {
            page = newPage(slim(contTitle));
            cur = startBlock(true);
          }
          carry.forEach(function (c) { cur.tb.appendChild(c); cur.count++; });
          cur.tb.appendChild(rows[i].node);
          cur.count++;
        }
      });
    });

    pages.forEach(function (p, i) {
      p.appendChild(el('<div class="foot"><span>Homebase · ' + esc(rep.footer) + '</span><span>Page ' + (i + 1) + ' of ' + pages.length + '</span></div>'));
    });
    return pages;
  }

  // ---------- PDF ----------

  var LIBS = [
    { test: function () { return window.html2canvas; }, src: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js' },
    { test: function () { return window.jspdf && window.jspdf.jsPDF; }, src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' }
  ];
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Couldn’t load the PDF tools. Check your connection and try again.')); };
      document.head.appendChild(s);
    });
  }
  function loadLibs() {
    return LIBS.reduce(function (p, lib) { return p.then(function () { return lib.test() ? null : loadScript(lib.src); }); }, Promise.resolve());
  }

  // One image per page, at twice screen resolution so text stays sharp.
  async function toPdf(pageEls, onProgress) {
    await loadLibs();
    var pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
    for (var i = 0; i < pageEls.length; i++) {
      if (onProgress) onProgress(i + 1, pageEls.length);
      var canvas = await window.html2canvas(pageEls[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, width: PAGE_W, height: PAGE_H, windowWidth: PAGE_W });
      if (i > 0) pdf.addPage('letter', 'portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 612, 792, undefined, 'FAST');
      canvas.width = canvas.height = 0;        // free memory between pages (matters on phones)
    }
    return pdf.output('blob');
  }

  // Short email body: the headline and main numbers; the PDF carries the rest.
  function emailHtml(rep, pageCount) {
    var figs = rep.summary.figures.map(function (f) {
      return '<td style="padding:10px 12px;background:#FFFDF7;border:1px solid #E4DCC8;border-radius:10px">' +
        '<div style="font-size:10px;color:#8a8296;text-transform:uppercase;letter-spacing:.08em">' + esc(f[0]) + '</div>' +
        '<div style="font-size:18px;color:#2B2640;margin-top:2px">' + f[1] + '</div></td>';
    }).join('<td style="width:8px"></td>');
    return '<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;background:#F7F3E9;padding:24px;border-radius:16px;color:#2B2640">' +
      '<p style="font-size:11px;color:#8a6412;text-transform:uppercase;letter-spacing:.08em;margin:0 0 4px">' + esc(rep.subject.replace(/^Homebase — /, '')) + '</p>' +
      '<p style="font-size:22px;margin:0 0 14px">' + esc(rep.label) + '</p>' +
      '<p style="font-size:15px;line-height:1.5;color:#4a4360;margin:0 0 16px">' + rep.summary.lede + '</p>' +
      '<table style="border-collapse:separate;width:100%;margin:0 0 18px"><tr>' + figs + '</tr></table>' +
      '<p style="font-size:13px;color:#4a4360;margin:0">The full report is attached as a PDF (' + pageCount + (pageCount === 1 ? ' page' : ' pages') + ').</p>' +
      '<p style="font-size:11px;color:#8a8296;margin:18px 0 0">Homebase · nassim613.github.io/Homebase</p></div>';
  }

  // ---------- public ----------
  var modelPromise = null;
  function model(fresh) {
    if (fresh || !modelPromise) modelPromise = loadData();
    return modelPromise;
  }

  return {
    options: async function () { return options(await model(true)); },
    build: async function (req) { return buildWith(await model(false), req); },
    render: render,
    toPdf: toPdf,
    emailHtml: emailHtml,
    // For testing without IndexedDB.
    _withData: function (raw) { modelPromise = Promise.resolve(makeModel(raw)); },
    _k: K
  };
})();
