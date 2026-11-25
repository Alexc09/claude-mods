import type { HelperPhase } from '../types'

/**
 * The Helper Desk mascots: pixel figures on a 24 by 24 grid, drawn by one renderer. The Main chat
 * card wears one (/mascot); in crew mode each subagent card wears one of the fast-food crew (CREW).
 *
 * To edit one, change its `map` (one letter a pixel, '.' empty) or its `ink` (letter -> colour).
 * To add one, add an entry to MASCOTS; `/mascot <id>` then picks it. A 1-pixel outline is added
 * round every filled pixel by itself. The standalone copies in ../mascots/ are made from here
 * with `node --experimental-strip-types mascots/build.mjs`, run in the plugin folder.
 */

/** A pixel drawn over the figure: column, row, colour. */
export type Pixel = [x: number, y: number, color: string]

export type Mascot = {
  /** What `/mascot <id>` takes. */
  id: string
  /** The name the list and the reply use ("Fry cook"). */
  name: string
  /** The drawing's alt text. */
  alt: string
  /** 24 columns a row, one letter a pixel, '.' empty. Rows past 24 sit below the frame, so a nod shows no gap. */
  map: string[]
  /** The colour of each letter. */
  ink: Record<string, string>
  /** Letters whose colour changes with the phase (an ember, a flame, fries); the rest keep `ink`. */
  phaseInk?: Record<string, Partial<Record<HelperPhase, string>>>
  /** The outline colour round the figure. */
  outline: string
  /** Steam or smoke: the anchor the puffs start from (the lower puff's centre) and their core and edge colours. */
  puffs?: { at: [x: number, y: number]; core: string; edge: string }
  /** While working: `px` flicker over the figure (ember, flame, fries), `glow` fades in and out with them. */
  flicker?: { px: Pixel[]; glow?: Pixel[] }
  /** While working: 'nod' dips 1 pixel every 3 s, 'bob' bobs 1 pixel every second, 'ride' bobs smoothly twice a second, 'none' stands still. */
  move: 'nod' | 'bob' | 'ride' | 'none'
  /** While working: parts of the drawing that move on their own (a patty hops, a mop swishes). */
  moves?: Move[]
  /** Once a turn ends: pixels drawn over the still figure (a pencil put down, a finished page). Keep them inside the figure: they get no outline. */
  rest?: { done?: Pixel[]; failed?: Pixel[] }
  /** One of the fast-food crew that subagent cards wear (see CREW). */
  crew?: boolean
  /**
   * The terminal's lines: `top` (a hat) in `topColor`, then `face` and `hand` (in `handColor` while
   * working), then `low` (a tie) in `lowColor` if given.
   */
  term: { top: string; topColor: string; face: string; hand: string; handColor: string; low?: string; lowColor?: string }
}

/**
 * A part of the drawing that moves by itself while Claude works. Its pixels leave the still figure
 * and move in their own group (transform-box: fill-box), each with its own outline, so at rest the
 * drawing is exactly the map's.
 */
export type Move = {
  /** Its pixels: the map's filled pixels inside [x0, y0, x1, y1] (inclusive), only `letters` if given. A pixel goes to the first part that takes it. */
  box?: [x0: number, y0: number, x1: number, y1: number]
  letters?: string
  /** Pixels only this part draws, and only while working (a tick, a bubble, a speed line). */
  add?: Pixel[]
  /** One loop: [percent, CSS declarations], eased from one to the next by `ease`. */
  keys: [pct: number, css: string][]
  /** The CSS timing function between keys. Default ease-in-out; 'steps(1,end)' holds each key, so pixels jump whole (a pen line showing up). */
  ease?: string
  /** Seconds a loop takes; `delay` starts it that far in. */
  dur: number
  delay?: number
  /** The pivot for a rotate or skew, in the part's own box. Default center. */
  origin?: string
  /** Drawn beneath the figure, so it slides out from behind it (a receipt from a till). */
  under?: boolean
  /** No outline round it (a speed line). */
  bare?: boolean
}

export const MASCOT_PX = 48
export const DEFAULT_MASCOT = 'fries-in-the-bag'

// ---------- Shared colours ----------

const PUNK_OUTLINE = '#2b1d16'
const PUNK_INK: Record<string, string> = {
  C: '#4b4d55',
  c: '#2c2d33',
  S: '#d29a6a',
  s: '#b07a4f',
  e: '#94603b',
  G: '#0b0b0b',
  W: '#f5f5f5',
  M: '#6e2f1c',
  P: '#8a5a2e',
  p: '#5a3618',
  R: '#fbbf24',
}
const EMBER = '#f97316'
const PUNK_EMBER = { E: { working: EMBER, done: '#9a3412', failed: '#57534e' } }
const PUNK_PUFFS = { at: [20, 12] as [number, number], core: '#f4f4f5', edge: '#a1a1aa' }
const PUNK_FLICKER = {
  px: [[20, 14, '#fde047']] as Pixel[],
  glow: [[19, 13, '#fb923c'], [20, 13, '#fed7aa'], [21, 13, '#fb923c']] as Pixel[],
}

const COOK_OUTLINE = '#1a1a1a'
/** Skin, its shade, the ear's shade, eye white, dark pixels (K), mouth, brows: each cook may override. */
const COOK_BASE: Record<string, string> = {
  S: '#e0a878',
  s: '#bf8556',
  e: '#9c6640',
  w: '#f7f7f5',
  K: COOK_OUTLINE,
  M: '#7a3322',
  b: '#3b2a20',
}
const STEAM = { core: '#f4f4f5', edge: '#a1a1aa' }
const SMOKE = { core: '#e4e4e7', edge: '#71717a' }
const COOK_TOP = ' ▄██▄'
const COOK_FACE = '(•‿•)'

// ---------- The fast-food crew: one uniform, five skin tones, and the moves they share ----------

/** Red cap (C, shade c) with a yellow brim (Y), red shirt (R) with a yellow collar (Y). */
const CREW_RED = '#dc2626'
const CREW_UNIFORM: Record<string, string> = { C: CREW_RED, c: '#a51c1c', R: CREW_RED, Y: '#facc15' }
const SKIN_LIGHT = { S: '#f1c8a0', s: '#d6a57a', e: '#b98458' }
const SKIN_BASE = { S: '#e0a878', s: '#bf8556', e: '#9c6640' }
const SKIN_TAN = { S: '#c98e5e', s: '#a46d43', e: '#7f4f2c' }
const SKIN_BROWN = { S: '#a26a42', s: '#82522f', e: '#653d20', b: '#1f140d' }
const SKIN_DEEP = { S: '#7a4a2c', s: '#5e371f', e: '#472815', b: '#140c07' }
/** The terminal's crew glyph: a red cap with its brim to the right, the cook face, a hand in the prop's colour. */
const CREW_TOP = ' ▄██▄▄'
const crewTerm = (handColor: string) => ({ top: CREW_TOP, topColor: CREW_RED, face: COOK_FACE, hand: '╯', handColor })

const ty = (px: number) => `transform:translateY(${px}px)`
const tx = (px: number) => `transform:translateX(${px}px)`
const tr = (x: number, y: number) => `transform:translate(${x}px,${y}px)`
const sx = (deg: number) => `transform:skewX(${deg}deg)`
const sy = (deg: number) => `transform:skewY(${deg}deg)`
/** A smooth swing from `a` to `b` and back, one loop (with the default ease-in-out it slows at each end). */
const swing = (a: string, b: string): [number, string][] => [[0, a], [50, b], [100, a]]
/** Per-key easing, for the part of a loop that should speed up (a fall) or slow down (a toss). */
const easeIn = ';animation-timing-function:cubic-bezier(.5,0,1,.6)'
const easeOut = ';animation-timing-function:cubic-bezier(0,.4,.5,1)'
/** The manager's pencil in his writing hand, its tip at x, y: graphite tip, yellow body, pink eraser, an outlined fist round it. */
const pencilAt = (x: number, y: number): Pixel[] => {
  const pencil: Pixel[] = [[x, y, '#27272a'], [x + 1, y - 1, '#facc15'], [x + 1, y - 2, '#f5b70b'], [x + 2, y - 3, '#d99a06'], [x + 2, y - 4, '#f472b6']]
  const fist: Pixel[] = [[x + 1, y, '#f1c8a0'], [x + 2, y, '#d6a57a'], [x + 2, y - 1, '#f1c8a0']]
  const taken = new Set([...pencil, ...fist].map(([a, b]) => `${a},${b}`))
  const near = fist.flatMap(([a, b]) => [`${a + 1},${b}`, `${a - 1},${b}`, `${a},${b + 1}`, `${a},${b - 1}`])
  const ring = [...new Set(near)].filter(k => !taken.has(k)).map(k => [...k.split(',').map(Number), COOK_OUTLINE] as Pixel)
  return [...ring, ...pencil, ...fist].filter(([a, b]) => a >= 0 && a < 24 && b >= 0 && b < 24)
}
/** The clipboard's four lines of writing, columns 18 to 21: [row, the line's pixels, the pixels just above it]. */
const PAGE: [row: number, low: string, high: string][] = [
  [6, 'xx.x', '....'],
  [8, 'x.xx', '....'],
  [10, 'xxx.', '....'],
  [12, 'xx.x', '....'],
]
const PEN_INK = '#3f3f46'
/** Where the pencil rests: its tip just past the last line's writing. */
const PEN_REST: [number, number] = [21, 12]
/** The first `lines` lines of writing as pixels. */
const writing = (lines: number): Pixel[] =>
  PAGE.slice(0, lines).flatMap(([r, low, high]) =>
    [...[...low].map((ch, i) => (ch === 'x' ? [18 + i, r, PEN_INK] : null)), ...[...high].map((ch, i) => (ch === 'x' ? [18 + i, r - 1, PEN_INK] : null))].filter(
      (p): p is Pixel => p !== null,
    ),
  )
/** A failed turn's last line: a red zigzag scratched through where it would go. */
const SCRATCH: Pixel[] = [[18, 12, '#b91c1c'], [19, 11, '#b91c1c'], [20, 12, '#b91c1c'], [21, 11, '#b91c1c']]
const r1 = (n: number) => Math.round(n * 10) / 10
/**
 * The manager writes out the page: the pencil zigzags along each line (quick up-and-down strokes,
 * creeping right), drops to the next, and each bit of writing shows up as the tip passes it. The
 * page stays full a moment, then clears while the pencil goes back up to the first line. The head
 * dips one pixel to the page while he writes.
 */
