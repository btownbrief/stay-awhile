/* ============================================================
   STAY AWHILE — a conversation game for Burlington.

   The whole game is: here are three questions, ask them out loud.

   Everything else is optional and out of the way. No setup screen, no names,
   nothing to agree to before you can read a question. The wheel is a link you
   can choose to click; only then does it ask who's playing. Two rows of dials,
   not twenty. If someone wants the whole deck, they can have the whole deck.

   The pieces:
     THE TRIO   — three questions, one button. That's the game.
     THE DIALS  — how deep and roughly what about.
                  "The slow burn" is the fourth depth setting rather than a mode
                  of its own: it just takes the depth out of your hands and
                  walks you down as you play.
     THE WHEEL  — opt-in party mode. Names, a wheel, one question at a time.
     THE DECK   — all 273, searchable, on request.
     THE TOWN   — what other people answered, per question, on request. It's a
                  click because reading it mid-conversation kills the
                  conversation, which is the entire point of the game.
     THE WEEK   — one question a week, the same one for the whole town. What
                  the newsletter links to.

   The town runs on the shared Btown Supabase project via db/stay-awhile.sql.
   With no backend it degrades honestly: answers save to this device and the
   page says so, rather than pretending.
============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';

  var WEDGE = ['#FF6B35', '#E8B04B', '#5BC8F5', '#F2A488',
               '#C7D96B', '#F5D98B', '#8FD3C7', '#FF9F68'];

  var DEPTHS = [
    { slug: 'light', label: 'Shallow end' },
    { slug: 'warm',  label: 'Waist deep' },
    { slug: 'deep',  label: 'Deep water' }
  ];
  var ORDER = ['light', 'warm', 'deep'];

  /* Fifteen topic tags was a filing system, not a filter. Five buckets is a
     choice someone can actually make while holding a drink. The tags in
     questions.json are untouched — they just roll up to these. */
  var BUCKETS = [
    { slug: 'btown',  label: 'Burlington',    tags: ['btown'] },
    { slug: 'back',   label: 'Back then',     tags: ['childhood', 'memory'] },
    { slug: 'people', label: 'People',        tags: ['love', 'friends', 'family'] },
    { slug: 'big',    label: 'Big questions', tags: ['life', 'opinions'] },
    { slug: 'loose',  label: 'Off the cuff',  tags: ['whatif', 'confess', 'now',
                                                     'food', 'travel', 'self', 'work'] }
  ];

  /* The slow burn, in threes: two rounds shallow, two waist, then deep. */
  function burnDepthFor(round) {
    if (round <= 2) return 'light';
    if (round <= 4) return 'warm';
    return 'deep';
  }

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function store(k, d) {
    try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : d; } catch (e) { return d; }
  }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var visitor = store('sa-visitor', null);
  if (!visitor) {
    visitor = 'v' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    save('sa-visitor', visitor);
  }

  /* ---------------- state ---------------- */

  var QUESTIONS = [];
  var mode = store('sa-mode', 'classic');
  if (mode !== 'catchup') mode = 'classic';
  document.body.dataset.mode = mode;
  var savedDials = store('sa-dials', {}) || {};
  var dials = {
    depths: savedDials.depths || ['light', 'warm'],
    burn: !!savedDials.burn,
    topics: savedDials.topics || null
  };

  var served = {};
  var trio = [];
  var round = 0;

  var TALKING_POINTS = [];
  var tpServed = {};
  var tpLoading = null;

  var players = store('sa-players', []);
  var wheelOn = false;
  var current = null;          // the wheel's question
  var rotation = 0, spinning = false, spinTimeout = null, spinWasHidden = false;
  var landingTimer = null, tick = null;
  var timerOn = false, timerSecs = 90;

  var townMode = null;         // 'live' | 'local'
  var hearted = store('sa-hearted', {});
  var flagged = store('sa-flagged', {});

  /* ---------------- analytics (fire and forget) ---------------- */

  function track(ev, qid, variant) {
    fetch(SUPABASE_URL + '/rest/v1/rpc/btb_track_event', {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_event: ev, p_page: qid || '', p_variant: variant || '' }),
      keepalive: true
    }).catch(function () {});
  }

  /* ---------------- the deck ---------------- */

  function activeTags() {
    var on = dials.topics;
    if (!on || !on.length) return null;                       // null = everything
    return BUCKETS.filter(function (b) { return on.indexOf(b.slug) !== -1; })
                  .reduce(function (a, b) { return a.concat(b.tags); }, []);
  }

  function pool(depths) {
    var use = depths || (dials.burn ? [burnDepthFor(round || 1)] : dials.depths);
    var tags = activeTags();

    /* The heavy ones — grief, death, regret — appear only if someone actually
       asked for deep water. That's a whole switch we no longer need to show. */
    var allowHeavy = use.indexOf('deep') !== -1;

    /* Questions that ask about "the people at this table" only make sense when
       there are people at the table, i.e. the wheel is up with names on it. */
    var allowRoom = wheelOn && players.length >= 2;

    return QUESTIONS.filter(function (q) {
      if (q.deck) return false;
      if (use.indexOf(q.d) === -1) return false;
      if (tags && !q.t.some(function (t) { return tags.indexOf(t) !== -1; })) return false;
      if (!allowHeavy && q.f.indexOf('heavy') !== -1) return false;
      if (!allowRoom && q.f.indexOf('room') !== -1) return false;
      return true;
    });
  }

  function take(list, n, exclude) {
    var fresh = list.filter(function (q) {
      return !served[q.id] && (!exclude || exclude.indexOf(q.id) === -1);
    });
    if (fresh.length < n) {                    // deck exhausted for this slice — recycle
      list.forEach(function (q) { delete served[q.id]; });
      fresh = list.filter(function (q) { return !exclude || exclude.indexOf(q.id) === -1; });
    }
    var out = [];
    for (var i = 0; i < n && fresh.length; i++) {
      var k = Math.floor(Math.random() * fresh.length);
      var q = fresh.splice(k, 1)[0];
      served[q.id] = true;
      out.push(q);
    }
    return out;
  }

  /* ---------------- talking points ---------------- */

  function toast(message) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
  }

  function loadTalkingPoints() {
    if (tpLoading) return tpLoading;
    tpLoading = fetch('data/talking-points.json')
      .then(function (r) { if (!r.ok) throw new Error('talking points → ' + r.status); return r.json(); })
      .then(function (doc) {
        TALKING_POINTS = (doc.points || []).filter(function (p) { return p && p.text; }).map(function (p) {
          return { _tp: true, text: String(p.text), url: p.url || null,
                   sourceName: p.sourceName || '', category: p.category || 'curated' };
        });
      })
      .catch(function () { TALKING_POINTS = []; });
    return tpLoading;
  }

  function takeTalkingPoint() {
    var fresh = TALKING_POINTS.filter(function (point) { return !tpServed[point.text]; });
    if (!fresh.length) { tpServed = {}; fresh = TALKING_POINTS.slice(); }
    if (!fresh.length) return null;
    var point = fresh[Math.floor(Math.random() * fresh.length)];
    tpServed[point.text] = true;
    return point;
  }

  function dealOne(live, exclude) {
    return mode === 'catchup' ? takeTalkingPoint() : (take(live, 1, exclude)[0] || null);
  }

  function talkingPointHtml(point) {
    return '<span class="q-depth q-tp-kicker">AROUND TOWN THIS WEEK</span>' +
      '<p class="q-text">' + esc(point.text) + '</p>' +
      (point.url ? '<div class="q-foot"><a class="q-tp-source" href="' + esc(point.url) +
        '" target="_blank" rel="noopener">from ' + esc(point.sourceName || 'source') + ' ↗</a></div>' : '');
  }

  function renderMode() {
    document.body.dataset.mode = mode;
    $('mode-classic').setAttribute('aria-selected', mode === 'classic');
    $('mode-catchup').setAttribute('aria-selected', mode === 'catchup');
    $('mode-note').textContent = mode === 'catchup'
      ? 'Around town — casual openers for catching up.'
      : 'The deep deck.';
    $('deal-btn').textContent = mode === 'catchup' ? 'Deal fresh chatter' : 'Three more';
  }

  function setMode(next, shouldTrack) {
    mode = next;
    save('sa-mode', mode);
    renderMode();
    if (shouldTrack) track('sa-mode', mode);

    if (mode === 'classic') {
      renderTrio();
      return;
    }

    if (TALKING_POINTS.length) {
      renderTrio();
      return;
    }
    renderTrio();
    loadTalkingPoints().then(function () {
      if (mode !== 'catchup') return;
      if (TALKING_POINTS.length) {
        renderTrio();
        return;
      }
      mode = 'classic';
      save('sa-mode', mode);
      renderMode();
      renderTrio();
      toast('No fresh chatter right now');
    });
  }

  /* ---------------- the trio ---------------- */

  /* The answer box sits on the card, always, rather than hiding behind a click —
     but it stays one quiet line tall and says "optional" on it, because nobody
     has to write anything to play this. It grows as you type. The name field
     only appears once there's something to sign. */
  function cardHtml(q, open) {
    var d = DEPTHS.filter(function (x) { return x.slug === q.d; })[0];
    return '' +
      '<span class="q-depth" data-d="' + q.d + '">' + esc(d.label) + '</span>' +
      '<p class="q-text">' + esc(q.q) + '</p>' +

      '<form class="q-answer" data-form="' + q.id + '" autocomplete="off">' +
        '<div class="ans-row">' +
          // Short enough to sit on one line inside a card this narrow — a
          // placeholder that wraps gets clipped by the one-line resting height.
          '<textarea class="ans" rows="1" maxlength="600" ' +
            'placeholder="Your answer — optional"></textarea>' +
          '<button type="submit" class="ans-go" disabled aria-label="Leave your answer">→</button>' +
        '</div>' +
        '<div class="ans-more" hidden>' +
          '<input type="text" class="ans-name" maxlength="24" placeholder="Name (optional)" ' +
            'value="' + esc(store('sa-name', '') || '') + '">' +
          '<span class="ans-note">Anyone can read this.</span>' +
        '</div>' +
      '</form>' +

      '<div class="q-foot">' +
        '<button class="q-reveal" data-reveal="' + q.id + '">See what the town said</button>' +
        '<button class="q-copy" data-copy="' + q.id + '" title="Copy a link to this question">Link</button>' +
      '</div>' +
      '<div class="q-town" data-town="' + q.id + '"' + (open ? '' : ' hidden') + '></div>';
  }

  /* ---------------- fit the question to its card ----------------

     A question is the only thing on a card, so it should behave like a headline
     and fill the space it's been given. A fixed font-size can't: "Are you a
     picky eater?" and "Someone from the year 3000 watches one day of your life,
     what horrifies them?" are the same card and four times the words, so any
     single size is either too small for one or overflowing for the other.

     So: grow each question to the biggest size that still fits its box. Short
     questions come out huge, long ones come out merely large, and no card is
     ever mostly empty. Re-run on resize, since the box changes width. */

  function fitQuestion(el) {
    if (!el) return;

    /* One column (phones): the cards are stacked, so there is no reason to force
       them all to the same height — and forcing it leaves "Do you lock your
       door?" marooned in a half-empty card. Down here the box hugs the question
       instead, and CSS picks a big fluid size. Hand the size back to CSS. */
    if (window.innerWidth <= 900) { el.style.fontSize = ''; return; }

    /* Talking points used to skip the fit and take their size straight from the
       CSS clamp — but a clamp reads the VIEWPORT, not the sentence. A talking
       point runs 100–160 characters, two to three times a question, so on a wide
       screen every long one got the full 36px, sailed past the bottom of the
       fixed box, and had its last line or three guillotined by overflow:hidden.
       They get fitted like everything else now, inside the range the CSS
       already declared. The floor sits under that range so a longer point
       written later still shrinks to fit rather than being cut off. */
    var tp = !!el.closest('.q-tp');
    var max = tp ? 36 : (window.innerWidth >= 1100 ? 54 : 46);
    var min = tp ? 15 : 17;

    // Binary search beats stepping: ~6 measurements instead of ~35.
    var lo = min, hi = max, best = min;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      el.style.fontSize = mid + 'px';
      if (el.scrollHeight <= el.clientHeight) { best = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    el.style.fontSize = best + 'px';
  }

  function fitAll() {
    [].forEach.call(document.querySelectorAll('.q-text'), fitQuestion);
  }

  /* The fit is a measurement, and on a cold load it measures Georgia — the
     fallback — because the webfonts arrive with font-display: swap. Georgia is
     the wider face, so those first cards come out a size or two smaller than
     they should and stay that way for the whole visit. Measure again once the
     real fonts land. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitAll);
  }

  var refit;
  window.addEventListener('resize', function () {
    clearTimeout(refit);
    refit = setTimeout(fitAll, 120);
  });

  function renderTrio() {
    var dealRound = mode === 'classic' ? round + 1 : round;
    var live = pool(dials.burn && mode === 'classic' ? [burnDepthFor(dealRound)] : null);
    if (mode === 'catchup' && !TALKING_POINTS.length) {
      $('trio').innerHTML = '';
      $('deal-note').textContent = '';
      return;
    }
    if (mode === 'classic' && !live.length) {
      $('trio').innerHTML = '<p class="trio-empty">Nothing matches. Turn a dial back on.</p>';
      $('deal-note').textContent = '';
      return;
    }

    if (mode === 'classic') round = dealRound;
    var previous = trio.filter(function (item) { return !item._tp; }).map(function (q) { return q.id; });
    var next = [];
    var handSize = mode === 'catchup' ? 3 : Math.min(3, live.length);
    for (var i = 0; i < handSize; i++) {
      var exclude = previous.concat(next.filter(function (item) { return !item._tp; })
        .map(function (q) { return q.id; }));
      var item = dealOne(live, exclude);
      if (item) next.push(item);
    }
    trio = next;

    $('trio').innerHTML = trio.map(function (item) {
      return item._tp
        ? '<article class="q q-tp">' + talkingPointHtml(item) + '</article>'
        : '<article class="q" data-id="' + item.id + '">' + cardHtml(item) + '</article>';
    }).join('');

    updateBurnMeter();
    fitAll();
    trio.forEach(function (item) {
      if (item._tp) track('sa-tp-served', 'tp', item.category);
      else track('sa-served', item.id, item.d);
    });

    $('deal-note').textContent = mode === 'catchup' ? '' : dials.burn
      ? (burnDepthFor(round) === 'deep'
          ? 'Deep water. It doesn’t get harder than this.'
          : 'Getting deeper as you go.')
      : live.length + ' in play';
  }

  /* ---------------- the dials ---------------- */

  function updateBurnMeter() {
    var meter = document.querySelector('.burn-meter');
    if (!meter) return;
    var meterRound = round || 1;
    var depth = burnDepthFor(meterRound);
    var reached = ORDER.indexOf(depth);
    meter.setAttribute('aria-label', 'Slow burn depth: ' +
      DEPTHS[reached].label + '. ' + meterRound + (meterRound === 1 ? ' round' : ' rounds') + '.');
    [].forEach.call(meter.querySelectorAll('.burn-dot'), function (dot, i) {
      dot.classList.toggle('on', i <= reached);
    });
  }

  function renderDials() {
    $('depth-chips').innerHTML =
      DEPTHS.map(function (d) {
        var on = !dials.burn && dials.depths.indexOf(d.slug) !== -1;
        return '<button class="chip chip-depth" data-depth="' + d.slug + '" data-d="' + d.slug +
               '" aria-pressed="' + on + '">' + esc(d.label) + '</button>';
      }).join('') +
      '<button class="chip chip-burn" data-burn="1" aria-pressed="' + dials.burn +
      '" title="Start shallow and work down as you play">The slow burn ↗</button>' +
      '<span class="burn-meter" role="img"' + (dials.burn ? '' : ' hidden') + '>' +
        ORDER.map(function (depth) {
          return '<span class="burn-dot" data-d="' + depth + '" aria-hidden="true"></span>';
        }).join('') +
      '</span>';

    var on = dials.topics;
    $('topic-chips').innerHTML =
      '<button class="chip" data-topic="" aria-pressed="' + (!on || !on.length) + '">Anything</button>' +
      BUCKETS.map(function (b) {
        var isOn = !!on && on.indexOf(b.slug) !== -1;
        return '<button class="chip" data-topic="' + b.slug + '" aria-pressed="' + isOn + '">' +
               esc(b.label) + '</button>';
      }).join('');

    save('sa-dials', dials);
    updateBurnMeter();
  }

  /* ---------------- the town ---------------- */

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

  function localAnswers(qid) {
    var all = store('sa-local-answers', {});
    return (all[qid] || []).slice().sort(function (a, b) {
      return (b.hearts || 0) - (a.hearts || 0) || new Date(b.created_at) - new Date(a.created_at);
    });
  }
  function saveLocalAnswer(qid, row) {
    var all = store('sa-local-answers', {});
    (all[qid] = all[qid] || []).unshift(row);
    save('sa-local-answers', all);
  }

  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + 'm ago';
    if (s < 129600) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  /* The reveal is now just the reading half — the answers other people left.
     Writing your own lives on the card itself and never goes away. */
  function townHtml(rows, msg, highlightId) {
    var list = rows.length
      ? rows.map(function (r) {
          var justAdded = highlightId && String(r.id) === String(highlightId);
          return '<div class="answer' + (justAdded ? ' just-added' : '') + '">' +
            '<p>' + esc(r.body) + '</p>' +
            '<div class="answer-meta">' +
              '<span class="who">' + esc(r.name || 'Anonymous') + '</span>' +
              '<span>' + esc(ago(r.created_at)) + '</span>' +
              '<button class="answer-heart' + (hearted[r.id] ? ' on' : '') + '" data-heart="' + esc(r.id) +
                '"' + (hearted[r.id] ? ' disabled' : '') + ' aria-label="Love this">♥ <span>' +
                (r.hearts || 0) + '</span></button>' +
              (townMode === 'live'
                ? '<button class="answer-flag" data-flag="' + esc(r.id) + '"' +
                  (flagged[r.id] ? ' disabled' : '') + '>' +
                  (flagged[r.id] ? 'reported' : 'report') + '</button>'
                : '') +
            '</div></div>';
        }).join('')
      : '<p class="answer-empty">Nobody’s answered this one yet.</p>';

    return '<div class="town-list">' + list + '</div>' +
      (msg ? '<p class="town-status">' + esc(msg) + '</p>' : '');
  }

  function finishTownLoad(box, rows, msg, highlightId) {
    box.innerHTML = townHtml(rows, msg, highlightId);
    var added = box.querySelector('.just-added');
    if (added) {
      setTimeout(function () { added.classList.remove('just-added'); }, 1400);
    }
  }

  function loadTown(qid, box, msg, highlightId) {
    box.hidden = false;
    if (!box.innerHTML) box.innerHTML = '<p class="answer-empty">Reading the room…</p>';

    var offline = function () {
      townMode = 'local';
      finishTownLoad(box, localAnswers(qid),
        msg || 'Saved on this device only — the shared answers aren’t switched on yet.', highlightId);
    };

    if (townMode === 'local') return offline();

    return rpc('btb_sa_list', { p_qid: qid })
      .then(function (rows) {
        townMode = 'live';
        finishTownLoad(box, rows || [], msg, highlightId);
      })
      .catch(offline);
  }

  /* Leaving an answer opens the town underneath it, so you can see yours land
     next to everyone else's. That's the reward for bothering. */
  function submitAnswer(form, qid) {
    var ta = form.querySelector('.ans');
    var nameEl = form.querySelector('.ans-name');
    var body = ta.value.trim();
    if (body.length < 2) return;

    var name = nameEl ? nameEl.value.trim() : '';
    save('sa-name', name);

    var btn = form.querySelector('.ans-go');
    btn.disabled = true;

    var card = form.closest('.q');
    var box = card.querySelector('[data-town]');
    var reveal = card.querySelector('[data-reveal]');

    var reset = function () {
      ta.value = '';
      ta.style.height = '';
      form.querySelector('.ans-more').hidden = true;
      if (reveal) reveal.textContent = 'Hide what the town said';
    };

    track('sa-answered', qid, '');

    if (townMode === 'local') {
      var localId = 'l' + Date.now();
      saveLocalAnswer(qid, { id: localId, name: name, body: body,
                             created_at: new Date().toISOString(), hearts: 0 });
      reset();
      box.innerHTML = '';
      loadTown(qid, box, 'Saved on this device. It’ll stay private until the shared answers are on.',
        localId);
      return;
    }

    rpc('btb_sa_submit', { p_qid: qid, p_name: name, p_body: body, p_voter: visitor })
      .then(function (answerId) {
        reset();
        box.innerHTML = '';
        loadTown(qid, box, 'Added. Thanks for actually answering.', answerId);
      })
      .catch(function () {
        townMode = 'local';
        var fallbackId = 'l' + Date.now();
        saveLocalAnswer(qid, { id: fallbackId, name: name, body: body,
                               created_at: new Date().toISOString(), hearts: 0 });
        reset();
        box.innerHTML = '';
        loadTown(qid, box, 'Couldn’t reach the town — saved on this device instead.', fallbackId);
      });
  }

  function copyLink(id, btn) {
    var url = location.origin + location.pathname + '?q=' + id;
    var done = function () {
      var was = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = was; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy:', url); });
    } else { window.prompt('Copy:', url); }
  }

  /* ---------------- questions of the week ---------------- */

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
  function questionsOfTheWeek() {
    /* Room questions need a table and a "me" — they make no sense as the
       town-wide question, so they sit this one out. */
    var classic = QUESTIONS.filter(function (q) {
      return !q.deck && q.f.indexOf('room') === -1;
    });
    var n = classic.length;
    if (!n) return [];
    var order = classic.map(function (_, i) { return i; });
    var rnd = mulberry32(20260711);
    for (var i = order.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = order[i]; order[i] = order[j]; order[j] = t;
    }
    /* One a week, walked one step at a time through the fixed shuffle. A
       single step means the whole deck gets its turn before anything
       repeats no matter how many questions there are — the old two-at-a-
       time walk is what needed an odd deck count to guarantee that. */
    var week = Math.round((mondayOfThisWeek() - new Date(2026, 0, 5)) / 604800000);
    var at = function (k) { return classic[order[(((k % n) + n) % n)]]; };
    return [at(week)];
  }
  function weekRangeLabel() {
    var mon = mondayOfThisWeek(), sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    var f = function (d, m) {
      return d.toLocaleDateString(undefined, m ? { month: 'short', day: 'numeric' } : { day: 'numeric' });
    };
    return mon.getMonth() === sun.getMonth() ? f(mon, 1) + ' – ' + f(sun, 0)
                                             : f(mon, 1) + ' – ' + f(sun, 1);
  }
  function renderWeek() {
    var qs = questionsOfTheWeek();
    if (!qs.length) return;
    $('qotw-date').textContent = weekRangeLabel();
    $('week-list').innerHTML = qs.map(function (q) {
      return '<li class="week-q">' +
        '<p class="week-question">' + esc(q.q) + '</p>' +
        '<div class="week-actions">' +
          '<button class="btn btn-go" data-open="' + esc(q.id) + '" type="button">Answer it</button>' +
          '<button class="btn btn-ghost" data-copy="' + esc(q.id) + '" type="button">Copy link</button>' +
        '</div></li>';
    }).join('');
    $('qotw').hidden = false;
  }

  /* ---------------- the whole deck ---------------- */

  function renderAll(filter) {
    var f = (filter || '').trim().toLowerCase();
    var list = QUESTIONS.filter(function (q) {
      return !q.deck && (!f || q.q.toLowerCase().indexOf(f) !== -1);
    });
    var classicCount = QUESTIONS.filter(function (q) { return !q.deck; }).length;
    $('all-sub').textContent = f
      ? list.length + ' of ' + classicCount + ' match “' + filter + '”'
      : 'All ' + classicCount + ', every one of them. Tap any to answer it.';
    $('all-list').innerHTML = list.map(function (q) {
      return '<li><button class="all-q" data-open="' + q.id + '">' +
        '<span class="all-dot" data-d="' + q.d + '" aria-hidden="true"></span>' +
        '<span>' + esc(q.q) + '</span></button></li>';
    }).join('');
  }

  /* ---------------- one question, by link ---------------- */

  function openSingle(q) {
    $('single-card').innerHTML = cardHtml(q, true);
    $('single').hidden = false;
    document.querySelector('main.wrap').hidden = true;
    document.querySelector('.hero').hidden = true;
    fitQuestion($('single-card').querySelector('.q-text'));
    track('sa-linked', q.id, q.d);
    loadTown(q.id, $('single-card').querySelector('[data-town]'));
  }

  /* ---------------- the wheel (opt-in) ---------------- */

  function drawWheel() {
    var n = players.length, w = $('wheel');
    if (n < 2) { w.innerHTML = ''; return; }
    var seg = 360 / n;
    var svg = ['<svg viewBox="0 0 200 200" width="100%" height="100%" aria-hidden="true">'];
    for (var i = 0; i < n; i++) {
      var a1 = (i * seg - 90) * Math.PI / 180, a2 = ((i + 1) * seg - 90) * Math.PI / 180;
      var x1 = 100 + 100 * Math.cos(a1), y1 = 100 + 100 * Math.sin(a1);
      var x2 = 100 + 100 * Math.cos(a2), y2 = 100 + 100 * Math.sin(a2);
      svg.push('<path d="M100,100 L' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' A100,100 0 ' +
        (seg > 180 ? 1 : 0) + ',1 ' + x2.toFixed(2) + ',' + y2.toFixed(2) + ' Z" fill="' +
        WEDGE[i % WEDGE.length] + '" stroke="rgba(11,10,12,.35)" stroke-width="1"/>');
      // Flip the label on the left half or it reads upside down.
      var mid = i * seg + seg / 2 - 90;
      var norm = ((mid % 360) + 360) % 360;
      var flip = norm > 90 && norm < 270;
      var nm = players[i].length > 11 ? players[i].slice(0, 10) + '…' : players[i];
      svg.push('<text x="' + (flip ? 36 : 164) + '" y="100" fill="#14100E" font-size="9" ' +
        'font-weight="600" text-anchor="' + (flip ? 'start' : 'end') + '" ' +
        'dominant-baseline="middle" font-family="DM Sans, system-ui, sans-serif" ' +
        'transform="rotate(' + (flip ? mid + 180 : mid).toFixed(2) + ' 100 100)">' + esc(nm) + '</text>');
    }
    svg.push('</svg>');
    w.innerHTML = svg.join('');
  }

  function renderPlayers() {
    $('players').innerHTML = players.map(function (p, i) {
      return '<span class="player" role="listitem">' +
        '<span class="dot" style="background:' + WEDGE[i % WEDGE.length] + '"></span>' + esc(p) +
        '<button type="button" data-drop="' + i + '" aria-label="Remove ' + esc(p) + '">×</button></span>';
    }).join('');
    save('sa-players', players);
    drawWheel();
    $('wheel-stage').hidden = players.length < 2;
    if (players.length < 2) $('wheel-card').hidden = true;
  }

  function stopTimer() {
    if (tick) { clearInterval(tick); tick = null; }
    $('timer').hidden = true;
  }

  function startTimer() {
    stopTimer();
    if (!timerOn || !current || current._tp) return;
    var left = timerSecs, bar = $('timer-bar'), el = $('timer');
    el.hidden = false; el.classList.remove('urgent', 'up');
    bar.style.transition = 'none'; bar.style.width = '100%';
    requestAnimationFrame(function () {
      bar.style.transition = 'width ' + timerSecs + 's linear, background-color .25s ease';
      bar.style.width = '0%';
    });
    $('timer-left').textContent = left + 's';
    tick = setInterval(function () {
      left -= 1;
      if (left <= 15) el.classList.add('urgent');
      if (left <= 0) { clearInterval(tick); tick = null; $('timer-left').textContent = 'Time.'; el.classList.add('up'); return; }
      $('timer-left').textContent = left + 's';
    }, 1000);
  }

  function showWheelQuestion(item) {
    current = item;
    if (!item) { $('wheel-card').hidden = true; return; }
    var isTalkingPoint = !!item._tp;
    $('wheel-card').classList.toggle('q-tp', isTalkingPoint);
    var d = !isTalkingPoint && DEPTHS.filter(function (x) { return x.slug === item.d; })[0];
    var dep = $('wc-depth');
    dep.textContent = isTalkingPoint ? 'AROUND TOWN THIS WEEK' : d.label;
    dep.classList.toggle('q-tp-kicker', isTalkingPoint);
    if (isTalkingPoint) dep.removeAttribute('data-d'); else dep.setAttribute('data-d', item.d);
    $('wc-text').textContent = isTalkingPoint ? item.text : item.q;
    var source = $('wc-source');
    source.hidden = !isTalkingPoint || !item.url;
    source.innerHTML = source.hidden ? '' : '<a class="q-tp-source" href="' + esc(item.url) +
      '" target="_blank" rel="noopener">from ' + esc(item.sourceName || 'source') + ' ↗</a>';
    $('wheel-card').hidden = false;
    fitQuestion($('wc-text'));
    if (isTalkingPoint) { track('sa-tp-served', 'tp', item.category); stopTimer(); }
    else { track('sa-served', item.id, item.d); startTimer(); }
  }

  function clearLandingEffect() {
    if (landingTimer) { clearTimeout(landingTimer); landingTimer = null; }
    $('wheel-stage').classList.remove('is-settled');
  }

  function showLanding(name, animate) {
    clearLandingEffect();
    $('whose-turn').innerHTML = '<em class="chosen">' + esc(name) + '</em>, you’re up.';
    if (!animate) return;
    /* Reflow is intentional here: it lets rapid spins replace, rather than
       queue, the one short landing treatment. */
    void $('wheel-stage').offsetWidth;
    $('wheel-stage').classList.add('is-settled');
    landingTimer = setTimeout(clearLandingEffect, 520);
  }

  function cancelSpin() {
    if (spinTimeout) { clearTimeout(spinTimeout); spinTimeout = null; }
    spinning = false;
    $('spin-btn').disabled = false;
    $('next-btn').disabled = false;
    clearLandingEffect();
  }

  function spin(then) {
    if (spinning || players.length < 2) return;
    clearLandingEffect();
    spinning = true;
    spinWasHidden = false;
    $('spin-btn').disabled = true; $('next-btn').disabled = true;
    $('whose-turn').innerHTML = '';

    var n = players.length, seg = 360 / n;
    var target = Math.floor(Math.random() * n);
    var centre = (target + 0.5) * seg + (Math.random() - 0.5) * seg * 0.66;
    var wanted = (360 - centre) % 360;
    var atNow = ((rotation % 360) + 360) % 360;
    rotation += 360 * (5 + Math.floor(Math.random() * 3)) + ((wanted - atNow) % 360 + 360) % 360;
    $('wheel').style.transform = 'rotate(' + rotation + 'deg)';

    spinTimeout = setTimeout(function () {
      spinTimeout = null;
      spinning = false;
      $('spin-btn').disabled = false; $('next-btn').disabled = false;
      showLanding(players[target], !spinWasHidden && !document.hidden);
      if (then) then();
    }, 4050);
  }

  function wheelTurn() {
    var live = pool();
    var item = dealOne(live, current && !current._tp ? [current.id] : [], false);
    if (!item) return;
    spin(function () { showWheelQuestion(item); });
  }

  /* ---------------- wiring ---------------- */

  function wire() {
    $('deal-btn').addEventListener('click', renderTrio);

    document.querySelector('.mode-switch').addEventListener('click', function (e) {
      var tab = e.target.closest('.mode-tab');
      if (!tab) return;
      var next = tab.id === 'mode-catchup' ? 'catchup' : 'classic';
      if (next !== mode) setMode(next, true);
    });

    // Cards, the week list, and the full deck all delegate to here.
    document.addEventListener('click', function (e) {
      var reveal = e.target.closest('[data-reveal]');
      if (reveal) {
        var id = reveal.getAttribute('data-reveal');
        var box = reveal.closest('.q').querySelector('[data-town]');
        if (!box) return;
        if (!box.hidden) {
          box.hidden = true;
          reveal.textContent = 'See what the town said';
          return;
        }
        reveal.textContent = 'Hide what the town said';
        track('sa-revealed', id, '');
        loadTown(id, box);
        return;
      }

      var copy = e.target.closest('[data-copy]');
      if (copy) { copyLink(copy.getAttribute('data-copy'), copy); return; }

      var open = e.target.closest('[data-open]');
      if (open) {
        var oid = open.getAttribute('data-open');
        var q = QUESTIONS.filter(function (x) { return x.id === oid; })[0];
        if (q) { history.replaceState({}, '', '?q=' + q.id); openSingle(q); }
        return;
      }

      var h = e.target.closest('[data-heart]');
      if (h && !h.disabled) {
        var hid = h.getAttribute('data-heart');
        hearted[hid] = true; save('sa-hearted', hearted);
        h.disabled = true; h.classList.add('on');
        var span = h.querySelector('span');
        span.textContent = (parseInt(span.textContent, 10) || 0) + 1;
        if (townMode === 'live') rpc('btb_sa_heart', { p_answer: hid, p_voter: visitor }).catch(function () {});
        return;
      }

      var f = e.target.closest('[data-flag]');
      if (f && !f.disabled) {
        var fid = f.getAttribute('data-flag');
        flagged[fid] = true; save('sa-flagged', flagged);
        f.disabled = true; f.textContent = 'reported';
        rpc('btb_sa_flag', { p_answer: fid, p_voter: visitor }).catch(function () {});
      }
    });

    document.addEventListener('submit', function (e) {
      var form = e.target.closest('[data-form]');
      if (!form) return;
      e.preventDefault();
      submitAnswer(form, form.getAttribute('data-form'));
    });

    /* The answer box starts one line tall and grows with what you write, so an
       empty card stays quiet and a long answer still has room. */
    document.addEventListener('input', function (e) {
      var ta = e.target.closest('.ans');
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';

      var form = ta.closest('.q-answer');
      var typed = ta.value.trim().length >= 2;
      form.querySelector('.ans-go').disabled = !typed;
      form.querySelector('.ans-more').hidden = !typed;   // sign it only once there's something to sign
    });

    /* Enter sends; shift-enter makes a new line. */
    document.addEventListener('keydown', function (e) {
      var ta = e.target.closest('.ans');
      if (!ta || e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      var form = ta.closest('.q-answer');
      if (!form.querySelector('.ans-go').disabled) {
        submitAnswer(form, form.getAttribute('data-form'));
      }
    });

    $('depth-chips').addEventListener('click', function (e) {
      var burn = e.target.closest('[data-burn]');
      if (burn) {
        dials.burn = !dials.burn;
        if (dials.burn) round = 0;
        renderDials(); renderTrio();
        return;
      }
      var btn = e.target.closest('[data-depth]');
      if (!btn) return;
      dials.burn = false;
      var d = btn.getAttribute('data-depth');
      var i = dials.depths.indexOf(d);
      if (i === -1) dials.depths.push(d);
      else if (dials.depths.length > 1) dials.depths.splice(i, 1);
      else return;                                  // never let them turn all three off
      renderDials(); renderTrio();
    });

    $('topic-chips').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-topic]');
      if (!btn) return;
      var t = btn.getAttribute('data-topic');
      if (!t) { dials.topics = null; }               // "Anything"
      else {
        var on = (dials.topics || []).slice();
        var i = on.indexOf(t);
        if (i === -1) on.push(t); else on.splice(i, 1);
        dials.topics = on.length ? on : null;
      }
      renderDials(); renderTrio();
    });

    $('open-wheel').addEventListener('click', function () {
      wheelOn = true;
      $('wheel-panel').hidden = false;
      renderPlayers();
      $('wheel-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    $('close-wheel').addEventListener('click', function () {
      wheelOn = false; cancelSpin(); stopTimer();
      $('wheel-panel').hidden = true;
      $('deal').scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    $('open-all').addEventListener('click', function () {
      $('all-panel').hidden = false;
      renderAll('');
      $('all-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    $('close-all').addEventListener('click', function () {
      $('all-panel').hidden = true;
      $('deal').scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    $('all-search').addEventListener('input', function () { renderAll(this.value); });

    $('name-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var n = $('name-input').value.trim();
      $('name-input').value = '';
      if (!n || players.length >= 12) return;
      if (players.some(function (p) { return p.toLowerCase() === n.toLowerCase(); })) return;
      players.push(n);
      renderPlayers();
    });
    $('players').addEventListener('click', function (e) {
      var b = e.target.closest('[data-drop]');
      if (!b) return;
      players.splice(Number(b.getAttribute('data-drop')), 1);
      renderPlayers();
    });

    $('spin-btn').addEventListener('click', function () {
      if (!current) wheelTurn(); else spin();
    });
    $('next-btn').addEventListener('click', wheelTurn);
    $('skip-btn').addEventListener('click', function () {
      if (current && !current._tp) track('sa-passed', current.id, current.d);
      var item = dealOne(pool(), current && !current._tp ? [current.id] : [], false);
      if (item) showWheelQuestion(item);
    });

    $('opt-timer').addEventListener('change', function () {
      timerOn = this.checked;
      $('timer-secs').disabled = !timerOn;
      if (timerOn && current) startTimer(); else stopTimer();
    });
    $('timer-secs').addEventListener('change', function () {
      timerSecs = parseInt(this.value, 10) || 90;
      if (timerOn && current) startTimer();
    });
    $('timer-more').addEventListener('click', function () {
      if (!timerOn || !current) return;
      var keep = timerSecs;
      timerSecs = 30 + (parseInt($('timer-left').textContent, 10) || 0);
      startTimer();
      timerSecs = keep;
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && spinning) spinWasHidden = true;
    });

    $('play-all').addEventListener('click', function () {
      history.replaceState({}, '', location.pathname);
      $('single').hidden = true;
      document.querySelector('main.wrap').hidden = false;
      document.querySelector('.hero').hidden = false;
      $('deal').scrollIntoView({ block: 'start' });
    });
  }

  /* ---------------- go ---------------- */

  fetch('data/questions.json')
    .then(function (r) { return r.json(); })
    .then(function (doc) {
      QUESTIONS = doc.questions;
      var classicCount = QUESTIONS.filter(function (q) { return !q.deck; }).length;
      $('q-total').textContent = classicCount;
      $('all-count').textContent = classicCount;
      $('timer-secs').disabled = true;

      renderDials();
      renderWeek();
      wire();

      var want = new URLSearchParams(location.search).get('q');
      var q = want && want !== 'week'
        ? QUESTIONS.filter(function (x) { return x.id === want; })[0]
        : null;

      if (q) {
        renderMode();
        openSingle(q);
      }
      else setMode(mode, false);
      if (want === 'week') $('qotw').scrollIntoView({ block: 'start' });
    })
    .catch(function () {
      $('trio').innerHTML = '<p class="trio-empty">The deck didn’t load. A refresh usually does it.</p>';
    });
})();
