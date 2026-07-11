-- ============================================================
-- STAY AWHILE — one-time Supabase setup
--
-- Run this ONCE in the SQL editor of the shared Btown games project
-- (jnouvwxomrcffqwilqkq). Until you do, the game works fine — answers just
-- save to the player's own device and the page says so.
--
-- Same shape as db/quick-wins.sql and db/photos.sql in the guide repo: tables
-- have RLS on with NO policies, so the anon key can't touch them directly.
-- Everything goes through security-definer RPCs, which are the only things
-- granted to anon. That way the rules below can't be bypassed from a browser.
--
-- MODERATION, and why it isn't a queue:
--   The whole point of the feature is "reveal what other people said", so
--   answers appear immediately — a pending queue would make the reveal
--   permanently empty. Guardrails instead:
--     * hard caps + a slur filter + rate limiting, enforced server-side
--     * any reader can report an answer; TWO reports auto-hide it
--     * admin.html gives you one-click hide/restore (no dashboard needed)
--
-- ADMIN PASSPHRASE: this reuses the one photos.sql already set, in the
-- btb_photo_admin table — one passphrase across the Btown admin pages rather
-- than a third one to remember. If you never ran photos.sql, admin.html simply
-- won't unlock; see the bottom of this file for how to set one anyway.
-- ============================================================

-- ---------- tables ----------

create table if not exists btb_sa_answers (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  qid        text not null,                       -- 'q001' etc, from data/questions.json
  name       text,                                -- optional; blank means Anonymous
  body       text not null,
  voter      text not null,                       -- opaque per-browser id, for rate limiting
  hearts     int  not null default 0,
  flags      int  not null default 0,
  status     text not null default 'visible'      -- visible | hidden
);
alter table btb_sa_answers enable row level security;   -- no policies: RPC-only

create index if not exists btb_sa_answers_qid_idx
  on btb_sa_answers (qid, status, hearts desc, created_at desc);

-- One report per browser per answer. The primary key does the enforcing.
create table if not exists btb_sa_flags (
  answer_id  uuid not null references btb_sa_answers(id) on delete cascade,
  voter      text not null,
  created_at timestamptz not null default now(),
  primary key (answer_id, voter)
);
alter table btb_sa_flags enable row level security;      -- no policies: RPC-only

-- Same deal for hearts: one per browser per answer.
create table if not exists btb_sa_hearts (
  answer_id  uuid not null references btb_sa_answers(id) on delete cascade,
  voter      text not null,
  created_at timestamptz not null default now(),
  primary key (answer_id, voter)
);
alter table btb_sa_hearts enable row level security;     -- no policies: RPC-only

-- ---------- read ----------

-- Best first, then newest. Hearts are what make the reveal worth scrolling.
create or replace function btb_sa_list(p_qid text)
returns table (id uuid, name text, body text, hearts int, created_at timestamptz)
language sql security definer set search_path = public as $$
  select a.id, a.name, a.body, a.hearts, a.created_at
  from btb_sa_answers a
  where a.qid = p_qid
    and a.status = 'visible'
  order by a.hearts desc, a.created_at desc
  limit 200;
$$;

grant execute on function btb_sa_list(text) to anon;

-- ---------- write ----------

