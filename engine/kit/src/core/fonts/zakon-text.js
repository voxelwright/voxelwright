// Vox Zakon Text. The small companion of Vox Zakon, with the role Vox Sentence has beside Vox
// Block: capitals seven cells tall, a lowercase with x-height five and descenders of two, one
// cell of stroke. Laid flat it is the web font "Vox Zakon Text", for keys, tabs and menu items
// at 20 px; built from voxels, capitals only, it is the board on a narrow screen.
//
// Zakon's own proportions are 700 to 500 (cap height to x-height), which is this grid exactly, so
// the reference was Zakon Regular rasterised at ten cells to the em. At that size its stem
// (102 units) is one cell and its bar (44 units) under half of one, so there is one weight of
// stroke here and no contrast.
//
// Carried over from Zakon, as far as one cell allows:
//   - Beaks. Where a bar ends free it turns down or up one cell: C E F G L S T Z, Б Г Є, г т.
//     T and т hang a serif from both ends of the bar, the Narbut Т.
//   - Feet where a letter stands on one stem: I T Y F P and Г Р Т, i l r f p and г р т ф.
//   - Lowercase stems begin with a flag to the left and the first one ends on a half foot
//     (b d h i j k l m n p r u, and i l stand on a whole foot).
//   - A two-storey a and a two-bowl g, as in Zakon.
//   - Д and Л, д and л are triangles; Д and д stand on a bar with feet below the line.
//   - The Ukrainian lowercase is Zakon's: в г д ж з и к л м н п т are small capitals in build,
//     г is not a turned r, т is a small Т with serifs, б carries its flag, ф runs from ascender
//     to descender.
//   - У and у end in a turn to the left; K and К turn the end of the arm; З is round, 3 is flat
//     topped; the zero is narrow rather than slashed.
//   - ʼ and the curly quotes are comma-shaped, not straight.
//
// Given up: stroke contrast, serifs on letters with two stems (H N U M, н п и ш: at five cells
// wide there is no room beside the stems), horns above the cap line (that row belongs to the
// marks of Ї and Й), diamond dots (a dot is one cell).
//
// Capitals keep the widths of Vox Sign 2 (five cells, with the same exceptions), except the I:
// in mixed case it must carry its serifs, or it is an l, and that makes it three cells where
// Vox Sign 2's post is one. For the board on a narrow screen there is a second id, zakoncaps:
// the same drawings, capitals only (text is set in capitals), with I and Ї as single posts, so
// the two board words are exactly as wide as in Vox Sign 2 and the board fits where it fitted. Д and Ф are seven wide and the 4 is six: their counters must stay
// more than half open at one voxel per cell (capitals and figures are held to that;
// the lowercase is for flat use, as Vox Sentence's is, and a e g в д ф ь я would not pass). Lowercase with a flag is five wide
// where Vox Sentence is four, so text sets about a sixth longer.
//
// The neutral symbols (brackets, arrows, @ $ # % & * _ and the dashes) are Vox Sign 2's own and
// are taken from sign.js; every letter, figure, quote and apostrophe is drawn here.

import { makeFont, registerFont } from './index.js';
import { MARKS as SIGN_MARKS } from './sign.js';

export const TEXT_CAPS = `
A
..#..
.#.#.
#...#
#...#
#####
#...#
#...#

B
####.
#...#
#...#
####.
#...#
#...#
####.

C
.####
#...#
#....
#....
#....
#...#
.###.

D
####.
#...#
#...#
#...#
#...#
#...#
####.

E
#####
#...#
#....
###..
#....
#...#
#####

F
#####
#...#
#....
###..
#....
#....
##...

G
.####
#...#
#....
#..##
#...#
#...#
.###.

H
#...#
#...#
#...#
#####
#...#
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

J
..###
...#.
...#.
...#.
...#.
#..#.
.##..

K
#..##
#.#..
##...
##...
#.#..
#..#.
#...#

L
#....
#....
#....
#....
#....
#...#
#####

M
#...#
##.##
#.#.#
#.#.#
#...#
#...#
#...#

N
#...#
##..#
##..#
#.#.#
#..##
#..##
#...#

O
.###.
#...#
#...#
#...#
#...#
#...#
.###.

P
####.
#...#
#...#
####.
#....
#....
##...

Q
.###.
#...#
#...#
#...#
#...#
#...#
.###.
...##

R
####.
#...#
#...#
####.
#.#..
#..#.
#...#

S
.####
#...#
#....
.###.
....#
#...#
####.

T
#####
#.#.#
..#..
..#..
..#..
..#..
.###.

U
#...#
#...#
#...#
#...#
#...#
#...#
.###.

V
#...#
#...#
#...#
.#.#.
.#.#.
..#..
..#..

W
#...#
#...#
#...#
#.#.#
#.#.#
##.##
#...#

X
#...#
#...#
.#.#.
..#..
.#.#.
#...#
#...#

Y
#...#
#...#
.#.#.
..#..
..#..
..#..
.###.

Z
#####
#...#
...#.
..#..
.#...
#...#
#####
`;

