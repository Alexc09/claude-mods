import type { BoxProps, ElementConstructor, RenderElement, SvgProps, TextProps } from 'claude-code'

import type { BandPlan, Helper } from '../types'

/**
 * The "Ice floe" view of the Helper Desk pane: the main chat and each running subagent as a penguin
 * on an ice floe, with short speech bubbles built from what the desk already knows (no model calls).
 *
 * Sizing (read from the desktop renderer and its font, not guessed):
 * - A Box's width/left are in `ch` and its height/top in `lh`; Svg width/height are CSS pixels, with
 *   `max-width:100%`, and the drawing inside its frame is stretched to the frame (`body>svg{width:100%;height:100%}`).
 * - Box width/height also take a percentage string ("12.5%"); left/top take integers only.
 * - The pane body is `text-body`: 0.875rem (14px) on a 1.25rem (20px) line, in Anthropic Sans, whose "0"
 *   is 0.604 em wide, so 1ch = 8.456px and 1lh = 20px. bodyColumns = floor(content width / 1ch).
 *
 * - The engine takes whole percentages only (/^\d{1,3}%$/) for width and height.
 * - The pane's width reaches the hook as `bodyColumns`: the desktop measures its body (a ResizeObserver)
 *   and sends floor(width / 1ch), and the hook runs again when that changes.
 *
 * So the scene zooms out to fit: from bodyColumns it picks a scale (fitScale, at most 1) at which the whole
 * ART_W x ART_H floe fits the pane, and draws the floe, the backdrop and every penguin at that scale (Svg
 * width/height). Every penguin and bubble is placed inside the floe's box by whole-percent spacers, and a
 * percent of the floe's box scales with it, so spots stay on the floe at any width. A wider pane than the
 * floe shows more sea and sky from a second, wide backdrop drawing centred the same way (its sky and sea
 * are the only ones, so the two meet without a seam). Text (bubbles, names) keeps the pane's size; on a
 * small floe a name that would run into another is left out, and a bubble that cannot fit waits.
 * A bubble line that runs wider than estimated ends in an ellipsis instead of overflowing.
 */

export type FloeEls = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Svg: ElementConstructor<SvgProps>
}

/** The floe drawing's size in CSS pixels at scale 1; the scene is this tall times its scale. */
export const ART_W = 560
export const ART_H = 320
/** The backdrop: sky, hills and sea, wide enough for any pane, cropped to it from the middle. */
const BACK_W = 2000
const HZ = 70
/** The desktop's cap on one Svg source. */
export const MAX_SOURCE = 131_072

/** Pane text, from the renderer and font (see the top of this file). */
export const CH_PX = 8.456
export const LH_PX = 20
const FONT_PX = 14

/** How far into its burst a penguin's drawing has shrunk away (its `.g` animation): its name goes then too. */
export const PUFF_MS = 500

/** How long the main chat's "<Name>, task" and reaction lines and a helper's new step stay up. */
export const SAY_MS = 4000
export const STEP_SAY_MS = 6000
/** Bubble text is never longer than this. */
const MAX_SAY = 28

/**
 * Fixed spots, [centre x, top y] in whole percents of the floe (at scale 1, x times 5.6px, y times 3.2px):
 * 0 is the main chat in the middle, then 7 helper spots in fill order.
 */
export const SPOTS: readonly (readonly [number, number])[] = [
  [50, 41],
  [32, 23],
  [70, 23],
  [35, 64],
  [67, 64],
  [22, 47],
  [79, 47],
  [50, 70],
]
const PEN_W = 44
const PEN_H = 38
const TAIL_H = 9
/** The penguin's box in columns, centred on its spot by a negative margin of half. */
const PEN_COLS = 12

// ---------- Text widths: Anthropic Sans advance widths (semibold, the wider cut), 1/1000 em, " " to "~" ----------

const ADV = [
  206, 260, 460, 640, 538, 1010, 719, 260, 410, 410, 489, 640, 260, 360, 260, 352, 610, 400, 595, 572, 630, 578, 580, 550, 575, 580, 260,
  260, 640, 640, 640, 560, 876, 752, 663, 769, 750, 644, 602, 800, 749, 284, 558, 714, 582, 957, 789, 817, 625, 817, 692, 610, 582, 727,
  752, 1037, 707, 699, 669, 410, 352, 410, 640, 500, 500, 562, 632, 568, 632, 590, 436, 586, 613, 266, 266, 593, 266, 892, 613, 592, 632,
  632, 420, 524, 436, 598, 587, 847, 612, 592, 516, 410, 310, 410, 640,
]
/** Pixel width of a line of pane text; any other character counts a full em. */
export function textPx(s: string) {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0)! - 32
    n += c >= 0 && c < ADV.length ? ADV[c]! : 1000
  }
  return (n / 1000) * FONT_PX
}

// ---------- Shared helpers ----------

const n1 = (v: number) => String(Math.round(v * 10) / 10)
function rng(key: string): () => number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type Pt = readonly [number, number]
/** A closed Catmull-Rom curve through the points, as cubic Béziers. */
function smooth(pts: Pt[]) {
  const n = pts.length
  let d = `M${n1(pts[0]![0])},${n1(pts[0]![1])}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!
    const p1 = pts[i]!
    const p2 = pts[(i + 1) % n]!
    const p3 = pts[(i + 2) % n]!
    d += `C${n1(p1[0] + (p2[0] - p0[0]) / 6)},${n1(p1[1] + (p2[1] - p0[1]) / 6)} ${n1(p2[0] - (p3[0] - p1[0]) / 6)},${n1(p2[1] - (p3[1] - p1[1]) / 6)} ${n1(p2[0])},${n1(p2[1])}`
  }
  return `${d}Z`
}
const REDUCE =
  '@media (prefers-reduced-motion: reduce){*{animation-duration:.01s!important;animation-delay:0s!important;animation-iteration-count:1!important}}'
function grey(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const r = n >> 16
  const g = (n >> 8) & 255
  const b = n & 255
  const l = Math.round(r * 0.3 + g * 0.59 + b * 0.11)
  const m = (v: number) =>
    Math.round(v * 0.25 + (l * 0.75 + 30) * 0.75)
      .toString(16)
      .padStart(2, '0')
  return `#${m(r)}${m(g)}${m(b)}`
}

// ---------- Outfits: each crew member's penguin, its name and hat ----------

export type Hat = 'cap' | 'toque' | 'headband' | 'visor' | 'bandana' | 'beanie' | 'headset'
/** What a penguin wears: the main chat's red cap, a crew hat and apron, or (crew off) a plain scarf. */
export type Outfit = { key: string; hat: Hat | null; color: string; apron: boolean; star: boolean }

/** The eleven crew (hooks/mascots.ts CREW) as penguins: a short name, a hat and an apron colour. */
export const CREW_PENGUINS: Record<string, { name: string; hat: Hat; color: string }> = {
  'crew-burger-flipper': { name: 'Flipper', hat: 'visor', color: '#e63946' },
  'crew-fry-cook': { name: 'Tater', hat: 'toque', color: '#f4a300' },
  cleaner: { name: 'Bubbles', hat: 'headband', color: '#3a86ff' },
  'dessert-maker': { name: 'Mochi', hat: 'beanie', color: '#ff4f9a' },
  cashier: { name: 'Penny', hat: 'visor', color: '#2a9d8f' },
  'drive-thru': { name: 'Pip', hat: 'headset', color: '#fb6a07' },
  'drinks-station': { name: 'Fizz', hat: 'headband', color: '#8338ec' },
  'prep-cook': { name: 'Sprout', hat: 'bandana', color: '#43aa8b' },
  dishwasher: { name: 'Suds', hat: 'bandana', color: '#3a86ff' },
  'delivery-rider': { name: 'Zippy', hat: 'beanie', color: '#f4a300' },
  trainee: { name: 'Biscuit', hat: 'visor', color: '#fb6a07' },
}
const SPARE_NAMES = ['Nugget', 'Pickles', 'Waffles', 'Dumpling', 'Noodle', 'Crumb', 'Pepper', 'Muffin']
export const MAIN_OUTFIT: Outfit = { key: 'main', hat: 'cap', color: '#e63946', apron: false, star: true }

