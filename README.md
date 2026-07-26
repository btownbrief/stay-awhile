# Stay Awhile

A conversation game for Burlington. Deal three questions, ask them out loud,
find out who you're sitting with.

**Live:** https://play.btownbrief.com/stay-awhile/
**Moderation:** https://play.btownbrief.com/stay-awhile/admin.html

Not really an arcade game — it's the one you play at a table with other people,
which is why it's linked from the city guide (under *Eat & Drink & Stay Awhile*)
as well as the arcade.

## How it works

The whole game is: **here are three questions, ask them.** One button deals three
more. No setup screen, no names, nothing to agree to before you can read a
question.

Everything else is a link you can choose to click.

### The dials
Two rows. That is the entire filter surface, deliberately.

- **How deep** — Shallow end / Waist deep / Deep water, plus **the slow burn**,
  which is the fourth setting rather than a mode of its own: it takes the depth
  out of your hands and walks you down as you play (two deals shallow, two waist
  deep, then deep water).
- **About** — five buckets: Burlington, Back then, People, Big questions, Off the
  cuff. The fifteen topic tags in `data/questions.json` are untouched; they just
  roll up to these. Fifteen chips was a filing system, not a filter.

Two things that used to be switches are now just rules, because a rule you don't
have to read beats a switch you have to find:

- **Heavy questions** (grief, death, regret — the `heavy` flag) only appear if
  you've actually asked for **Deep water**.
- **Questions about the room** (the `room` flag — "who here would win on
  Jeopardy?") only appear when the wheel is up with at least two names on it.

### The wheel — opt-in
A quiet link, not the front door. Only when you open it does it ask for names,
because a wheel has to have something to land on. Inside it: one question at a
time, and the optional answer timer for a table big enough that one person can
talk out the whole night.

### The whole deck
"See all 273 questions" reveals the lot, searchable. Tap any one to answer it.

### Questions of the week
Two questions a week, **the same two for the whole town**, Monday to Sunday — one
for each edition of the Brief.

It's a fixed shuffle of the deck walked two steps a week. Room questions sit it
out (they need a table and a "me"), which leaves 251 — odd, so stepping by two
cycles through every question before any repeats — about two and a half years
of Mondays. Deterministic, so there's nothing to store and no cron job to forget
about.

It's also what stops the community answers looking dead: without it, answers
spread so thin across 273 cards that every card reads "nobody has answered this
yet" forever.

### Deep links
`?q=q142` opens any single question on its own with the town's answers already
up — **this is what you put in the newsletter.** Every card has a Link button.
`?q=week` always lands on the current pair.

### Leaving an answer, and reading the town's
Every card carries a **small answer box, always** — one quiet line tall, muted,
with the word *optional* written on it. Nobody has to write anything to play, and
the box has to look like it knows that. It grows as you type; the name field only
turns up once there's something worth signing; Enter sends.

Reading what everyone *else* said is separate, behind **"See what the town said"**
— because reading other people's answers mid-conversation kills the conversation,
which is the entire point of the game. Leaving your own answer opens the town
underneath it, so you see yours land next to theirs.

Answers can be hearted (one per browser); the best float to the top.

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