function scribble(): Move[] {
  const dur = 3
  const lines: [a: number, b: number][] = [[2, 20], [24, 42], [46, 64], [68, 84]]
  const clear = 90
  const pen: [number, string][] = []
  const at = (pct: number, x: number, y: number) => pen.push([r1(pct), tr(r1(x - PEN_REST[0]), y - PEN_REST[1])])
  at(0, 18, PAGE[0]![0])
  const shows: Move[] = []
  PAGE.forEach(([r, low, high], i) => {
    const [a, b] = lines[i]!
    const strokes = 8
    for (let k = 0; k <= strokes; k++) at(a + ((b - a) * k) / strokes, 18 + (3 * k) / strokes, r - (k % 2))
    const when = (col: number) => r1(a + ((b - a) * (col + 0.5)) / 3.4)
    const px: [number, number, number][] = []
    ;[...low].forEach((ch, c) => ch === 'x' && px.push([18 + c, r, when(c)]))
    ;[...high].forEach((ch, c) => ch === 'x' && px.push([18 + c, r - 1, when(c)]))
    for (const [x, y, t] of px)
      shows.push({ add: [[x, y, PEN_INK]], bare: true, ease: 'steps(1,end)', keys: [[0, 'opacity:0'], [t, 'opacity:1'], [clear, 'opacity:0']], dur })
  })
  at(clear, PEN_REST[0], PEN_REST[1])
  at(98, 18, PAGE[0]![0])
  at(100, 18, PAGE[0]![0])
  return [
    { box: [3, 0, 15, 17], keys: [[0, ty(0)], [6, ty(1)], [82, ty(1)], [94, ty(0)]], dur },
    { add: pencilAt(PEN_REST[0], PEN_REST[1]), keys: pen, ease: 'linear', dur },
    ...shows,
  ]
}
/** A fizz bubble (one bare blue pixel) that rises 3 pixels from x, y and pops. */
const fizz = (x: number, y: number, delay: number): Move => ({
  add: [[x, y, '#38bdf8']],
  bare: true,
  keys: [[0, `${ty(0)};opacity:0`], [12, `${ty(-0.5)};opacity:1`], [70, `${ty(-3)};opacity:1`], [88, `${ty(-3.5)};opacity:0`], [100, `${ty(-3.5)};opacity:0`]],
  ease: 'linear',
  dur: 1.2,
  delay,
})
/** A soap bubble of the map, in `box`, that comes up from 2 pixels lower, rises 2 more and pops. */
const rise = (box: [number, number, number, number], delay: number): Move => ({
  box,
  keys: [[0, `${ty(2)};opacity:0`], [15, `${ty(1.25)};opacity:1`], [75, `${ty(-1.75)};opacity:1`], [90, `${ty(-2.25)};opacity:0`], [100, `${ty(2)};opacity:0`]],
  ease: 'linear',
  dur: 1.5,
  delay,
})
/** A grey speed line on `row` at the left edge, streaking off to the left. */
const speedLine = (row: number, delay: number): Move => ({
  add: [[0, row, '#a1a1aa'], [1, row, '#a1a1aa']],
  bare: true,
  keys: [[0, `${tx(2)};opacity:0`], [20, `${tx(1)};opacity:1`], [75, `${tx(-1)};opacity:.6`], [90, `${tx(-2)};opacity:0`], [100, `${tx(-2)};opacity:0`]],
  ease: 'linear',
  dur: 0.6,
  delay,
})

/** Pixels from a little map at x0, y0: '.' leaves a pixel be, 'o' outlines it, '_' clears it, any other letter takes its `ink`. */
const paint = (x0: number, y0: number, rows: string[], ink: Record<string, string>): Pixel[] =>
  rows.flatMap((row, dy) =>
    [...row].flatMap((ch, dx): Pixel[] => (ch === '.' ? [] : [[x0 + dx, y0 + dy, ch === 'o' ? COOK_OUTLINE : ch === '_' ? '' : ink[ch]!]])),
  )
/** The fries-in-the-bag worker's props: red carton (Q, q, y band), fries (F, f), kraft bag (P, p, o inside). */
const BAG_INK: Record<string, string> = {
  Q: '#ef4444', q: '#b91c1c', y: '#facc15', F: '#fde047', f: '#eab308', P: '#c99a62', p: '#a8773f', k: '#4a2c14',
  S: '#f6d2b4', s: '#d9a988', R: CREW_RED, W: '#ffffff',
}
/**
 * One fry falling from the tipped carton's lip into the bag, `at` percent into the loop. It is drawn
 * where it lands, in the bag's mouth, so with reduced motion it just sticks out of the bag.
 */
const fryDrop = (x: number, at: number, drift: number): Move => ({
  add: [[x + drift, 12, BAG_INK.F!], [x + drift, 13, BAG_INK.f!]],
  bare: true,
  ease: 'linear',
  keys: [
    [0, `${tr(-drift, -3)};opacity:0`],
    [at, `${tr(-drift, -3)};opacity:0`],
    [at + 2, `${tr(-drift, -3)};opacity:1${easeIn}`],
    [at + 14, `${tr(0, 0)};opacity:1`],
    [at + 17, `${tr(0, 0.5)};opacity:0`],
    [100, `${tr(0, 0.5)};opacity:0`],
  ],
  dur: 1.4,
})

// ---------- The library ----------