/** A helper's penguin name and outfit: from its crew member; plain (a scarf in its card colour) with crew off. */
export function penguinOf(hp: Pick<Helper, 'crew' | 'seat'>, crewOn: boolean, cardColor: string): { name: string; outfit: Outfit } {
  const c = hp.crew ? CREW_PENGUINS[hp.crew] : undefined
  const name = c?.name ?? SPARE_NAMES[((hp.seat % SPARE_NAMES.length) + SPARE_NAMES.length) % SPARE_NAMES.length]!
  if (crewOn && c) return { name, outfit: { key: `crew-${hp.crew}`, hat: c.hat, color: c.color, apron: true, star: false } }
  return { name, outfit: { key: `plain-${cardColor}`, hat: null, color: cardColor, apron: false, star: false } }
}

// ---------- The penguin drawing ----------

const VINK = '#14213a'
export type PenguinPhase = 'idle' | 'working' | 'done' | 'failed'

function parts(o: Outfit, ph: PenguinPhase) {
  const f = ph === 'failed'
  const C = {
    body: f ? '#6d7588' : '#28385a',
    bodyHi: f ? '#8a92a3' : '#3b5079',
    belly: f ? '#e3e6ec' : '#ffffff',
    beak: f ? '#c9a46a' : '#ff9f1c',
    cheek: f ? '#c7b9bf' : '#ff8fa3',
    hue: f ? grey(o.color) : o.color,
  }
  const st = `stroke="${VINK}" stroke-linejoin="round"`
  const flipL = `<path d="M13.4,21.5C9.6,23.5 8.4,27.6 9.1,30.6C10.7,30 12.8,27.4 13.8,24.6Z" fill="${C.body}" ${st} stroke-width="1"/>`
  const flipRPath = `<path d="M30.6,21.5C34.4,23.5 35.6,27.6 34.9,30.6C33.3,30 31.2,27.4 30.2,24.6Z" fill="${C.body}" ${st} stroke-width="1"/>`
  const feet = `<g fill="${C.beak}" ${st} stroke-width=".9"><ellipse cx="17.6" cy="35.6" rx="3.3" ry="1.5"/><ellipse cx="26.4" cy="35.6" rx="3.3" ry="1.5"/></g>`
  const body =
    `<path d="M13,20C13,11.6 17,8.2 22,8.2C27,8.2 31,11.6 31,20C31,22.2 33,25.6 33,29C33,33.4 28.6,35.8 22,35.8C15.4,35.8 11,33.4 11,29C11,25.6 13,22.2 13,20Z" fill="${C.body}" ${st} stroke-width="1.1"/>` +
    `<path d="M16.2,11.6C17.6,9.9 19.6,9.3 21.2,9.4" fill="none" stroke="${C.bodyHi}" stroke-width="1.3" stroke-linecap="round"/>` +
    `<path d="M16.4,21.2C17.2,19.6 19.4,19 22,19C24.6,19 26.8,19.6 27.6,21.2C29.4,24.2 30.2,26.6 30.2,29.2C30.2,32.6 26.6,34.4 22,34.4C17.4,34.4 13.8,32.6 13.8,29.2C13.8,26.6 14.6,24.2 16.4,21.2Z" fill="${C.belly}"/>`
  let apron = ''
  if (o.star) {
    apron = `<path d="M26.6,24.2l.75,1.5 1.65.25-1.2,1.15.3,1.65-1.5-.8-1.5.8.3-1.65-1.2-1.15 1.65-.25Z" fill="#ffc83d" stroke="#b7791f" stroke-width=".5"/>`
  } else if (o.apron) {
    apron =
      `<path d="M17.3,24.6L18.8,20.4M26.7,24.6L25.2,20.4" stroke="${C.hue}" stroke-width="1.2" stroke-linecap="round"/>` +
      `<path d="M15.4,24.4L28.6,24.4L29.6,32.4C27,34 17,34 14.4,32.4Z" fill="${C.hue}" ${st} stroke-width=".8"/>` +
      `<rect x="19.6" y="27" width="4.8" height="3" rx=".8" fill="#ffffff" opacity=".35"/>`
  } else {
    // Crew off: a plain scarf in the card's colour, so penguins still tell apart.
    apron =
      `<path d="M15.4,20.4C19,22.2 25,22.2 28.6,20.4L28.8,23C25,24.8 19,24.8 15.2,23Z" fill="${C.hue}" ${st} stroke-width=".8"/>` +
      `<path d="M25.4,23.6L27.8,29.4L25,29L24,24.2Z" fill="${C.hue}" ${st} stroke-width=".8"/>`
  }
  let eyes: string
  if (f) {
    eyes = `<g fill="none" stroke="${VINK}" stroke-width="1.1" stroke-linecap="round"><path d="M16.6,15.2Q18.6,16.6 20.6,15.2"/><path d="M23.4,15.2Q25.4,16.6 27.4,15.2"/></g>`
  } else if (ph === 'done') {
    eyes = `<g fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"><path d="M16.8,16Q18.6,13.6 20.4,16"/><path d="M23.6,16Q25.4,13.6 27.2,16"/></g>`
  } else {
    eyes =
      `<g fill="#ffffff"><circle cx="18.6" cy="15" r="2.3"/><circle cx="25.4" cy="15" r="2.3"/></g><g fill="${VINK}"><circle cx="18.9" cy="15.2" r="1.3"/><circle cx="25.1" cy="15.2" r="1.3"/></g>` +
      `<g fill="#ffffff"><circle cx="19.3" cy="14.7" r=".45"/><circle cx="25.5" cy="14.7" r=".45"/></g>`
  }
  const face =
    eyes +
    `<g fill="${C.cheek}" opacity=".75"><ellipse cx="15.6" cy="18.3" rx="1.4" ry=".85"/><ellipse cx="28.4" cy="18.3" rx="1.4" ry=".85"/></g>` +
    `<path d="M20.2,17.3L23.8,17.3L22,20Z" fill="${C.beak}" ${st} stroke-width=".8"/>`
  const hs = `${st} stroke-width=".9"`
  const H: Record<Hat, string> = {
    cap:
      `<path d="M14.2,13C14.2,7.6 17.6,5 22,5C26.4,5 29.8,7.6 29.8,13Z" fill="${C.hue}" ${hs}/><path d="M13.4,12.8C18,11.6 27,11.6 34.6,13.2C33.4,14.6 26,14.8 13.4,13.8Z" fill="${f ? '#7b7f88' : '#b3202d'}" ${hs}/>` +
      `<path d="M20.2,10.6h3.6l-.5,2h-2.6Z" fill="#ffffff"/><g stroke="#ffc83d" stroke-width=".7"><path d="M20.9,10.6V8.4M22,10.6V7.9M23.1,10.6V8.4"/></g>`,
    toque: `<g fill="#ffffff" ${hs}><circle cx="17.6" cy="5.8" r="3.4"/><circle cx="26.4" cy="5.8" r="3.4"/><circle cx="22" cy="4" r="3.9"/></g><path d="M16.2,7.4h11.6v4.4c-3.6,1-8,1-11.6,0Z" fill="#ffffff" ${hs}/><path d="M18,6.6c1-1.4 2.6-2 4-2" fill="none" stroke="#dfe6ef" stroke-width=".9"/>`,
    headband: `<path d="M13.4,11.4C18,9.8 26,9.8 30.6,11.4L30.9,13.9C26,12.4 18,12.4 13.1,13.9Z" fill="${C.hue}" ${hs}/><path d="M30.4,12.4l4.4-2.2-.6,3.2 1.8,2-4.8-.8Z" fill="${C.hue}" ${hs}/>`,
    visor: `<path d="M14.2,11.6C17,9.4 27,9.4 29.8,11.6L29.8,13C27,11.4 17,11.4 14.2,13Z" fill="${C.hue}" ${hs}/><path d="M13.6,12.4C17.8,13.6 26.2,13.6 30.4,12.4C30.6,14.2 26.6,15 22,15C17.4,15 13.4,14.2 13.6,12.4Z" fill="${f ? '#7b8a82' : VINK}" opacity=".85" ${hs}/>`,
    bandana: `<path d="M13.6,12.4C13.8,7.4 17.6,5.6 22,5.6C26.4,5.6 30.2,7.4 30.4,12.4C26,11 18,11 13.6,12.4Z" fill="${C.hue}" ${hs}/><g fill="#ffffff" opacity=".8"><circle cx="18.4" cy="8.4" r=".7"/><circle cx="22.4" cy="7.4" r=".7"/><circle cx="26" cy="8.8" r=".7"/><circle cx="20.6" cy="10.2" r=".6"/></g><path d="M29.6,10.6l3.8-1.2-1.6,2.6 2.2,1.6-4.4-.6Z" fill="${C.hue}" ${hs}/>`,
    beanie: `<path d="M14.2,12.6C14.2,6.8 17.6,4.6 22,4.6C26.4,4.6 29.8,6.8 29.8,12.6Z" fill="${C.hue}" ${hs}/><path d="M13.6,10.6h16.8v3c-5.4,1.2-11.4,1.2-16.8,0Z" fill="${f ? '#8a8f98' : '#ffffff'}" opacity=".9" ${hs}/><circle cx="22" cy="3.6" r="2.3" fill="#ffd6e8" ${hs}/>`,
    headset:
      `<path d="M13.2,15C13.2,6.4 30.8,6.4 30.8,15" fill="none" stroke="${VINK}" stroke-width="2.4"/><path d="M13.2,15C13.2,6.4 30.8,6.4 30.8,15" fill="none" stroke="#5c6b85" stroke-width="1.2"/>` +
      `<g fill="${C.hue}" ${hs}><rect x="11" y="12.6" width="3.4" height="5" rx="1.2"/><rect x="29.6" y="12.6" width="3.4" height="5" rx="1.2"/></g><path d="M13,17.2Q14.4,20.6 18.4,20.2" fill="none" stroke="${VINK}" stroke-width=".9"/><circle cx="18.6" cy="20.1" r=".9" fill="${VINK}"/>`,
  }
  return { flipL, flipRPath, feet, body, apron, face, hat: o.hat ? H[o.hat] : '' }
}