export const TEXT_DIGITS = `
0
.##.
#..#
#..#
#..#
#..#
#..#
.##.

1
.#.
##.
.#.
.#.
.#.
.#.
###

2
.###.
#...#
....#
...#.
..#..
.#..#
#####

3
#####
#..#.
..#..
.###.
....#
#...#
.###.

4
....#.
...##.
..#.#.
.#..#.
#...#.
######
...###

5
.####
.#...
.#...
.###.
....#
#...#
.###.

6
..##.
.#...
#....
####.
#...#
#...#
.###.

7
#####
#...#
...#.
..#..
..#..
.#...
.#...

8
.###.
#...#
#...#
.###.
#...#
#...#
.###.

9
.###.
#...#
#...#
.####
....#
...#.
.##..
`;

export const TEXT_LOWER = `
a 2
.###.
....#
.####
#...#
.####

b
##...
.#...
.###.
.#..#
.#..#
.#..#
.###.

c 2
.###
#..#
#...
#...
.###

d
...##
....#
.####
#...#
#...#
#...#
.####

e 2
.##.
#..#
####
#...
.###

f
..##
.#..
####
.#..
.#..
.#..
###.

g 2
.####
#..#.
.##..
#....
.###.
#...#
.###.

h
##...
.#...
.###.
.#..#
.#..#
.#..#
##..#

i
.#.
...
##.
.#.
.#.
.#.
###

j
..#
...
.##
..#
..#
..#
..#
..#
##.

k
##...
.#...
.#..#
.#.#.
.##..
.#.#.
##..#

l
##.
.#.
.#.
.#.
.#.
.#.
###

m 2
###.#.
.#.#.#
.#.#.#
.#.#.#
##.#.#

n 2
####.
.#..#
.#..#
.#..#
##..#

o 2
.##.
#..#
#..#
#..#
.##.

p 2
####.
.#..#
.#..#
.#..#
.###.
.#...
###..

q 2
.####
#...#
#...#
#...#
.####
....#
...##

r 2
##.#
.##.
.#..
.#..
###.

s 2
.###
#...
.##.
...#
###.

t 1
.#..
####
.#..
.#..
.#..
..##

u 2
##.##
.#..#
.#..#
.#..#
..###

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
#..#
#..#
.##.
#..#
#..#

y 2
#...#
#...#
.#.#.
.#.#.
..#..
..#..
##...

z 2
####
...#
.##.
#...
####
`;

export const TEXT_UK_CAPS = `
Б
#####
#...#
#....
####.
#...#
#...#
####.

Г
#####
#...#
#....
#....
#....
#....
##...

Ґ -1
....#
#####
#....
#....
#....
#....
#....
##...

Д
...#...
..#.#..
..#.#..
.#...#.
.#...#.
.#...#.
#######
#.....#

Є
.####
#...#
#....
###..
#....
#...#
.###.

Ж
#..#..#
#..#..#
.#.#.#.
..###..
.#.#.#.
#..#..#
#..#..#

З
.###.
#...#
....#
..##.
....#
#...#
.###.

И
#...#
#...#
#..##
#.#.#
##..#
#...#
#...#

Й -2
.#.#.
..#..
#...#
#...#
#..##
#.#.#
##..#
#...#
#...#

Ї -2
#.#
...
###
.#.
.#.
.#.
.#.
.#.
###

Л
..#..
..#..
.#.#.
.#.#.
.#.#.
#...#
#...#

П
#####
#...#
#...#
#...#
#...#
#...#
#...#

У
#...#
#...#
.#.#.
.#.#.
..#..
..#..
##...

Ф
...#...
.#####.
#..#..#
#..#..#
.#####.
...#...
..###..

Ц
#...#.
#...#.
#...#.
#...#.
#...#.
#...#.
######
.....#

Ч
#...#
#...#
#...#
.####
....#
....#
....#

Ш
#.#.#
#.#.#
#.#.#
#.#.#
#.#.#
#.#.#
#####

Щ
#.#.#.
#.#.#.
#.#.#.
#.#.#.
#.#.#.
#.#.#.
######
.....#

Ь
#....
#....
#....
####.
#...#
#...#
####.

Ю
#..###.
#.#...#
#.#...#
###...#
#.#...#
#.#...#
#..###.

Я
.####
#...#
#...#
.####
..#.#
.#..#
#...#
`;