create or replace function btb_sa_submit(
  p_qid text, p_name text, p_body text, p_voter text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_body   text;
  v_name   text;
  v_recent int;
  v_id     uuid;
begin
  -- Shape checks. Anything malformed is a client bug or someone poking.
  if p_qid  is null or p_qid  !~ '^q[0-9]{3,4}$' then
    raise exception 'bad question id';
  end if;
  if p_voter is null or length(p_voter) not between 8 and 64 then
    raise exception 'bad voter';
  end if;

  -- Collapse whitespace, strip control characters, cap the length.
  v_body := btrim(regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]+', ' ', 'g'));
  v_body := regexp_replace(v_body, '\s{2,}', ' ', 'g');
  if length(v_body) < 2   then raise exception 'too short'; end if;
  if length(v_body) > 600 then v_body := left(v_body, 600); end if;

  v_name := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', '', 'g'));
  v_name := nullif(left(v_name, 24), '');

  -- A blunt slur filter. Not a content policy — just the floor. Anything
  -- subtler is what the report button and admin.html are for.
  if v_body ~* '(n[i1]gg|f[a4]gg|k[i1]ke|sp[i1]c\M|tr[a4]nny|c[o0]on\M|retard)' then
    raise exception 'rejected';
  end if;

  -- Rate limit: five answers a minute, thirty an hour, per browser.
  select count(*) into v_recent
  from btb_sa_answers
  where voter = p_voter and created_at > now() - interval '1 minute';
  if v_recent >= 5 then raise exception 'slow down'; end if;

  select count(*) into v_recent
  from btb_sa_answers
  where voter = p_voter and created_at > now() - interval '1 hour';
  if v_recent >= 30 then raise exception 'slow down'; end if;

  -- Don't let the same browser post the same answer twice to one question.
  if exists (
    select 1 from btb_sa_answers
    where qid = p_qid and voter = p_voter and body = v_body
  ) then
    raise exception 'duplicate';
  end if;

  insert into btb_sa_answers (qid, name, body, voter)
  values (p_qid, v_name, v_body, p_voter)
  returning id into v_id;

  return v_id;
end $$;

grant execute on function btb_sa_submit(text, text, text, text) to anon;

-- ---------- heart ----------

create or replace function btb_sa_heart(p_answer uuid, p_voter text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_hearts int;
begin
  if p_voter is null or length(p_voter) not between 8 and 64 then return 0; end if;

  insert into btb_sa_hearts (answer_id, voter)
  values (p_answer, p_voter)
  on conflict do nothing;                 -- one heart per browser, silently

  select count(*) into v_hearts from btb_sa_hearts where answer_id = p_answer;
  update btb_sa_answers set hearts = v_hearts where id = p_answer;
  return v_hearts;
end $$;

grant execute on function btb_sa_heart(uuid, text) to anon;

-- ---------- report ----------

create or replace function btb_sa_flag(p_answer uuid, p_voter text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_flags int;
begin
  if p_voter is null or length(p_voter) not between 8 and 64 then return; end if;

  insert into btb_sa_flags (answer_id, voter)
  values (p_answer, p_voter)
  on conflict do nothing;                 -- one report per browser, silently

  select count(*) into v_flags from btb_sa_flags where answer_id = p_answer;

  update btb_sa_answers
  set flags = v_flags,
      status = case when v_flags >= 2 then 'hidden' else status end
  where id = p_answer;
end $$;

grant execute on function btb_sa_flag(uuid, text) to anon;

-- ============================================================
-- ADMIN — what admin.html talks to.
--
-- One passphrase across the Btown admin pages: the one photos.sql already
-- hashed into btb_photo_admin. Checking through to_regclass means this file
-- still installs cleanly if photos.sql was never run — admin just never
-- unlocks, rather than the whole script exploding.
-- ============================================================

create or replace function btb_sa_is_admin(p_pass text)
returns boolean
language plpgsql security definer stable set search_path = public, extensions as $$
declare ok boolean := false;
begin
  if to_regclass('public.btb_photo_admin') is not null then
    execute 'select exists (select 1 from btb_photo_admin
                            where pass_hash = crypt($1, pass_hash))'
      into ok using coalesce(p_pass, '');
  end if;
  return coalesce(ok, false);
end $$;
revoke all on function btb_sa_is_admin(text) from public, anon, authenticated;

-- Lets admin.html check the passphrase before it stores it locally.
create or replace function btb_sa_admin_check(p_pass text)
returns boolean
language sql security definer stable set search_path = public as $$
  select btb_sa_is_admin(p_pass);
$$;
grant execute on function btb_sa_admin_check(text) to anon;

-- Everything worth looking at: reported first, then hidden, then recent.
create or replace function btb_sa_admin_list(p_pass text)
returns table (
  id uuid, qid text, name text, body text,
  hearts int, flags int, status text, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not btb_sa_is_admin(p_pass) then
    raise exception 'bad admin passphrase' using errcode = '28000';
  end if;

  return query
    select a.id, a.qid, a.name, a.body, a.hearts, a.flags, a.status, a.created_at
    from btb_sa_answers a
    order by
      (a.flags > 0 and a.status = 'visible') desc,   -- reported but still up = act now
      a.flags desc,
      a.created_at desc
    limit 300;
end $$;
grant execute on function btb_sa_admin_list(text) to anon;

-- Hide or restore. Restoring clears the reports, otherwise the next report
-- would trip the two-strike rule again immediately and undo you.
create or replace function btb_sa_admin_set_status(
  p_pass text, p_answer uuid, p_status text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not btb_sa_is_admin(p_pass) then
    raise exception 'bad admin passphrase' using errcode = '28000';
  end if;
  if p_status not in ('visible', 'hidden') then
    raise exception 'bad status';
  end if;

  if p_status = 'visible' then
    delete from btb_sa_flags where answer_id = p_answer;
    update btb_sa_answers set status = 'visible', flags = 0 where id = p_answer;
  else
    update btb_sa_answers set status = 'hidden' where id = p_answer;
  end if;
end $$;
grant execute on function btb_sa_admin_set_status(text, uuid, text) to anon;

-- Gone for good.
create or replace function btb_sa_admin_delete(p_pass text, p_answer uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not btb_sa_is_admin(p_pass) then
    raise exception 'bad admin passphrase' using errcode = '28000';
  end if;
  delete from btb_sa_answers where id = p_answer;
end $$;
grant execute on function btb_sa_admin_delete(text, uuid) to anon;

-- ============================================================
-- IF YOU NEVER RAN photos.sql and admin.html won't unlock, run this once to
-- create the shared admin table and set a passphrase:
--
--   create extension if not exists pgcrypto with schema extensions;
--   create table if not exists btb_photo_admin (
--     id int primary key default 1,
--     pass_hash text not null,
--     constraint btb_photo_admin_one_row check (id = 1)
--   );
--   alter table btb_photo_admin enable row level security;
--   insert into btb_photo_admin (pass_hash)
--   values (crypt('CHOOSE_YOUR_ADMIN_PASSPHRASE', gen_salt('bf')))
--   on conflict (id) do update set pass_hash = excluded.pass_hash;
--
-- ============================================================
-- WHICH QUESTIONS DOES BURLINGTON ACTUALLY WANT TO ANSWER?
--
-- The game fires btb_track_event (from the guide's quick-wins.sql) on every
-- question it deals: 'sa-served', 'sa-revealed', 'sa-answered', 'sa-passed',
-- 'sa-linked'. p_page is the question id, p_variant is its depth. After a
-- month, this ranks them — the top of this list is a Brief issue, and the
-- bottom of it is the cut list:
--
--   select page as qid,
--          count(*) filter (where event = 'sa-served')   as served,
--          count(*) filter (where event = 'sa-answered') as answered,
--          count(*) filter (where event = 'sa-passed')   as passed,
--          round(100.0 * count(*) filter (where event = 'sa-answered')
--                      / nullif(count(*) filter (where event = 'sa-served'), 0), 1)
--            as answer_rate
--   from btb_events
--   where event like 'sa-%'
--   group by page
--   having count(*) filter (where event = 'sa-served') >= 20
--   order by answer_rate desc nulls last;
-- ============================================================
