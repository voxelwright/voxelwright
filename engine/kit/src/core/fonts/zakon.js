// Vox Zakon. Zakon, Ukraine's national typeface, redrawn as voxels: a display set of capitals
// eleven cells tall, the same height as Vox Block, so one can be swapped for the other.
//
// The source is Zakon Bold. Its stem is 142 units and its
// bar 62; at eleven cells to the cap height a cell is 63.6 units, so the stem is 2.2 cells and
// the bar 1.0, and the grid takes them as two cells and one.
//
// This is the second drawing. The first kept Zakon's details and lost its proportions: rounds
// were narrower than square letters, every pair stood one cell apart, and horns stuck out above
// the cap line. This one is drawn from measurements (for each character, its true ink width and
// how much of every cell the outline covers) by these rules:
//
//   - Width. Each glyph is as wide as Zakon Bold's ink at eleven cells, rounded to whole cells:
//     O H D U И П Ц Ч 11, A V Y N Д Л Ф 12, M 15, Ш Щ Ю Ж 16, W 18, against E F L P Г Ь 9 and S 8.
//     That rhythm of wide rounds and narrow letters is most of what makes it Zakon. The figures
//     5 and 6 are 7 for 7.5, like 2 3 9, so that with Zakon's spacing they keep its even pitch.
//     Not the nearest whole cell, and why: T is 10 for 10.8 and I is 4 for 4.5, so that a
//     two-cell stem stands on the axis; W is 18 for 18.5 and ? is 6 for 6.5, halves taken down;
//     B is 9 for 9.5, because both of its bowls end nearer nine cells than ten; the dots are 2
//     for 2.6 (see below).
//   - Height. Nothing rises above the cap line except the marks of Ї and Й and the upturn of Ґ,
//     which really is two cells tall. Zakon's horns rise three quarters of a cell but cover only
//     a third of it: what shows at this size is the beak that hangs under the end of a bar, one
//     or two rows inside the cap height (C E F G S Z, Б Г Є, T, the arms of К and Ж).
//     Below the baseline only what covers half a cell: the feet of Д, the tails of Ц Щ and Q.
//   - Strokes. Stems two cells, hairlines one, and which is which is read from the letter:
//     N has hairline stems and a heavy diagonal, И heavy stems and a hairline diagonal that runs
//     corner to corner; A Л Д V W X Y У have one heavy and one hairline side; M a hairline first
//     leg, a heavy and a hairline diagonal that meet on the baseline, and a heavy last leg.
//   - Rounds. Two-cell sides for the middle rows, stepping in one cell per row to a one-row top
//     and bottom (O C G Q D U, Є Ю Ф, the bowls of B Б Ь, the figures). P, R and Я keep a
//     squarer shoulder: their bowls are four rows tall and have no room for the steps.
//   - Diagonals take their slope from the outline. The legs of A Л Д and the arms of V and W
//     step one cell every two or three rows; the arms of Y and У one every two; the diagonal of
//     N and the legs of R and Я one a row. Hairline diagonals are single cells that meet at
//     corners, which voxels() redraws as single steps at two and three voxels per cell.
//   - Serifs are slabs one cell tall, one cell to each side of a stem; serifs that face each
//     other inside a letter stand at least two cells apart.
//   - Dots are two by two (full stop, colon, the dots of Ї, ! and ?): Zakon's are diamonds 2.6
//     cells across, too small here to show their points. The comma and ʼ are the same with a tail.
//   - Counters stay more than half open at one, two and three voxels per cell. No glyph was widened past its true width to pass.
//
// The Ukrainian letters, each from its own outline: К and Ж carry a hairline arm that leaves
// the stem at the waist and ends in a heavy terminal with a beak, drawn as one connected stroke;
// Д and Л are triangles, Д on a bar with two feet below the line; У has a heavy left arm and a
// tail that turns left; З is round with a beak at the top left and a heavy ball at the bottom
// left, and cannot be taken for the flat-topped figure 3; Ґ keeps its upturn; Ц and Щ hang a
// tail at the right; Й carries Zakon's hook, not a breve; Є is С with a ticked bar.
// А І М О Х are the very same outlines as A I M O X in Zakon; В Е К Н Р С Т differ from
// B E K H P C T by under a third of a cell and share a drawing.
//
// Given up: bracketed and one-sided serifs, the swell of curves, horns, diamond dots, the full
// length of / ( ) ! ? (they rise above the cap line in Zakon and are cut to it here), the third
// row of Д's feet and of the tails of Q Ц Щ, heavy rings in % (a one-cell counter would close).
//
// Spacing is Zakon's own, not tuned by hand: see spaceLikeZakon below.

