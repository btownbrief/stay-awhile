/* ============================================================
   STAY AWHILE — a conversation game for Burlington.

   Moving parts:
     1. THE DECK   — 311 tagged questions, filtered to the room you're
                     actually in, dealt without repeats.
     2. THE WHEEL  — an SVG wheel of the people at the table. It picks who
                     answers. That's the whole mechanic.
     3. THE BURN   — opt-in. Instead of honouring the depth filter, it starts
                     you in the shallow end and walks you down. Nobody picks
                     "deep" from a cold start; they'll happily arrive there
                     twenty minutes in.
     4. THE TOWN   — answers other people left on the same question. Opt-in,
                     because reading them mid-game kills the conversation,
                     which is the entire point of the game.
     5. THE WEEK   — two questions a week, the same two for the whole town, one
                     for each edition of the Brief. It's what the newsletter
                     links to, and it's what stops the town's answers being
                     spread so thin across 311 cards that every card reads
                     "nobody has answered this yet" forever.

   The town runs on the shared Btown Supabase project via the RPCs in
   db/stay-awhile.sql. Until that SQL is run — or the network's gone, or
   someone's on a train — the game still works: answers save to this device
   only, and the page says so rather than pretending.
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
  var ORDER = ['light', 'warm', 'deep'];

  /* How the slow burn escalates: question 1–4 shallow, 5–10 waist, 11+ deep. */
  var BURN_STEPS = [
    { depth: 'light', until: 4 },
    { depth: 'warm',  until: 10 },
    { depth: 'deep',  until: Infinity }
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

  /* A stable id for this browser: stops one person flagging the same answer ten
     times, hearting it ten times, or machine-gunning the submit button. */
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
    topics: null,            // null = all, so a topic added later is on by default
    room: true,
    skipHeavy: false,
    quickOnly: false,
    timer: false,
    timerSecs: 90
  };
  if (filters.timer == null) { filters.timer = false; filters.timerSecs = 90; }

  var solo = false;
  var single = false;        // one question, arrived at by link — not a game
  var served = {};           // ids already dealt this session
  var current = null;
  var currentPlayer = null;
  var rotation = 0;
  var spinning = false;

  var mode = store('sa-mode', 'straight');   // 'straight' | 'burn'
  var turn = 0;                              // real turns taken — drives the burn
  var burnAt = 'light';                      // depth the burn actually served

  var townMode = null;       // 'live' | 'local' — settled on first fetch
  var flagged = store('sa-flagged', {});
  var hearted = store('sa-hearted', {});

  var tick = null;           // the answer timer's interval

  /* ---------------- analytics ----------------
     Rides on btb_track_event, which the guide's quick-wins.sql already
     installed. Fire-and-forget: if it isn't there, it 404s and nobody cares.
     After a month this answers "which questions does Burlington actually want
     to answer, and which should be cut?" — see README. */
  function track(event, qid, variant) {
    fetch(SUPABASE_URL + '/rest/v1/rpc/btb_track_event', {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_event: event, p_page: qid || '', p_variant: variant || '' }),
      keepalive: true
    }).catch(function () {});
  }

  /* ---------------- the deck ---------------- */

  function topicsOn() {
    return filters.topics || TOPICS.map(function (t) { return t.slug; });
  }

  function pool(depths) {
    var use = depths || filters.depths;
    var on = topicsOn();
    var roomOk = filters.room && players.length >= 2 && !solo;
    return QUESTIONS.filter(function (q) {
      if (use.indexOf(q.d) === -1) return false;
      if (!q.t.some(function (t) { return on.indexOf(t) !== -1; })) return false;
      if (q.f.indexOf('room') !== -1 && !roomOk) return false;
      if (filters.skipHeavy && q.f.indexOf('heavy') !== -1) return false;
      if (filters.quickOnly && q.f.indexOf('long') !== -1) return false;
      return true;
    });
  }

  /* Everything in play, whatever mode we're in — the burn overrides the depth
     filter, so the tally has to know that or it lies to you. */
  function livePool() {
    return mode === 'burn' ? pool(ORDER) : pool();
  }

  /* `turn` is 1-based by the time we're asked (nextTurn bumps it before it
     draws), so `until` reads as "through question N": 1–4 shallow, 5–10 waist,
     11 and beyond deep. */
  function burnDepth() {
    for (var i = 0; i < BURN_STEPS.length; i++) {
      if (turn <= BURN_STEPS[i].until) return BURN_STEPS[i].depth;
    }
    return 'deep';
  }

  function drawFrom(list) {
    if (!list.length) return null;
    var fresh = list.filter(function (q) { return !served[q.id]; });
    if (!fresh.length) {
      // This slice is exhausted. Start it over — but don't immediately hand
      // back the card that's already on the table.
      list.forEach(function (q) { delete served[q.id]; });
      fresh = list.filter(function (q) { return !current || q.id !== current.id; });
      if (!fresh.length) fresh = list;
    }
    var q = fresh[Math.floor(Math.random() * fresh.length)];
    served[q.id] = true;
    return q;
  }

  function draw() {
    if (mode !== 'burn') return drawFrom(pool());

    // Take the depth the burn wants. If the player's topics have starved that
    // depth entirely, fall to the next one down, then back up — a narrow topic
    // pick shouldn't dead-end the game.
    var want = burnDepth();
    var i = ORDER.indexOf(want);
    var tries = [want]
      .concat(ORDER.slice(i + 1))
      .concat(ORDER.slice(0, i).reverse());

    for (var t = 0; t < tries.length; t++) {
      var list = pool([tries[t]]);
      if (list.length) {
        burnAt = tries[t];
        return drawFrom(list);
      }
    }
    return null;
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

      svg.push('<path d="M100,100 L' + x1.toFixed(2) + ',' + y1.toFixed(2) +
               ' A100,100 0 ' + large + ',1 ' + x2.toFixed(2) + ',' + y2.toFixed(2) + ' Z" ' +
               'fill="' + WEDGE[i % WEDGE.length] + '" stroke="rgba(11,10,12,.35)" stroke-width="1"/>');

      // Label sits along the wedge's bisector. On the left half that rotation
      // would leave the name upside down, so spin the text a further 180° and
      // mirror its anchor — same spot on the rim, the right way up.
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
    ['spin-btn', 'next-btn', 'respin-btn'].forEach(function (id) { $(id).disabled = true; });
    $('whose-turn').innerHTML = '';

    var n = players.length;
    var seg = 360 / n;
    var target = Math.floor(Math.random() * n);

    // Land somewhere inside the wedge rather than dead centre every time.
    var jitter = (Math.random() - 0.5) * seg * 0.66;
    var centre = (target + 0.5) * seg + jitter;

    var wanted = (360 - centre) % 360;      // rotation mod 360 that parks the wedge under the pointer
    var atNow = ((rotation % 360) + 360) % 360;
    var delta = ((wanted - atNow) % 360 + 360) % 360;

    rotation += 360 * (5 + Math.floor(Math.random() * 3)) + delta;
    $('wheel').style.transform = 'rotate(' + rotation + 'deg)';

    window.setTimeout(function () {
      spinning = false;
      ['spin-btn', 'next-btn', 'respin-btn'].forEach(function (id) { $(id).disabled = false; });
      currentPlayer = players[target];
      $('whose-turn').innerHTML = '<em>' + esc(currentPlayer) + '</em>, you’re up.';
      if (then) then();
    }, 4050);   // matches the CSS transition, plus a beat
  }

  /* ---------------- the answer timer ---------------- */

  function stopTimer() {
    if (tick) { clearInterval(tick); tick = null; }
    $('timer').hidden = true;
  }

  function startTimer() {
    stopTimer();
    if (!filters.timer || single || !current) return;

    var total = filters.timerSecs;
    var left = total;
    var bar = $('timer-bar');
    var el = $('timer');

    el.hidden = false;
    el.classList.remove('up');
    bar.style.transition = 'none';
    bar.style.width = '100%';

    // Let the reset paint before the drain starts, or the transition is skipped.
    requestAnimationFrame(function () {
      bar.style.transition = 'width ' + total + 's linear';
      bar.style.width = '0%';
    });

    $('timer-left').textContent = left + 's';
    tick = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(tick); tick = null;
        $('timer-left').textContent = 'Time.';
        el.classList.add('up');
        return;
      }
      $('timer-left').textContent = left + 's';
    }, 1000);
  }

  function addTime(secs) {
    if (!filters.timer || !current) return;
    filters.timerSecs = Math.min(600, filters.timerSecs);   // guard only; not persisted here
    var el = $('timer');
    var wasUp = el.classList.contains('up');
    // Simplest honest behaviour: restart the clock with the extra time added.
    var base = wasUp ? secs : secs + (parseInt($('timer-left').textContent, 10) || 0);
    var keep = filters.timerSecs;
    filters.timerSecs = base;
    startTimer();
    filters.timerSecs = keep;
  }

  /* ---------------- the card ---------------- */

  function label(slug) {
    var t = TOPICS.filter(function (x) { return x.slug === slug; })[0];
    return t ? t.emoji + ' ' + t.label : slug;
  }

  function renderBurn() {
    var box = $('burn');
    if (mode !== 'burn' || single) { box.hidden = true; return; }
    box.hidden = false;

    var at = burnAt;
    [].forEach.call(box.querySelectorAll('[data-step]'), function (li) {
      var step = li.getAttribute('data-step');
      li.classList.toggle('on', step === at);
      li.classList.toggle('done', ORDER.indexOf(step) < ORDER.indexOf(at));
    });

    var step = BURN_STEPS.filter(function (s) { return s.depth === at; })[0];
    var togo = step && step.until !== Infinity ? step.until - turn : 0;
    $('burn-note').textContent = at === 'deep'
      ? 'You’re in deep water. It doesn’t get any harder than this.'
      : togo <= 0
        ? 'Going deeper.'
        : togo + ' more, then it gets deeper.';
  }

  function showCard(q, opts) {
    opts = opts || {};
    current = q;
    stopTimer();

    if (!q) { $('card').hidden = true; return; }

    var depth = DEPTHS.filter(function (d) { return d.slug === q.d; })[0];
    var tags = ['<span class="tag tag-depth" data-d="' + q.d + '">' + esc(depth.label) + '</span>'];
    q.t.forEach(function (t) { tags.push('<span class="tag">' + esc(label(t)) + '</span>'); });
    if (q.f.indexOf('long') !== -1) tags.push('<span class="tag">📖 A story</span>');

    $('card-tags').innerHTML = tags.join('');
    $('card-q').textContent = q.q;
    $('card').hidden = false;

    resetTown();
    renderBurn();
    if (!opts.quiet) track('sa-served', q.id, q.d);
    startTimer();
  }

  /* A real turn: new person AND new question. Only this advances the burn. */
  function nextTurn() {
    turn += 1;
    var q = draw();
    if (!q) { turn -= 1; showEmptyDeck(); return; }
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
    $('burn').hidden = true;
    current = null;
    $('town-toggle').hidden = true;
    $('share-btn').hidden = true;
    stopTimer();
  }

  /* ---------------- deep links & question of the day ---------------- */

  function shareUrl(id) {
    return location.origin + location.pathname + '?q=' + id;
  }

  function copyLink(id, btn) {
    var url = shareUrl(id);
    var done = function () {
      var was = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(function () { btn.textContent = was; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link:', url); });
    } else {
      window.prompt('Copy this link:', url);
    }
  }

  /* ---------------- questions of the week ----------------

     Two a week, the same two for the whole town, Monday through Sunday — one
     for each edition of the Brief.

     One fixed shuffle of the deck, walked two steps a week. 311 is odd, so
     stepping by two cycles through every question before any of them comes
     round again — about three years of Mondays. Deterministic, so there is
     nothing to store, nothing to schedule, and no cron job to forget about. */

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* The Monday of the current week, local time — so the pair turns over at
     midnight in Burlington, not at 8pm the evening before (which is what UTC
     would give us). Monday because that's when the Brief goes out. */
  function mondayOfThisWeek() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }

  function questionsOfTheWeek() {
    var n = QUESTIONS.length;
    if (n < 2) return [];

    var order = QUESTIONS.map(function (_, i) { return i; });
    var rnd = mulberry32(20260711);           // fixed seed — the running order never changes
    for (var i = order.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }

    var epoch = new Date(2026, 0, 5);         // a Monday, same epoch the playlist uses
    var week = Math.round((mondayOfThisWeek() - epoch) / 604800000);
    var at = function (k) { return QUESTIONS[order[(((k % n) + n) % n)]]; };

    return [at(week * 2), at(week * 2 + 1)];
  }

  function weekRangeLabel() {
    var mon = mondayOfThisWeek();
    var sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    var f = function (d, withMonth) {
      return d.toLocaleDateString(undefined,
        withMonth ? { month: 'short', day: 'numeric' } : { day: 'numeric' });
    };
    // "Jul 6 – 12", or "Jun 29 – Jul 5" when the week straddles two months.
    return mon.getMonth() === sun.getMonth()
      ? f(mon, true) + ' – ' + f(sun, false)
      : f(mon, true) + ' – ' + f(sun, true);
  }

  function renderWeek() {
    var qs = questionsOfTheWeek();
    if (!qs.length) return;

    $('qotw-date').textContent = weekRangeLabel();
    $('week-list').innerHTML = qs.map(function (q) {
      return '<li class="week-q">' +
        '<p class="week-question">' + esc(q.q) + '</p>' +
        '<div class="week-actions">' +
          '<button class="btn btn-go" data-open="' + esc(q.id) + '" type="button">' +
            'Answer it — and see what the town said</button>' +
          '<button class="btn btn-ghost" data-copy="' + esc(q.id) + '" type="button">Copy link</button>' +
        '</div>' +
      '</li>';
    }).join('');

    $('qotw').hidden = false;
  }

  /* One question, on its own, because someone followed a link to it. Not a
     game — no wheel, no deck, no burn. Just the question and the town. */
  function openSingle(q) {
    single = true;
    solo = true;
    current = null;

    $('qotw').hidden = true;
    $('setup').hidden = true;
    $('game').hidden = false;
    $('wheel-stage').hidden = true;
    $('burn').hidden = true;

    ['next-btn', 'skip-btn', 'respin-btn'].forEach(function (id) { $(id).hidden = true; });
    $('play-all').hidden = false;

    showCard(q);
    track('sa-linked', q.id, q.d);

    // They came for the answers. Don't make them click again.
    $('town-toggle').setAttribute('aria-expanded', 'true');
    $('town-body').hidden = false;
    loadTown();

    $('game').scrollIntoView({ block: 'start' });
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
    return (all[qid] || []).slice().sort(function (a, b) {
      return (b.hearts || 0) - (a.hearts || 0) ||
             new Date(b.created_at) - new Date(a.created_at);
    });
  }
  function saveLocalAnswer(qid, row) {
    var all = store('sa-local-answers', {});
    (all[qid] = all[qid] || []).unshift(row);
    save('sa-local-answers', all);
  }
  function heartLocal(qid, id) {
    var all = store('sa-local-answers', {});
    (all[qid] || []).forEach(function (r) {
      if (r.id === id) r.hearts = (r.hearts || 0) + 1;
    });
    save('sa-local-answers', all);
  }

  function resetTown() {
    var t = $('town-toggle');
    t.hidden = false;
    t.setAttribute('aria-expanded', 'false');
    $('share-btn').hidden = false;
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
        var didHeart = hearted[r.id];
        var didFlag = flagged[r.id];
        var n = r.hearts || 0;
        return '<div class="answer">' +
          '<p>' + esc(r.body) + '</p>' +
          '<div class="answer-meta">' +
            '<span class="who">' + esc(r.name || 'Anonymous') + '</span>' +
            '<span>·</span><span>' + esc(ago(r.created_at)) + '</span>' +
            '<button class="answer-heart' + (didHeart ? ' on' : '') + '" data-heart="' + esc(r.id) + '"' +
              (didHeart ? ' disabled' : '') + ' aria-label="Love this answer">' +
              '♥ <span>' + n + '</span></button>' +
            (townMode === 'live'
              ? '<button class="answer-flag" data-flag="' + esc(r.id) + '"' +
                (didFlag ? ' disabled' : '') + '>' + (didFlag ? 'reported' : 'report') + '</button>'
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

    var qid = current.id, depth = current.d;

    var done = function (msg) {
      btn.disabled = false;
      btn.textContent = 'Add mine';
      $('answer-input').value = '';
      note(msg);
    };

    var fallback = function (msg) {
      townMode = 'local';
      saveLocalAnswer(qid, {
        id: 'l' + Date.now(), name: name, body: body,
        created_at: new Date().toISOString(), hearts: 0
      });
      renderAnswers(localAnswers(qid));
      done(msg);
    };

    if (townMode === 'local') {
      fallback('Saved on this device. It’ll stay private until the shared answers are switched on.');
      track('sa-answered', qid, depth);
      return;
    }

    rpc('btb_sa_submit', { p_qid: qid, p_name: name, p_body: body, p_voter: visitor })
      .then(function () {
        track('sa-answered', qid, depth);
        loadTown();
        done('Added. Thanks for actually answering.');
      })
      .catch(function () {
        fallback('Couldn’t reach the town — saved on this device instead.');
      });
  }

  function heartAnswer(id, btn) {
    hearted[id] = true;
    save('sa-hearted', hearted);
    btn.disabled = true;
    btn.classList.add('on');
    var n = btn.querySelector('span');
    n.textContent = (parseInt(n.textContent, 10) || 0) + 1;

    if (townMode === 'local') { heartLocal(current.id, id); return; }
    rpc('btb_sa_heart', { p_answer: id, p_voter: visitor }).catch(function () {});
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
    $('name-input').value = '';
    if (!name || players.length >= 12) return;
    if (players.some(function (p) { return p.toLowerCase() === name.toLowerCase(); })) return;
    players.push(name);
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

  function renderMode() {
    [].forEach.call(document.querySelectorAll('[data-mode]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode));
    });
    $('mode-note').textContent = mode === 'burn'
      ? 'Starts in the shallow end and works its way down as you play. It sets the depth for you, so the depth filter below sits this one out.'
      : 'Questions come at whatever depth you’ve set in the filters below.';

    // The burn owns the depth, so say so rather than leaving dead chips lit.
    $('depth-chips').classList.toggle('inert', mode === 'burn');
    $('depth-lock').hidden = mode !== 'burn';
    save('sa-mode', mode);
  }

  function syncFilters() {
    var n = livePool().length;
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

    $('timer-secs').disabled = !filters.timer;
    save('sa-filters', filters);
  }

  /* ---------------- wiring ---------------- */

  function begin(isSolo) {
    solo = isSolo;
    single = false;
    turn = 0;
    served = {};
    burnAt = 'light';

    $('qotw').hidden = true;
    $('setup').hidden = true;
    $('game').hidden = false;

    var noWheel = solo || players.length < 2;
    $('wheel-stage').hidden = noWheel;
    $('respin-btn').hidden = noWheel;
    ['next-btn', 'skip-btn'].forEach(function (id) { $(id).hidden = false; });
    $('play-all').hidden = true;
    $('next-btn').textContent = noWheel ? 'Next question' : 'Next — spin again';

    syncFilters();
    renderMode();
    $('game').scrollIntoView({ block: 'start' });

    if (noWheel) {
      nextTurn();
    } else {
      renderBurn();
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

    $('mode-chips').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-mode]');
      if (!btn) return;
      mode = btn.getAttribute('data-mode');
      renderMode();
      syncFilters();
    });

    $('start-btn').addEventListener('click', function () { begin(false); });
    $('solo-btn').addEventListener('click', function () { begin(true); });

    $('spin-btn').addEventListener('click', function () {
      if (!current) nextTurn();   // first spin: person + question
      else spin();                // re-spin without changing the question
    });

    $('next-btn').addEventListener('click', nextTurn);

    $('skip-btn').addEventListener('click', function () {
      // A pass is not a turn — passing shouldn't push you deeper.
      if (current) track('sa-passed', current.id, current.d);
      var q = draw();
      if (!q) { showEmptyDeck(); return; }
      showCard(q);
    });

    $('respin-btn').addEventListener('click', function () { spin(); });

    $('play-all').addEventListener('click', function () {
      history.replaceState({}, '', location.pathname);
      single = false;
      $('setup').hidden = false;
      $('game').hidden = true;
      renderWeek();
      $('setup').scrollIntoView({ block: 'start' });
    });

    $('share-btn').addEventListener('click', function () {
      if (current) copyLink(current.id, this);
    });

    $('week-list').addEventListener('click', function (e) {
      var open = e.target.closest('[data-open]');
      if (open) {
        var id = open.getAttribute('data-open');
        var q = QUESTIONS.filter(function (x) { return x.id === id; })[0];
        if (q) { history.replaceState({}, '', '?q=' + q.id); openSingle(q); }
        return;
      }
      var copy = e.target.closest('[data-copy]');
      if (copy) copyLink(copy.getAttribute('data-copy'), copy);
    });

    $('town-toggle').addEventListener('click', function () {
      var open = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', String(!open));
      $('town-body').hidden = open;
      if (!open) {
        if (current) track('sa-revealed', current.id, current.d);
        loadTown();
      }
    });

    $('town-form').addEventListener('submit', submitAnswer);

    $('town-list').addEventListener('click', function (e) {
      var h = e.target.closest('[data-heart]');
      if (h && !h.disabled) { heartAnswer(h.getAttribute('data-heart'), h); return; }
      var f = e.target.closest('[data-flag]');
      if (f && !f.disabled) flagAnswer(f.getAttribute('data-flag'), f);
    });

    $('timer-more').addEventListener('click', function () { addTime(30); });

    $('depth-chips').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-depth]');
      if (!btn || mode === 'burn') return;
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
      filters.topics = null; renderFilterChips(); syncFilters();
    });
    $('topics-none').addEventListener('click', function () {
      filters.topics = []; renderFilterChips(); syncFilters();
    });
    $('topics-local').addEventListener('click', function () {
      filters.topics = ['btown']; renderFilterChips(); syncFilters();
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
    $('opt-timer').addEventListener('change', function () {
      filters.timer = this.checked;
      syncFilters();
      if (filters.timer && current && !single) startTimer(); else stopTimer();
    });
    $('timer-secs').addEventListener('change', function () {
      filters.timerSecs = parseInt(this.value, 10) || 90;
      syncFilters();
      if (filters.timer && current && !single) startTimer();
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
      $('opt-timer').checked = filters.timer;
      $('timer-secs').value = String(filters.timerSecs);
      $('answer-name').value = store('sa-name', '') || '';

      renderPlayers();
      renderFilterChips();
      renderMode();
      syncFilters();
      renderWeek();
      wire();

      // ?q=q142 opens that one question on its own, with the town's answers
      // already up — that's what the newsletter links to.
      // ?q=week is the stable address for whatever this week's pair happens to
      // be, for when you want a link you can set and forget.
      var want = new URLSearchParams(location.search).get('q');
      if (want === 'week') {
        $('qotw').scrollIntoView({ block: 'start' });
      } else if (want) {
        var q = QUESTIONS.filter(function (x) { return x.id === want; })[0];
        if (q) openSingle(q);
      }
    })
    .catch(function () {
      $('setup').innerHTML =
        '<div class="panel-head"><h2>The deck didn’t load</h2>' +
        '<p>Something went wrong fetching the questions. A refresh usually does it.</p></div>';
    });
})();
