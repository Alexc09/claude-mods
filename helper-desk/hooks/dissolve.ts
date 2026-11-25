import type { HelperPhase } from '../types'
import { MASCOT_PX, mascotOf } from './mascots'

/**
 * The pixel burst a finished subagent card leaves with: over its last BURST_MS the mascot flashes,
 * then its pixels fly out from the middle, spin and fade; the progress bar does the same, mostly sideways.
 *
 * burstSvg(id, phase)                the mascot's still drawing, every pixel its own rect, bursting.
 * burstBarSvg(color, W, seat)        the finished progress bar bursting.
 *
 * Each is one fixed SVG source with CSS @keyframes only (no script). The desktop keeps an `isInteractive`
 * frame while the source is byte-identical, so the pane swaps to it once and the animation runs from
 * frame 0, which looks exactly like the still drawing. Every per-pixel offset comes from a seeded
 * generator, so the same input always gives the same string. Text and border cannot animate in the pane:
 * textFade() says how far they have faded for one redraw.
 */

/** How long the burst runs, in ms: the last BURST_MS of a finished card's time in the pane. */
export const BURST_MS = 1300
/** The text and border fade: from TEXT_FROM ms into the burst, TEXT_STEPS steps of STEP_MS each. */
export const STEP_MS = 100
const TEXT_FROM = 300
const TEXT_STEPS = 9
/** The desktop's cap on one Svg source. */
export const MAX_SOURCE = 131_072

/** Seeded generator (mulberry32 on an FNV-1a hash of the key): same key, same numbers. */
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
/** Short numbers: one or two decimals, no leading zero. */
const n1 = (v: number) => String(Math.round(v * 10) / 10).replace(/^(-?)0\./, '$1.')
const n2 = (v: number) => String(Math.round(v * 100) / 100).replace(/^(-?)0\./, '$1.')

type Px = { x: number; y: number; c: string; w?: number; h?: number; o?: number }

/**
 * The mascot's still drawing as single pixels, built the way mascotSvg(id, phase) builds its grid:
 * the map's inks in that phase's colours, a one-pixel outline round every filled pixel, then rest[phase].
 */
function stillPixels(id: string, phase: Exclude<HelperPhase, 'working'>): Px[] {
  const m = mascotOf(id)
  const map = m.map.map(row => row.padEnd(24, '.'))
  const cells = new Set<string>()
  map.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && cells.add(`${x},${y}`)))
  const ink = (ch: string) => m.phaseInk?.[ch]?.[phase] ?? m.ink[ch] ?? m.outline
  const grid: string[][] = map.map(row => [...row].map(ch => (ch === '.' ? '' : ink(ch))))
  for (const k of cells) {
    const [x, y] = k.split(',').map(Number) as [number, number]
    for (const [ax, ay] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as [number, number][]) {
      if (ay >= 0 && ay < map.length && ax >= 0 && ax < 24 && !cells.has(`${ax},${ay}`)) grid[ay]![ax] = m.outline
    }
  }
  for (const [x, y, c] of m.rest?.[phase] ?? []) grid[y]![x] = c
  const out: Px[] = []
  grid.forEach((row, y) => row.forEach((c, x) => c && y < 24 && out.push({ x, y, c })))
  return out
}

/**
 * Each pixel flies out fast and slows (ease-out), spins and fades over the second half. The flash: the
 * figure brightens and pops a little (.q). Brightening, not a white overlay, so it reads on a light pane
 * too. Should a sanitizer drop the filter, the pop and the burst still play.
 */