import { makeFont, registerFont } from './index.js';
import SPACING from './zakon-spacing.js';

export const CAPS = `
A
....##.....
....###....
...####....
...#.##....
..#...##...
..#...##...
..#...##...
.########..
.#.....##..
.#.....##..
###....####

B
#######..
.##...##.
.##...##.
.##...##.
.##..##..
.#######.
.##....##
.##....##
.##....##
.##....##
########.

C
...#######
..##....##
.##......#
##........
##........
##........
##........
##........
.##......#
..##....##
...######.

D
########...
.##...###..
.##.....##.
.##......##
.##......##
.##......##
.##......##
.##......##
.##.....##.
.##...###..
########...

E
#########
.##....##
.##.....#
.##......
.##..#...
.#####...
.##..#...
.##......
.##.....#
.##....##
#########

F
#########
.##....##
.##.....#
.##......
.##..#...
.#####...
.##..#...
.##......
.##......
.##......
####.....

G
...#######.
..##....##.
.##......#.
##.........
##.........
##.....####
##......##.
##......##.
.##.....##.
..##....##.
...######..

H
####...####
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.#########.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
####...####

I
####
.##.
.##.
.##.
.##.
.##.
.##.
.##.
.##.
.##.
####

J
....####
.....##.
.....##.
.....##.
.....##.
.....##.
.....##.
.....##.
#...##..
##..##..
.####...

K
####...###.
.##...####.
.##..##..#.
.##..#.....
.##.##.....
.######....
.##...##...
.##....##..
.##....##..
.##....##..
####...####

L
####.....
.##......
.##......
.##......
.##......
.##......
.##......
.##......
.##.....#
.##....##
#########

M
...##......##..
...##.....###..
...###....###..
..#.##...#.##..
..#..##..#.##..
..#..##.#..##..
..#..##.#..##..
..#...###..##..
.#....##....##.
.#.....#....##.
####...#...####

N
.###.....###
..###.....#.
..###.....#.
..####....#.
..#.###...#.
..#..###..#.
..#...###.#.
..#....####.
..#.....###.
..#......##.
####.....##.

O
...#####...
..##...##..
.##.....##.
##.......##
##.......##
##.......##
##.......##
##.......##
.##.....##.
..##...##..
...#####...

P
########.
.##....##
.##....##
.##....##
.##....##
.##...##.
.######..
.##......
.##......
.##......
####.....

Q
...#####......
..##...##.....
.##.....##....
##.......##...
##.......##...
##.......##...
##.......##...
##.......##...
.##.....##....
..##...##.....
...#####......
......####....
.........#####

R
########..
.##....##.
.##....##.
.##....##.
.##....##.
.##...##..
.######...
.##..##...
.##...##..
.##....##.
####...###

S
.#######
##....##
##.....#
###.....
.####...
..####..
....###.
.....###
#.....##
##...##.
######..

T
##########
#...##...#
#...##...#
....##....
....##....
....##....
....##....
....##....
....##....
....##....
...####...

U
####...####
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
..##...##..
...#####...

V
####....####
.##......#..
..##.....#..
..##....#...
..##....#...
...##...#...
...##..#....
....##.#....
....####....
....###.....
.....##.....

W
####..####....####
.##....##......#..
..##....##.....#..
..##....##....#...
..##....##....#...
...##...###...#...
...##..#.##..#....
....##.#..##.#....
....###...###.....
....###...###.....
.....##....##.....

X
####...####
..##....#..
...##..#...
...##.#....
....###....
....###....
....###....
....#.##...
...#...##..
..#....##..
####...####

Y
####....####
..##.....#..
..##....#...
...##...#...
...##..#....
....##.#....
.....###....
.....##.....
.....##.....
.....##.....
....####....

Z
#########
#.....###
#....###.
.....###.
....###..
...###...
...###...
..###...#
.###....#
###.....#
#########
`;

