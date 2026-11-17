// Vox Sentence. Vox Sign 2 with a lowercase, so a heading can be a sentence and not a shout.
// Capitals are seven cells tall, the x-height is five, descenders hang two below the baseline.
// Lowercase is four cells wide where capitals are five, so words set close and lines stay short.
// A row above the cap line is kept free for accents (and for Ї and Й when Cyrillic comes).

import { makeFont, registerFont } from './index.js';
import { CAPS, DIGITS, MARKS } from './sign.js';

// In mixed case a one-cell I is an l. Here the capital I carries bars.
const CAP_I = `
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
#...#
#...#
#.#.#
#.#.#
.#.#.

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
  src: CAPS + CAP_I + DIGITS + MARKS + LOW_MARKS + LOWER,
  kern: { LT: -2, LY: -2, "L'": -2, rn: 0, rm: 0 },
}));