const CSS =
  '.p>*>*{transform-box:fill-box;transform-origin:center}' +
  '@keyframes k{0%{opacity:1;animation-timing-function:cubic-bezier(.2,.65,.35,1)}' +
  '40%{opacity:1;scale:1;animation-timing-function:ease-in}' +
  '100%{translate:var(--x) var(--y);rotate:var(--r);scale:var(--s);opacity:0}}' +
  '.p>*>*{animation:k 1s cubic-bezier(.2,.65,.35,1) both}' +
  '@keyframes q{0%{scale:1;filter:brightness(1)}35%{scale:1.08;filter:brightness(1.9) saturate(1.3)}100%{scale:1;filter:brightness(1)}}.q{animation:q .32s ease-out both}' +
  '@media (prefers-reduced-motion: reduce){.p>*>*,.q{animation:none}.p{animation:z .8s ease-out both}}@keyframes z{to{opacity:0}}'

/** The particles in a group that flashes round (ox, oy). */
const wrap = (body: string, ox: number, oy: number) =>
  `<g class="q" style="transform-origin:${n1(ox)}px ${n1(oy)}px"><g class="p">${body}</g></g>`

type Motion = { x: number; y: number; r: number; s: number; d: number }

/** One rect per pixel, grouped by fill (the order inside a group keeps the drawing's layering). */
function particles(px: Px[], motion: (p: Px) => Motion): string {
  const groups = new Map<string, string[]>()
  for (const p of px) {
    const mv = motion(p)
    const vars = `--x:${n1(mv.x)}px;--y:${n1(mv.y)}px;--r:${Math.round(mv.r)}deg;--s:${n1(mv.s)}`
    const key = p.o !== undefined && p.o < 1 ? `${p.c}|${n2(p.o)}` : p.c
    const list = groups.get(key) ?? []
    // Mascot pixels are opaque, so a hair of overlap is safe; bar cells are see-through, so they must not overlap.
    const pad = p.w === undefined ? 0.08 : 0
    list.push(`<rect x="${n2(p.x - pad / 2)}" y="${n2(p.y - pad / 2)}" width="${n2((p.w ?? 1) + pad)}" height="${n2((p.h ?? 1) + pad)}" style="${vars};animation-delay:${n2(mv.d)}s"/>`)
    groups.set(key, list)
  }
  return [...groups]
    .map(([key, list]) => {
      const [c, o] = key.split('|')
      return `<g fill="${c}"${o ? ` fill-opacity="${o}"` : ''}>${list.join('')}</g>`
    })
    .join('')
}

/** How one pixel moves: out from the middle. `bar`: the 10 px strip, so mostly sideways and in CSS px. */
function burst(rnd: () => number, px: Px[], bar: boolean): (p: Px) => Motion {
  const cx = px.reduce((a, p) => a + p.x + (p.w ?? 1) / 2, 0) / px.length
  const cy = px.reduce((a, p) => a + p.y + (p.h ?? 1) / 2, 0) / px.length
  return p => {
    const vx = p.x + (p.w ?? 1) / 2 - cx
    const vy = bar ? (rnd() - 0.5) * 2 : p.y + (p.h ?? 1) / 2 - cy
    const a = rnd(), b = rnd(), c = rnd()
    if (bar) {
      const dist = 8 + b * 18 + Math.abs(vx) * 0.12
      return { d: 0.18 + c * 0.1, x: Math.sign(vx || 1) * dist, y: (b - 0.5) * 7, r: (c - 0.5) * 360, s: 0.3 + a * 0.3 }
    }
    const len = Math.hypot(vx, vy)
    const ang = len < 0.3 ? a * Math.PI * 2 : Math.atan2(vy, vx) + (a - 0.5) * 0.5
    const dist = 2.5 + b * 4 + len * 0.3
    return { d: 0.18 + c * 0.1, x: Math.cos(ang) * dist, y: Math.sin(ang) * dist - 1, r: (c - 0.5) * 360, s: 0.3 + a * 0.3 }
  }
}

const cache = new Map<string, string | null>()
/** For tests: how many sources the cache holds. */
export const burstCacheSize = () => cache.size