export const DIGITS = `
0
..####..
.##..##.
##....##
##....##
##....##
##....##
##....##
##....##
##....##
.##..##.
..####..

1
..##.
####.
..##.
..##.
..##.
..##.
..##.
..##.
..##.
..##.
.####

2
#####..
##..##.
#....##
.....##
....##.
....##.
...##..
..##...
.##...#
##...##
#######

3
#######
#....##
#...##.
...##..
..##...
...###.
.....##
#....##
#....##
##...##
.#####.

4
.....##.
....###.
...####.
...#.##.
..#..##.
..#..##.
.#...##.
########
.....##.
.....##.
....####

5
.######
.#...##
.#.....
.#.....
.####..
.#..##.
.....##
.....##
##...##
##..##.
.####..

6
...####
..##...
.##....
##.....
#####..
##..##.
##...##
##...##
##...##
.##.##.
..###..

7
########
##...##.
#...##..
....##..
...##...
...##...
...##...
..##....
..##....
..##....
..##....

8
..####..
.##..##.
.##..##.
.##..##.
..####..
..####..
.##..##.
##....##
##....##
.##..##.
..####..

9
.####..
##..##.
##...##
##...##
##...##
.######
.....##
.....##
....##.
....##.
.####..
`;

export const MARKS = `
. 9
##
##

, 9
##
##
.#
#.

!
##
##
##
##
##
##
##
##
..
##
##

?
######
#...##
#...##
....##
...##.
..##..
..#...
..#...
......
.##...
.##...

- 5
#####

+ 3
...#...
...#...
...#...
#######
...#...
...#...
...#...

: 4
##
##
..
..
..
##
##

/
......##
.....##.
.....##.
....##..
....##..
...##...
...##...
..##....
..##....
.##.....
.##.....
##......

'
##
##
##

"
##.##
##.##
##.##

= 4
#######
.......
.......
#######

; 4
##
##
..
..
..
##
##
.#
#.

(
..##
.##.
##..
##..
##..
##..
##..
##..
##..
.##.
..##

)
##..
.##.
..##
..##
..##
..##
..##
..##
..##
.##.
##..

%
.##......#.
#..#....#..
#..#...#...
#..#...#...
.##...#....
.....#.....
....#...##.
...#...#..#
...#...#..#
..#....#..#
.#......##.

#
...#..#..
...#..#..
...#..#..
...#..#..
.########
..#...#..
..#...#..
########.
..#..#...
..#..#...
..#..#...

&
..######..
.##...#...
.##...#...
.##.......
.###......
..########
.##...##.#
##....##..
##....##..
##....##..
.########.
`;

export const UK = `
Б
#########.
.##....##.
.##.....#.
.##.......
.##.......
.#######..
.##....##.
.##.....##
.##.....##
.##....##.
########..

Г
#########
.##....##
.##.....#
.##......
.##......
.##......
.##......
.##......
.##......
.##......
####.....

Ґ -2
.......#
......##
########
.##.....
.##.....
.##.....
.##.....
.##.....
.##.....
.##.....
.##.....
.##.....
####....

Д
.....##.....
.....###....
....####....
....#.##....
...#...##...
...#...##...
...#...##...
..#.....##..
..#.....##..
..#.....##..
############
##........##
#..........#

Є
...#######
..##....##
.##......#
##........
##...#....
######....
##...#....
##........
.##......#
..##....##
...######.

Ж
.###..####..###.
.####..##..####.
.#..##.##.##..#.
.....#.##.#.....
.....#.##.#.....
....########....
...##..##..##...
..##...##...##..
..##...##...##..
..##...##...##..
####..####..####

З
.######..
.#....##.
.#....##.
......##.
.....##..
....####.
.......##
.......##
##.....##
##....##.
.######..

И
####...####
.##....###.
.##....###.
.##...#.##.
.##...#.##.
.##..#..##.
.##.#...##.
.##.#...##.
.###....##.
.###....##.
####...####

Й -3
....####...
......##...
...........
####...####
.##....###.
.##....###.
.##...#.##.
.##...#.##.
.##..#..##.
.##.#...##.
.##.#...##.
.###....##.
.###....##.
####...####

Ї -3
##..##
##..##
......
.####.
..##..
..##..
..##..
..##..
..##..
..##..
..##..
..##..
..##..
.####.

Л
....##.....
....###....
...####....
...#.##....
..#...##...
..#...##...
..#...##...
.#.....##..
.#.....##..
.#.....##..
###....####

П
###########
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
####...####

У
####...####
..##.....#.
..##....#..
...##...#..
...##..#...
....##.#...
....####...
.....##....
.....##....
....##.....
..####.....

Ф
..########..
.##..##..##.
##...##...##
##...##...##
##...##...##
##...##...##
##...##...##
.##..##..##.
..########..
.....##.....
....####....

Ц
####...####
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
.##.....##.
###########
.........##
..........#

Ч
####...####
.##.....##.
.##.....##.
.##.....##.
.##.....##.
..##....##.
...#######.
........##.
........##.
........##.
.......####

Ш
####..####..####
.##....##....##.
.##....##....##.
.##....##....##.
.##....##....##.
.##....##....##.
.##....##....##.
.##....##....##.
.##....##....##.
.##....##....##.
################

Щ
####..####..####
.##....##....##.
.##....##....##.
.##....##....##.
.##....##....##.
.##....##....##.
.##....##....##.
.##....##....##.
.##....##....##.
.##....##....##.
################
..............##
...............#

Ь
####.....
.##......
.##......
.##......
.##......
.######..
.##...##.
.##....##
.##....##
.##...##.
#######..

Ю
####....#####...
.##....##...##..
.##...##.....##.
.##..##.......##
.##..##.......##
.######.......##
.##..##.......##
.##..##.......##
.##...##.....##.
.##....##...##..
####....#####...

Я
..########
.##....##.
.##....##.
.##....##.
.##....##.
..##...##.
...######.
...##..##.
..##...##.
.##....##.
###...####

ʼ
##
##
.#
#.
`;

