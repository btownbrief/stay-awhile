# Stay Awhile

A conversation game for Burlington. Spin the wheel, land on someone, ask them
something that isn't small talk.

**Live:** https://play.btownbrief.com/stay-awhile/
**Moderation:** https://play.btownbrief.com/stay-awhile/admin.html

Not really an arcade game — it's the one you play at a table with other people,
which is why it's linked from the city guide (under *Eat & Drink & Stay Awhile*)
as well as the arcade.

## How it works

### The deck
311 questions in `data/questions.json`, each tagged with a depth (`light` /
`warm` / `deep`), one or more topics, and flags:

- `room` — asks about the people physically present ("who here would win on
  Jeopardy?"). Automatically excluded when fewer than two players.
- `heavy` — grief, death, regret, real pain. The *Skip the heavy ones* switch
  takes these out.
- `long` — needs a proper five-minute story. *Quick answers only* drops these.

37 of the questions are Burlington/Vermont specific; **Burlington only** in the
filters gives you nothing but those.

### The wheel
An SVG wheel of whoever's at the table. It picks who answers. Two players
minimum; solo mode drops the wheel and just deals cards.

### The slow burn
Opt-in, from the setup screen. Instead of honouring the depth filter, it starts
you in the shallow end and walks you down:

| Question | Depth |
|---|---|
| 1–4 | Shallow end |
| 5–10 | Waist deep |
| 11+ | Deep water |

Nobody picks "deep water" from a cold start. They'll happily *arrive* there
twenty minutes in. A pass doesn't advance the burn — only a real turn does.

### Questions of the week
Two questions a week, **the same two for the whole town**, Monday to Sunday —
one for each edition of the Brief.

It's a fixed shuffle of the deck walked two steps a week. 311 is odd, so
stepping by two cycles through every question before any repeats — about three
years of Mondays. It turns over at local midnight on Monday. Because it's
deterministic there's nothing to store, nothing to schedule, and no cron job to
forget about.

This is also what stops the community answers looking dead: without it, answers
spread so thin across 311 cards that every card reads "nobody has answered this
yet" forever. Two questions a week concentrate them.

### Deep links
`?q=q142` opens any single question on its own, with the town's answers already
expanded — **this is what you put in the newsletter.** Every card has a **Copy
link** button, including the two on the weekly panel.

`?q=week` is the set-and-forget address: it always lands on whatever the current
pair happens to be.

### The town
Other people's answers to the same question, behind a deliberate "See what the
town said" click. It's opt-in because reading them mid-game kills the
conversation, which is the entire point of the game. Answers can be hearted
(one per browser); the best float to the top.

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
| [`admin.html`](admin.html) | One-click hide / restore / delete |

**`admin.html`** opens with *Needs a look* — anything that's been reported but is
still public. It uses **the same passphrase as the photo admin** (the one
`photos.sql` hashed into `btb_photo_admin`), so there's no third password to
remember. The passphrase is never checked in the browser: every admin RPC
verifies it server-side, so reading the page source buys nothing.

If you never ran `photos.sql`, admin won't unlock — the bottom of
`db/stay-awhile.sql` has the three statements that fix that.

Tables have RLS on with **no policies**, so the anon key can't read or write
them directly — everything goes through security-definer functions, and those
are the only things granted to `anon`.

## Which questions does Burlington actually want to answer?

Every question the game deals fires `btb_track_event` (already installed by the
guide's `quick-wins.sql`): `sa-served`, `sa-revealed`, `sa-answered`,
`sa-passed`, `sa-linked`. The question id goes in `p_page`, its depth in
`p_variant`.

After a month, the query at the bottom of `db/stay-awhile.sql` ranks every
question by the share of people who, having been shown it, actually answered it.
The top of that list is a Brief issue in itself. The bottom of it is the cut
list.

## Editing the questions

`data/questions.json` is generated, but it's plain JSON and safe to hand-edit.
Keep the shape:

```json
{ "id": "q312", "q": "The question?", "d": "warm", "t": ["btown"], "f": [] }
```

`id` must match `^q[0-9]{3,4}$` — the SQL validates it, and answers are keyed to
it, so **never renumber an existing question**. Adding to the end is free.

Note that adding questions reshuffles the questions-of-the-week running order
(the shuffle is seeded over the whole deck), which is harmless — it just means
next week's pair changes. Answers already posted stay attached to their question,
because they're keyed on the id, not the position.

## Local

No build step. It's a static page.

```sh
python3 -m http.server 8000
# → http://localhost:8000
```
