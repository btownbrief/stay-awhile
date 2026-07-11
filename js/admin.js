/* Stay Awhile — moderation.

   The passphrase is NEVER checked here. Every admin RPC verifies it
   server-side (btb_sa_is_admin), so reading this file buys an attacker
   nothing. After one successful unlock we keep it in localStorage purely so
   you don't retype it. Same passphrase as the photo admin. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';
  var PASS_KEY = 'sa-admin-pass';

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var pass = '';
  try { pass = localStorage.getItem(PASS_KEY) || ''; } catch (e) {}

  var rows = [];
  var tab = 'flagged';
  var questions = {};   // qid -> text, so you can see what was being answered

  function rpc(fn, args) {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error(t || (fn + ' → ' + res.status));
        });
      }
      return res.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }

  function when(iso) {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  /* ---------------- gate ---------------- */

  function unlock(candidate) {
    return rpc('btb_sa_admin_check', { p_pass: candidate }).then(function (ok) {
      if (!ok) throw new Error('Wrong passphrase.');
      pass = candidate;
      try { localStorage.setItem(PASS_KEY, pass); } catch (e) {}
      $('gate').hidden = true;
      $('board').hidden = false;
      return load();
    });
  }

  function lock() {
    pass = '';
    try { localStorage.removeItem(PASS_KEY); } catch (e) {}
    $('board').hidden = true;
    $('gate').hidden = false;
    $('pass-input').value = '';
  }

  $('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('gate-err');
    err.hidden = true;
    unlock($('pass-input').value.trim()).catch(function (ex) {
      err.textContent = /passphrase|Wrong/i.test(ex.message)
        ? 'Wrong passphrase.'
        : 'Couldn’t reach the database. Has db/stay-awhile.sql been run?';
      err.hidden = false;
    });
  });

  /* ---------------- board ---------------- */

  function visible() {
    if (tab === 'flagged') {
      return rows.filter(function (r) { return r.flags > 0; });
    }
    if (tab === 'hidden') {
      return rows.filter(function (r) { return r.status === 'hidden'; });
    }
    return rows;
  }

  function render() {
    $('n-flagged').textContent = rows.filter(function (r) { return r.flags > 0; }).length;
    $('n-hidden').textContent  = rows.filter(function (r) { return r.status === 'hidden'; }).length;
    $('n-all').textContent     = rows.length;

    var list = visible();
    var box = $('rows');

    if (!list.length) {
      box.innerHTML = '';
      var e = $('empty');
      e.textContent = tab === 'flagged'
        ? 'Nothing has been reported. Quiet night.'
        : tab === 'hidden'
          ? 'Nothing is hidden.'
          : 'No answers yet.';
      e.hidden = false;
      return;
    }
    $('empty').hidden = true;

    box.innerHTML = list.map(function (r) {
      var q = questions[r.qid];
      var isHidden = r.status === 'hidden';
      return '<article class="mod' + (isHidden ? ' is-hidden' : '') +
             (r.flags > 0 && !isHidden ? ' is-flagged' : '') + '">' +
        '<div class="mod-q">' +
          '<a href="./?q=' + esc(r.qid) + '" target="_blank" rel="noopener">' + esc(r.qid) + '</a>' +
          (q ? ' <span>' + esc(q) + '</span>' : '') +
        '</div>' +
        '<p class="mod-body">' + esc(r.body) + '</p>' +
        '<div class="mod-meta">' +
          '<span class="who">' + esc(r.name || 'Anonymous') + '</span>' +
          '<span>' + esc(when(r.created_at)) + '</span>' +
          '<span>♥ ' + r.hearts + '</span>' +
          (r.flags > 0 ? '<span class="flagpill">' + r.flags + ' report' +
                         (r.flags === 1 ? '' : 's') + '</span>' : '') +
          (isHidden ? '<span class="hidpill">hidden</span>' : '') +
          '<span class="mod-actions">' +
            (isHidden
              ? '<button class="linkish" data-show="' + esc(r.id) + '">Restore</button>'
              : '<button class="linkish" data-hide="' + esc(r.id) + '">Hide</button>') +
            '<button class="linkish danger" data-del="' + esc(r.id) + '">Delete</button>' +
          '</span>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function load() {
    return rpc('btb_sa_admin_list', { p_pass: pass }).then(function (data) {
      rows = data || [];
      render();
    });
  }

  function act(promise) {
    return promise.then(load).catch(function (e) {
      if (/passphrase/i.test(e.message)) lock();
      else window.alert('That didn’t work: ' + e.message);
    });
  }

  $('rows').addEventListener('click', function (e) {
    var hide = e.target.closest('[data-hide]');
    if (hide) {
      return act(rpc('btb_sa_admin_set_status', {
        p_pass: pass, p_answer: hide.getAttribute('data-hide'), p_status: 'hidden'
      }));
    }
    var show = e.target.closest('[data-show]');
    if (show) {
      return act(rpc('btb_sa_admin_set_status', {
        p_pass: pass, p_answer: show.getAttribute('data-show'), p_status: 'visible'
      }));
    }
    var del = e.target.closest('[data-del]');
    if (del) {
      if (!window.confirm('Delete this answer for good?')) return;
      return act(rpc('btb_sa_admin_delete', {
        p_pass: pass, p_answer: del.getAttribute('data-del')
      }));
    }
  });

  $('tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-tab]');
    if (!btn) return;
    tab = btn.getAttribute('data-tab');
    [].forEach.call(this.querySelectorAll('[data-tab]'), function (b) {
      b.setAttribute('aria-pressed', String(b === btn));
    });
    render();
  });

  $('refresh').addEventListener('click', function () { act(Promise.resolve()); });
  $('lock').addEventListener('click', lock);

  /* ---------------- go ---------------- */

  // Pull the questions so a row shows what was actually being answered, not
  // just an opaque id.
  fetch('data/questions.json')
    .then(function (r) { return r.json(); })
    .then(function (doc) {
      doc.questions.forEach(function (q) { questions[q.id] = q.q; });
      if (rows.length) render();
    })
    .catch(function () {});

  if (pass) {
    unlock(pass).catch(function () { lock(); });
  }
})();