// Cyrillic letters that are the Latin shape in Zakon itself.
export const ZAKON_SHARED = { А: 'A', В: 'B', Е: 'E', І: 'I', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X' };

// Spacing from the source. The distance between two letters is Zakon's own (right bearing + left
// bearing + kerning, in cells), plus the looseness by which a grid of whole cells is wider than
// the type, rounded to whole cells; and never so close that two letters touch, even at a corner
// (one clear cell is kept). It fills font.kern for every pair, figures included, so nothing is
// tuned pair by pair. The word space follows the same sum: Zakon's 4.4 cells, its bearings and
// the looseness come to 5.5, drawn as 6 (space: 4 and a gap on each side).
const INF = 99;
export const LOOSE = 0.4;
export function spaceLikeZakon(font, data = SPACING, loose = LOOSE) {
  const chars = Object.keys(font.glyphs).filter((c) => c !== ' ');
  for (const a of chars) for (const b of chars) {
    const A = font.glyphs[a], B = font.glyphs[b], ba = data.bearings[a], bb = data.bearings[b];
    if (!ba || !bb) continue;
    // how far b could move toward a before the two shapes touch, looking one row up and down
    let free = INF;
    for (let r = 0; r < A.right.length; r++) {
      if (A.right[r] === INF) continue;
      for (let q = Math.max(0, r - 1); q <= Math.min(B.left.length - 1, r + 1); q++) if (B.left[q] !== INF) free = Math.min(free, A.right[r] + B.left[q]);
    }
    if (free === INF) free = 2;
    const real = ba[1] + bb[0] + (data.kern[a + b] || 0);
    const want = Math.round(real + loose) - font.gap; // cells to add to the gap
    // Tucking one letter under another (A V, Г А, a comma after T) stops two clear cells short:
    // each cube shows a side face, which half fills a gap of one.
    let v = want < 0 ? Math.max(want, Math.min(0, 2 - free - font.gap)) : want;
    // Where Zakon sets two letters closer than half a cell and the drawn shapes still stand two
    // or more cells apart (a thin stem set in from its serif, a round under an arm), close one
    // cell: W N, R O, O W. The boxes may then overlap; the shapes keep a clear cell.
    if (real < 0.5 && v >= 0 && free + font.gap + v >= 2) v -= 1;
    // Where two letters face each other with ink on their very edges for four rows or more (the
    // beaks of E against the terminals of S), one cell between them reads as a join: give two.
    let facing = 0;
    for (let r = 0; r < A.right.length; r++) if (A.right[r] === 0 && B.left[r] === 0) facing++;
    if (facing >= 4 && font.gap + v < 2) v = 2 - font.gap;
    if (v) font.kern[a + b] = v; else delete font.kern[a + b];
  }
  font.maxKern = 0;
  font.pairs.clear();
  return font;
}

export const zakon = registerFont(spaceLikeZakon(makeFont({
  id: 'zakon', name: 'Vox Zakon',
  cap: 11, descent: 2, gap: 1, space: 4, lineGap: 4, upper: true, maxKern: 0, kernKeep: 1,
  depth: (scale) => scale,
  src: CAPS + DIGITS + MARKS + UK,
  alias: ZAKON_SHARED,
  kern: {},
})));