const VSH = '<ellipse cx="22" cy="36" rx="12.5" ry="2.1" fill="#6aa7d6" opacity=".38"/>'
const penCache = new Map<string, string>()

/**
 * One penguin, one fixed source per outfit and phase: the desktop keeps its frame while the source holds.
 * working waddles (CSS, infinite; a helper also hops in once); done hops once and shows a tick; failed
 * slumps once and shows a cross; idle is still; burst (the card's last BURST_MS) puffs into snow once.
 */
export function penguinSvg(o: Outfit, phase: PenguinPhase | 'burst', endPhase: 'done' | 'failed' = 'done') {
  const ck = `${o.key}|${phase}|${phase === 'burst' ? endPhase : ''}`
  const hit = penCache.get(ck)
  if (hit) return hit
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PEN_W} ${PEN_H}" width="${PEN_W}" height="${PEN_H}">`
  const ph: PenguinPhase = phase === 'burst' ? endPhase : phase
  const p = parts(o, ph)
  const flipR = ph === 'done' ? `<g transform="rotate(-118 31 22)">${p.flipRPath}</g>` : p.flipRPath
  const figure = `<g>${p.flipL}${p.feet}${p.body}${p.apron}${p.face}${p.hat}</g>`
  let style = ''
  let inner: string
  if (phase === 'burst') {
    const R = rng(`poof${o.key}`)
    let puffs = ''
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + R() * 0.5
      const d = 9 + R() * 5
      const r = 3.2 + R() * 2.2
      puffs += `<circle cx="${n1(22 + Math.cos(a) * 4)}" cy="${n1(25 + Math.sin(a) * 4)}" r="${n1(r)}" style="--x:${n1(Math.cos(a) * d)}px;--y:${n1(Math.sin(a) * d * 0.8 - 2)}px;animation-delay:${n1(0.12 + R() * 0.12)}s"/>`
    }
    const spark = (
      [
        [9, 8],
        [35, 10],
        [8, 27],
        [37, 26],
      ] as const
    )
      .map(([x, y], i) => `<path d="M${x},${y - 2.2}l.7,1.5 1.5.7-1.5.7-.7,1.5-.7-1.5-1.5-.7 1.5-.7Z" style="animation-delay:${n1(0.3 + i * 0.06)}s"/>`)
      .join('')
    style =
      '.g{transform-origin:22px 30px;animation:g .5s cubic-bezier(.5,0,.75,0) both}@keyframes g{0%{transform:none;opacity:1}35%{transform:scale(1.1,.9)}100%{transform:scale(.15);opacity:0}}' +
      '.pf circle{transform-box:fill-box;transform-origin:center;animation:pf 1s cubic-bezier(.2,.7,.3,1) both}@keyframes pf{0%{opacity:0;transform:scale(.3)}20%{opacity:1}100%{opacity:0;transform:translate(var(--x),var(--y)) scale(1.6)}}' +
      '.sp path{transform-box:fill-box;transform-origin:center;animation:sp .7s ease-out both}@keyframes sp{0%{opacity:0;transform:scale(0)}40%{opacity:1;transform:scale(1.2)}100%{opacity:0;transform:scale(.4)}}'
    inner = `<g class="g">${VSH}${figure}${flipR}</g><g class="pf" fill="#ffffff" stroke="#9cc9e6" stroke-width=".8">${puffs}</g><g class="sp" fill="#ffd84a">${spark}</g>`
  } else {
    let badge = ''
    let cls = ''
    if (phase === 'working') {
      style =
        `.w{transform-origin:22px 36px;animation:w ${o.star ? 1.8 : 1.4}s ease-in-out infinite alternate}@keyframes w{from{transform:rotate(-3.5deg)}to{transform:rotate(3.5deg)}}` +
        '.fw{transform-origin:31px 22px;animation:fw .7s ease-in-out infinite alternate}@keyframes fw{from{transform:rotate(4deg)}to{transform:rotate(-26deg)}}'
      if (!o.star) {
        style +=
          '.e{transform-origin:22px 36px;animation:e .6s cubic-bezier(.3,1.4,.5,1) both}@keyframes e{0%{transform:translateY(-16px) scale(.3);opacity:0}50%{opacity:1}100%{transform:none}}' +
          '.in circle{transform-box:fill-box;transform-origin:center;animation:in .7s ease-out .32s both}@keyframes in{0%{opacity:.95;transform:scale(.2)}100%{opacity:0;transform:translate(var(--x),0) scale(1.5)}}'
      }
      cls = 'w'
    } else if (phase === 'done') {
      style =
        '.w{animation:h .75s ease-out .05s 1 both}@keyframes h{0%,100%{transform:none}30%{transform:translateY(-6px)}55%{transform:none}72%{transform:translateY(-2px)}86%{transform:none}}' +
        '.b{transform-box:fill-box;transform-origin:center;animation:b .45s cubic-bezier(.3,1.6,.5,1) .3s both}@keyframes b{from{transform:scale(0)}to{transform:none}}'
      badge = `<g class="b"><circle cx="37" cy="6.5" r="4.6" fill="#22b573" stroke="#ffffff" stroke-width="1.2"/><path d="M34.8,6.6l1.6,1.6 3-3.2" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></g>`
      cls = 'w'
    } else if (phase === 'failed') {
      style =
        '.w{transform-origin:22px 36px;animation:s .8s ease-out .15s 1 both}@keyframes s{to{transform:scale(1.03,.94)}}' +
        '.b{transform-box:fill-box;transform-origin:center;animation:b .45s ease-out .4s both}@keyframes b{from{transform:scale(0);opacity:0}to{transform:none;opacity:1}}'
      badge =
        `<g class="b"><circle cx="37" cy="6.5" r="4.6" fill="#e25555" stroke="#ffffff" stroke-width="1.2"/><path d="M35.2,4.7l3.6,3.6M38.8,4.7l-3.6,3.6" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/></g>` +
        '<path d="M32.4,9.4c0,0 -1.6,2.2 -1.6,3.2a1.6,1.6 0 0 0 3.2,0c0-1-1.6-3.2-1.6-3.2Z" fill="#8fd0ff" stroke="#3d7fb8" stroke-width=".6"/>'
      cls = 'w'
    }
    const fr = phase === 'working' ? `<g class="fw">${flipR}</g>` : flipR
    let body = `${VSH}<g${cls ? ` class="${cls}"` : ''}>${figure}${fr}</g>${badge}`
    if (phase === 'working' && !o.star) {
      const puff = (
        [
          [-1, -9],
          [1, 9],
          [-1, -4],
          [1, 4],
        ] as const
      )
        .map(([, x], i) => `<circle cx="${n1(22 + x * 0.6)}" cy="${n1(34.6 - (i % 2))}" r="${2.6 + (i % 2)}" style="--x:${n1(x * 0.8)}px"/>`)
        .join('')
      body = `<g class="e">${body}</g><g class="in" fill="#ffffff" stroke="#a8d0ea" stroke-width=".7">${puff}</g>`
    }
    inner = body
  }
  const out = `${open}<style>${style}${REDUCE}</style>${inner}</svg>`
  penCache.set(ck, out)
  return out
}