export const MASCOTS: Mascot[] = [
  {
    id: 'punk-cap',
    name: 'Punk in a cap',
    alt: 'Pixel punk in a cap and sunglasses smoking a pipe',
    // A charcoal flat cap (top button, seam, dark band, short brim with a darker underside), black
    // shades, an earring, a pipe in the mouth with its ember (E) on top of the bowl.
    map: [
      '........................',
      '..........c.............',
      '........CCCCCC..........',
      '.......cCCcCCCCC........',
      '......cCCCcCCCCCC.......',
      '......ccccccccccCCC.....',
      '......sSSSSSSSSSccc.....',
      '......sSSSSSSSSS........',
      '......sSSSSSSSSS........',
      '......sSSSSSSSSS........',
      '......GGGGGGGGGGG.......',
      '......sSSGWGSGWG........',
      '......seeGGGSGGG........',
      '......seSSSSSSSSS.......',
      '......seeSSSSSSSS..pEp..',
      '......sRSSSSSSSS...PPp..',
      '......sSSSSSSMMMPPPPPp..',
      '......sSSSSSSSSS...PPp..',
      '......sSSSSSSSSS...pp...',
      '.......sSSSSSSSS........',
      '........sssss...........',
      '........SSSSS...........',
      '........SSSSS...........',
      '........SSSSS...........',
      '........SSSSS...........',
      '........SSSSS...........',
    ],
    ink: PUNK_INK,
    phaseInk: PUNK_EMBER,
    outline: PUNK_OUTLINE,
    puffs: PUNK_PUFFS,
    flicker: PUNK_FLICKER,
    move: 'nod',
    term: { top: '▄▄▄▄▄▖', topColor: 'gray', face: '(⌐■_■)', hand: '╯', handColor: EMBER },
  },
  {
    id: 'punk-mohawk',
    name: 'Punk with a mohawk',
    alt: 'Pixel punk with a pink mohawk and sunglasses smoking a pipe',
    map: [
      '........................',
      '.........H..............',
      '......H..HH...H.........',
      '......HH.HHH..HH........',
      '......HHhHHHHhHH........',
      '......HHHHHHHHHH........',
      '......sSSSSSSSSS........',
      '......sSSSSSSSSS........',
      '......sSSSSSSSSS........',
      '......sSSSSSSSSS........',
      '......GGGGGGGGGGG.......',
      '......sSSGWGSGWG........',
      '......seeGGGSGGG........',
      '......seSSSSSSSSS.......',
      '......seeSSSSSSSS..pEp..',
      '......sRSSSSSSSS...PPp..',
      '......sSSSSSSMMMPPPPPp..',
      '......sSSSSSSSSS...PPp..',
      '......sSSSSSSSSS...pp...',
      '.......sSSSSSSSS........',
      '........sssss...........',
      '........SSSSS...........',
      '........SSSSS...........',
      '........SSSSS...........',
      '........SSSSS...........',
      '........SSSSS...........',
    ],
    ink: { ...PUNK_INK, H: '#ec4899', h: '#9d174d' },
    phaseInk: PUNK_EMBER,
    outline: PUNK_OUTLINE,
    puffs: PUNK_PUFFS,
    flicker: PUNK_FLICKER,
    move: 'nod',
    term: { top: ' ʌʌʌ', topColor: '#ec4899', face: '(⌐■_■)', hand: '╯', handColor: EMBER },
  },
  {
    id: 'burger-flipper',
    name: 'Burger flipper',
    alt: 'Pixel burger flipper in a paper cap flipping a patty',
    map: [
      '........................',
      '...............YYYYYY...',
      '..............PYPPPYPP..',
      '......AAAA....pPpPpPpP..',
      '.....AAAAAAA............',
      '....AAAAAAAAAA..........',
      '....aaaaaaaaaa..........',
      '....RRRRRRRRRR..........',
      '....sSSSSSSSSS.GGGGGG...',
      '....sSSSSSSSSS.GgGgGG...',
      '....sSSSbbSSbb....k.....',
      '....sSSSwKSSwK....k.....',
      '....sssSSSSSSS....k.....',
      '....sseSSSSSSSS...k.....',
      '....sssSSSSSSSS..SkS....',
      '....sSSSSSSSSS...SSS....',
      '....sSSSSSSMMM...SSS....',
      '....sSSSSSSSSS...RRR....',
      '....sSSSSSSSSS...RRR....',
      '.....sSSSSSSSS...RRR....',
      '......sssss......RRR....',
      '..RRRRYSSSYRRRRRRRRR....',
      '.RRRRRRYYYRRRRRRRRRR....',
      '.RRRRRRRRRRRRRRRRRRR....',
    ],
    ink: {
      ...COOK_BASE,
      P: '#8a4b2a', p: '#5c2e17', A: '#fafafa', a: '#d4d4d8', R: '#dc2626', Y: '#facc15',
      G: '#b4b9c2', g: '#4b5563', k: '#3a3a3a',
    },
    outline: COOK_OUTLINE,
    puffs: { at: [22, 6], ...STEAM },
    flicker: {
      px: [[16, 1, '#fef08a'], [19, 2, '#fef08a']],
      glow: [[15, 3, '#ea580c'], [17, 3, '#ea580c'], [19, 3, '#ea580c'], [21, 3, '#ea580c']],
    },
    move: 'nod',
    term: { top: COOK_TOP, topColor: '#dc2626', face: COOK_FACE, hand: '╯', handColor: '#facc15' },
  },
  {
    id: 'fry-cook',
    name: 'Fry cook',
    alt: 'Pixel fry cook with a visor and fries',
    // Fries are F (yellow) and f (their shade), apart from the yellow brim and shirt (Y), so
    // they alone go dull when a turn fails.
    map: [
      '........................',
      '........................',
      '........................',
      '......HHHHH.............',
      '.....HHHHHHHH...........',
      '....HHHHHHHHHH..........',
      '....hKHHHHHHHH..........',
      '....RKRRRRRRRR..........',
      '....sKSSSSSYYYYYY.......',
      '....sKSSSSSSSS..........',
      '....sKSSbbSSbb....F..F..',
      '....sKSSwKSSwK....fF.fF.',
      '....sKKSSSSSSS....fFfFf.',
      '....KgKSSSSSSSS...fFfFf.',
      '....sKKSSSSSSSS...RRRRR.',
      '....sSgSSSSSSS....RRRRr.',
      '....sSSggggKMM....RRRRr.',
      '....sSSSSSSSSS....RRRr..',
      '....sSSSSSSSSS....RRRr..',
      '.....sSSSSSSSS....SSSS..',
      '......sssss.......SSS...',
      '..YYYYRSSSRYYYYYYYYY....',
      '.YYYYYYRRRYYYYYYYYYY....',
      '.YYYYYYYYYYYYYYYYYYY....',
    ],
    ink: {
      ...COOK_BASE,
      H: '#5a3a22', h: '#3e2716', R: '#dc2626', r: '#a51c1c', Y: '#facc15', F: '#facc15', f: '#d99a06',
      g: '#8a8a94', S: '#c98e5e', s: '#a46d43', e: '#7f4f2c',
    },
    phaseInk: { F: { failed: '#b3aa8a' }, f: { failed: '#8c856e' } },
    outline: COOK_OUTLINE,
    puffs: { at: [20, 8], core: '#fafaf9', edge: '#a8a29e' },
    flicker: {
      px: [[18, 10, '#fef9c3'], [21, 10, '#fef9c3'], [18, 12, '#fef9c3'], [22, 12, '#fef9c3']],
      glow: [[18, 11, '#fde047'], [21, 11, '#fde047'], [20, 13, '#fde047']],
    },
    move: 'bob',
    term: { top: COOK_TOP, topColor: '#dc2626', face: COOK_FACE, hand: '╯', handColor: '#facc15' },
  },
  {
    id: 'classic-chef',
    name: 'Classic chef',
    alt: 'Pixel chef in a tall white hat tasting from a wooden spoon',
    map: [
      '........................',
      '......WWW.WWW...........',
      '.....WWWWWWWWWW.........',
      '....WWWWWWWWWWWW........',
      '....WWWWWWWWWWWw........',
      '.....wWWWWWWWWw.........',
      '....WwWwWwWwWw..........',
      '....WwWwWwWwWw..........',
      '....sSSSSSSSSS..........',
      '....sSSSbbSSbb..........',
      '....sSSSwKSSwK..........',
      '....sssSSSSSSS..........',
      '....sseSSSSSSSS.........',
      '....sssSSSSSSSS..ooo....',
      '....sSSSSDSSSSSD.ooo....',
      '....sSSSSDDDDDDD..o.....',
      '....sSSSSSSSMMS...o.....',
      '....sSSSSSSSSSS...o.....',
      '.....sSSSSSSSS...SoS....',
      '......sssss......SSS....',
      '......NNNNN......WWW....',
      '..WWWNNNNNNNWWWWWWWW....',
      '.WWWWWWNNNWWKWWWWWWW....',
      '.WWWWWWWWWWWWWKWWWWW....',
    ],
    ink: {
      ...COOK_BASE,
      W: '#fafafa', w: '#cfcfd6', D: '#3b2414', o: '#c08a4a', N: '#dc2626',
      S: '#f1c29a', s: '#d49a6c', e: '#b07a4f',
    },
    outline: COOK_OUTLINE,
    puffs: { at: [18, 11], ...STEAM },
    move: 'nod',
    term: { top: COOK_TOP, topColor: 'gray', face: COOK_FACE, hand: '╯', handColor: '#c08a4a' },
  },
  {
    id: 'line-cook',
    name: 'Line cook',
    alt: 'Pixel line cook in a bandana tossing a flaming wok',
    map: [
      '........................',
      '........................',
      '........................',
      '........................',
      '......BBBBBB............',
      '.....BBBBBBBB...........',
      '....BBdBBBBdBB..........',
      '..BBBBBBBdBBBB..L.......',
      '.BB.sSSSSSSSSS.LL.......',
      '.B..sSSSSSSSSS.lL.......',
      '....sSSSbbSSbb..........',
      '....sSSSwKSSwK....Y.....',
      '....sssSSSSSSS...YO..Y..',
      '....sseSSSSSSSS..OYO.O..',
      '....sssSSSSSSSS..OYYOO..',
      '....sSSSSSSSSS..OOYYYO..',
      '....sSSSSSSMMM..OYYWYYO.',
      '....sSSSSSSSSS.IIIIIIII.',
      '....sSSSSSSSSS.kIIIIIII.',
      '.....sSSSSSSSS..iiiiii..',
      '......sssss.............',
      '..TTTTSSSSSTTTT.........',
      '.TTTTTTTTTTTTTTT........',
      '.TTTTTTTTTTTTTTT........',
    ],
    ink: {
      ...COOK_BASE,
      B: '#dc2626', d: '#fafafa', L: '#7dd3fc', l: '#0ea5e9', Y: '#fde047', O: '#f97316', W: '#fffbe6',
      I: '#6b7280', i: '#3f444d', k: '#3f444d', T: '#e5e7eb', S: '#8d5a3b', s: '#6e4229', e: '#55311d', b: '#1f140d',
    },
    phaseInk: {
      Y: { done: '#f59e0b', failed: '#9ca3af' },
      O: { done: '#c2410c', failed: '#6b7280' },
      W: { done: '#fde68a', failed: '#d4d4d8' },
    },
    outline: COOK_OUTLINE,
    puffs: { at: [19, 9], ...SMOKE },
    flicker: {
      px: [[18, 11, '#fffbe6'], [21, 12, '#fffbe6'], [18, 13, '#fffbe6'], [19, 16, '#ffffff']],
      glow: [[17, 13, '#fde047'], [19, 13, '#fde047'], [21, 13, '#fde047'], [17, 15, '#fde047'], [21, 15, '#fde047']],
    },
    move: 'bob',
    term: { top: COOK_TOP, topColor: '#dc2626', face: COOK_FACE, hand: '╯', handColor: EMBER },
  },
  {
    id: 'pizza-maker',
    name: 'Pizza maker',
    alt: 'Pixel pizza maker in a flat cap spinning a dough disc',
    map: [
      '........................',
      '...........DDDDDDDDDD...',
      '..........DDdDDDDDdDDD..',
      '...........dddddddddd...',
      '..................S.....',
      '.....CCCCCC......SSS....',
      '....CCCCCCCCC....SSS....',
      '....cccccccccCC..SSS....',
      '....sSSSSSSSSS...SSS....',
      '....sSSSbbSSbb...SSS....',
      '....sSSSwKSSwK...SSS....',
      '....sssSSSSSSS...SSS....',
      '....sseSSSSSSSS..SSS....',
      '....sssSSSSSSSS..UUU....',
      '....sSSSSKKKKKK..UUU....',
      '....sSSSSSKKKKS..UUU....',
      '....sSSSSSSSMMS..UUU....',
      '....sSSSSSSSSS...UUU....',
      '.....sSSSSSSSS...UUU....',
      '......sssss......UUU....',
      '......SSSSS......UUU....',
      '..UUUUUSSSUUUUUUUUUU....',
      '.UUUUUUUUUUUUUUUUUUU....',
      '.UUUUUUUUUUUUUUUUUUU....',
    ],
    ink: {
      ...COOK_BASE,
      D: '#f3d9a4', d: '#cfa865', C: '#57534e', c: '#3a3734', U: '#16a34a', S: '#e6b48a', s: '#c48c5f', e: '#a06b42',
    },
    outline: COOK_OUTLINE,
    move: 'bob',
    term: { top: COOK_TOP, topColor: '#57534e', face: COOK_FACE, hand: '╯', handColor: '#cfa865' },
  },
  {
    id: 'grill-master',
    name: 'Grill master',
    alt: 'Pixel grill master in a backwards cap and shades holding a smoking sausage',
    map: [
      '........................',
      '........................',
      '........................',
      '........................',
      '.....CCCCCCC............',
      '....CCCCCCCCC...........',
      '....CCCCCCCCCC..........',
      '.cccCCCCCCCCCC..QQQQQQ..',
      '....sSSSSSSSSS.QQqQQqQQ.',
      '....sSSSSSSSSS..qqqqqq..',
      '....sSGGGGGGGGG.T....T..',
      '....sSSGgGSGgG..TTTTTT..',
      '....sssSSSSSSS....TT....',
      '....sseSSSSSSSS...TT....',
      '....sssSSSSSSSS...TT....',
      '....sBSSSSSSSS...SSSS...',
      '....sBBSSSSMMM...SSSS...',
      '....sBBBBBBBBB...UUU....',
      '.....BBBBBBBBB...UUU....',
      '......BBBBBB.....UUU....',
      '......sssss......UUU....',
      '..UUUUUSSSUUUUUUUUUU....',
      '.UUUUUUUUUUUUUUUUUUU....',
      '.UUUUUUUUUUUUUUUUUUU....',
    ],
    ink: {
      ...COOK_BASE,
      C: '#2563eb', c: '#1e40af', Q: '#c2553a', q: '#7c2a1a', T: '#c9ccd3', G: '#0b0b0b', g: '#f5f5f5',
      B: '#6b3f1f', U: '#475569',
    },
    outline: COOK_OUTLINE,
    puffs: { at: [19, 5], ...SMOKE },
    flicker: { px: [[16, 8, '#f4a07f'], [19, 8, '#f4a07f'], [22, 8, '#f4a07f']] },
    move: 'nod',
    term: { top: COOK_TOP, topColor: '#2563eb', face: COOK_FACE, hand: '╯', handColor: '#c2553a' },
  },
  {
    id: 'barista',
    name: 'Barista',
    alt: 'Pixel barista in a beanie holding a latte mug',
    map: [
      '........................',
      '........NN..............',
      '......NNNNNN............',
      '.....NNNNNNNN...........',
      '....NNNNNNNNNN..........',
      '....NNNNNNNNNN..HH.HH...',
      '....nNnNnNnNnN..HHHHH...',
      '....nNnNnNnNnN...HHH....',
      '....sSSSSSSSSS....H.....',
      '....sSSSSSSSSS..........',
      '....sSSSbbSSbb..........',
      '....sSSSwKSSwK..........',
      '....sssSSSSSSS..........',
      '....sseSSSSSSSS.........',
      '....sssSSSSSSSS.UOOOOU..',
      '....sRSSSSbbbbS.UUUUUUU.',
      '....sSSSSSSMMM..UUUUUU.U',
      '....sSSSSSSSSS..UUUUUUUU',
      '.....sSSSSSSSS..uUUUUu..',
      '......sssss....XXXXXXXX.',
      '......SSSSS......SSSS...',
      '..AAAAASSSAAAAAAAAAA....',
      '.AAAAAAaaaAAAAAAAAAA....',
      '.AAAAAAAAAAAAAAAAAAA....',
    ],
    ink: {
      ...COOK_BASE,
      N: '#d4a017', n: '#a87c0a', H: '#f472b6', R: '#fbbf24', U: '#fafafa', u: '#cfcfd6', O: '#8b5a2b',
      X: '#cfcfd6', A: '#a16207', a: '#27272a', S: '#f0c8a8', s: '#d6a37f', e: '#b07a4f',
    },
    outline: COOK_OUTLINE,
    puffs: { at: [18, 12], ...STEAM },
    flicker: { px: [[17, 6, '#fbcfe8'], [19, 6, '#fbcfe8'], [18, 7, '#fbcfe8']] },
    move: 'nod',
    term: { top: COOK_TOP, topColor: '#d4a017', face: COOK_FACE, hand: '╯', handColor: '#f472b6' },
  },
  {
    id: 'sushi-chef',
    name: 'Sushi chef',
    alt: 'Pixel sushi chef in a headband with a knife and salmon nigiri',
    map: [
      '........................',
      '........................',
      '................V.......',
      '................VV......',
      '......XXXXXX....VV......',
      '.....XXXXXXXX...VV......',
      '..W.XXXXXXXXXX..VV......',
      '.WWWWwWwWwWwWW..VV......',
      '..WWWWwWwWwWwW..VV......',
      '.W..sSSSSSSSSS..VV......',
      '....sSSSXXSSXX..VV......',
      '....sSSSSKSSSK..VV......',
      '....sssSSSSSSS..vv......',
      '....sseSSSSSSSS.oo......',
      '....sssSSSSSSSS.oo......',
      '....sSSSSSSSSS.SSSS.....',
      '....sSSSSSSMMM.SSSS.....',
      '....sSSSSSSSSS..oo..FFF.',
      '....sSSSSSSSSS..WW.FfFfF',
      '.....sSSSSSSSS..WW.FFFFF',
      '......sssss.....WW.RRRRR',
      '..WWWWXSSSXWWWWWWW.RRRRR',
      '.WWWWWWXXXWWWWWWWW..RRR.',
      '.WWWWWWWWWWWWWWWWW......',
    ],
    ink: {
      ...COOK_BASE,
      X: '#141414', W: '#fafafa', w: '#c7c7cf', V: '#e4e7ec', v: '#9aa1ad', o: '#7a4a24', F: '#fb7a4b',
      f: '#fde2d4', R: '#f1ead8', S: '#f2cfa4', s: '#d5a979', e: '#b88758',
    },
    outline: COOK_OUTLINE,
    flicker: { px: [[16, 4, '#ffffff'], [17, 7, '#ffffff'], [16, 10, '#ffffff']] },
    move: 'nod',
    term: { top: COOK_TOP, topColor: 'gray', face: COOK_FACE, hand: '╯', handColor: '#fb7a4b' },
  },
  {
    id: 'baker',
    name: 'Baker',
    alt: 'Pixel baker in a white cap with a rolling pin and flour',
    map: [
      '........................',
      '........................',
      '........................',
      '........................',
      '......AAAAAA............',
      '.....AAAAAAAA...........',
      '....AAAAAAAAAA..........',
      '....aaaaaaaaaa..........',
      '...GGSSSSSSSSS..........',
      '...GGSSSSSSSSS..........',
      '...GGSSSbbSSbb..........',
      '....GSSSwKSSwK..........',
      '....GssSSSSSSS..........',
      '....sseSwwSSSSw.........',
      '....sssSppSSSSS.........',
      '....sSSSSSSSSS..........',
      '....sSSSSSSMMM..........',
      '....sSSSSSSSSS..........',
      '.....sSSSSSSSS..........',
      '......sssss.KKKKKKKKK...',
      '..AAAASSSSKKoooooooooKK.',
      '..AAAAAAAKqqoooooooooqqK',
      '.AAAAAAAAAKKOOOOOOOOOKK.',
      '.AAAAAAAAAAAKKKKKKKKK...',
    ],
    ink: {
      ...COOK_BASE,
      A: '#fafafa', a: '#cfcfd6', G: '#d9622b', p: '#f2949a', w: '#ffffff', o: '#e8be86', O: '#b5803f',
      q: '#7a4a24', S: '#eebd94', s: '#d09a70', e: '#ad7650', b: '#a5461c',
    },
    outline: COOK_OUTLINE,
    puffs: { at: [17, 17], core: '#ffffff', edge: '#a8a29e' },
    move: 'bob',
    term: { top: COOK_TOP, topColor: 'gray', face: COOK_FACE, hand: '╯', handColor: '#e8be86' },
  },
  {
    id: 'ramen-cook',
    name: 'Ramen cook',
    alt: 'Pixel ramen cook lifting noodles from a bowl with chopsticks',
    map: [
      '........................',
      '........................',
      '........................',
      '........................',
      '......XXXXXX............',
      '.....XXXXXXXXX..........',
      '....XXXXXXXXXXX.........',
      '....WWWWWWWWWW..........',
      '....XXXXXXXXXX..........',
      '....sSSSSSSSSS..SSooooo.',
      '....sSSSbbSSbb..SS.YyYy.',
      '....sSSSwKSSwK.....YyYy.',
      '....sssSSSSSSS.....YyYy.',
      '....sseSSSSSSSS....YyYy.',
      '....sssSSSSSSSS....YyYy.',
      '....sSSSSSSSSS.....YyYy.',
      '....sSSSSSSMMM..WWWWWWW.',
      '....sSSSSSSSSS..RRRRRRR.',
      '....sSSSSSSDDS..RRRRRRR.',
      '.....sSSSSSDDS...RRRRR..',
      '......sssss.......rrr...',
      '..UUUUUSSSUUUUU.........',
      '.UUUUUUUUUUUUUUU........',
      '.UUUUUUUUUUUUUUU........',
    ],
    ink: {
      ...COOK_BASE,
      X: '#1f2937', W: '#f5f5f4', o: '#d6a45c', Y: '#fde68a', y: '#e2a90b', R: '#b91c1c', r: '#7f1d1d',
      D: '#2a1a10', U: '#e7e5e4', S: '#d9a273', s: '#b77d50', e: '#94603b',
    },
    outline: COOK_OUTLINE,
    puffs: { at: [20, 7], ...STEAM },
    move: 'nod',
    term: { top: COOK_TOP, topColor: '#6b7280', face: COOK_FACE, hand: '╯', handColor: '#fde68a' },
  },
  {
    id: 'fries-in-the-bag',
    name: 'Fries in the bag',
    alt: 'Fast-food worker putting the fries in the bag',
    // A freckled teen in the crew uniform, purple-dyed hair under the cap and a smirk. One arm holds
    // an open kraft bag (P, p, k) from below; the other, up at the edge, holds a red fries carton (Q).
    // Both sleeves run down into the shirt. The carton is empty in the map: its fries only show while working.
    map: [
      '........................',
      '........................',
      '........................',
      '......CCCCC.............',
      '.....CCCCCCCC...........',
      '....CCCCCCCCCC..........',
      '....cCCCCCCCCC......QQQ.',
      '...vccCCCCCCCC......QyQ.',
      '..vVVVVVVSSYYYYY....QQq.',
      '..vVVSSSSSSSSS......qQq.',
      '...vVSSSbbSSbb.......SSs',
      '....sSSSwKSSwK.......SSs',
      '....sssSSSSSSS...ppp..cR',
      '....sseSSSfSfSS.PkkkP.cR',
      '....sssSSSSfSSS.PPPPp.cR',
      '....sSSSSSSSSM..PPPPp.cR',
      '....sSSSSSSMMS..PPPPp.cR',
      '....sSSSSSSSSS..SpPPp.cR',
      '....sSSSSSSSSS..SSSs..cR',
      '.....sSSSSSSSS..SSSs..cR',
      '......sssss......cRR..cR',
      '..RRRRYSSSYRRRRRRRRRRRRR',
      '.RRRRRRYYYRRRRRRRRRRRRRR',
      '.RRRRRRRRRRRRRRRRRRRRRRR',
    ],
    ink: {
      ...COOK_BASE, ...CREW_UNIFORM, S: '#f6d2b4', s: '#d9a988', e: '#b9876a', f: '#c98b5f', M: '#8a3b2a',
      V: '#8b5cf6', v: '#5b21b6', Q: BAG_INK.Q!, q: BAG_INK.q!, y: BAG_INK.y!, P: BAG_INK.P!, p: BAG_INK.p!, k: BAG_INK.k!,
    },
    outline: COOK_OUTLINE,
    // The carton tips over the bag and three fries drop in; the bag gives a little bounce as they
    // land; the carton tips back. The arm lifts with the carton, its sleeve tucked into the shirt.
    moves: [
      {
        box: [18, 3, 23, 9],
        letters: 'Qqy',
        add: [[21, 3, BAG_INK.F!], [20, 4, BAG_INK.F!], [21, 4, BAG_INK.f!], [22, 4, BAG_INK.F!], [20, 5, BAG_INK.f!], [21, 5, BAG_INK.F!], [22, 5, BAG_INK.f!]],
        origin: '4px 8px',
        keys: [[0, 'transform:translate(0,0) rotate(0deg)'], [12, 'transform:translate(0,0) rotate(0deg)'], [36, 'transform:translate(0,-1px) rotate(-42deg)'], [64, 'transform:translate(0,-1px) rotate(-42deg)'], [88, 'transform:translate(0,0) rotate(0deg)'], [100, 'transform:translate(0,0) rotate(0deg)']],
        dur: 1.4,
      },
      {
        box: [21, 10, 23, 20],
        // The sleeve runs on into the shirt, so the lift never opens a seam at the shoulder.
        add: [[22, 21, CREW_RED], [23, 21, CREW_RED], [22, 22, CREW_RED], [23, 22, CREW_RED]],
        keys: [[0, ty(0)], [12, ty(0)], [36, ty(-1)], [64, ty(-1)], [88, ty(0)], [100, ty(0)]],
        dur: 1.4,
      },
      {
        box: [16, 12, 20, 20],
        // The sleeve runs on into the shirt, and an outline pixel by the wrist follows it up, so a lift leaves no gap.
        add: [[17, 21, CREW_RED], [18, 21, CREW_RED], [19, 21, CREW_RED], [17, 22, CREW_RED], [18, 22, CREW_RED], [19, 22, CREW_RED], [15, 20, COOK_OUTLINE]],
        keys: [[0, ty(0)], [50, ty(0)], [56, ty(-1)], [66, ty(0)], [100, ty(0)]],
        dur: 1.4,
      },
      fryDrop(18, 34, 0),
      fryDrop(17, 40, 1),
      fryDrop(18, 46, 0),
    ],
    move: 'none',
    // Done: the bag folded shut and lifted a pixel (order up), a sparkle. Failed: the carton dropped
    // on its side and fries spilled by the bag.
    rest: {
      done: [
        ...paint(15, 10, [
          '.ooooo',
          'oPPPPP',
          'oppppp',
          'oPPPPp',
          'oPPPPp',
          'oPPPPp',
          'oSpPPp',
          'oSSSso',
          'ooSSso',
          '.ocRRo',
        ], { ...BAG_INK, c: '#a51c1c' }),
        [18, 13, '#fef08a'], [17, 14, '#fef08a'], [18, 14, '#ffffff'], [19, 14, '#fef08a'], [18, 15, '#fef08a'],
      ],
      failed: [
        ...paint(16, 5, [
          '._______',
          '._ooooo_',
          '.okQyQQo',
          '.okQQQqo',
          '.okQQqqo',
          '..ooo...',
        ], BAG_INK),
        [16, 11, BAG_INK.F!], [16, 12, BAG_INK.f!], [15, 15, BAG_INK.F!], [15, 16, BAG_INK.f!], [21, 18, BAG_INK.F!], [21, 19, BAG_INK.f!],
      ],
    },
    term: { top: CREW_TOP, topColor: CREW_RED, face: '(•‿•)', hand: '⊔', handColor: '#c99a62' },
  },
  {
    id: 'manager',
    name: 'Shift manager',
    alt: 'Pixel shift manager scribbling on a clipboard with a pencil',
    // No cap: neat side-parted hair, light-blue shirt, navy tie, gold name badge, a clipboard of
    // lined paper (l, the faint rules) and, while working, a pencil in his other hand.
    map: [
      '........................',
      '......HHHHHH............',
      '.....HHHHHHHHH..........',
      '....HHHHhhhhhHH....GGG..',
      '....HHHHHHHHHHHH.PPGGGPP',
      '....HHHHHHHHHHH..PwwwwwP',
      '....HHSSSSSSSS...PlllllP',
      '....HSSSbbSSbb...PwwwwwP',
      '....sSSSwKSSwK...PlllllP',
      '....sssSSSSSSS...PwwwwwP',
      '....sseSSSSSSSS..PlllllP',
      '....sssSSSSSSSS..PwwwwwP',
      '....sSSSSSSSSS...PlllllP',
      '....sSSSSSSMMM..SSSwwwwP',
      '....sSSSSSSSSS..SSSwwwwP',
      '....sSSSSSSSSS..SSSPPPPP',
      '.....sSSSSSSSS..BBB.....',
      '......sssss.....BBB.....',
      '....BBBcSSScBBBBBBB.....',
      '..BBBBBBcTcBBBBBBBB.....',
      '.BBBBBBBBTBBBBBBBBB.....',
      '.BBBBBBBTTTBBNNBBBB.....',
      '.BBBBBBBTTTBBBBBBBB.....',
      '.BBBBBBBBTBBBBBBBBB.....',
    ],
    ink: {
      ...COOK_BASE, ...SKIN_LIGHT,
      H: '#4a3426', h: '#7a5a44', B: '#cfe2f7', c: '#ffffff', T: '#1e3a8a', N: '#facc15', P: '#8a5a2e', w: '#ffffff', l: '#d5deea', G: '#9ca3af',
    },
    outline: COOK_OUTLINE,
    // The pencil zigzags along each line and the writing shows up behind it; the head dips to the page.
    moves: scribble(),
    move: 'none',
    // Done: the page written, the pencil put down, a green tick. Failed: the last line scribbled out.
    rest: {
      done: [...writing(4), ...pencilAt(PEN_REST[0], PEN_REST[1]), [19, 13, '#16a34a'], [20, 14, '#16a34a'], [21, 13, '#16a34a']],
      failed: [...writing(3), ...SCRATCH, ...pencilAt(PEN_REST[0], PEN_REST[1])],
    },
    term: { top: ' ▗▄▄▄▖', topColor: '#4a3426', face: COOK_FACE, hand: '✎', handColor: '#eab308', low: '  ▼', lowColor: '#1e3a8a' },
  },
  {
    id: 'crew-burger-flipper',
    name: 'Crew burger flipper',
    alt: 'Pixel crew burger flipper flipping a cheesy patty off a spatula',
    crew: true,
    // Spatula up, a cheesy patty (P, p) mid-flip above it.
    map: [
      '........................',
      '................YYYYYY..',
      '...............PYPPPYPP.',
      '......CCCCC....pPpPpPpP.',
      '.....CCCCCCCC...........',
      '....CCCCCCCCCC..........',
      '....cCCCCCCCCC..........',
      '....ccCCCCCCCC..........',
      '....HHSSSSSYYYYY........',
      '....HSSSSSSSSS...GGGGGG.',
      '....sSSSbbSSbb...GgGgGG.',
      '....sSSSwKSSwK.....k....',
      '....sssSSSSSSS.....k....',
      '....sseSSSSSSSS....k....',
      '....sssSSSSSSSS...SkS...',
      '....sSSSSSSSSS....SSS...',
      '....sSSSSSSMMM....SSS...',
      '....sSSSSSSSSS....RRR...',
      '....sSSSSSSSSS....RRR...',
      '.....sSSSSSSSS....RRR...',
      '......sssss.......RRR...',
      '..RRRRYSSSYRRRRRRRRRR...',
      '.RRRRRRYYYRRRRRRRRRRR...',
      '.RRRRRRRRRRRRRRRRRRRR...',
    ],
    ink: { ...COOK_BASE, ...CREW_UNIFORM, ...SKIN_BASE, H: '#3b2a20', P: '#8a4b2a', p: '#5c2e17', G: '#b4b9c2', g: '#4b5563', k: '#3a3a3a' },
    outline: COOK_OUTLINE,
    // A quick toss: the patty drops onto the spatula, the spatula flicks and it flips once in the
    // air and hangs a beat; burnt when a turn fails.
    phaseInk: { P: { failed: '#4a2c1c' }, p: { failed: '#2e1a10' } },
    moves: [
      {
        box: [15, 1, 22, 3],
        keys: [
          [0, `${ty(0)} scaleY(1)`], [8, `${ty(0)} scaleY(1)${easeIn}`], [34, `${ty(4)} scaleY(1)`], [46, `${ty(4)} scaleY(1)${easeOut}`],
          [60, `${ty(1)} scaleY(-1)`], [74, `${ty(-1)} scaleY(1)`], [88, `${ty(0)} scaleY(1)`], [100, `${ty(0)} scaleY(1)`],
        ],
        dur: 0.9,
      },
      { box: [17, 9, 22, 14], letters: 'GgkS', keys: [[0, ty(0)], [32, ty(0)], [38, ty(0.5)], [46, ty(0)], [52, ty(-1)], [64, ty(0)], [100, ty(0)]], dur: 0.9 },
    ],
    move: 'none',
    term: crewTerm('#8a4b2a'),
  },
  {
    id: 'crew-fry-cook',
    name: 'Crew fry cook',
    alt: 'Pixel crew fry cook shaking a wire basket of fries',
    crew: true,
    // A wire fry basket (G, g) heaped with fries (F, f), held clear of the face.
    map: [
      '........................',
      '........................',
      '........................',
      '......CCCCC.............',
      '.....CCCCCCCC...........',
      '....CCCCCCCCCC..........',
      '....cCCCCCCCCC..........',
      '....ccCCCCCCCC....F.F.F.',
      '....HHSSSSSYYYYY..fFfF.F',
      '....HSSSSSSSSS....fFfFfF',
      '....sSSSbbSSbb...FfFfFfF',
      '....sSSSwKSSwK...GGGGGGG',
      '....sssSSSSSSS...GgGgGgG',
      '....sseSSSSSSSS..gGgGgGg',
      '....sssSSSSSSSS..GgGgGgG',
      '....sSSSSSSSSS....gGgGg.',
      '....sSSSSSSMMM......k...',
      '....sSSSSSSSSS.....SkS..',
      '....sSSSSSSSSS.....SSS..',
      '.....sSSSSSSSS.....RRR..',
      '......sssss........RRR..',
      '..RRRRYSSSYRRRRRRRRRRR..',
      '.RRRRRRYYYRRRRRRRRRRRR..',
      '.RRRRRRRRRRRRRRRRRRRRR..',
    ],
    ink: { ...COOK_BASE, ...CREW_UNIFORM, ...SKIN_TAN, H: '#5a3a22', F: '#facc15', f: '#d99a06', G: '#c4c9d1', g: '#5b6370', k: '#3a3a3a' },
    outline: COOK_OUTLINE,
    // The basket dips and shakes, steam rises off the fries; grey fries when a turn fails.
    phaseInk: { F: { failed: '#b3aa8a' }, f: { failed: '#8c856e' } },
    puffs: { at: [20, 5], core: '#fafaf9', edge: '#a8a29e' },
    moves: [
      {
        box: [17, 7, 23, 16],
        letters: 'FfGgk',
        keys: [[0, ty(0)], [20, ty(1)], [32, tr(-0.75, 1)], [44, tr(0.5, 1)], [56, tr(-0.75, 1)], [68, tr(0.5, 1)], [82, ty(0)], [100, ty(0)]],
        dur: 1.1,
      },
    ],
    move: 'none',
    term: crewTerm('#facc15'),
  },
  {
    id: 'cleaner',
    name: 'Cleaner',
    alt: 'Pixel crew cleaner with a grey beard swishing a mop over a yellow bucket',
    crew: true,
    // Short grey beard (m), a mop (P handle, W head) standing in a yellow bucket (Q, q).
    map: [
      '........................',
      '....................P...',
      '....................P...',
      '......CCCCC.........P...',
      '.....CCCCCCCC.......P...',
      '....CCCCCCCCCC......P...',
      '....cCCCCCCCCC......P...',
      '....ccCCCCCCCC......P...',
      '....HHSSSSSYYYYY....P...',
      '....HSSSSSSSSS......P...',
      '....sSSSbbSSbb......P...',
      '....sSSSwKSSwK......P...',
      '....sssSSSSSSS......P...',
      '....sseSSSSSSSS.....P...',
      '....sssSSSSSSSS.....P...',
      '....sSSSSSSSSS....WWPWW.',
      '....sSSSSSSMMM...WWWWWWW',
      '....sSmSSSSSSS..GGGGGGGG',
      '....smmSSSSmmm...QQQQQQq',
      '.....mmmmmmmmm...QQQQQQq',
      '......mmmmm......QQQQQQq',
      '..RRRRYSSSYRRRRR.QQQQQQq',
      '.RRRRRRYYYRRRRRR.QQQQQQq',
      '.RRRRRRRRRRRRRRR.qqqqqqq',
    ],
    ink: { ...COOK_BASE, ...CREW_UNIFORM, ...SKIN_DEEP, H: '#cfcfd4', m: '#cfcfd4', P: '#a0703c', G: '#6b7280', W: '#f4f4f5', Q: '#facc15', q: '#d99a06' },
    outline: COOK_OUTLINE,
    // The mop swishes left and right from the top of its handle; a grey mop head when a turn fails.
    phaseInk: { W: { failed: '#a8a29e' } },
    moves: [
      {
        box: [16, 1, 23, 16],
        letters: 'PW',
        origin: '50% 0',
        keys: swing(sx(-5), sx(4)),
        dur: 1.1,
      },
    ],
    move: 'none',
    term: crewTerm('#a0703c'),
  },
  {
    id: 'dessert-maker',
    name: 'Dessert maker',
    alt: 'Pixel crew dessert maker with a blonde ponytail holding a tall soft-serve cone',
    crew: true,
    // Blonde ponytail, a tall strawberry-vanilla soft-serve (W, w) on a cone (T, t).
    map: [
      '........................',
      '....................WW..',
      '...................WWW..',
      '......CCCCC.......wwwww.',
      '.....CCCCCCCC.....WWWWW.',
      '....CCCCCCCCCC...wwwwwww',
      '....cCCCCCCCCC...WWWWWWW',
      '..HHccCCCCCCCC...wwwwwww',
      '.HHHHHSSSSSYYYYY.TTTTTTT',
      '.HHHHSSSSSSSSS....TtTtT.',
      '..HHsSSSbbSSbb....tTtTt.',
      '..HHsSSSwKSSwK.....TtT..',
      '...HsssSSSSSSS.....tTt..',
      '....sseSSSSSSSS.....T...',
      '....sssSSSSSSSS....SSS..',
      '....sSSSSSSSSS.....SSS..',
      '....sSSSSSSMMM.....SSS..',
      '....sSSSSSSSSS.....RRR..',
      '....sSSSSSSSSS.....RRR..',
      '.....sSSSSSSSS.....RRR..',
      '......sssss........RRR..',
      '..RRRRYSSSYRRRRRRRRRRR..',
      '.RRRRRRYYYRRRRRRRRRRRR..',
      '.RRRRRRRRRRRRRRRRRRRRR..',
    ],
    ink: { ...COOK_BASE, ...CREW_UNIFORM, ...SKIN_LIGHT, H: '#f2c94c', W: '#fff7e6', w: '#f9a8d4', T: '#d9a35b', t: '#a8742f', b: '#9a6a2a' },
    outline: COOK_OUTLINE,
    // The swirl sways, its tip furthest, and two sparkles twinkle; the pink fades when a turn fails.
    phaseInk: { w: { failed: '#c9b3bd' } },
    flicker: { px: [[15, 2, '#facc15'], [23, 11, '#facc15']] },
    moves: [
      { box: [17, 1, 23, 2], keys: swing(tx(-1.5), tx(1.5)), dur: 1.4 },
      { box: [17, 3, 23, 4], keys: swing(tx(-0.5), tx(0.5)), dur: 1.4 },
    ],
    move: 'none',
    term: crewTerm('#f9a8d4'),
  },
  {
    id: 'cashier',
    name: 'Cashier',
    alt: 'Pixel crew cashier with a hair bun at a till printing a receipt',
    crew: true,
    // Black hair bun, a till (G, g) with a green display (n) and a receipt (w, L) curling out.
    map: [
      '........................',
      '........................',
      '........................',
      '......CCCCC......ww.....',
      '.....CCCCCCCC....Lw.....',
      '....CCCCCCCCCC...ww.....',
      '...HcCCCCCCCCC...wL.....',
      '..HHccCCCCCCCC...ww.....',
      '..HHHHSSSSSYYYYY.Lw.kkkk',
      '...HHSSSSSSSSS...ww.knnk',
      '....sSSSbbSSbb...ww.kkkk',
      '....sSSSwKSSwK...ww..kk.',
      '....sssSSSSSSS..GGGGGGGG',
      '....sseSSSSSSSS.GaGaGaGG',
      '....sssSSSSSSSS.GGGGGGGG',
      '....sSSSSSSSSS..GaGaGaGG',
      '....sSSSSSSMMM..GGGGGGGG',
      '....sSSSSSSSSS..gggggggg',
      '....sSSSSSSSSS..gggYYggg',
      '.....sSSSSSSSS..gggggggg',
      '......sssss.............',
      '..RRRRYSSSYRRRR.........',
      '.RRRRRRYYYRRRRR.........',
      '.RRRRRRRRRRRRRR.........',
    ],
    ink: { ...COOK_BASE, ...CREW_UNIFORM, ...SKIN_BROWN, H: '#1c1410', w: '#fafaf9', L: '#9ca3af', k: '#374151', n: '#4ade80', G: '#a3a8b3', a: '#f4f4f5', g: '#6b7280', M: '#9b2c4a' },
    outline: COOK_OUTLINE,
    // The receipt prints up out of the till, the drawer pops, the display glows; it goes dark when a turn fails.
    phaseInk: { n: { failed: '#4b5563' } },
    flicker: { px: [[21, 9, '#bbf7d0'], [22, 9, '#bbf7d0']] },
    moves: [
      {
        box: [17, 3, 18, 11],
        under: true,
        keys: [[0, `${ty(6)};opacity:1`], [55, `${ty(0)};opacity:1`], [78, `${ty(0)};opacity:1`], [90, `${ty(-1)};opacity:0`], [100, `${ty(6)};opacity:0`]],
        ease: 'linear',
        dur: 1.8,
      },
      { box: [16, 17, 23, 19], keys: [[0, ty(0)], [74, ty(0)], [80, ty(1)], [92, ty(0)], [100, ty(0)]], dur: 1.8 },
    ],
    move: 'none',
    term: crewTerm('#4ade80'),
  },
  {
    id: 'drive-thru',
    name: 'Drive-thru',
    alt: 'Pixel crew drive-thru worker in a headset handing out a paper bag',
    crew: true,
    // Ginger hair and freckles (f), a headset with a mic (K, g), holding out a paper bag (P, p).
    map: [
      '........................',
      '........................',
      '........................',
      '......CCCCC......P.P.P.P',
      '.....CKCCCCCC....PPPPPPP',
      '....CKCCCCCCCC...PPPPPPp',
      '....cKCCCCCCCC...ppppppp',
      '....cKCCCCCCCC...PPPPPPp',
      '....HKSSSSSYYYYY.PPPPPPp',
      '....HKSSSSSSSS...PPPPPPp',
      '....sKSSbbSSbb...PPPPPPp',
      '....sKSSwKSSwK...PPPPPPp',
      '....sKKSSfSfSS...PPPPPPp',
      '....KgKSSSfSSSS..PPPPPPp',
      '....sKKSSSSSSSS..ppppppp',
      '....sSgSSSSSSS.....SSS..',
      '....sSSggggKMM.....SSS..',
      '....sSSSSSSSSS.....SSS..',
      '....sSSSSSSSSS.....RRR..',
      '.....sSSSSSSSS.....RRR..',
      '......sssss........RRR..',
      '..RRRRYSSSYRRRRRRRRRRR..',
      '.RRRRRRYYYRRRRRRRRRRRR..',
      '.RRRRRRRRRRRRRRRRRRRRR..',
    ],
    ink: { ...COOK_BASE, ...CREW_UNIFORM, ...SKIN_LIGHT, H: '#c2562a', f: '#c47a4f', g: '#8a8a94', P: '#d0a165', p: '#a0723a' },
    outline: COOK_OUTLINE,
    // The bag, hand and sleeve lift up and out, then settle; the added red pixels lengthen the sleeve.
    moves: [
      {
        box: [17, 3, 23, 20],
        letters: 'PpSR',
        add: [19, 20, 21].flatMap(x => [[x, 21, CREW_RED], [x, 22, CREW_RED]] as Pixel[]),
        keys: [[0, ty(0)], [35, ty(-2)], [60, ty(-2)], [90, ty(0)], [100, ty(0)]],
        dur: 1.3,
      },
    ],
    move: 'none',
    term: crewTerm('#d0a165'),
  },
  {
    id: 'drinks-station',
    name: 'Drinks station',
    alt: 'Pixel crew drinks server with a goatee holding a big fizzy soda cup',
    crew: true,
    // Black hair and goatee (B), a big lidded soda cup (L, W, U) with a striped straw (Z, z).
    map: [
      '........................',
      '......................Z.',
      '.....................ZZ.',
      '......CCCCC..........z..',
      '.....CCCCCCCC........Z..',
      '....CCCCCCCCCC.......z..',
      '....cCCCCCCCCC...LLLLZL.',
      '....ccCCCCCCCC...LLLLLLL',
      '....HHSSSSSYYYYY.WWWWWWw',
      '....HSSSSSSSSS...WWWWWWw',
      '....sSSSbbSSbb...UUUUUUu',
      '....sSSSwKSSwK...UUUUUUu',
      '....sssSSSSSSS...WWWWWWw',
      '....sseSSSSSSSS...WWWWw.',
      '....sssSSSSSSSS...WWWWw.',
      '....sSSSSSSSSS....WWWWw.',
      '....sSSSSSSMMM....SSSS..',
      '....sSSSSSSSSS....SSSS..',
      '....sSSSSSSBBS.....RRR..',
      '.....sSSSSBBSS.....RRR..',
      '......sssss........RRR..',
      '..RRRRYSSSYRRRRRRRRRRR..',
      '.RRRRRRYYYRRRRRRRRRRRR..',
      '.RRRRRRRRRRRRRRRRRRRRR..',
    ],
    ink: { ...COOK_BASE, ...CREW_UNIFORM, ...SKIN_TAN, H: '#1c1410', B: '#1c1410', Z: '#dc2626', z: '#fafafa', L: '#d4d4d8', W: '#fafafa', w: '#cfd2d8', U: '#38bdf8', u: '#0284c7' },
    outline: COOK_OUTLINE,
    // Fizz bubbles rise off the lid by the straw; the drink goes flat grey when a turn fails.
    phaseInk: { U: { failed: '#9ca3af' }, u: { failed: '#6b7280' } },
    moves: [fizz(18, 5, 0), fizz(19, 4, 0.4), fizz(17, 4, 0.8)],
    move: 'none',
    term: crewTerm('#38bdf8'),
  },
  {
    id: 'prep-cook',
    name: 'Prep cook',
    alt: 'Pixel crew prep cook with a black beard chopping with a knife over a tomato',
    crew: true,
    // Full black beard (B), a chef knife (G blade, k handle) raised over a tomato and lettuce on a board.
    map: [
      '........................',
      '........................',
      '.....................G..',
      '......CCCCC.........GG..',
      '.....CCCCCCCC.......GG..',
      '....CCCCCCCCCC......GG..',
      '....cCCCCCCCCC......GG..',
      '....ccCCCCCCCC......GG..',
      '....BBSSSSSYYYYY....GG..',
      '....BSSSSSSSSS.....SkS..',
      '....sSSSbbSSbb.....SkS..',
      '....sSSSwKSSwK.....SSS..',
      '....sssSSSSSSS..........',
      '....sseSSSSSSSS.........',
      '....sssSSSSSSSS....V....',
      '....sBSSSSSBBBB...TTTT..',
      '....sBBSSSSMMMB..TTtTTT.',
      '....sBBBBBBBBB...TTTTTVV',
      '....sBBBBBBBBB...TTTTVVV',
      '.....BBBBBBBBB....TTTVV.',
      '......BBBBB....PPPPPPPPP',
      '..RRRRYSSSYRRR.ppppppppp',
      '.RRRRRRYYYRRRR..........',
      '.RRRRRRRRRRRRR..........',
    ],
    ink: { ...COOK_BASE, ...CREW_UNIFORM, ...SKIN_BROWN, B: '#1c1410', G: '#d6dae0', k: '#3a2a1c', T: '#e5322d', t: '#ffb4a8', V: '#4caf3a', P: '#c99a5e', p: '#8f6533' },
    outline: COOK_OUTLINE,
    // The hand and knife chop down two pixels and back; the blade dulls when a turn fails.
    phaseInk: { G: { failed: '#8b9099' } },
    moves: [{ box: [19, 2, 21, 11], keys: [[0, ty(0)], [30, `${ty(-0.5)}${easeIn}`], [45, ty(2)], [58, ty(2)], [100, ty(0)]], dur: 0.7 }],
    move: 'none',
    term: crewTerm('#e5322d'),
  },
  {
    id: 'dishwasher',
    name: 'Dishwasher',
    alt: 'Pixel crew dishwasher with a moustache scrubbing a plate as soap bubbles rise',
    crew: true,
    // Brown moustache (B), scrubbing a plate (W, u) with a sponge (V, Q) in a pink glove (O), bubbles (o) rising.
    map: [
      '........................',
      '........................',
      '.....................oo.',
      '......CCCCC..........oo.',
      '.....CCCCCCCC...oo......',
      '....CCCCCCCCCC..oo......',
      '....cCCCCCCCCC.......o..',
      '....ccCCCCCCCC..........',
      '....HHSSSSSYYYYY........',
      '....HSSSSSSSSS....uuuu..',
      '....sSSSbbSSbb...uWWWWu.',
      '....sSSSwKSSwK..uWWWWWWu',
      '....sssSSSSSSS..uWWWWWWu',
      '....sseSSSSSSSS.uWWWWWWu',
      '....sssSSSSSSSS.uWWWVVVV',
      '....sSSSSSSBBB...uWWQQQQ',
      '....sSSSSSSMMM....uuQQQQ',
      '....sSSSSSSSSS......OOO.',
      '....sSSSSSSSSS......OOO.',
      '.....sSSSSSSSS......RRR.',
      '......sssss.........RRR.',
      '..RRRRYSSSYRRRRRRRRRRRR.',
      '.RRRRRRYYYRRRRRRRRRRRRR.',
      '.RRRRRRRRRRRRRRRRRRRRRR.',
    ],
    ink: { ...COOK_BASE, ...CREW_UNIFORM, ...SKIN_LIGHT, H: '#6b4a2e', B: '#6b4a2e', W: '#ffffff', V: '#3f9a3a', u: '#6fa3dc', Q: '#fde047', O: '#f472b6', o: '#bae6fd' },
    outline: COOK_OUTLINE,
    // Soap bubbles rise and pop, the plate wiggles, the sponge scrubs; the bubbles go grey when a turn fails.
    phaseInk: { o: { failed: '#d4d4d8' } },
    moves: [
      rise([21, 2, 22, 3], 0),
      rise([16, 4, 17, 5], 0.5),
      rise([21, 6, 21, 6], 1),
      { box: [16, 9, 23, 16], letters: 'Wu', keys: swing(ty(0), ty(-1)), dur: 0.6, delay: 0.15 },
      { box: [20, 14, 23, 18], letters: 'VQO', keys: swing(tx(0), tx(-1)), dur: 0.4 },
    ],
    move: 'none',
    term: crewTerm('#6fa3dc'),
  },
  {
    id: 'delivery-rider',
    name: 'Delivery rider',
    alt: 'Pixel crew delivery rider in a red helmet with a big insulated bag',
    crew: true,
    // Red crew helmet with a white stripe, a strap (k) across the chest to a big insulated bag (Q, q).
    map: [
      '........................',
      '........................',
      '.......CCCCCC...........',
      '.....CCCCCCCCCC.........',
      '....CCCWWWWCCCCC........',
      '...CCCCCCCCCCCCC........',
      '...cCCCCCCCCCCCC...kkkk.',
      '...ccCCCCCCCCCkkk..k..k.',
      '...cccSSSSSSSS..qqqqqqqq',
      '...cccSSSSSSSS..QQQQQQQq',
      '...cccSSbbSSbb..QQQQQQQq',
      '...cccSSwKSSwK..WWWWWWWq',
      '....ckSSSSSSSS..QQQQQQQq',
      '....ckSSSSSSSSS.QQQQQQQq',
      '....skSSSSSSSSS.QQQQQQQq',
      '....sSkSSSSSSS..QQQQQQQq',
      '....sSSkSSSMMM..qqqqqqqq',
      '....sSSSkSSSSS..........',
      '....sSSSSkSSSS..........',
      '.....sSSSSkSSS..........',
      '......sssss.............',
      '..RRRRYSSSYRRRR.........',
      '.RRRRRRYYYRRRRR.........',
      '.RRRRRRRRRRRRRR.........',
    ],
    ink: { ...COOK_BASE, ...CREW_UNIFORM, ...SKIN_DEEP, W: '#fafafa', k: '#2a2a2a', Q: '#f59e0b', q: '#b45309' },
    outline: COOK_OUTLINE,
    // Riding: the rider bobs, the bag bounces twice as fast, speed lines streak past behind.
    moves: [
      { box: [16, 6, 23, 16], letters: 'kqQW', keys: swing(ty(0), ty(-1)), dur: 0.5 },
      speedLine(13, 0),
      speedLine(17, 0.3),
    ],
    move: 'ride',
    term: crewTerm('#f59e0b'),
  },
  {
    id: 'trainee',
    name: 'Trainee',
    alt: 'Pixel crew trainee in an oversized cap balancing a wobbly tray',
    crew: true,
    // Oversized cap down low, a nervous sweat drop (D, d), a tray (T, t) with a burger and a drink.
    map: [
      '........................',
      '.......CCCCCC...........',
      '.....CCCCCCCCCC.........',
      '....CCCCCCCCCCCC........',
      '...CCCCCCCCCCCCC........',
      '...cCCCCCCCCCCCC........',
      '...cCCCCCCCCCCCC........',
      '...ccCCCCCCCCCCC........',
      '..HHHHSSSSSYYYYYYYYY....',
      '....HSSSbSSSbS..........',
      '....sSSSSbSSSb..D.....z.',
      '....sSSSwKSSwK.DD....LLL',
      '....sssSSSSSSS.Dd....WrW',
      '....sseSSSSSSSS..UU..WrW',
      '....sssSSSSSSSS.UUUU.WWW',
      '....sSSSSSSSSS..VVVV.WWW',
      '....sSSSSSSSMM..pppp.WWW',
      '....sSSSSSSSSS..UUUU.WWW',
      '....sSSSSSSSSS.TTTTTTTTT',
      '.....sSSSSSSSS.ttttttttt',
      '......sssss.......SSS...',
      '..RRRRYSSSYRRRRRRRRRR...',
      '.RRRRRRYYYRRRRRRRRRRR...',
      '.RRRRRRRRRRRRRRRRRRRR...',
    ],
    ink: { ...COOK_BASE, ...CREW_UNIFORM, ...SKIN_TAN, H: '#1c1410', D: '#7dd3fc', d: '#0ea5e9', L: '#e5e7eb', r: '#dc2626', z: '#dc2626', W: '#fafafa', U: '#e0a050', p: '#6b3a1e', V: '#4caf3a', T: '#b45309', t: '#7c2d12' },
    outline: COOK_OUTLINE,
    // The sweat drop slides down behind the tray and fades; the tray tilts one way, then the other.
    moves: [
      {
        box: [15, 10, 17, 12],
        letters: 'Dd',
        under: true,
        keys: [[0, `${ty(0)};opacity:0`], [15, `${ty(0)};opacity:1`], [65, `${ty(2)};opacity:1`], [85, `${ty(2.5)};opacity:0`], [100, `${ty(2.5)};opacity:0`]],
        ease: 'ease-in',
        dur: 1.2,
      },
      { box: [15, 10, 23, 19], keys: swing(sy(-10), sy(10)), dur: 1.2 },
    ],
    move: 'none',
    term: crewTerm('#e0a050'),
  },
]

