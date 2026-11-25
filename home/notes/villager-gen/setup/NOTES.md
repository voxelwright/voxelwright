# Villager setup: ui-craft rounds

Captures come from `node scripts/villagers/check-setup.mjs --shots=<dir> [--viewport=WxH]`
(stub host, `&from=code-1` for the made villager). Each round has `wide/` (1440x900),
`narrow/` (390x844) and `tablet/` (1024x768). Moments: `1-empty`, `1b-picked` (a pattern
card picked, added in round 3), `2-waiting`, `3-tuning`, `4-pattern`, `5-walking`.

Self-scores are the builder's own, 1 to 10. The council (Opus and Sol) scores the final round.

## Round 2 (council)

| | belongs | clarity | hierarchy | craft | delight |
| --- | --- | --- | --- | --- | --- |
| wide | 8 / 8 | 6 / 5 | 7 / 7 | 6 / 8 | 8 / 8 |
| narrow | 7 / 8 | 4 / 3 | 4 / 4 | 4 / 6 | 6 / 7 |

## Round 3 (self)

| | belongs | clarity | hierarchy | craft | delight |
| --- | --- | --- | --- | --- | --- |
| wide | 8 | 8 | 8 | 7.5 | 8 |
| narrow | 8 | 7.5 | 7.5 | 7 | 7 |

What changed:

- Phone layout recomposed. The tools sit in one row before three ribbons; their tags hang
  below the table's edge on threads, in two columns; the name tag heads the screen; save
  and send-off sit in the bottom corners. Before there is a villager the camera frames the
  rack and the mat and the slip lies on the near half of the table.
- One tag system: every label is the same paper tag (handwriting), active and focus are the
  same lifted tag with a stitched blue edge; speech, status and the slip's example use the
  book face. Two typefaces in the page.
- Each tool tag names the tool and its two ends with a bead for the current value; the colour
  tag shows the rail's end threads (the old "cooler/warmer" words were wrong for warm felts);
  the jokes tag inks the current step and strikes out a locked "crude". Ribbons are labelled
  at both ends; the metronome moved so nothing covers them. Quiet tags show on the empty
  table (wide).
- Pattern cards are bigger, sit behind the mat, and carry their names as page text; a picked
  card stands up out of the rack and its felt card, big, is clipped to the slip. The name tag
  says which pattern a villager came from.
- Waiting: the pattern is made on the mat, one piece every 4.5 s: chalked on a felt sheet, cut
  along the chalk, laid in a row and pinned. No percentage.
- The slip lies on the mat (wide, empty), moves to the near edge while the mat is busy, and
  lifts away as stitching starts, so nothing ghosts over the pattern moment. The example
  text is printed (book face, grey, "e.g.") so it never reads as typed.
- Walk-off: the camera follows the villager for about nine seconds. The red in round 2 was
  the check's own colour test (hue at 0.2); the check now puts the colour back before the
  send-off.
- check-setup gates layout at every capture: every visible label on screen, none overlapping.

Known in round 3: the wide walk-off camera looks through a floor lamp; the picked pattern's
felt card covers two rack cards on wide; tablet 1-empty has the slip over two ribbon tags
(the layout gate failed there, 59 of 61); the wide run hit a 30 s timeout under load after
its captures (fixed in the check by waiting for the send-off to finish, not a fixed delay).

## Round 4 (self)

| | belongs | clarity | hierarchy | craft | delight |
| --- | --- | --- | --- | --- | --- |
| wide | 9 | 8.5 | 8.5 | 8 | 8.5 |
| narrow | 8.5 | 8.5 | 8.5 | 8 | 8 |

Tablet (1024x768) uses the wide layout and reads about the same as wide.

What changed:

- The picked pattern's felt card is stitched across the top of the slip instead of floating
  over it, and the slip on the mat keeps below the rack and left of the ribbons' tags, so
  nothing covers the cards. Quiet preview tags under the slip are hidden, as paper would hide them.
- Save and send-off sit in the bottom corners at every size.
- Walk-off: the camera watches from high and in front, over the chairs and the reading lamp,
  and the villager does its counter chore first, so it walks across open floor in view.
- Phone, empty table: the ribbons' end labels preview; the hanging tool tags wait for a villager.
- check-setup: 61 of 61 at 1440x900, 390x844 and 1024x768, layout gate clean at every moment.

Still short of 9: the tags' second line (ends and bead) is 13 to 14 px, readable but small;
the waiting pieces are small at wide; on the phone the empty and waiting moments leave a band
of rug between the table and the slip; the colour slider's screen-reader text says "turned one
way" and should name the end colours.

Stopped after this round on time, below the bar of 9 in craft and delight.

## Round 5 (self, after the council's round 4)

Council round 4, belongs/clarity/hierarchy/craft/delight: Opus wide 8/7/7/7/8, tablet
8/7/6/7/8, phone 7/6/7/6/7; GPT-6.1 Sol wide 8/7/7/7/8, tablet 8/6/7/7/8, phone 6/5/5/6/7.

| | belongs | clarity | hierarchy | craft | delight |
| --- | --- | --- | --- | --- | --- |
| wide | 9 | 8.5 | 8.5 | 8.5 | 8.5 |
| tablet | 8.5 | 8 | 8 | 8 | 8 |
| narrow | 8.5 | 8.5 | 8.5 | 8 | 8 |

What changed:

- Phone, tuning: no more threads. The villager stands at the back of the mat, then the
  three ribbons, then two rows of three tools, each tag lying just under its own tool; the
  camera looks at the villager's feet so the tools fill the lower screen and nothing is cut
  off at the sides.
- Phone, empty and waiting: the tools stay off the table until there is a villager, so the
  screen shows only the rack, the mat and the slip, framed down to the slip with no band of rug.