// ---------- The floe and the backdrop: two still drawings, never changed ----------

const ART_STYLE =
  '.wall{fill:url(#wa)}.top{fill:#ffffff}.rim{stroke:#7fb7de}.sh{fill:#0d5a99;opacity:.28}.foam{stroke:#ecf8ff;opacity:.85}.sea{fill:#2f9fe3}' +
  '.rp{stroke:#bfe9ff;opacity:.75}.pt{fill:#e8f4fb}.ck{stroke:#bfdcf0}.sb{fill:#ffffff;stroke:#a9cde6}.sbs{fill:#d7ebf8}.lit,.glow{display:none}' +
  '.cr{fill:#e63946}.crd{fill:#b3202d}.cw{fill:#ffffff}.cy{fill:#ffc83d}.cwd{fill:#8a5a36}.ins{stroke:#14213a}' +
  '@media (prefers-color-scheme: dark){' +
  '.wall{fill:url(#wan)}.top{fill:#cfdaec}.rim{stroke:#6f86ad}.sh{fill:#020c1c;opacity:.45}.foam{stroke:#8aa4c9;opacity:.6}.sea{fill:#163f68}' +
  '.rp{stroke:#4f7fae;opacity:.7}.pt{fill:#c2cfe5}.ck{stroke:#a6b8d6}.sb{fill:#d6e0f0;stroke:#8fa3c6}.sbs{fill:#b3c2dc}' +
  '.lit{display:inline;fill:#ffd56a}.glow{display:inline}.cr{fill:#b8303b}.crd{fill:#8a1d27}.cw{fill:#d8dceb}}'

