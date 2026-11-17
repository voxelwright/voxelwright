// Vox Sentence. Vox Sign 2 with a lowercase, so a heading can be a sentence and not a shout.
// Capitals are seven cells tall, the x-height is five, descenders hang two below the baseline.
// Lowercase is four cells wide where capitals are five, so words set close and lines stay short.
// A row above the cap line is kept free for accents (and for Ї and Й when Cyrillic comes).

import { makeFont, registerFont } from './index.js';
import { CAPS, DIGITS, MARKS } from './sign.js';
import { UK_CAPS, UK_YI_BARS, UK_LOWER, SHARED_CAPS, SHARED_LOWER } from './ukrainian.js';

// In mixed case a one-cell I is an l, so here the capital I carries bars. The A comes to a point:
// at text sizes the square arch of the sign reads as a box, and a point steps cleanly when redrawn.
const CAP_I = `
A
..#..
.#.#.
#...#
#...#
#####
#...#
#...#

I
###
.#.
.#.
.#.
.#.
.#.
###
`;

export const LOWER = `
a 2
.##.
...#
.###
#..#
.###

b
#...
#...
###.
#..#
#..#
#..#
###.

c 2
.###
#...
#...
#...
.###

d
...#
...#
.###
#..#
#..#
#..#
.###

e 2
.##.
#..#
####
#...
.###

f
.##
#..
###
#..
#..
#..
#..

g 2
.###
#..#
#..#
#..#
.###
...#
.##.

h
#...
#...
###.
#..#
#..#
#..#
#..#

i
#
.
#
#
#
#
#

j
.#
..
.#
.#
.#
.#
.#
.#
#.

k
#...
#...
#..#
#.#.
##..
#.#.
#..#

l
#
#
#
#
#
#
#

m 2
###.##.
#..#..#
#..#..#
#..#..#
#..#..#

n 2
###.
#..#
#..#
#..#
#..#

o 2
.##.
#..#
#..#
#..#
.##.

p 2
###.
#..#
#..#
#..#
###.
#...
#...

q 2
.###
#..#
#..#
#..#
.###
...#
...#

r 2
###
#..
#..
#..
#..

s 2
.###
#...
.##.
...#
###.

t 1
.#.
###
.#.
.#.
.#.
..#

u 2
#..#
#..#
#..#
#..#
.###

v 2
#...#
#...#
.#.#.
.#.#.
..#..

w 2
#.....#
#..#..#
#.#.#.#
#.#.#.#
.#...#.

x 2
#...#
.#.#.
..#..
.#.#.
#...#

y 2
#..#
#..#
#..#
#..#
.###
...#
.##.

z 2
####
...#
.##.
#...
####
`;

// The colon and semicolon sit on the x-height in mixed case.
const LOW_MARKS = `
: 3
#
.
.
#

; 3
#
.
.
#
#
`;

export const sentence = registerFont(makeFont({
  id: 'sentence', name: 'Vox Sentence',
  cap: 7, xHeight: 5, descent: 2, gap: 1, space: 2, lineGap: 4, upper: false, maxKern: 2, kernKeep: 1,
  depth: (scale) => (scale < 3 ? scale : scale - 1), // one cell deep, but never a slab at display sizes
  src: CAPS + CAP_I + DIGITS + MARKS + LOW_MARKS + LOWER + UK_CAPS + UK_YI_BARS + UK_LOWER,
  alias: { ...SHARED_CAPS, ...SHARED_LOWER },
  kern: { LT: -2, LY: -2, "L'": -2, rn: 0, rm: 0, 'T,': 0, 'T.': 0, 'P,': 0, 'P.': 0, 'F,': 0, 'F.': 0, 'Y,': 0, 'Y.': 0, 'V,': 0, 'V.': 0, 'r,': -1, 'r.': -1, 'Г,': 0, 'Г.': 0, 'Т,': 0, 'Т.': 0, 'Р,': 0, 'Р.': 0, 'У,': 0, 'У.': 0, 'Ч,': 0, 'Ч.': 0, 'г,': -1, 'г.': -1, 'т,': 0, 'т.': 0 },
}));
