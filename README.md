# Stay Awhile

A conversation game for Burlington. Spin the wheel, land on someone, ask them
something that isn't small talk.

**Live:** https://play.btownbrief.com/stay-awhile/

Not really an arcade game — it's the one you play at a table with other people,
which is why it's linked from the city guide (under *Eat & Drink & Stay Awhile*)
as well as the arcade.

## How it works

- **The deck** — 311 questions in `data/questions.json`, each tagged with a
  depth (`light` / `warm` / `deep`), one or more topics, and flags:
  - `room` — asks about the people physically present ("who here would win on
    Jeopardy?"). Automatically excluded when fewer than two players.
  - `heavy` — grief, death, regret, real pain. The *Skip the heavy ones* switch
    takes these out.
  - `long` — needs a proper five-minute story. *Quick answers only* drops these.

  37 of the questions are Burlington/Vermont specific. `Burlington only` in the
  filters gives you nothing but those.

- **The wheel** — an SVG wheel of whoever's at the table. It picks who answers.
  Two players minimum; solo mode drops the wheel and just deals cards.

- **The town** — other people's answers to the same question, behind a
  deliberate "See what the town said" click. It's opt-in because reading them
  mid-game kills the conversation, which is the entire point of the game.

## The town's answers (Supabase)

Runs on the shared Btown games project (`jnouvwxomrcffqwilqkq`) via the RPCs in
[`db/stay-awhile.sql`](db/stay-awhile.sql). **Run that SQL once** in the Supabase
SQL editor to switch the shared answers on.

Until you do, the game degrades honestly: answers save to the player's own
device and the page tells them so. Nothing breaks, nothing lies.

### Moderation

Answers appear **immediately** — a pending queue would make "see what the town
said" permanently empty, which defeats the feature. The guardrails instead:

| Layer | What it does |
|---|---|
| Server-side caps | 600 chars, control characters stripped, whitespace collapsed |
| Slur filter | Blunt regex in `btb_sa_submit`; hard-rejects the obvious |
| Rate limit | 5 answers/minute, 30/hour, per browser |
| Dedupe | Same browser can't post the same answer twice to one question |
| Reports | Any reader can report; **two reports auto-hide** an answer |

To hide something by hand:

```sql
update btb_sa_answers set status = 'hidden' where id = '…';
```

To see what's been reported but is still up:

```sql
select * from btb_sa_answers where flags > 0 and status = 'visible';
```

Tables have RLS on with **no policies**, so the anon key can't read or write
them directly — everything goes through security-definer functions, and those
are the only things granted to `anon`.

## Editing the questions

`data/questions.json` is generated, but it's plain JSON and perfectly safe to
hand-edit. Keep the shape:

```json
{ "id": "q312", "q": "The question?", "d": "warm", "t": ["btown"], "f": [] }
```

`id` must match `^q[0-9]{3,4}$` — the SQL validates it, and answers are keyed to
it, so **never renumber an existing question**. Adding to the end is free.

## Local

No build step. It's a static page.

```sh
python3 -m http.server 8000
# → http://localhost:8000
```