let artCache = ''
/** The floe with its props, on a clear background: the backdrop's sea shows around it. */
export function floeArtSvg() {
  if (artCache) return artCache
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART_W} ${ART_H}" width="${ART_W}" height="${ART_H}">`
  s +=
    '<defs>' +
    '<linearGradient id="wa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dff3fd"/><stop offset="1" stop-color="#7fc0ea"/></linearGradient>' +
    '<linearGradient id="wan" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fb3d4"/><stop offset="1" stop-color="#4c6390"/></linearGradient>' +
    '<radialGradient id="gl"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".9"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient>' +
    '</defs>'
  s += `<style>${ART_STYLE}</style>`
  // little ice chunks drifting (still)
  const chunk = (x: number, y: number, k: number) => {
    const pts: Pt[] = (
      [
        [-10, -2],
        [-2, -6],
        [9, -4],
        [12, 2],
        [2, 6],
        [-9, 4],
      ] as const
    ).map(([a, b]) => [x + a * k, y + b * k] as const)
    const dn: Pt[] = pts.map(([a, b]) => [a, b + 4 * k] as const)
    return `<path class="wall rim" stroke-width=".8" d="${smooth(dn)}"/><path class="top rim" stroke-width=".8" d="${smooth(pts)}"/>`
  }
  s += chunk(58, 96, 1.1) + chunk(510, 304, 1.4) + chunk(30, 304, 1.2) + chunk(540, 86, 0.8)
  // the floe: an irregular, rounded slab seen from above, with a thick front wall
  const F: Pt[] = [
    [120, 100],
    [200, 88],
    [300, 85],
    [410, 90],
    [478, 102],
    [516, 138],
    [524, 196],
    [504, 250],
    [444, 282],
    [340, 293],
    [230, 292],
    [140, 284],
    [74, 258],
    [44, 206],
    [48, 150],
    [76, 114],
  ]
  const off = (pts: Pt[], dy: number) => smooth(pts.map(([x, y]) => [x, y + dy] as const))
  s += `<path class="sh" d="${off(F, 26)}"/>`
  s += `<path class="foam" fill="none" stroke-width="3" d="${off(F, 19)}"/>`
  s += `<path class="wall rim" stroke-width="1.4" d="${off(F, 16)}"/>`
  for (const [x, y] of [
    [90, 268],
    [150, 292],
    [210, 298],
    [300, 300],
    [372, 298],
    [440, 288],
    [492, 262],
    [516, 220],
  ] as const)
    s += `<path class="rim" stroke-width="1" opacity=".6" d="M${x},${y - 6}v8"/>`
  s += `<path class="top rim" stroke-width="1.4" d="${smooth(F)}"/>`
  // soft blue patches and cracks on the surface
  for (const [x, y, rx, ry] of [
    [150, 140, 38, 10],
    [330, 120, 50, 9],
    [420, 228, 44, 11],
    [210, 262, 52, 9],
    [95, 210, 22, 14],
    [300, 200, 26, 7],
  ] as const)
    s += `<ellipse class="pt" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>`
  for (const d of ['M236,112l14,6 10,-2 12,7', 'M458,170l-12,10 -4,12', 'M120,236l16,4 6,9', 'M352,266l20,-4 10,5'])
    s += `<path class="ck" fill="none" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`
  // snow mounds and a snowball pile (left back)
  const mound = (x: number, y: number, w: number) =>
    `<path class="sbs" d="M${x - w},${y}q${w},${n1(-w * 0.9)} ${2 * w},0Z"/><path class="sb" stroke-width=".9" d="M${x - w},${y}q${w},${n1(-w * 0.9)} ${2 * w},0q${-w},${n1(w * 0.25)} ${-2 * w},0Z" opacity=".95"/>`
  s += mound(64, 196, 9) + mound(500, 222, 8) + mound(256, 100, 7)
  for (const [x, y, r] of [
    [82, 142, 5],
    [93, 143, 5],
    [88, 134, 5],
  ] as const)
    s += `<circle class="sb" stroke-width=".9" cx="${x}" cy="${y}" r="${r}"/><path class="sbs" d="M${n1(x - r * 0.85)},${n1(y + r * 0.2)}a${n1(r * 0.9)},${n1(r * 0.9)} 0 0 0 ${n1(r * 1.7)},0Q${x},${n1(y + r * 0.7)} ${n1(x - r * 0.85)},${n1(y + r * 0.2)}Z"/>`
  // a fishing hole with a rod and a bucket (front left)
  s +=
    '<ellipse class="wall rim" stroke-width="1.2" cx="112" cy="252" rx="17" ry="7"/><ellipse class="sea" cx="112" cy="253.5" rx="13.5" ry="4.6"/><path class="rp" fill="none" stroke-width="1" d="M104,253q4,-2 8,0q4,2 8,0"/>'
  s += '<path d="M134,262L150,232" stroke="#8a5a36" stroke-width="1.8" stroke-linecap="round"/><path d="M150,232Q140,236 122,252" fill="none" stroke="#5c6b85" stroke-width=".6"/>'
  s +=
    '<path d="M138,262h11l-1.4,9h-8.2Z" fill="#3a86ff" stroke="#14213a" stroke-width=".9"/><path d="M140,262q3.5,-5 7,0" fill="none" stroke="#14213a" stroke-width=".8"/><path d="M141,262l2,-3 1.6,2.6 2,-2.4" fill="#ff9f1c" stroke="#14213a" stroke-width=".6"/>'
  // the fry cart (back right): wheels, red body, striped awning, a fries sign
  const cx = 468
  const cy = 132
  s += `<ellipse class="sh" cx="${cx + 24}" cy="${cy + 3}" rx="30" ry="5"/>`
  s += '<g class="ins" stroke-width="1.1" stroke-linejoin="round">'
  s += `<rect class="cr" x="${cx}" y="${cy - 26}" width="48" height="24" rx="2"/><rect class="crd" x="${cx}" y="${cy - 8}" width="48" height="6"/>`
  s += `<rect class="cwd" x="${cx + 4}" y="${cy - 30}" width="40" height="4"/>`
  s += `<rect class="cw" x="${cx + 6}" y="${cy - 22}" width="36" height="10" rx="1"/>`
  s += `<path d="M${cx + 3},${cy - 52}v22M${cx + 45},${cy - 52}v22" fill="none" stroke="#7a4f30" stroke-width="2.4"/>`
  for (let i = 0; i < 6; i++)
    s += `<path class="${i % 2 ? 'cw' : 'cr'}" d="M${n1(cx - 4 + i * 9.33)},${cy - 50}h9.33v8a4.66,4.66 0 0 1 -9.33,0Z"/>`
  s += `<rect class="cr" x="${cx - 5}" y="${cy - 55}" width="58" height="6" rx="2"/>`
  s += `<rect class="cy" x="${cx + 12}" y="${cy - 72}" width="24" height="17" rx="3"/><path class="cr" d="M${cx + 18},${cy - 64}h12l-1.6,7h-8.8Z"/>`
  s += `<path fill="none" stroke="#ffc83d" stroke-width="1.8" stroke-linecap="round" d="M${cx + 20.5},${cy - 64}v-4M${cx + 24},${cy - 64}v-5M${cx + 27.5},${cy - 64}v-4"/>`
  s += `<circle cx="${cx + 10}" cy="${cy}" r="5" fill="#3b4256"/><circle cx="${cx + 38}" cy="${cy}" r="5" fill="#3b4256"/>`
  s += '</g>'
  s += `<g fill="#ffc83d" stroke="#14213a" stroke-width=".8"><path d="M${cx + 10},${cy - 18}h5l-.8,5h-3.4Z"/><path d="M${cx + 20},${cy - 18}h5l-.8,5h-3.4Z"/></g>`
  s += `<rect class="lit" x="${cx + 7}" y="${cy - 21}" width="34" height="8" opacity=".55"/><circle class="glow" cx="${cx + 24}" cy="${cy - 18}" r="34" fill="url(#gl)" opacity=".7"/>`
  artCache = `${s}</svg>`
  return artCache
}

let backCache = ''
/**
 * Sky, sun or moon, snowy hills and sea across BACK_W pixels, drawn to fill its frame from the middle
 * at scale 1 ("slice"), so its middle sits under the floe drawing whatever the pane's width.
 */
