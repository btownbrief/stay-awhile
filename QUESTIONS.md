# What a Stay Awhile question sounds like

The deck got a full editorial pass in July 2026 after the questions started to
feel off — most of them a little, some of them a lot. Two independent reviews
(Claude Fable 5 and GPT-5.6 via Codex) converged on the same diagnosis. This
file is the distillation, so every future question gets held to it.

## The one-line test

A good card nearly disappears once somebody starts answering. If the card is
more present than the conversation — if you can hear the writer — it's wrong.

## The rules

1. **The person answering is the subject.** Not society, not humanity, not
   parenting, prisons, war, or "people these days." A question about the world
   produces a mini-editorial; a question about the person produces the game.
   ("Should voting be mandatory?" is a radio call-in. "When did you know it was
   time to leave — a job, a place, a person?" is a conversation.)

2. **Ask for a scene, not a thesis.** Prefer *when did… / what happened… /
   who taught you…* over *is… / should… / can people…*. The answer should be a
   story or a specific detail — a smell, a scar, a paycheck, a snowstorm.

3. **No stage directions.** Never end a question with a command: *Be honest.
   Go. Defend it. Admit it. Prove it. Say it out loud. Show the room.* The bark
   says "I don't trust you to be interesting," which is the opposite of the
   game's premise. The question carries the fun or it doesn't.

4. **No truth-policing.** Strip *actually, genuinely, honestly, really,
   properly* unless the word is doing real work (rare — "Do you actually go to
   the farmers market, or do you just intend to?" earns its *actually*; most
   don't). A card that arrives suspicious of the player sours the table.

5. **Invitations, not dares.** Nothing that forces a performance or an
   exposure on the spot — impressions on command, reading your screen time
   aloud, showing the room your texts. If a reveal is the fun, frame it so the
   player chooses it ("…and would you read it out loud?").

6. **Depth is invited, never extracted.** Deep water is opt-in, so deep
   questions can be pointed — but they must leave the answerer in control of
   the story and its stakes. "What was the hardest stretch of your life?"
   invites. "When did you last feel like a genuinely bad person?" prosecutes.
   Never directly demand grief, shame, body insecurity, or an unresolved
   grievance.

7. **An ordinary answer must be able to win.** Nobody should need a dramatic
   childhood, an impressive skill, or a clever hot take to answer well. Prefer
   *a meal you still think about* over *the most delicious thing you have ever
   eaten* — superlatives demand a definitive answer where a particular one is
   better. (Superlatives are fine for light local fights: best breakfast in
   Chittenden County is allowed to be a fight.)

8. **It has to sound like a Burlington person talking.** American speech, read
   aloud before it goes in. No *queued, expiry, colour, humour, holiday*-for-
   vacation, no ESL-textbook debate prompts, no imported icebreaker-deck
   material. Local questions use Burlington as lived terrain (creemee stands,
   mud season, the Flynn), not as an authenticity test.

9. **Room questions tease with affection.** Rankings are fine when they're
   about whimsy and talent (who'd win on Jeopardy, who'd last longest in the
   woods) — never about trust, virtue, or guilt rankings that leave someone at
   the table visibly unchosen.

10. **Don't assume a life path.** No required children, marriage, living
    parents, particular age, or particular decade of pop culture. (This is what
    was wrong with the 9/11 question — it hands anyone under thirty nothing.)

11. **One clean question.** A second clause is allowed only when it turns the
    answer into a story ("— and how did that go?"), not when it's a second
    question wearing a trench coat.

12. **The thirty-second test.** Say the question out loud and imagine the
    quietest person at the table. If their honest answer is one word with
    nowhere to go (smartest animal, sleeping position, allergies), it's
    inventory, not conversation — cut it.

## Mechanical constraints

- The classic deck count no longer has to be odd. That rule existed because the
  question of the week used to be a *pair*, stepping through a fixed shuffle two
  at a time, where an even count would have split the deck into two halves and
  only ever shown one of them. It's one question a week now, stepping one at a
  time, which cycles the whole deck at any count. Add questions freely.
- New classic questions take sequential ids after the current highest classic
  id (the ford deck owns q401+). Never reuse a retired id: community answers in
  Supabase are keyed by qid.
- `heavy` questions must be `deep`. `room` questions must make sense with the
  wheel up and at least two names on it.
