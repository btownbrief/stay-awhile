# What a Stay Awhile talking point sounds like

Talking points are the Catch Up deck — "around town this week" cards curated
from the Btown Brief's local news. They're chatter fuel for a table of people
catching up, not news delivery. `QUESTIONS.md` governs the main deck; this file
governs `data/talking-points.json`. Whoever refreshes the file — person or
scheduled agent — holds every point to this.

## The shape

One or two sentences of **concrete local fact**, then a **question aimed at
the listener's own life** — their experience, opinion, or speculation. The
fact carries the news so nobody needs to have read it; the question makes it
about the person sitting there.

> Kountry Kart is doing late-night again. What's your order?
> A Malletts Bay couple has found five thousand objects on the bottom of Lake
> Champlain. What do you figure is still down there?

## The rules

1. **Never quiz the table on the news.** "Did you catch that story?" and "Did
   you hear about that one?" test readership — and the person Catch Up mode
   exists for is the one who *didn't* read it. ("Did you hear…?" as an opener
   is fine; that's how people talk. As the ender, it's a dead end.)
2. **The question lands on the listener.** Their order, their guess, the shop
   *they'd* miss — never "isn't that interesting?"
3. **Every point gets a question.** A bare fact is a headline, not an opener.
4. **Concrete numbers and names beat vibes.** "Sixty-one years" and "number
   six" are the fun. No "all of it", no "— big, if true" energy, no
   newscaster taglines ("Feels like the end of an era?"). Name the person —
   "a Vermont filmmaker", never "some guy".
5. **Give the quiet person somewhere to start.** No bare yes/no enders
   ("Road trip?", "Would you go?", "Agree or not?") — put an object or a
   choice in the question: "Which stand gets your first stamp?"
6. **Selection:** stories qualify if a table can enjoy them — openings,
   closings, milestones, oddities, local heroes, lake lore, food, sports,
   civic surprises with a wow number. **Never:** deaths and tragedies,
   electoral politics, crime with victims, anything that turns the table
   somber or partisan. Single-day events don't qualify (they expire before
   the file updates); festivals and openings with a week-plus window do.
7. **Shelf life.** Every point carries `"added": "YYYY-MM-DD"`. Six weeks is
   the hard cap; when the file runs over ~22 points, trim anything past four
   weeks first. Retire event previews the day after the event, and retire
   anything events have overtaken (a team "making a playoff run" reads wrong
   the day the run ends — prefer phrasings that survive the outcome). Keep
   the file at 18–26 points.
8. **One point per story**, and don't add a new point that asks the same
   follow-up as an existing one.
9. **Say it out loud** in a normal voice before it goes in. If it sounds like
   a card, a caption, or a quiz host, rewrite it.
10. **A talking point is not a deck question.** If it works with the news
   removed ("where would you take a tourist?"), it belongs in
   `data/questions.json` under the QUESTIONS.md doctrine — or nowhere.

## Mechanics

- Fields: `text`, `url` (the edition's post URL), `sourceName` (always
  "the Btown Brief"), `added` (date the point entered the file). The app
  ignores unknown fields, so `added` is safe.
- Update the top-level `updated` date and the covered-editions `note` when
  refreshing.
- Refresh lands as a PR, never a direct push to main. Merge is Stephen's call.