export function backdropSvg() {
  if (backCache) return backCache
  const R = rng('floe-back')
  const X0 = (BACK_W - ART_W) / 2
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BACK_W} ${ART_H}" width="${BACK_W}" height="${ART_H}" preserveAspectRatio="xMidYMid slice">`
  s +=
    '<defs>' +
    '<linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6cc3f5"/><stop offset="1" stop-color="#c8ecff"/></linearGradient>' +
    '<linearGradient id="skn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1430"/><stop offset="1" stop-color="#28406e"/></linearGradient>' +
    '<linearGradient id="se" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5cc3f2"/><stop offset=".35" stop-color="#2f9fe3"/><stop offset="1" stop-color="#1878c4"/></linearGradient>' +
    '<linearGradient id="sen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d4f7e"/><stop offset="1" stop-color="#0a2645"/></linearGradient>' +
    '</defs>'
  s +=
    '<style>' +
    '.sky{fill:url(#sk)}.sea{fill:url(#se)}.cl{fill:#ffffff}.cls{fill:#dcefff}.h1{fill:#e6f4fc}.h2{fill:#ffffff}.hs{fill:#cfe3f1}.hl{stroke:#9cc2dc}.pine{fill:#2f7a62}' +
    '.rp{stroke:#bfe9ff;opacity:.75}.sun{fill:#fff6c9}.sunh{fill:#fff6c9;opacity:.35}.moon,.st{display:none}' +
    '@media (prefers-color-scheme: dark){' +
    '.sky{fill:url(#skn)}.sea{fill:url(#sen)}.cl{fill:#2a3c64}.cls{fill:#223257}.h1{fill:#5a6f97}.h2{fill:#7c8fb3}.hs{fill:#4d6189}.hl{stroke:#3b4d75}.pine{fill:#1d4a40}' +
    '.rp{stroke:#4f7fae;opacity:.7}.sun,.sunh{display:none}.moon{display:inline;fill:#f6f0d2}.st{display:inline;fill:#e8eefc}}' +
    '</style>'
  s += `<rect class="sky" width="${BACK_W}" height="${HZ + 2}"/>`
  s += `<circle class="sunh" cx="${X0 + 474}" cy="22" r="20"/><circle class="sun" cx="${X0 + 474}" cy="22" r="11"/>`
  s += `<path class="moon" d="M${X0 + 478},12a11,11 0 1 0 8,18a9,9 0 1 1 -8,-18Z"/>`
  for (let i = 0; i < 110; i++) s += `<circle class="st" cx="${n1(R() * BACK_W)}" cy="${n1(R() * 52)}" r="${n1(0.5 + R() * 0.8)}"/>`
  // One 560-wide strip of clouds, hills and pines, repeated so the floe's own strip sits in the middle.
  const cloud = (x: number, y: number, k: number) =>
    `<g transform="translate(${x} ${y}) scale(${k})"><ellipse class="cls" cx="0" cy="4" rx="30" ry="7"/><g class="cl"><circle cx="-16" cy="0" r="9"/><circle cx="-2" cy="-6" r="12"/><circle cx="13" cy="-1" r="9"/><ellipse cx="0" cy="3" rx="28" ry="6"/></g></g>`
  let strip = cloud(92, 24, 0.9) + cloud(270, 14, 0.7) + cloud(392, 34, 0.6) + cloud(536, 20, 0.8)
  strip += `<path class="h1 hl" stroke-width="1" d="M0,${HZ}L0,46C30,36 60,40 90,48C120,30 160,26 200,42C232,36 252,44 270,${HZ}Z"/>`
  strip += `<path class="h1 hl" stroke-width="1" d="M300,${HZ}C320,44 352,30 392,36C420,22 452,24 480,40C510,34 540,38 560,46L560,${HZ}Z"/>`
  strip += `<path class="h2 hl" stroke-width="1" d="M40,${HZ}C70,50 100,46 130,56C160,48 182,52 196,${HZ}Z"/><path class="hs" d="M140,${HZ}C150,60 168,54 196,${HZ}Z"/>`
  strip += `<path class="h2 hl" stroke-width="1" d="M356,${HZ}C380,52 420,44 452,54C470,50 500,52 520,${HZ}Z"/><path class="hs" d="M470,${HZ}C482,60 500,56 520,${HZ}Z"/>`
  for (const [x, y, k] of [
    [70, 52, 1],
    [80, 55, 0.8],
    [418, 46, 1],
    [430, 49, 0.8],
    [444, 47, 0.9],
    [230, 50, 0.8],
  ] as const)
    strip += `<path class="pine" d="M${x},${n1(y - 9 * k)}l${n1(4 * k)},${n1(9 * k)}h${n1(-8 * k)}Z"/>`
  for (let k = -2; k <= 2; k++) s += `<g transform="translate(${X0 + k * ART_W} 0)">${strip}</g>`
  // the sea, with still ripples
  s += `<rect class="sea" y="${HZ}" width="${BACK_W}" height="${ART_H - HZ}"/><rect class="rp" y="${HZ}" width="${BACK_W}" height="1.2" fill="#d6f2ff" opacity=".7"/>`
  for (let i = 0; i < 160; i++) {
    const x = R() * BACK_W
    const y = HZ + 8 + R() * (ART_H - HZ - 10)
    const w = 6 + R() * 12
    s += `<path class="rp" fill="none" stroke-width="1.3" stroke-linecap="round" d="M${n1(x)},${n1(y)}q${n1(w / 2)},-3 ${n1(w)},0"/>`
  }
  backCache = `${s}</svg>`
  return backCache
}

/** The bubble's tail: lean l (bubble runs right), c, r (bubble runs left). */
export function tailSvg(lean: 'l' | 'c' | 'r') {
  const apex = { l: '2.4,8.4', c: '7,8.6', r: '11.6,8.4' }[lean]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 ${TAIL_H}" width="14" height="${TAIL_H}"><path d="M3,0L11,0L${apex}Z" fill="#ffffff"/><path d="M3,0L${apex}L11,0" fill="none" stroke="#2b3445" stroke-width="1.3" stroke-linejoin="round"/></svg>`
}

// ---------- What the penguins say ----------

/** At most MAX_SAY characters: a longer line ends at its last whole word that fits, then an ellipsis. */
function cutSay(s: string) {
  if (s.length <= MAX_SAY) return s
  let t = s.slice(0, MAX_SAY - 1)
  const space = t.lastIndexOf(' ')
  if (space >= MAX_SAY * 0.6) t = t.slice(0, space)
  return `${t.trimEnd().replace(/[,;:]$/, '')}…`
}
const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

const VERBS = new Set(
  (
    'add back build bump check clean clone commit compare compile convert copy count create delete diff download edit export extract fetch find fix ' +
    'format generate get grep import inspect install kill launch lint list load look make measure merge move open parse print pull push put read ' +
    'remove rename render replace reset restart run save scan search set show sort start stop sync tail test update upload use validate verify view ' +
    'wait watch write zip'
  ).split(' '),
)
const DOUBLE = new Set(['run', 'set', 'get', 'stop', 'put', 'grep', 'commit'])
function gerund(word: string) {
  const w = word.toLowerCase()
  const ing = DOUBLE.has(w) ? `${w}${w.at(-1)}ing` : w.endsWith('e') && !w.endsWith('ee') ? `${w.slice(0, -1)}ing` : `${w}ing`
  return word.charAt(0) === word.charAt(0).toUpperCase() ? ing.charAt(0).toUpperCase() + ing.slice(1) : ing
}

/** A step's live words, tidied for a bubble: "Running: Read config, server log" reads "Reading config, server log". */
export function tidyStep(live: string) {
  let s = live.trim()
  if (s.startsWith('Running: ')) {
    s = s.slice('Running: '.length)
    const [first = '', ...rest] = s.split(' ')
    if (VERBS.has(first.toLowerCase())) s = [gerund(first), ...rest].join(' ')
  }
  return cutSay(s)
}

/** A helper's bubble now, or null: its latest step for a while, then done or stopped until it bursts. */
export function helperLine(hp: Helper, now: number, bursting: boolean): string | null {
  if (bursting) return null
  if (hp.phase === 'done') return `Done ✓ ${hp.count} step${hp.count === 1 ? '' : 's'}`
  if (hp.phase === 'failed') return 'Stopped ✗'
  const last = hp.steps[hp.steps.length - 1]
  if (!last || hp.stepAt === undefined || now - hp.stepAt >= STEP_SAY_MS) return null
  return tidyStep(last.live)
}

/**
 * The main chat's bubble now, or null. Newest first: a helper that just started ("Pip, check the log"),
 * one that just ended ("Thanks Pip"); else the plan step in progress ("Now: …"); else "Waiting on N helpers".
 */
export function mainLine(list: Helper[], names: Map<string, string>, plan: BandPlan | null, now: number): string | null {
  type Event = { at: number; text: string }
  const events: Event[] = []
  for (const hp of list) {
    const name = names.get(hp.id) ?? 'friend'
    if (now - hp.startedAt < SAY_MS && now >= hp.startedAt) events.push({ at: hp.startedAt, text: cutSay(`${name}, ${lcFirst(hp.description)}`) })
    if (hp.phase !== 'working' && hp.endedAt && now - hp.endedAt < SAY_MS && now >= hp.endedAt) {
      const nice = [`Thanks ${name}`, 'Nice', `Nice one, ${name}`][((hp.seat % 3) + 3) % 3]!
      events.push({ at: hp.endedAt, text: cutSay(hp.phase === 'done' ? nice : `Oh no, ${name}`) })
    }
  }
  if (events.length) return events.reduce((a, b) => (b.at >= a.at ? b : a)).text
  const step = plan?.shown ? plan.steps.find(st => st.status === 'in_progress') : undefined
  if (step) return cutSay(`Now: ${step.text}`)
  const n = list.filter(hp => hp.phase === 'working').length
  return n ? `Waiting on ${n} helper${n === 1 ? '' : 's'}` : null
}