export const TEXT_UK_LOWER = `
б
..##
.#..
###.
#..#
#..#
#..#
.##.

в 2
###.
#..#
###.
#..#
###.

г 2
####
#..#
#...
#...
##..

ґ 1
...#
####
#...
#...
#...
##..

д 2
..#..
.#.#.
.#.#.
.#.#.
#####
#...#

є 2
.###
#...
###.
#...
.###

ж 2
#.#.#
#.#.#
.###.
#.#.#
#.#.#

з 2
###.
...#
.##.
...#
###.

и 2
#..#
#..#
#.##
##.#
#..#

й
.##.
....
#..#
#..#
#.##
##.#
#..#

ї
#.#
...
##.
.#.
.#.
.#.
###

к 2
#..#
#.#.
##..
#.#.
#..#

л 2
..#..
.#.#.
.#.#.
#...#
#...#

м 2
#...#
##.##
#.#.#
#...#
#...#

н 2
#..#
#..#
####
#..#
#..#

п 2
####
#..#
#..#
#..#
#..#

т 2
#####
#.#.#
..#..
..#..
.###.

ф
..#..
..#..
.###.
#.#.#
#.#.#
#.#.#
.###.
..#..
..#..

ц 2
#..#.
#..#.
#..#.
#..#.
#####
....#

ч 2
#..#
#..#
.###
...#
...#

ш 2
#.#.#
#.#.#
#.#.#
#.#.#
#####

щ 2
#.#.#.
#.#.#.
#.#.#.
#.#.#.
######
.....#

ь 2
#...
#...
###.
#..#
###.

ю 2
#..##.
#.#..#
###..#
#.#..#
#..##.

я 2
.###
#..#
.###
.#.#
#..#
`;

// The colon and semicolon sit on the x-height in mixed case; quotes and the apostrophe are
// comma-shaped, as Zakon's are.
const TEXT_MARKS = `
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

ʼ
.#
#.

’
.#
#.

‘
#.
.#

“
#.#.
.#.#

”
.#.#
#.#.
`;

// Cyrillic letters that are the Latin shape in Zakon at this size. г is not r, and з is not 3.
export const ZAKON_TEXT_SHARED = { А: 'A', В: 'B', Е: 'E', І: 'I', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', а: 'a', е: 'e', і: 'i', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x' };

// The capitals-only set for the narrow board: I and Ї as posts, as in Vox Sign 2.
const CAPS_POSTS = `
I
#
#
#
#
#
#
#

Ї -2
#.#
...
.#.
.#.
.#.
.#.
.#.
.#.
.#.
`;

// After the first review round. The т lost the serifs that hung from its bar: with them it had
// three downstrokes and read as the italic т, an m. W ends in two points, not a bar. The
// apostrophes are comma-shaped and three cells tall, so they cannot be taken for an acute.
const TEXT_FIXES = `
т 2
#####
..#..
..#..
..#..
..#..

W
#...#
#...#
#...#
#.#.#
#.#.#
#.#.#
.#.#.

’
.#
.#
#.

ʼ
.#
.#
#.
`;

const HAND_PAIRS = { LT: -2, LY: -2, "L'": -2, 'T,': 0, 'T.': 0, 'P,': 0, 'P.': 0, 'F,': 0, 'F.': 0, 'Y,': 0, 'Y.': 0, 'V,': 0, 'V.': 0, 'Г,': 0, 'Г.': 0, 'Т,': 0, 'Т.': 0, 'Р,': 0, 'Р.': 0, 'У,': 0, 'У.': 0, 'Ч,': 0, 'Ч.': 0 };

