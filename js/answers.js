/* ============================================================
   STAY AWHILE — the archive (answers.html).

   Every answer the town has left, on one page, newest questions first.
   Reading them one card at a time is fine for a player; this is for
   anyone who wants to read the whole town at once.

   Two ways in:
     * btb_sa_feed — one RPC, everything visible, newest first. The good way.
     * If that function isn't installed yet (db/stay-awhile.sql hasn't been
       re-pasted), fall back to walking the question-of-the-week rotation —
       the same seeded shuffle app.js uses — and pulling each week's answers
       through btb_sa_list, a handful at a time.
============================================================ */
(function () {
  'use strict';

  /* ---------------- the weekly rotation, pure ----------------
     Must match questionsOfTheWeek() in js/app.js exactly: same seed, same
     epoch, same pool filter, same shuffle. scripts/check-rotation.js
     verifies this against known weeks. */

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function mondayOfThisWeek() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }
  function currentWeekIndex() {
    return Math.round((mondayOfThisWeek() - new Date(2026, 0, 5)) / 604800000);
  }
  function classicPool(questions) {
    return questions.filter(function (q) {
      return !q.deck && q.f.indexOf('room') === -1;
    });
  }
  function shuffledOrder(n) {
    var order = [];
    for (var i = 0; i < n; i++) order.push(i);
    var rnd = mulberry32(20260711);
    for (var k = order.length - 1; k > 0; k--) {
      var j = Math.floor(rnd() * (k + 1));
      var t = order[k]; order[k] = order[j]; order[j] = t;
    }
    return order;
  }
  function qidForWeek(questions, week) {
    var classic = classicPool(questions);
    var n = classic.length;
    if (!n) return null;
    var order = shuffledOrder(n);
    return classic[order[(((week % n) + n) % n)]].id;
  }
  /* Newest week first, deduped — the fallback's reading order. */
  function weeklyQids(questions) {
    var week = currentWeekIndex();
    var ids = [], seen = {};
    for (var k = week; k >= 0; k--) {
      var id = qidForWeek(questions, k);
      if (id && !seen[id]) { seen[id] = true; ids.push(id); }
    }
    return ids;
  }

  /* Node (scripts/check-rotation.js) stops here; the browser carries on. */
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { qidForWeek: qidForWeek, currentWeekIndex: currentWeekIndex,
                         weeklyQids: weeklyQids };
    }
    return;
  }

  /* ---------------- the page ---------------- */

  var SUPABASE_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function rpc(fn, args) {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    }).then(function (r) {
      if (!r.ok) throw new Error(fn + ' → ' + r.status);
      return r.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }

  function monthDay(iso) {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  var QINDEX = {};      // qid → { q, d }
  var GROUPS = [];      // [{ qid, question, d, rows }] in reading order
  var filter = 'all';
  var loaded = false;

  /* ---------------- render ---------------- */

  function answerHtml(r) {
    return '<div class="answer">' +
      '<p>' + esc(r.body) + '</p>' +
      '<div class="answer-meta">' +
        '<span class="who">' + esc(r.name || 'Anonymous') + '</span>' +
        '<span>' + esc(monthDay(r.created_at)) + '</span>' +
        ((r.hearts || 0) > 0 ? '<span class="a-hearts">♥ ' + (r.hearts | 0) + '</span>' : '') +
      '</div></div>';
  }

  function render() {
    if (!loaded) return;
    var now = new Date();
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    var sections = GROUPS.map(function (g) {
      var rows = g.rows.filter(function (r) {
        if (filter === 'month')   return new Date(r.created_at) >= monthStart;
        if (filter === 'hearted') return (r.hearts || 0) > 0;
        return true;
      });
      if (!rows.length) return '';
      return '<section class="aq">' +
        '<div class="aq-head">' +
          '<span class="all-dot" data-d="' + esc(g.d || '') + '" aria-hidden="true"></span>' +
          '<h2 class="aq-q">' + esc(g.question) + '</h2>' +
        '</div>' +
        '<p class="aq-meta">' + rows.length + (rows.length === 1 ? ' answer' : ' answers') +
          ' · <a href="index.html?q=' + esc(g.qid) + '">open this card →</a></p>' +
        '<div class="town-list">' + rows.map(answerHtml).join('') + '</div>' +
      '</section>';
    }).filter(Boolean);

    $('archive').innerHTML = sections.length
      ? sections.join('')
      : '<p class="archive-empty">' + (GROUPS.length
          ? 'Nothing matches that filter yet.'
          : 'Nobody has answered anything yet. The cards are one page over — go be first.') +
        '</p>';
  }

  function setNote(msg) {
    var el = $('note');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function groupLabel(qid) {
    var q = QINDEX[qid];
    return { question: q ? q.q : 'A retired question', d: q ? q.d : '' };
  }

  /* Group feed rows by qid, keeping the feed's newest-first order — so groups
     come out ordered by their most recent answer. */
  function groupFeed(rows) {
    var byQid = {}, order = [];
    rows.forEach(function (r) {
      if (!byQid[r.qid]) { byQid[r.qid] = []; order.push(r.qid); }
      byQid[r.qid].push(r);
    });
    return order.map(function (qid) {
      var label = groupLabel(qid);
      return { qid: qid, question: label.question, d: label.d, rows: byQid[qid] };
    });
  }

  /* ---------------- fetch ---------------- */

  function loadFeed() {
    return rpc('btb_sa_feed', { p_limit: 1000 }).then(function (rows) {
      GROUPS = groupFeed(rows || []);
    });
  }

  /* The fallback: every question the weekly walk has landed on so far, pulled
     one qid at a time through btb_sa_list, a few in flight at once. */
  function loadWeekly(questions) {
    var qids = weeklyQids(questions);
    var results = {};
    var at = 0;

    function next() {
      if (at >= qids.length) return Promise.resolve();
      var qid = qids[at++];
      return rpc('btb_sa_list', { p_qid: qid })
        .then(function (rows) { results[qid] = rows || []; })
        .catch(function () { results[qid] = []; })
        .then(next);
    }

    var lanes = [];
    for (var i = 0; i < 8 && i < qids.length; i++) lanes.push(next());

    return Promise.all(lanes).then(function () {
      GROUPS = qids.map(function (qid) {
        var label = groupLabel(qid);
        return { qid: qid, question: label.question, d: label.d, rows: results[qid] };
      }).filter(function (g) { return g.rows.length; });
      setNote('Showing weekly questions — full feed arrives after the next database update.');
    });
  }

  /* ---------------- wiring ---------------- */

  $('filter').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-filter]');
    if (!btn) return;
    filter = btn.getAttribute('data-filter');
    [].forEach.call(this.querySelectorAll('[data-filter]'), function (b) {
      b.setAttribute('aria-pressed', b === btn);
    });
    if (history.replaceState) history.replaceState({}, '', filter === 'all' ? location.pathname : '#' + filter);
    render();
  });

  var wantFilter = (location.hash || '').replace('#', '');
  if (wantFilter === 'month' || wantFilter === 'hearted') {
    filter = wantFilter;
    [].forEach.call($('filter').querySelectorAll('[data-filter]'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-filter') === wantFilter);
    });
  }

  /* ---------------- go ---------------- */

  fetch('data/questions.json')
    .then(function (r) { return r.json(); })
    .then(function (doc) {
      var questions = doc.questions;
      questions.forEach(function (q) { QINDEX[q.id] = q; });

      return loadFeed().catch(function () { return loadWeekly(questions); });
    })
    .then(function () { loaded = true; render(); })
    .catch(function () {
      $('archive').innerHTML =
        '<p class="archive-empty">Couldn’t reach the town. A refresh usually does it.</p>';
    });
})();