// ---------- Spots: fixed per penguin for its whole life ----------

/** Helper id to its spot (1..7). A helper keeps its spot until it leaves; nobody shifts. */
const spotOf = new Map<string, number>()

/** Frees the spots of helpers gone from the list, then seats running helpers that wait, oldest first. */
export function assignSpots(list: Helper[]) {
  const ids = new Set(list.map(hp => hp.id))
  for (const id of [...spotOf.keys()]) if (!ids.has(id)) spotOf.delete(id)
  const used = new Set(spotOf.values())
  for (const hp of [...list].sort((a, b) => a.seat - b.seat)) {
    if (spotOf.has(hp.id) || hp.phase !== 'working') continue
    for (let k = 1; k < SPOTS.length; k++) {
      if (!used.has(k)) {
        spotOf.set(hp.id, k)
        used.add(k)
        break
      }
    }
  }
  return spotOf
}

// ---------- Bubble placement, in floe pixels ----------

type Rect = { x0: number; x1: number; y0: number; y1: number }
const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** Greedy word wrap to `chars` a line; past `maxLines` the last line ends in an ellipsis. */
export function wrap(s: string, chars: number, maxLines: number): string[] {
  const lines: string[] = []
  for (const word of s.split(' ')) {
    const last = lines[lines.length - 1]
    if (last !== undefined && last.length + 1 + word.length <= chars) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines)
    const full = `${keep[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`
    let cut = full.slice(0, chars - 1)
    // Mid-word: end at the last whole word instead, when that keeps most of the line.
    const space = cut.lastIndexOf(' ')
    if (full[chars - 1] !== ' ' && space >= chars * 0.4) cut = cut.slice(0, space)
    keep[maxLines - 1] = `${cut.trimEnd()}…`
    return keep
  }
  return lines.map(l => (l.length > chars ? `${l.slice(0, chars - 1)}…` : l))
}

export type Talker = { spot: number; x: number; y: number; line: string; main: boolean; at: number }
/** A placed bubble; `left` and `width` are whole percents of the floe's width, `box` the pixels they make. */
export type Placed = { spot: number; x: number; y: number; lines: string[]; left: number; width: number; lean: 'l' | 'c' | 'r'; box: Rect }
/** A penguin on the scene, in pixels of the scaled floe; `name` is null when its name is left out. */
export type Standing = { x: number; y: number; name: string | null; main: boolean }

/** The width a bubble needs for these lines: the text, 1ch of padding each side, the border, a little slack. */
const bubbleW = (lines: string[]) => Math.ceil(Math.max(...lines.map(textPx)) + 2 * CH_PX + 2 + 6)

/** The floe's scale for a pane this many columns wide: the whole drawing fits across it, never above 1. */
export const fitScale = (columns: number) => Math.max(0.25, Math.min(1, (columns * CH_PX - 2) / ART_W))

/** The box a name's text takes under its penguin. */
const nameBox = (x: number, y: number, name: string, scale: number): Rect => {
  const w = textPx(name) / 2 + 3
  return { x0: x - w, x1: x + w, y0: y + PEN_H * scale, y1: y + PEN_H * scale + LH_PX }
}
/** A penguin's body, a little inside its drawing. */
const bodyBox = (x: number, y: number, scale: number): Rect => ({ x0: x - 16 * scale, x1: x + 16 * scale, y0: y + 3 * scale, y1: y + PEN_H * scale })

/**
 * Which names fit on a floe this small: main's always, then each in spot order unless it would run into a
 * name already shown or another penguin. Depends only on who stands where, never on bubbles or the clock.
 */
export function namesShown(pens: { x: number; y: number; name: string; main: boolean }[], scale: number): boolean[] {
  const shown: Rect[] = []
  return pens.map((p, i) => {
    const box = nameBox(p.x, p.y, p.name, scale)
    const clash = shown.some(r => hit(r, box)) || pens.some((o, j) => j !== i && hit(bodyBox(o.x, o.y, scale), box))
    if (clash && !p.main) return false
    shown.push(box)
    return true
  })
}

/** The bubble shapes, [characters a line, lines], tried in turn. */
const SHAPES = [
  [17, 2],
  [11, 3],
  // Shorter shapes for a small floe: one line, ending in an ellipsis when the words run on.
  [17, 1],
  [11, 1],
] as const

/**
 * Places at most one bubble per penguin: main first, then the newest. Each tries a wide shape, a narrow
 * one, then one line of each (shortened), centred over its penguin or running right or left; it never
 * covers another bubble or the floe's edge, and covers another penguin only when nothing else fits.
 * Last of all (on a small floe) it may cover another penguin's name, never main's nor one whose bubble is
 * up; that name is then left out (coveredNames). One that cannot fit waits.
 * Positions are pixels of the floe drawn `sceneW` wide at `scale`; bubble text keeps its size.
 */
export function placeBubbles(talkers: Talker[], everyone: Standing[], sceneW: number, scale: number): Placed[] {
  const PX = sceneW / 100
  const names = everyone.flatMap(p => (p.name === null ? [] : [{ x: p.x, y: p.y, main: p.main, r: nameBox(p.x, p.y, p.name, scale) }]))
  // A name no bubble may cover: main's, and a penguin's whose own bubble is up.
  const firm = (o: { x: number; y: number; main: boolean }) => o.main || placed.some(b => b.x === o.x && b.y === o.y)
  const soft = everyone.map(p => ({ x: p.x, y: p.y, r: bodyBox(p.x, p.y, scale) }))
  const placed: Placed[] = []
  const order = [...talkers].sort((a, b) => Number(b.main) - Number(a.main) || b.at - a.at)
  // 0: clear of everything; 1: over another penguin; 2: over a quiet penguin's name too.
  const tryShape = (t: Talker, chars: number, maxLines: number, mode: 0 | 1 | 2): Placed | null => {
    const lines = wrap(t.line, chars, maxLines)
    // Whole percents of the floe's width, rounded up: the bubble is never narrower than its text.
    const wp = Math.ceil(bubbleW(lines) / PX)
    const w = wp * PX
    // The tail's tip touches the head; the bubble sits on the tail.
    const y1 = t.y + 2 * scale - TAIL_H
    const y0 = y1 - (lines.length * LH_PX + 2)
    if (y0 < 0) return null
    const opts: [number, 'l' | 'c' | 'r'][] = [
      [t.x - w / 2, 'c'],
      [t.x - 16, 'l'],
      [t.x - w + 16, 'r'],
      [t.x - 10, 'l'],
      [t.x - w + 10, 'r'],
    ]
    for (const [left, lean] of opts) {
      const lp = Math.round(left / PX)
      const L = lp * PX
      if (L < 2 || L + w > sceneW - 2) continue
      const box = { x0: L, x1: L + w, y0, y1: t.y + 2 * scale }
      if (placed.some(p => hit(p.box, box)) || names.some(o => (mode < 2 || firm(o)) && hit(o.r, box))) continue
      if (mode === 0 && soft.some(o => !(o.x === t.x && o.y === t.y) && hit(o.r, box))) continue
      return { spot: t.spot, x: t.x, y: t.y, lines, left: lp, width: wp, lean, box }
    }
    return null
  }
  for (const t of order) {
    let pick: Placed | null = null
    for (const [chars, maxLines] of SHAPES) {
      pick = tryShape(t, chars, maxLines, 0) ?? tryShape(t, chars, maxLines, 1)
      if (pick) break
    }
    if (!pick) {
      for (const [chars, maxLines] of SHAPES) {
        pick = tryShape(t, chars, maxLines, 2)
        if (pick) break
      }
    }
    if (pick) placed.push(pick)
  }
  return placed
}