/** The mascot with this id, or the default one. */
export function mascotOf(id: string | undefined | null): Mascot {
  return MASCOTS.find(m => m.id === id) ?? MASCOTS.find(m => m.id === DEFAULT_MASCOT)!
}

/** The crew subagent cards wear, in the order they are handed out (the manager is not one of them). */
export const CREW: string[] = MASCOTS.filter(m => m.crew).map(m => m.id)

// ---------- The renderer ----------

const MOVE_CSS = {
  nod: `.bob{animation:bob 3s ease-in-out infinite}
@keyframes bob{0%,60%,100%{transform:translateY(0)}72%{transform:translateY(1px)}84%{transform:translateY(0)}}`,
  bob: `.bob{animation:bob 1s steps(1,end) infinite}
@keyframes bob{0%{transform:translateY(0)}50%{transform:translateY(1px)}}`,
  ride: `.bob{animation:bob .5s ease-in-out infinite alternate}
@keyframes bob{from{transform:translateY(0)}to{transform:translateY(1px)}}`,
}
const FLICKER_CSS = `.em{opacity:.7;animation:em 1.3s ease-in-out infinite alternate}
@keyframes em{from{opacity:.15}to{opacity:1}}`
const GLOW_CSS = `.gl{opacity:0;animation:gl 1.3s ease-in-out infinite alternate}
@keyframes gl{from{opacity:0}to{opacity:.6}}`
const PUFF_CSS = `.pf{opacity:0;transform-box:fill-box;transform-origin:center;animation:2.7s ease-in-out infinite}
.p1{animation-name:pa}
.p2{animation-name:pb;animation-delay:-.9s}
.p3{animation-name:pc;animation-delay:-1.8s}
@keyframes pa{0%{opacity:0;transform:translate(0,0) scale(.6)}20%{opacity:.95}70%{opacity:.6}100%{opacity:0;transform:translate(-2px,-9px) scale(1.2)}}
@keyframes pb{0%{opacity:0;transform:translate(0,0) scale(.6)}20%{opacity:.9}70%{opacity:.5}100%{opacity:0;transform:translate(2px,-10px) scale(1.3)}}
@keyframes pc{0%{opacity:0;transform:translate(0,0)}20%{opacity:.9}50%{transform:translate(1px,-4px)}100%{opacity:0;transform:translate(-1px,-8px)}}`
const WISP_CSS = `.wisp{opacity:0;animation:wisp 4.5s ease-in-out infinite}
@keyframes wisp{0%{opacity:0;transform:translate(0,0)}30%{opacity:.35}100%{opacity:0;transform:translate(1px,-9px)}}`
const still = (classes: string[]) => `@media (prefers-reduced-motion: reduce){${classes.join(',')}{animation:none}}`