- The slip says "Describe them, or pick a pattern card. You tune them once they are sewn."
  (no "then Enter"). With a pattern picked it says how the two combine ("Your words say who
  they are; Calm coach sets how they talk"), and the pattern's felt card is one line.
- Pattern cards: every capture runs as an adult (Jo, or Alex), so the rack shows the same five
  throughout. The 4-vs-5 difference in round 4 was the captures using two profiles.
- Waiting: the tissue pattern sheet with the words lies on the mat beside the cutting, and the
  progress is a small paper tag at the mat's front instead of the whole slip under the table.
- Tuning: the other pattern cards lie down in the rack so the villager no longer stands in
  front of them; the card it was made from stands at the rack's right end, and the name tag
  carries a strip of that card's felt.
- Speech: a small paper note as wide as its words (at most 280 px, 250 on a phone), slightly
  turned; words are pencilled faintly first and inked as they are said, so it is never an
  empty box.
- Walk-off: the note from the tuning is cleared on the send-off, so nothing see-through sits
  over the fridge; only a small "Make another" tag shows until it is opened or the camera
  comes back to the table.
- Scarf: the prompt now asks for the tails to hang to one side, never down the middle (the
  example module does it). Not fixed in the trusted felt pass; the captures still use round
  1's Brindle (`&from=code-1`), whose centred red tail still reads as a tongue.

check-setup: 66 of 66 at 1440x900, 1024x768 and 390x844, layout gate clean at every moment.

Still short of 9: on the tablet the slip on the mat still covers the spools and the
xylophone, the tools are small and a band of rug shows under the table; the phone's villager is large and seen from above, and the warmth ribbon
sits under its front; the tape measure is small on the phone; the scarf tail on the fixture;
saving a pattern adds a card to the rack but the card does not visibly pop up. Stopped after
one round on time.

## Round 6 (self, after the council's round 5)

Council round 5, belongs/clarity/hierarchy/craft/delight: Opus wide 8/8/7/7/8, tablet
8/7/6/6/8, phone 7/7/6/6/7; GPT-6.1 Sol wide 9/7/8/8/8, tablet 9/7/7/8/8, phone 8/6/6/7/8.

Scored stricter than before (my round-5 scores ran 1 to 1.5 above the council's):

| | belongs | clarity | hierarchy | craft | delight |
| --- | --- | --- | --- | --- | --- |
| wide | 8 | 8 | 7.5 | 7 | 8 |
| tablet | 8 | 8 | 7.5 | 7.5 | 8 |
| narrow | 8 | 7.5 | 7.5 | 7 | 7.5 |

What changed, by the council's points:

1. Framing. The villager's bounds are measured as it is stitched. Wide, the camera tilts up and
   then steps back until the villager sits between room for the speech note and the tool row.
   Tablet and phone keep the tools' size and show a big villager smaller while it is on the bench
   (down to two fifths), and it grows to its tuned size during the hop down; `state().scale` is
   still the tuned size. The phone camera is lower (slope 0.8, not 1.25), so it sees the face, and
   the villager stands nearly square to it. The speech note stands on the top of the bounds (ears
   and hats included); the name tag is at the top left at every size. Checked with the tortoise,
   the stub's tall dog and the heron (`--from=code-4`).
2. Tablet and phone. Before there is a villager only a roomy wide screen (aspect 1.5 or more) keeps
   the tools on the table, so the slip covers nothing. The phone's ribbons and tool rows moved toward
   the near edge, to make room for the villager behind them.
3. Gestures. Each tool shows a dashed thread-blue arrow (along its axis for a drag, round it for
   the key and the dial) and nudges itself once, on hover or focus, and in turn for each tool as the
   tools come out. Tapping a xylophone bar or a spool sets it there.
4. Waiting. Wide and tablet, the camera closes in on the mat; the cut pieces and the tissue sheet's
   handwriting (now 0.72 of its size) are readable. A phone keeps the sheet aside. The seconds are a
   small 14 px tag. While the mat is busy the rack's names are painted on the cards, not page text.
5. Pattern cards. Wide, the cards are as large as fit about a metre (1.22 times for five). A phone's
   rack is a two-step stand, three cards on the raised back step, the rest in front, each about 1.2
   times the old size. The slip keeps its tab clear of the raised card and stays above the tools.
   The card the villager was made from, and a just-saved card, stand at the rack's right end, clear of
   the fruit bowl; a saved card drops in from above with a bounce and a stitched green "saved" tag
   (new capture `4b-saved`). The "Kept as a pattern" note is now read out only, so it no longer covers
   the speech note.
6. Walk-off. It was walking, not floating: the high camera let the shell hide its feet and shadow.
   The contact shadow now reaches past the body (`root.userData.footprint`, used by `stepCrowd`), the
   camera watches from the front left at about 1.1 m, looking toward the counter, its first chore,
   for 11 s, and the reading lamp stays out of frame.
7. First decision. Before a villager exists the tool tags are hidden at every size; the screen
   offers only the slip and the pattern cards.

Gate: check-setup's layout gate now also fails a tag, the name, the speech note or the corner tags
over the villager's projected bounds, and any tool lying under the slip. 68 of 68 at 1440x900,
1024x768 and 390x844.

Still weak: wide tuning tilts up far enough that the pendant lamp's shade enters the top of the
frame; on the phone a tall villager (the heron) is shrunk to about two fifths because the name tag
and speech note reserve the top 180 to 215 px; the gesture nudge only shows in motion, so stills show
the arrows alone; the waiting close-up on wide cuts the cards' tops, and laid pieces overlap; the
phone's back step is a plain wooden block; the tortoise fixture's legs stay hidden under its shell
while it walks. No council round was run on round 6.
