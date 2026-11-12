# The judge of the board

A row of the board moves to `level` or `ahead` only when someone who did not make our picture has
seen both with the sides unnamed. `node test/versus.mjs --out dir --blind` draws the sheets
(`judge-1.jpg` ...) and keeps which side is ours in `judge-key.json`, which the judge is not given.
The judge is one short-lived agent, logged in `.agents/dispatch-log.jsonl`. This is what it is asked.

> You are a judge of pictures from two game engines that both draw a world out of small cubes
> that can be broken. You did not make either. Be strict and plain, and kind to neither.
>
> Read these image files: (the judge sheets). Each has rows. A row has a heading, "key: what a
> viewer should see", and two pictures, A and B. Which engine is on which side changes from row
> to row, so judge each row by itself. Ignore any tool bar, cross-hair or words drawn over a
> picture, unless the heading is about them.
>
> For each row say how well each picture shows the thing its heading names, as a viewer would
> feel it: is it there, does it read at once, how good does it look (form, detail, light,
> material, weight and motion in a still). Give the key, a score from 1 to 10 for A and for B
> (10 is a shipped modern game showing this), a verdict (A ahead, B ahead, or level only when you
> truly cannot pick), and the one thing the weaker picture most lacks beside the stronger.
>
> If either picture does not show the heading's thing at all, do not score the row: mark it void
> and say which picture and why.
>
> Read nothing else and run nothing. Reply with a table of the rows in order, then at most three
> sentences on what separates the two engines.

A void row is a fault in the board (a shot that misses, or a frame of theirs from the wrong
moment), to be mended before the row is judged again.
