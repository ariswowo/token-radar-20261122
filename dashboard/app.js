// app.js — the token radar dashboard.
//
// Reads window.RADAR (written by main.ts from the same board), renders the
// sortable, filterable board, the live-token comparison, the set-aside lists,
// and a detail view with the model breakdown and the farm plan. The model
// sandbox re-ranks the board in the page from the same formula the program
// uses, so the default view always agrees with board.json.

(function () {
  'use strict';

  var R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.getElementById('meta-line').textContent = 'No radar data was loaded.';
    return;
  }

  var C = R.constants;
  var ROWS = R.rows;
  var LIVE = R.live_top || [];
  var PRE = R.set_aside_pre_token || [];
  var GECKO = R.set_aside_gecko_listed || [];

  // --- small helpers -------------------------------------------------------

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(n) {
    if (n == null || isNaN(n)) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return '$' + Math.round(n);
  }

  function moneyFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function pct(n) {
    if (n == null || isNaN(n)) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function ageText(days) {
    if (days == null) return '—';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }

  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  /** The same formula main.ts uses, so the page and board.json agree. */
  function impliedOf(row, k) {
    var size = clamp(k.base_multiple * Math.pow(row.tvl_usd / 1e8, k.size_exponent), k.size_floor, k.base_multiple);
    var g = clamp(row.change_7d == null ? 0 : row.change_7d, k.growth_lo, k.growth_hi);
    var growth = 1 + (g / 100) * k.growth_weight;
    var maturity = k.maturity_base + (1 - k.maturity_base) * Math.min(row.age_days, k.maturity_cap_days) / k.maturity_cap_days;
    var chain = 1 + k.chain_step * Math.min(Math.max(row.chains.length - 1, 0), k.chain_cap);
    return { value: Math.max(1, Math.round(row.tvl_usd * size * growth * maturity * chain)), size: size, growth: growth, maturity: maturity, chain: chain };
  }

  // --- state ---------------------------------------------------------------

  var state = {
    tab: 'board',
    q: '',
    category: '',
    chain: '',
    minTvl: 0,
    sort: 'implied',
    selected: null,
    sandbox: null, // null = the board as main.ts wrote it; otherwise constants
  };

  function readHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('q') != null) state.q = p.get('q');
    if (p.get('category') != null) state.category = p.get('category');
    if (p.get('chain') != null) state.chain = p.get('chain');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('p')) state.selected = p.get('p');
  }

  function writeHash() {
    var p = new URLSearchParams();
    p.set('tab', state.tab);
    if (state.q) p.set('q', state.q);
    if (state.category) p.set('category', state.category);
    if (state.chain) p.set('chain', state.chain);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.selected) p.set('p', state.selected);
    history.replaceState(null, '', '#' + p.toString());
  }

  // --- header, stats, model ------------------------------------------------

  function renderMeta() {
    var total = ROWS.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    document.getElementById('meta-line').textContent =
      'Snapshot ' + R.as_of + ' · ' + R.counts.protocols + ' protocols · floor ' + money(R.floor_usd) + ' · model ' + R.model_name;
    document.getElementById('model-formula').textContent = R.model_name + ': ' + R.model_formula;
    document.getElementById('stats').innerHTML = [
      ['<b>' + ROWS.length + '</b>', 'ranked pre-token protocols'],
      ['<b>' + ROWS.filter(function (r) { return r.watchlist; }).length + ' / ' + R.counts.watchlist + '</b>', 'watchlist covered'],
      ['<b>' + ROWS.filter(function (r) { return r.early; }).length + '</b>', 'below the $50M floor'],
      ['<b>' + money(total) + '</b>', 'total implied value'],
      ['<b>' + R.counts.live + '</b>', 'live tokens for comparison'],
    ].map(function (s) { return '<div class="stat">' + s[0] + '<span>' + s[1] + '</span></div>'; }).join('');
  }

  // --- controls ------------------------------------------------------------

  var categorySel = document.getElementById('category');
  var chainSel = document.getElementById('chain');

  function fillSelects() {
    var cats = {};
    var chains = {};
    ROWS.forEach(function (r) {
      if (r.category) cats[r.category] = 1;
      r.chains.forEach(function (c) { chains[c] = 1; });
    });
    categorySel.innerHTML = '<option value="">All categories</option>' +
      Object.keys(cats).sort().map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    chainSel.innerHTML = '<option value="">All chains</option>' +
      Object.keys(chains).sort().map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  }

  // --- board ---------------------------------------------------------------

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var list = ROWS.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (q) {
        var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var k = state.sandbox || C;
    list.forEach(function (r) {
      r._implied = state.sandbox ? impliedOf(r, k).value : r.implied_value_usd;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1);
      if (key === 'growth') return (b.change_7d || 0) - (a.change_7d || 0) || (a.slug < b.slug ? -1 : 1);
      if (key === 'age') return b.age_days - a.age_days || (a.slug < b.slug ? -1 : 1);
      if (key === 'name') return a.name.localeCompare(b.name);
      return b._implied - a._implied || (a.slug < b.slug ? -1 : 1);
    });
    return list;
  }

  function rowHtml(r, pos) {
    var rank = state.sandbox ? pos + 1 : r.rank;
    var top = Math.max.apply(null, ROWS.map(function (x) { return x.implied_value_usd; }));
    var pctW = Math.max(2, Math.round((r._implied / top) * 100));
    var g = r.change_7d;
    var gCls = g == null ? '' : g >= 0 ? 'up' : 'down';
    var badges = (r.watchlist ? '<span class="badge watch">Watchlist</span>' : '') +
      (r.early ? '<span class="badge early">Early</span>' : '');
    return '<tr>' +
      '<td class="num">' + rank + '</td>' +
      '<td><span class="name">' + esc(r.name) + badges + '</span><small>' + esc(r.slug) + '</small></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + gCls + '">' + pct(g) + '</td>' +
      '<td class="num">' + ageText(r.age_days) + '</td>' +
      '<td class="num"><span class="bar"><i style="width:' + pctW + '%"></i></span>' + money(r._implied) + '</td>' +
      '<td><button type="button" class="rowlink" data-slug="' + esc(r.slug) + '">Farm plan</button></td>' +
      '</tr>';
  }

  function renderBoard() {
    var list = visibleRows();
    var body = document.getElementById('board-body');
    document.getElementById('count-line').textContent =
      'Showing ' + list.length + ' of ' + ROWS.length + ' ranked protocols' +
      (state.sandbox ? ' — re-ranked with your sandbox constants' : '') + '.';
    body.innerHTML = list.length
      ? list.map(function (r, i) { return rowHtml(r, i); }).join('')
      : '<tr><td colspan="9" class="empty">Nothing matches those filters.</td></tr>';
  }

  function renderLive() {
    document.getElementById('live-body').innerHTML = LIVE.map(function (r, i) {
      var g = r.change_7d;
      return '<tr><td class="num">' + (i + 1) + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><small>' + esc(r.slug) + '</small></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + r.mcap_to_tvl.toFixed(2) + '×</td>' +
        '<td class="num ' + (g == null ? '' : g >= 0 ? 'up' : 'down') + '">' + pct(g) + '</td></tr>';
    }).join('');
  }

  function renderSetAside() {
    function rows(list) {
      return list.map(function (r) {
        return '<tr><td><span class="name">' + esc(r.name) + '</span><small>' + esc(r.slug) + '</small></td>' +
          '<td>' + esc(r.category || '—') + '</td>' +
          '<td class="num">' + money(r.tvl_usd) + '</td>' +
          '<td>' + esc(r.reason) + '</td></tr>';
      }).join('');
    }
    document.getElementById('setaside-pre-body').innerHTML = rows(PRE) ||
      '<tr><td colspan="4" class="empty">None set aside.</td></tr>';
    document.getElementById('setaside-gecko-body').innerHTML = rows(GECKO) ||
      '<tr><td colspan="4" class="empty">None set aside.</td></tr>';
  }

  // --- detail --------------------------------------------------------------

  var dialog = document.getElementById('detail');

  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < ROWS.length; i++) if (ROWS[i].slug === slug) { r = ROWS[i]; break; }
    if (!r) return;
    state.selected = slug;
    var k = state.sandbox || C;
    var calc = state.sandbox ? impliedOf(r, k) : null;
    var m = r.model;
    var size = calc ? calc.size : m.size_multiple;
    var growth = calc ? calc.growth : m.growth_factor;
    var maturity = calc ? calc.maturity : m.maturity_factor;
    var chain = calc ? calc.chain : m.chain_factor;
    var implied = calc ? calc.value : r.implied_value_usd;
    var steps = r.farm_steps.map(function (s, j) {
      return '<li><b>Step ' + (j + 1) + '.</b> ' + esc(s) + '</li>';
    }).join('');
    document.getElementById('detail-content').innerHTML =
      '<div class="detail-inner">' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.category || '—') + ' · ' + esc(r.chains.join(', ')) + ' · TVL ' + moneyFull(r.tvl_usd) +
      ' · 7-day ' + pct(r.change_7d) + ' · ' + r.age_days + ' days with no token' +
      (r.watchlist ? ' · on the watchlist' : '') + (r.early ? ' · below the $50M floor' : '') + '</p>' +
      '<h3>Why it is worth ' + money(implied) + '</h3>' +
      '<table><tbody>' +
      '<tr><td>TVL</td><td class="num">' + moneyFull(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Size multiple (falls as TVL grows)</td><td class="num">× ' + size.toFixed(4) + '</td></tr>' +
      '<tr><td>Growth factor (7-day ' + pct(r.change_7d) + ')</td><td class="num">× ' + growth.toFixed(4) + '</td></tr>' +
      '<tr><td>Maturity factor (' + r.age_days + ' days, no token)</td><td class="num">× ' + maturity.toFixed(4) + '</td></tr>' +
      '<tr><td>Chain factor (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</td><td class="num">× ' + chain.toFixed(4) + '</td></tr>' +
      '<tr><td><strong>Implied value</strong></td><td class="num"><strong>' + moneyFull(implied) + '</strong></td></tr>' +
      '</tbody></table>' +
      '<h3>How to farm it</h3><ol>' + steps + '</ol>' +
      '<p class="honest">Nothing here promises an airdrop. ' + esc(r.name) + ' may never launch a token at all.</p>' +
      '</div>';
    if (!dialog.open) dialog.showModal();
    // The dialog's first focusable element is the Close button at the
    // bottom; without this the browser scrolls the dialog down to it and
    // the title ends up above the viewport.
    dialog.focus();
    dialog.scrollTop = 0;
    writeHash();
  }

  function closeDetail() {
    if (dialog.open) dialog.close();
    if (state.selected) { state.selected = null; writeHash(); }
  }

  dialog.addEventListener('close', function () {
    if (state.selected) { state.selected = null; writeHash(); }
  });

  // --- sandbox -------------------------------------------------------------

  function sandboxConstants() {
    return {
      base_multiple: parseFloat(document.getElementById('sb-base').value) || C.base_multiple,
      size_exponent: parseFloat(document.getElementById('sb-exp').value) || C.size_exponent,
      size_floor: C.size_floor,
      growth_weight: parseFloat(document.getElementById('sb-growth').value) || C.growth_weight,
      growth_lo: C.growth_lo,
      growth_hi: C.growth_hi,
      maturity_base: parseFloat(document.getElementById('sb-maturity').value) || C.maturity_base,
      maturity_cap_days: C.maturity_cap_days,
      chain_step: parseFloat(document.getElementById('sb-chain').value) || C.chain_step,
      chain_cap: C.chain_cap,
      unknown_age_days: C.unknown_age_days,
    };
  }

  function fillSandbox() {
    document.getElementById('sb-base').value = C.base_multiple;
    document.getElementById('sb-exp').value = C.size_exponent;
    document.getElementById('sb-growth').value = C.growth_weight;
    document.getElementById('sb-maturity').value = C.maturity_base;
    document.getElementById('sb-chain').value = C.chain_step;
    document.getElementById('sb-note').innerHTML = 'Showing the board as <b>radar-2</b> wrote it. Change a value and re-rank to see how much the order depends on it.';
  }

  document.getElementById('sb-apply').addEventListener('click', function () {
    state.sandbox = sandboxConstants();
    state.sort = 'implied';
    document.getElementById('sort').value = 'implied';
    renderBoard();
    var top = visibleRows()[0];
    document.getElementById('sb-note').innerHTML = 'Re-ranked with your constants. New top row: <b>' + esc(top ? top.name : '—') + '</b> at ' + money(top ? top._implied : 0) + '. The saved board still uses radar-2.';
    writeHash();
  });

  document.getElementById('sb-reset').addEventListener('click', function () {
    state.sandbox = null;
    fillSandbox();
    renderBoard();
  });

  // --- tabs and controls ---------------------------------------------------

  function showTab(tab) {
    state.tab = tab;
    ['board', 'live', 'setaside'].forEach(function (t) {
      document.getElementById('view-' + t).classList.toggle('hidden', t !== tab);
      document.querySelector('[data-tab="' + t + '"]').classList.toggle('active', t === tab);
    });
    document.getElementById('count-line').textContent =
      tab === 'live' ? 'The ' + LIVE.length + ' largest live tokens by market cap.' :
      tab === 'setaside' ? PRE.length + ' pre-token protocols set aside, and ' + GECKO.length + ' with a token already recorded.' :
      '';
    if (tab === 'board') renderBoard();
    writeHash();
  }

  document.querySelectorAll('[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });

  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); writeHash(); });
  document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); writeHash(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); writeHash(); });
  document.getElementById('min-tvl').addEventListener('change', function (e) { state.minTvl = parseInt(e.target.value, 10) || 0; renderBoard(); writeHash(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); writeHash(); });

  document.getElementById('board-body').addEventListener('click', function (e) {
    var b = e.target.closest('[data-slug]');
    if (b) openDetail(b.getAttribute('data-slug'));
  });

  // --- boot ----------------------------------------------------------------

  readHash();
  renderMeta();
  fillSelects();
  fillSandbox();
  document.getElementById('q').value = state.q;
  if (state.category) document.getElementById('category').value = state.category;
  if (state.chain) document.getElementById('chain').value = state.chain;
  if (state.sort) document.getElementById('sort').value = state.sort;
  renderBoard();
  renderLive();
  renderSetAside();
  showTab(['board', 'live', 'setaside'].indexOf(state.tab) >= 0 ? state.tab : 'board');
  if (state.selected) openDetail(state.selected);
})();