/** For each penguin, whether a placed bubble covers its name (then the name is left out). */
export function coveredNames(placed: Placed[], everyone: Standing[], scale: number): boolean[] {
  return everyone.map(p => p.name !== null && placed.some(b => hit(b.box, nameBox(p.x, p.y, p.name!, scale))))
}

// ---------- The scene ----------

/** A whole percent, as the engine takes it. */
const pct = (v: number) => `${Math.min(100, Math.max(0, Math.round(v)))}%`

export type FloeInput = {
  list: Helper[]
  main: Helper | null
  plan: BandPlan | null
  now: number
  crewOn: boolean
  /** The pane's width in columns (bodyColumns). */
  columns: number
  /** ms into a finished helper's burst, or -1 (the same clock as the Cards view). */
  burstAt: (hp: Helper) => number
  /** A helper's card colour (its hue), for plain outfits with crew off. */
  cardColor: (hp: Helper) => string
}

/** The scene: a backdrop, the floe, the penguins on their spots, their bubbles, and "+N more". */
export function floeScene(els: FloeEls, inp: FloeInput): RenderElement {
  const { Box, Text, Svg } = els
  // Zoom out to fit: the floe, the backdrop and the penguins at this scale; text keeps its size.
  const scale = fitScale(inp.columns)
  const W = Math.floor(ART_W * scale)
  const H = Math.round(ART_H * scale)
  const PX = W / 100
  const PY = H / 100
  const penW = Math.round(PEN_W * scale)
  const penH = Math.round(PEN_H * scale)
  // A spot in whole percents of the floe, and the pixels that makes at this scale.
  const at = (spot: number) => {
    const [xp, yp] = SPOTS[spot]!
    return { xp, yp, x: xp * PX, y: yp * PY }
  }
  const spots = assignSpots(inp.list)
  type Pen = {
    spot: number
    xp: number
    yp: number
    x: number
    y: number
    name: string
    main: boolean
    leaving: number
    source: string
    alt: string
    line: string | null
    at: number
  }
  const pens: Pen[] = []
  const names = new Map<string, string>()
  for (const hp of inp.list) names.set(hp.id, penguinOf(hp, inp.crewOn, inp.cardColor(hp)).name)

  const mainPhase = inp.main?.phase === 'working' ? 'working' : 'idle'
  const m = at(0)
  const mainSays = mainLine(inp.list, names, inp.plan, inp.now)
  pens.push({
    spot: 0,
    ...m,
    name: 'Main',
    main: true,
    leaving: -1,
    source: penguinSvg(MAIN_OUTFIT, mainPhase),
    alt: `Main penguin, ${mainPhase}`,
    line: mainSays,
    at: inp.now,
  })
  for (const hp of inp.list) {
    const spot = spots.get(hp.id)
    if (spot === undefined) continue
    const { name, outfit } = penguinOf(hp, inp.crewOn, inp.cardColor(hp))
    const leaving = hp.phase !== 'working' ? inp.burstAt(hp) : -1
    const bursting = leaving >= 0
    const phase = bursting ? 'burst' : hp.phase
    const end = hp.phase === 'failed' ? 'failed' : 'done'
    pens.push({
      spot,
      ...at(spot),
      name,
      main: false,
      leaving,
      source: penguinSvg(outfit, phase, end),
      alt: `${name} penguin, ${bursting ? 'leaving' : hp.phase}`,
      line: helperLine(hp, inp.now, bursting),
      at: hp.phase === 'working' ? (hp.stepAt ?? hp.startedAt) : hp.endedAt,
    })
  }
  // Spot order: a penguin's frame keeps its place among the frames whoever comes or goes.
  pens.sort((a, b) => a.spot - b.spot)
  // A name shows while its penguin does: not past the point its puff has shrunk the drawing away,
  // and not where a small floe has no room for it.
  const roomy = namesShown(pens, scale)
  const nameOn = pens.map((p, i) => roomy[i]! && p.leaving < PUFF_MS)
  const standing: Standing[] = pens.map((p, i) => ({ x: p.x, y: p.y, name: nameOn[i] ? p.name : null, main: p.main }))
  const talkers: Talker[] = pens.filter(p => p.line).map(p => ({ spot: p.spot, x: p.x, y: p.y, line: p.line!, main: p.main, at: p.at }))
  const bubbles = placeBubbles(talkers, standing, W, scale).sort((a, b) => a.spot - b.spot)
  // On a small floe a bubble may sit over a quiet penguin's name: that name is left out meanwhile.
  const covered = coveredNames(bubbles, standing, scale)
  for (const [i, c] of covered.entries()) if (c) nameOn[i] = false
  const waiting = inp.list.filter(hp => hp.phase === 'working' && !spots.has(hp.id)).length

  return (
    <Box key="floe" flexDirection="column" width="100%" overflow="hidden">
      <Svg source={backdropSvg()} alt="Sky and sea" width={BACK_W} height={H} isInteractive />
      <Box position="absolute" top={0} left={0} right={0} bottom={0} flexDirection="row" justifyContent="center">
        <Box flexDirection="column" flexShrink={0}>
          <Svg source={floeArtSvg()} alt="An ice floe with a fry cart" width={W} height={H} isInteractive />
          {pens.map((p, i) => (
            <Box key={`pen-${p.spot}`} position="absolute" top={0} left={0} right={0} bottom={0} flexDirection="column">
              <Box height={pct(p.yp)} flexShrink={0} />
              <Box flexDirection="row" flexShrink={0}>
                <Box width={pct(p.xp)} flexShrink={0} />
                <Box width={PEN_COLS} marginLeft={-PEN_COLS / 2} flexShrink={0} flexDirection="column" alignItems="center">
                  <Svg source={p.source} alt={p.alt} width={penW} height={penH} isInteractive />
                  {nameOn[i] ? (
                    <Text color="#17223a" bold={p.main} wrap="truncate-end">
                      {p.name}
                    </Text>
                  ) : null}
                </Box>
              </Box>
            </Box>
          ))}
          {bubbles.map(b => (
            <Box
              key={`say-${b.spot}`}
              position="absolute"
              top={0}
              left={0}
              right={0}
              height={pct((b.y + 2 * scale) / PY)}
              flexDirection="column"
              justifyContent="flex-end"
            >
              <Box flexDirection="row" flexShrink={0}>
                <Box width={pct(b.left)} flexShrink={0} />
                <Box
                  width={pct(b.width)}
                  flexShrink={0}
                  borderStyle="round"
                  borderColor="#2b3445"
                  backgroundColor="#ffffff"
                  paddingX={1}
                  paddingY={0}
                  flexDirection="column"
                  alignItems="center"
                >
                  {b.lines.map((l, i) => (
                    <Text key={`say-${b.spot}-${i}`} color="#1d2433" wrap="truncate-end">
                      {l}
                    </Text>
                  ))}
                </Box>
              </Box>
              <Box flexDirection="row" flexShrink={0}>
                <Box width={pct((b.x - 7) / PX)} flexShrink={0} />
                <Svg source={tailSvg(b.lean)} alt="Speech bubble tail" width={14} height={TAIL_H} isInteractive />
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
      {waiting > 0 ? (
        <Box key="more" position="absolute" right={1} bottom={0} borderStyle="round" borderColor="#2b3445" backgroundColor="#ffffff" paddingX={1} paddingY={0}>
          <Text color="#1d2433">{`+${waiting} more`}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