export const zakoncaps = registerFont(makeFont({
  id: 'zakoncaps', name: 'Vox Zakon Text Caps',
  cap: 7, descent: 1, gap: 1, space: 3, lineGap: 3, upper: true, maxKern: 2, kernKeep: 1,
  depth: (scale) => (scale < 3 ? scale : scale - 1),
  src: SIGN_MARKS + TEXT_MARKS + TEXT_CAPS + TEXT_DIGITS + TEXT_UK_CAPS + TEXT_FIXES + CAPS_POSTS,
  alias: { А: 'A', В: 'B', Е: 'E', І: 'I', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X' },
  kern: HAND_PAIRS,
}));

export const zakontext = registerFont(makeFont({
  id: 'zakontext', name: 'Vox Zakon Text',
  cap: 7, xHeight: 5, descent: 2, gap: 1, space: 2, lineGap: 4, upper: false, maxKern: 2, kernKeep: 1,
  depth: (scale) => (scale < 3 ? scale : scale - 1), // as Vox Sentence: one cell deep, never a slab at display sizes
  src: SIGN_MARKS + TEXT_MARKS + TEXT_CAPS + TEXT_DIGITS + TEXT_LOWER + TEXT_UK_CAPS + TEXT_UK_LOWER + TEXT_FIXES,
  alias: ZAKON_TEXT_SHARED,
  kern: { ...HAND_PAIRS, rn: 0, rm: 0, 'r,': -1, 'r.': -1, 'г,': -1, 'г.': -1, 'т,': 0, 'т.': 0 },
}));

// ---- Vox Zakon Text Bold, for keys
// One cell of stroke is too light on a button. The bold has stems two cells wide and bars one:
// every cell is doubled to the right, so verticals double and horizontals do not, which is
// Zakon's own contrast and the thing the regular had to give up. Before that, a glyph is opened
// by one column wherever two strokes stood one cell apart, so nothing closes. Letters the rule
// draws badly are drawn by hand in BOLD_HAND.
import { parse } from './index.js';

// Round letters keep a counter two cells wide: a slit of one cell reads as a bead at 20 px.
const ROUND = new Set([...'oepbgqоервьяб']);
export function embolden(g) {
  const open = new Set();
  for (const r of g.rows) for (let c = 1; c < g.w - 1; c++) if (r[c] === '.' && r[c - 1] === '#' && r[c + 1] === '#') open.add(c);
  if (ROUND.has(g.ch)) for (const r of g.rows) for (let c = 1; c < g.w - 2; c++) if (r[c] === '.' && r[c + 1] === '.' && r[c - 1] === '#' && r[c + 2] === '#') open.add(c);
  let rows = g.rows.map((r) => [...r].map((v, c) => (open.has(c) ? v + v : v)).join(''));
  rows = rows.map((r) => { const o = [...(r + '.')]; for (let c = r.length - 1; c >= 0; c--) if (r[c] === '#') o[c + 1] = '#'; return o.join(''); });
  return { ch: g.ch, y: g.y, w: rows[0].length, rows };
}

export const BOLD_HAND = `
Ї -2
##..##
......
.####.
..##..
..##..
..##..
..##..
..##..
.####.

ї
##.##
.....
###..
.##..
.##..
.##..
####.

W
##.....##
##.....##
##..#..##
##.###.##
####.####
.###.###.
.##...##.

w 2
##.....##
##..#..##
##.###.##
####.####
.##...##.

т 2
######
..##..
..##..
..##..
..##..

и 2
##...##
##..###
##.#.##
###..##
##...##

й
.#####.
.......
##...##
##..###
##.#.##
###..##
##...##
`;

const regular = parse(SIGN_MARKS + TEXT_MARKS + TEXT_CAPS + TEXT_DIGITS + TEXT_LOWER + TEXT_UK_CAPS + TEXT_UK_LOWER + TEXT_FIXES);
for (const [ch, as] of Object.entries(ZAKON_TEXT_SHARED)) if (regular[as] && !regular[ch]) regular[ch] = { ...regular[as], ch };
const boldGlyphs = { ...Object.fromEntries(Object.entries(regular).map(([ch, g]) => [ch, embolden(g)])), ...parse(BOLD_HAND) };

export const zakontextbold = registerFont(makeFont({
  id: 'zakontextbold', name: 'Vox Zakon Text Bold',
  cap: 7, xHeight: 5, descent: 2, gap: 1, space: 3, lineGap: 4, upper: false, maxKern: 2, kernKeep: 1,
  depth: (scale) => (scale < 3 ? scale : scale - 1),
  glyphs: boldGlyphs,
  kern: { ...HAND_PAIRS, rn: 0, rm: 0, 'r,': -1, 'r.': -1, 'г,': -1, 'г.': -1, 'т,': 0, 'т.': 0 },
}));