/** One rect per run of a colour along a row. */
function runs(grid: string[][]): string[] {
  const rects: string[] = []
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const c = row[x]
      let end = x + 1
      while (end < row.length && row[end] === c) end += 1
      if (c) rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${c}"/>`)
      x = end
    }
  })
  return rects
}

const svgCache = new Map<string, string>()

/**
 * A mascot in a phase, as an SVG document. CSS moves it, so the drawing depends only on the
 * mascot and the phase and the desktop keeps its frame across redraws (draw it `isInteractive`).
 * Working: puffs rise and fade, the flicker pixels glow, the figure nods or bobs.
 * Done: one slow faint wisp, the phase colours dim. Failed: no puffs, the phase colours go grey.
 */
export function mascotSvg(id: string, phase: HelperPhase): string {
  const m = mascotOf(id)
  const key = `${m.id}:${phase}`
  const hit = svgCache.get(key)
  if (hit) return hit
  const working = phase === 'working'
  const map = m.map.map(row => row.padEnd(24, '.'))
  const cells = new Set<string>()
  map.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && cells.add(`${x},${y}`)))
  const ink = (ch: string) => m.phaseInk?.[ch]?.[phase] ?? m.ink[ch] ?? m.outline
  const near = (k: string) => {
    const [x, y] = k.split(',').map(Number) as [number, number]
    return ([[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as [number, number][]).filter(
      ([ax, ay]) => ay >= 0 && ay < map.length && ax >= 0 && ax < 24,
    )
  }
  // A one-pixel outline round every filled pixel.
  const grid: string[][] = map.map(row => [...row].map(ch => (ch === '.' ? '' : ink(ch))))
  for (const k of cells) for (const [ax, ay] of near(k)) if (!cells.has(`${ax},${ay}`)) grid[ay]![ax] = m.outline
  if (phase !== 'working') for (const [x, y, c] of m.rest?.[phase] ?? []) grid[y]![x] = c
  const rects = runs(grid)
  const rect = (x: number, y: number, c: string, cls = '') =>
    `<rect${cls ? ` class="${cls}"` : ''} x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`
  const puff = (i: number, cls: string) => {
    const { at: [ax, ay], core, edge } = m.puffs!
    const px: Pixel[][] = [
      [[ax, ay - 1, core], [ax - 1, ay - 1, edge], [ax + 1, ay - 1, edge], [ax, ay - 2, edge], [ax, ay, edge]],
      [[ax, ay, core], [ax + 1, ay, edge], [ax, ay + 1, edge], [ax + 1, ay + 1, edge]],
      [[ax, ay, edge]],
    ]
    return `<g class="pf ${cls}">${px[i]!.map(([x, y, c]) => rect(x, y, c)).join('')}</g>`
  }
  const figure = rects.join('')
  let body = figure
  const css: string[] = []
  if (working) {
    const used: string[] = []
    let inner = figure
    if (m.moves?.length) {
      // Each part takes its pixels out of the figure. The figure's outline still runs under a part
      // drawn over it (not under one drawn beneath), and a part's outline only fills empty pixels,
      // so at rest the drawing is the map's; once a part moves, the edges it leaves show.
      const owner = new Map<string, number>()
      m.moves.forEach((mv, i) => {
        if (!mv.box) return
        const [x0, y0, x1, y1] = mv.box
        for (const k of cells) {
          const [x, y] = k.split(',').map(Number) as [number, number]
          const inBox = x >= x0 && x <= x1 && y >= y0 && y <= y1
          if (inBox && !owner.has(k) && (!mv.letters || mv.letters.includes(map[y]![x]!))) owner.set(k, i)
        }
      })
      const blank = () => map.map(() => Array<string>(24).fill(''))
      const below = new Set([...owner].filter(([, i]) => m.moves![i]!.under).map(([k]) => k))
      const base = blank()
      for (const k of cells) {
        if (owner.has(k)) continue
        const [x, y] = k.split(',').map(Number) as [number, number]
        base[y]![x] = ink(map[y]![x]!)
        for (const [ax, ay] of near(k)) {
          const n = `${ax},${ay}`
          if (!cells.has(n) || (owner.has(n) && !below.has(n))) base[ay]![ax] = m.outline
        }
      }
      const parts = m.moves.map((mv, i) => {
        const g = blank()
        const mine = new Set<string>()
        for (const [k, j] of owner) {
          if (j !== i) continue
          const [x, y] = k.split(',').map(Number) as [number, number]
          g[y]![x] = ink(map[y]![x]!)
          mine.add(k)
        }
        for (const [x, y, c] of mv.add ?? []) {
          if (y < 0 || y >= map.length || x < 0 || x >= 24) continue
          g[y]![x] = c
          mine.add(`${x},${y}`)
        }
        if (!mv.bare) for (const k of mine) for (const [ax, ay] of near(k)) if (!mine.has(`${ax},${ay}`) && !cells.has(`${ax},${ay}`)) g[ay]![ax] = m.outline
        css.push(
          `.pt${i}{transform-box:fill-box;transform-origin:${mv.origin ?? 'center'};animation:pk${i} ${mv.dur}s ${mv.ease ?? 'ease-in-out'} infinite${mv.delay ? `;animation-delay:-${mv.delay}s` : ''}}`,
          `@keyframes pk${i}{${mv.keys.map(([pct, decl]) => `${pct}%{${decl}}`).join('')}}`,
        )
        used.push(`.pt${i}`)
        return { under: !!mv.under, svg: `<g class="pt${i}">${runs(g).join('')}</g>` }
      })
      inner = [...parts.filter(pt => pt.under), { svg: runs(base).join('') }, ...parts.filter(pt => !pt.under)].map(pt => pt.svg).join('')
    }
    if (m.move !== 'none') {
      css.push(MOVE_CSS[m.move])
      used.push('.bob')
    }
    if (m.flicker) {
      inner += m.flicker.px.map(([x, y, c]) => rect(x, y, c, 'em')).join('')
      css.push(FLICKER_CSS)
      used.push('.em')
      if (m.flicker.glow?.length) {
        inner += `<g class="gl">${m.flicker.glow.map(([x, y, c]) => rect(x, y, c)).join('')}</g>`
        css.push(GLOW_CSS)
        used.push('.gl')
      }
    }
    body = m.move !== 'none' ? `<g class="bob">${inner}</g>` : inner
    if (m.puffs) {
      body += `${puff(0, 'p1')}${puff(1, 'p2')}${puff(2, 'p3')}`
      css.push(PUFF_CSS)
      used.push('.pf')
    }
    if (used.length) css.push(still(used))
  } else if (phase === 'done' && m.puffs) {
    body = `${figure}${puff(2, 'wisp')}`
    css.push(WISP_CSS, still(['.wisp']))
  }
  const style = css.length ? `<style>\n${css.join('\n')}\n</style>` : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${MASCOT_PX}" height="${MASCOT_PX}" shape-rendering="crispEdges">${style}${body}</svg>`
  svgCache.set(key, svg)
  return svg
}
