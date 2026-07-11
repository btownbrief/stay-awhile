-- ============================================================
-- STAY AWHILE — one-time Supabase setup
--
-- Run this ONCE in the SQL editor of the shared Btown games project
-- (jnouvwxomrcffqwilqkq). Until you do, the game works fine — answers
-- just save to the player's own device and the page says so.
--
-- Same shape as db/quick-wins.sql in the guide repo: tables have RLS on
-- with NO policies, so the anon key can't touch them directly. Everything
-- goes through security-definer RPCs, which are the only things granted
-- to anon. That way the rules below can't be bypassed from the browser.
--
-- MODERATION, and why it isn't a queue:
--   The whole point of the feature is "reveal what other people said", so
--   answers appear immediately — a pending queue would make the reveal
--   permanently empty. Instead:
--     * hard caps + a slur filter + rate limiting, enforced server-side
--     * any reader can report an answer; TWO reports auto-hide it
--     * you can hide anything by hand:
--         update btb_sa_answers set status = 'hidden' where id = '…';
--   To see what's been reported but is still up:
--     select * from btb_sa_answers where flags > 0 and status = 'visible';
-- ============================================================

-- ---------- tables ----------

create table if not exists btb_sa_answers (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  qid        text not null,                       -- 'q001' etc, from data/questions.json
  name       text,                                -- optional; blank means Anonymous
  body       text not null,
  voter      text not null,                       -- opaque per-browser id, for rate limiting
  flags      int  not null default 0,
  status     text not null default 'visible'      -- visible | hidden
);
alter table btb_sa_answers enable row level security;   -- no policies: RPC-only

create index if not exists btb_sa_answers_qid_idx
  on btb_sa_answers (qid, status, created_at desc);

-- One report per browser per answer. The primary key does the enforcing.
create table if not exists btb_sa_flags (
  answer_id  uuid not null references btb_sa_answers(id) on delete cascade,
  voter      text not null,
  created_at timestamptz not null default now(),
  primary key (answer_id, voter)
);
alter table btb_sa_flags enable row level security;      -- no policies: RPC-only

-- ---------- read ----------

create or replace function btb_sa_list(p_qid text)
returns table (id uuid, name text, body text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select a.id, a.name, a.body, a.created_at
  from btb_sa_answers a
  where a.qid = p_qid
    and a.status = 'visible'
  order by a.created_at desc
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
  -- subtler is what the report button and your own eyes are for.
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