/** The mascot bursting: one fixed SVG source, the same size and viewBox as mascotSvg. */
export function burstSvg(id: string, phase: Exclude<HelperPhase, 'working'>): string {
  const m = mascotOf(id)
  const key = `${m.id}:${phase}`
  const hit = cache.get(key)
  if (hit) return hit
  const px = stillPixels(m.id, phase)
  // Seeded on the mascot alone, so done and failed fly the same way.
  const body = particles(px, burst(rng(`${m.id}:burst`), px, false))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${MASCOT_PX}" height="${MASCOT_PX}" shape-rendering="crispEdges">` +
    `<style>${CSS}</style>${wrap(body, 12, 12)}</svg>`
  cache.set(key, svg)
  return svg
}

// ---------- The progress bar ----------

const BAR_H = 10
/** Bars come in this many sparkle layouts, by seat, so the cache holds at most this many per colour and width. */
export const BAR_VARIANTS = 4
const CELL = 3
// register.tsx's noise() and sparkles(), for the same sparkle spots as the finished bar.
const noise = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return v - Math.floor(v)
}
function sparkleSpots(w: number, h: number, salt: number): [number, number][] {
  const cols = Math.floor(w / CELL)
  const rows = Math.max(1, Math.floor(h / CELL))
  const out: [number, number][] = []
  for (let c = 0; c < cols; c++) {
    const density = 0.18 + 0.3 * Math.pow(c / Math.max(1, cols), 1.3)
    for (let r = 0; r < rows; r++) if (noise(c + salt, r) < density) out.push([c * CELL + 0.5, r * CELL + (h - rows * CELL) / 2 + 0.5])
  }
  return out
}

/** The finished bar as cells of `cs` px: the gradient (track under it folded in), inside the rounded ends, plus the sparkles. */
function barPixels(color: string, W: number, seat: number, cs: number): Px[] {
  const R = BAR_H / 2
  const out: Px[] = []
  for (let x = 0; x < W; x += cs) {
    for (let y = 0; y < BAR_H; y += cs) {
      const mx = x + cs / 2, my = y + cs / 2
      const ex = mx < R ? R - mx : mx > W - R ? mx - (W - R) : 0
      if (ex * ex + (my - R) * (my - R) > R * R) continue
      // The track (16 %) under a gradient from 55 % to 100 %: what the two layers add up to.
      const g = 0.55 + 0.45 * (mx / W)
      out.push({ x, y, c: color, w: cs, h: cs, o: Math.round((1 - 0.84 * (1 - g)) * 100) / 100 })
    }
  }
  for (const [x, y] of sparkleSpots(W, BAR_H, seat * 11)) out.push({ x, y, c: '#ffffff', w: 1.6, h: 1.6, o: 0.75 })
  return out
}

/**
 * The finished progress bar bursting, W by 10 CSS px like cardBarSvg. Coarser cells on a wide bar keep it
 * under MAX_SOURCE; null for a bar too wide even then, which keeps its still drawing.
 */
export function burstBarSvg(color: string, W: number, seat: number): string | null {
  const v = seat % BAR_VARIANTS
  const key = `bar:${color}:${W}:${v}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  let out: string | null = null
  for (const cs of [2, 2.5, 5, 10]) {
    const px = barPixels(color, W, v, cs)
    const body = particles(px, burst(rng(`${key}:burst`), px, true))
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAR_H}" viewBox="0 0 ${W} ${BAR_H}"><style>${CSS}</style>${wrap(body, W / 2, BAR_H / 2)}</svg>`
    if (svg.length <= MAX_SOURCE) {
      out = svg
      break
    }
  }
  cache.set(key, out)
  return out
}

/** How far the text and border have faded `ms` into the burst, 0 to 1, in whole steps: the pane redraws every STEP_MS. */
export function textFade(ms: number): number {
  if (ms < TEXT_FROM) return 0
  return Math.min(TEXT_STEPS, Math.floor((ms - TEXT_FROM) / STEP_MS) + 1) / TEXT_STEPS
}
