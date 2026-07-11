/* ============================================================
   STAY AWHILE — a conversation game for Burlington.

   Three moving parts:
     1. THE DECK   — 311 tagged questions, filtered down to the room
                     you're actually in, then dealt without repeats.
     2. THE WHEEL  — an SVG wheel of the people at the table. It picks
                     who has to answer. That's the whole mechanic.
     3. THE TOWN   — answers other people left on the same question.
                     Opt-in, because reading them mid-game kills the
                     conversation, which is the entire point of the game.

   The town runs on the shared Btown Supabase project via the RPCs in
   db/stay-awhile.sql. Until that SQL has been run — or if the network is
   gone, or someone's on a train — the game still works: answers save to
   this device only and say so.
============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';

  /* Wedge colours. All light enough to carry near-black text. */
  var WEDGE = ['#FF6B35', '#E8B04B', '#5BC8F5', '#F2A488',
               '#C7D96B', '#F5D98B', '#8FD3C7', '#FF9F68'];

  var DEPTHS = [
    { slug: 'light', label: 'Shallow end' },
    { slug: 'warm',  label: 'Waist deep' },
    { slug: 'deep',  label: 'Deep water' }
  ];

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function store(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  /* A stable id for this browser, so one person can't flag the same
     answer ten times and can't machine-gun the submit button. */
  var visitor = store('sa-visitor', null);
  if (!visitor) {
    visitor = 'v' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    save('sa-visitor', visitor);
  }

  /* ---------------- state ---------------- */

  var QUESTIONS = [];
  var TOPICS = [];

  var players = store('sa-players', []);
  var filters = store('sa-filters', null) || {
    depths: ['light', 'warm', 'deep'],
    topics: null,            // null = all (so a new topic added later is on by default)
    room: true,
    skipHeavy: false,
    quickOnly: false
  };

  var solo = false;
  var started = false;
  var bag = [];              // shuffled ids waiting to be dealt
  var current = null;        // the question on the table
  var currentPlayer = null;
  var rotation = 0;
  var spinning = false;

  var townMode = null;       // 'live' | 'local' — settled on first fetch
  var flagged = store('sa-flagged', {});

  /* ---------------- the deck ---------------- */

  function topicsOn() {
    return filters.topics || TOPICS.map(function (t) { return t.slug; });
  }

  function pool() {
    var on = topicsOn();
    var roomOk = filters.room && players.length >= 2 && !solo;
    return QUESTIONS.filter(function (q) {
      if (filters.depths.indexOf(q.d) === -1) return false;
      if (!q.t.some(function (t) { return on.indexOf(t) !== -1; })) return false;
      if (q.f.indexOf('room') !== -1 && !roomOk) return false;
      if (filters.skipHeavy && q.f.indexOf('heavy') !== -1) return false;
      if (filters.quickOnly && q.f.indexOf('long') !== -1) return false;
      return true;
    });
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* Deal without repeats. When the bag empties we reshuffle the whole
     pool, but never hand back the card that was just on the table. */
  function draw() {
    var live = pool();
    if (!live.length) return null;

    bag = bag.filter(function (id) {
      return live.some(function (q) { return q.id === id; });
    });

    if (!bag.length) {
      bag = shuffle(live.map(function (q) { return q.id; }));
      if (bag.length > 1 && current && bag[bag.length - 1] === current.id) {
        bag.unshift(bag.pop());
      }
    }

    var id = bag.pop();
    return live.filter(function (q) { return q.id === id; })[0] || null;
  }

  /* ---------------- the wheel ---------------- */

  function drawWheel() {
    var n = players.length;
    var wheel = $('wheel');
    if (n < 2) { wheel.innerHTML = ''; return; }

    var seg = 360 / n;
    var svg = ['<svg viewBox="0 0 200 200" width="100%" height="100%" aria-hidden="true">'];

    for (var i = 0; i < n; i++) {
      // Angles run clockwise from straight up, matching the pointer.
      var a1 = (i * seg - 90) * Math.PI / 180;
      var a2 = ((i + 1) * seg - 90) * Math.PI / 180;
      var x1 = 100 + 100 * Math.cos(a1), y1 = 100 + 100 * Math.sin(a1);
      var x2 = 100 + 100 * Math.cos(a2), y2 = 100 + 100 * Math.sin(a2);
      var large = seg > 180 ? 1 : 0;

      // Two players means two half-discs, and an arc needs the flag set.
      var d = n === 1
        ? 'M0,0 H200 V200 H0 Z'
        : 'M100,100 L' + x1.toFixed(2) + ',' + y1.toFixed(2) +
          ' A100,100 0 ' + large + ',1 ' + x2.toFixed(2) + ',' + y2.toFixed(2) + ' Z';

      svg.push('<path d="' + d + '" fill="' + WEDGE[i % WEDGE.length] +
               '" stroke="rgba(11,10,12,.35)" stroke-width="1"/>');

      // Label sits along the wedge's bisector. On the left half of the wheel
      // that rotation would leave the name upside down, so we spin the text a
      // further 180° and mirror its anchor — which lands it in exactly the same
      // spot on the rim, the right way up.
      var mid = i * seg + seg / 2 - 90;
      var norm = ((mid % 360) + 360) % 360;
      var flip = norm > 90 && norm < 270;
      var name = players[i].length > 11 ? players[i].slice(0, 10) + '…' : players[i];
      svg.push(
        '<text x="' + (flip ? 36 : 164) + '" y="100" fill="#14100E" ' +
        'font-size="9" font-weight="600" ' +
        'text-anchor="' + (flip ? 'start' : 'end') + '" dominant-baseline="middle" ' +
        'font-family="DM Sans, system-ui, sans-serif" ' +
        'transform="rotate(' + (flip ? mid + 180 : mid).toFixed(2) + ' 100 100)">' +
        esc(name) + '</text>'
      );
    }

    svg.push('</svg>');
    wheel.innerHTML = svg.join('');
  }

  function spin(then) {
    if (spinning || players.length < 2) return;
    spinning = true;
    $('spin-btn').disabled = true;
    $('next-btn').disabled = true;
    $('respin-btn').disabled = true;
    $('whose-turn').innerHTML = '';

    var n = players.length;
    var seg = 360 / n;
    var target = Math.floor(Math.random() * n);

    // Land somewhere inside the wedge rather than dead centre every time.
    var jitter = (Math.random() - 0.5) * seg * 0.66;
    var centre = (target + 0.5) * seg + jitter;

    var wanted = (360 - centre) % 360;              // rotation, mod 360, that puts the wedge under the pointer
    var atNow = ((rotation % 360) + 360) % 360;
    var delta = ((wanted - atNow) % 360 + 360) % 360;

    rotation += 360 * (5 + Math.floor(Math.random() * 3)) + delta;
    $('wheel').style.transform = 'rotate(' + rotation + 'deg)';

    window.setTimeout(function () {
      spinning = false;
      $('spin-btn').disabled = false;
      $('next-btn').disabled = false;
      $('respin-btn').disabled = false;
      currentPlayer = players[target];
      $('whose-turn').innerHTML = '<em>' + esc(currentPlayer) + '</em>, you’re up.';
      if (then) then();
    }, 4050);   // matches the CSS transition, plus a beat
  }

  /* ---------------- the card ---------------- */

  function label(slug) {
    var t = TOPICS.filter(function (x) { return x.slug === slug; })[0];
    return t ? t.emoji + ' ' + t.label : slug;
  }

  function showCard(q) {
    current = q;
    if (!q) {
      $('card').hidden = true;
      return;
    }

    var depth = DEPTHS.filter(function (d) { return d.slug === q.d; })[0];
    var tags = ['<span class="tag tag-depth" data-d="' + q.d + '">' + esc(depth.label) + '</span>'];
    q.t.forEach(function (t) { tags.push('<span class="tag">' + esc(label(t)) + '</span>'); });
    if (q.f.indexOf('long') !== -1) tags.push('<span class="tag">📖 A story</span>');

    $('card-tags').innerHTML = tags.join('');
    $('card-q').textContent = q.q;
    $('card').hidden = false;

    // A new question means a new set of answers.
    resetTown();
  }

  /* Advance the game: new person AND new question. */
  function nextTurn() {
    var q = draw();
    if (!q) { showEmptyDeck(); return; }
    if (solo || players.length < 2) {
      showCard(q);
    } else {
      spin(function () { showCard(q); });
    }
  }

  function showEmptyDeck() {
    $('card-tags').innerHTML = '';
    $('card-q').textContent = 'Nothing left in the deck. Loosen the filters below and we’ll keep going.';
    $('card').hidden = false;
    current = null;
    $('town-toggle').hidden = true;
  }

  /* ---------------- the town ---------------- */

  function rpc(fn, args) {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    }).then(function (res) {
      if (!res.ok) throw new Error(fn + ' → ' + res.status);
      return res.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }

  function localAnswers(qid) {
    var all = store('sa-local-answers', {});
    return all[qid] || [];
  }
  function saveLocalAnswer(qid, row) {
    var all = store('sa-local-answers', {});
    (all[qid] = all[qid] || []).unshift(row);
    save('sa-local-answers', all);
  }

  function resetTown() {
    var t = $('town-toggle');
    t.hidden = false;
    t.setAttribute('aria-expanded', 'false');
    $('town-body').hidden = true;
    $('town-count').hidden = true;
    $('town-status').hidden = true;
    $('answer-input').value = '';
    $('town-list').innerHTML = '';
  }

  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + 'm ago';
    if (s < 129600) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function renderAnswers(rows) {
    var list = $('town-list');
    if (!rows.length) {
      list.innerHTML = '<p class="answer-empty">Nobody has answered this one yet. ' +
                       'You could be the first.</p>';
    } else {
      list.innerHTML = rows.map(function (r) {
        var mine = flagged[r.id];
        return '<div class="answer">' +
          '<p>' + esc(r.body) + '</p>' +
          '<div class="answer-meta">' +
            '<span class="who">' + esc(r.name || 'Anonymous') + '</span>' +
            '<span>·</span><span>' + esc(ago(r.created_at)) + '</span>' +
            (townMode === 'live'
              ? '<button class="answer-flag" data-flag="' + esc(r.id) + '"' +
                (mine ? ' disabled' : '') + '>' + (mine ? 'reported' : 'report') + '</button>'
              : '') +
          '</div>' +
        '</div>';
      }).join('');
    }

    var badge = $('town-count');
    badge.textContent = rows.length + (rows.length === 1 ? ' answer' : ' answers');
    badge.hidden = false;
  }

  function loadTown() {
    if (!current) return;
    var qid = current.id;
    $('town-list').innerHTML = '<p class="answer-empty">Reading the room…</p>';

    if (townMode === 'local') {
      renderAnswers(localAnswers(qid));
      note('Saved on this device only — the shared answers aren’t switched on yet.');
      return;
    }

    rpc('btb_sa_list', { p_qid: qid })
      .then(function (rows) {
        townMode = 'live';
        renderAnswers(rows || []);
      })
      .catch(function () {
        // No backend (SQL not run, offline, whatever). Degrade honestly.
        townMode = 'local';
        renderAnswers(localAnswers(qid));
        note('Saved on this device only — the shared answers aren’t switched on yet.');
      });
  }

  function note(msg) {
    var el = $('town-status');
    el.textContent = msg;
    el.hidden = false;
  }

  function submitAnswer(e) {
    e.preventDefault();
    if (!current) return;

    var body = $('answer-input').value.trim();
    if (body.length < 2) return;

    var name = $('answer-name').value.trim();
    save('sa-name', name);

    var btn = $('answer-submit');
    btn.disabled = true;
    btn.textContent = 'Adding…';

    var done = function (msg) {
      btn.disabled = false;
      btn.textContent = 'Add mine';
      $('answer-input').value = '';
      note(msg);
    };

    if (townMode === 'local') {
      saveLocalAnswer(current.id, {
        id: 'l' + Date.now(), name: name, body: body, created_at: new Date().toISOString()
      });
      renderAnswers(localAnswers(current.id));
      done('Saved on this device. It’ll stay private until the shared answers are switched on.');
      return;
    }

    rpc('btb_sa_submit', {
      p_qid: current.id, p_name: name, p_body: body, p_voter: visitor
    })
      .then(function () {
        loadTown();
        done('Added. Thanks for actually answering.');
      })
      .catch(function () {
        townMode = 'local';
        saveLocalAnswer(current.id, {
          id: 'l' + Date.now(), name: name, body: body, created_at: new Date().toISOString()
        });
        renderAnswers(localAnswers(current.id));
        done('Couldn’t reach the town — saved on this device instead.');
      });
  }

  function flagAnswer(id, btn) {
    flagged[id] = true;
    save('sa-flagged', flagged);
    btn.disabled = true;
    btn.textContent = 'reported';
    rpc('btb_sa_flag', { p_answer: id, p_voter: visitor }).catch(function () {});
    note('Reported. Two reports and it comes down automatically.');
  }

  /* ---------------- players ---------------- */

  function renderPlayers() {
    $('players').innerHTML = players.map(function (p, i) {
      return '<span class="player" role="listitem">' +
        '<span class="dot" style="background:' + WEDGE[i % WEDGE.length] + '"></span>' +
        esc(p) +
        '<button type="button" data-drop="' + i + '" aria-label="Remove ' + esc(p) + '">×</button>' +
      '</span>';
    }).join('');

    save('sa-players', players);
    drawWheel();

    $('start-btn').textContent = players.length >= 2
      ? 'Start the game' : 'Add two people to spin';
    $('start-btn').disabled = players.length < 2;
  }

  function addPlayer(e) {
    e.preventDefault();
    var name = $('name-input').value.trim();
    if (!name) return;
    if (players.length >= 12) { $('name-input').value = ''; return; }
    if (players.some(function (p) { return p.toLowerCase() === name.toLowerCase(); })) {
      $('name-input').value = '';
      return;
    }
    players.push(name);
    $('name-input').value = '';
    renderPlayers();
    syncFilters();
  }

  /* ---------------- filters ---------------- */

  function renderFilterChips() {
    $('depth-chips').innerHTML = DEPTHS.map(function (d) {
      var on = filters.depths.indexOf(d.slug) !== -1;
      return '<button class="chip chip-depth" data-depth="' + d.slug + '" data-d="' + d.slug +
             '" aria-pressed="' + on + '">' + esc(d.label) + '</button>';
    }).join('');

    var on = topicsOn();
    $('topic-chips').innerHTML = TOPICS.map(function (t) {
      var isOn = on.indexOf(t.slug) !== -1;
      return '<button class="chip" data-topic="' + t.slug + '" aria-pressed="' + isOn + '">' +
             t.emoji + ' ' + esc(t.label) + '</button>';
    }).join('');
  }

  /* Keep the hero counter, the tally line, and the room switch honest. */
  function syncFilters() {
    var n = pool().length;
    $('q-live').textContent = n;

    var tally = $('filter-tally');
    tally.classList.toggle('empty', n === 0);
    tally.innerHTML = n === 0
      ? '<b>Nothing matches.</b> Turn something back on.'
      : '<b>' + n + '</b> question' + (n === 1 ? '' : 's') + ' in play, out of ' + QUESTIONS.length + '.';

    // "Questions about us" is meaningless with nobody else in the room.
    var roomBox = $('opt-room');
    var canRoom = players.length >= 2 && !solo;
    roomBox.disabled = !canRoom;
    roomBox.closest('.switch').style.opacity = canRoom ? '' : '.45';

    save('sa-filters', filters);
  }

  /* ---------------- wiring ---------------- */

  function begin(isSolo) {
    solo = isSolo;
    started = true;

    $('setup').hidden = true;
    $('game').hidden = false;
    $('wheel-stage').hidden = solo || players.length < 2;
    $('respin-btn').hidden = solo || players.length < 2;
    $('next-btn').textContent = (solo || players.length < 2)
      ? 'Next question' : 'Next — spin again';

    syncFilters();
    $('game').scrollIntoView({ block: 'start' });

    if (solo || players.length < 2) {
      showCard(draw() || null);
      if (!current) showEmptyDeck();
    } else {
      $('whose-turn').textContent = 'Give it a spin.';
    }
  }

  function wire() {
    $('name-form').addEventListener('submit', addPlayer);

    $('players').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-drop]');
      if (!btn) return;
      players.splice(Number(btn.getAttribute('data-drop')), 1);
      renderPlayers();
      syncFilters();
    });

    $('start-btn').addEventListener('click', function () { begin(false); });
    $('solo-btn').addEventListener('click', function () { begin(true); });

    $('spin-btn').addEventListener('click', function () {
      if (!current) {
        nextTurn();                       // first spin of the game: person + question
      } else {
        spin();                           // re-spin without changing the question
      }
    });

    $('next-btn').addEventListener('click', nextTurn);

    $('skip-btn').addEventListener('click', function () {
      var q = draw();
      if (!q) { showEmptyDeck(); return; }
      showCard(q);                        // same person, different question
    });

    $('respin-btn').addEventListener('click', function () { spin(); });

    $('town-toggle').addEventListener('click', function () {
      var open = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', String(!open));
      $('town-body').hidden = open;
      if (!open) loadTown();
    });

    $('town-form').addEventListener('submit', submitAnswer);

    $('town-list').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-flag]');
      if (btn && !btn.disabled) flagAnswer(btn.getAttribute('data-flag'), btn);
    });

    $('depth-chips').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-depth]');
      if (!btn) return;
      var d = btn.getAttribute('data-depth');
      var i = filters.depths.indexOf(d);
      if (i === -1) filters.depths.push(d);
      else if (filters.depths.length > 1) filters.depths.splice(i, 1);
      else return;                        // never let them switch all three off
      renderFilterChips();
      syncFilters();
    });

    $('topic-chips').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-topic]');
      if (!btn) return;
      var t = btn.getAttribute('data-topic');
      var on = topicsOn().slice();
      var i = on.indexOf(t);
      if (i === -1) on.push(t); else on.splice(i, 1);
      filters.topics = on;
      renderFilterChips();
      syncFilters();
    });

    $('topics-all').addEventListener('click', function () {
      filters.topics = null;
      renderFilterChips(); syncFilters();
    });
    $('topics-none').addEventListener('click', function () {
      filters.topics = [];
      renderFilterChips(); syncFilters();
    });
    $('topics-local').addEventListener('click', function () {
      filters.topics = ['btown'];
      renderFilterChips(); syncFilters();
    });

    $('opt-room').addEventListener('change', function () {
      filters.room = this.checked; syncFilters();
    });
    $('opt-heavy').addEventListener('change', function () {
      filters.skipHeavy = this.checked; syncFilters();
    });
    $('opt-quick').addEventListener('change', function () {
      filters.quickOnly = this.checked; syncFilters();
    });
  }

  /* ---------------- go ---------------- */

  fetch('data/questions.json')
    .then(function (r) { return r.json(); })
    .then(function (doc) {
      QUESTIONS = doc.questions;
      TOPICS = doc.topics;

      $('q-total').textContent = QUESTIONS.length;

      $('opt-room').checked = filters.room;
      $('opt-heavy').checked = filters.skipHeavy;
      $('opt-quick').checked = filters.quickOnly;
      $('answer-name').value = store('sa-name', '') || '';

      renderPlayers();
      renderFilterChips();
      syncFilters();
      wire();
    })
    .catch(function () {
      $('setup').innerHTML =
        '<div class="panel-head"><h2>The deck didn’t load</h2>' +
        '<p>Something went wrong fetching the questions. A refresh usually does it.</p></div>';
    });
})();
