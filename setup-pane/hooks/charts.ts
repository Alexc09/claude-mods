import type { CostPaneDay, CostPaneHourDay } from '../types'

// Chart and number helpers of the cost pane: Svg markup for the desktop, block-character bars for the terminal.

// Mid-tone colors that read on a light and a dark pane alike.
export const ACCENT = '#d97757'
export const BLUE = '#3f8fd2'
export const GREY = '#8a8a8a'
export const MODEL_COLOR: Record<string, string> = { Opus: ACCENT, Fable: '#8e6fd8', Mythos: '#c9a227', Sonnet: BLUE, Haiku: '#4caf7a' }
// SVG text: the desktop draws the markup as an image, where currentColor does not follow the theme,
// so the ink follows the system's light or dark mode instead.
export const INK_LIGHT = '#5c5c5c'
export const INK_DARK = '#b8b8b8'

/** "$1,200" from $100 up, "$4.20" below. */
export function money(n: number): string {
  if (Math.abs(n) >= 100) {
    const whole = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `${n < 0 ? '-' : ''}$${whole}`
  }
  return `$${n.toFixed(2)}`
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A bar of `frac` (0 to 1) of `cells` terminal cells, in eighths of a cell. */
export function textBar(frac: number, cells: number): string {
  const n = Math.max(0, Math.min(1, frac || 0)) * cells
  const full = Math.floor(n)
  const rem = Math.round((n - full) * 8)
  return '█'.repeat(full + (rem === 8 ? 1 : 0)) + (rem === 8 ? '' : EIGHTHS[rem]!)
}

/** Whole cells for each value, adding up to `cells` (largest remainder first). */
export function splitCells(values: number[], cells: number): number[] {
  const sum = values.reduce((a, b) => a + b, 0)
  if (sum <= 0) return values.map(() => 0)
  const raw = values.map(v => (v / sum) * cells)
  const out = raw.map(Math.floor)
  let left = cells - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left-- <= 0) break
    out[i]! += 1
  }
  return out
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const SVG_STYLE =
  `<style>.t{fill:${INK_LIGHT};font:10px -apple-system,BlinkMacSystemFont,system-ui,sans-serif}.b{font-weight:700}` +
  `.a{stroke:${INK_LIGHT};stroke-opacity:.35}@media (prefers-color-scheme:dark){.t{fill:${INK_DARK}}.a{stroke:${INK_DARK}}}</style>`
const svgOpen = (w: number, h: number, style = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${SVG_STYLE}${style}`
/**
 * For the two charts: the slot's full width at a fixed height, with no viewBox, so nothing is scaled. Drawn as a
 * plain image, not an interactive frame: a frame took the mouse wheel, so the pane would not scroll over a chart.
 * Everything across is placed in percent of the image, everything down in pixels, so text keeps its size at any width.
 */
const svgOpenWide = (h: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${h}">${SVG_STYLE}${EDGE_STYLE}`
// Below this frame width, a label centred under the first or last bar can reach past the frame's edge.
const EDGE_WIDTH = 400
// Space kept between an edge label and the image's edge.
const EDGE_GAP = 2
const EDGE_STYLE = `<style>.en{display:none}@media (max-width:${EDGE_WIDTH}px){.ew{display:none}.en{display:inline}}</style>`

/**
 * A label centred at `x` percent across. Under the first or last bar (`edge`), a second copy against the
 * frame's edge takes its place in a narrow frame, so the label never leaves the frame.
 */
function centredText(x: number, y: number, text: string, cls: string, edge: 'left' | 'right' | '' = '', extra = ''): string {
  const at = (attrs: string, c: string) => `<text class="${c}" ${attrs} y="${y}"${extra}>${esc(text)}</text>`
  const mid = `x="${pct(x)}" text-anchor="middle"`
  if (!edge) return at(mid, cls)
  const side = edge === 'left' ? `x="${EDGE_GAP}" text-anchor="start"` : `x="100%" dx="-${EDGE_GAP}" text-anchor="end"`
  return at(mid, `${cls} ew`) + at(side, `${cls} en`)
}

/** A box placed across in percent of the frame (`x`, `w`) and down in pixels (`y`, `h`). */
type Bar = { x: number; y: number; w: number; h: number }
const pct = (v: number) => `${+v.toFixed(2)}%`
const barAttrs = (b: Bar) => `x="${pct(b.x)}" y="${b.y.toFixed(1)}" width="${pct(b.w)}" height="${b.h.toFixed(1)}"`

/** A chart's markup and the pixel height it is drawn at. */
export type Chart = { source: string; height: number }

// The charts' fixed heights, whatever the data, so the pane's layout never changes when only the figures do.
export const DAY_CHART_HEIGHT = 170
export const HOUR_CHART_HEIGHT = 160

/** One bar per day of the plan week (reset to reset: 8 bars when the reset splits a day, else 7): this week in the accent, last week's same day as a faint bar behind. */
export function dailySvg(days: CostPaneDay[]): Chart {
  const hasSub = days.some(d => d.sub)
  const h = DAY_CHART_HEIGHT
  const top = 18
  const base = h - (hasSub ? 32 : 20)
  const max = Math.max(1, ...days.map(d => Math.max(d.cost, d.last)))
  const slot = 100 / days.length
  const today = days.reduce((at, d, i) => (d.isFuture ? at : i), -1)
  const y = (v: number) => base - ((base - top) * v) / max
  const lw = slot * 0.72
  const tw = slot * 0.42
  let out = svgOpenWide(h)
  days.forEach((d, i) => {
    const cx = slot * i + slot / 2
    if (d.last > 0) out += `<rect ${barAttrs({ x: cx - lw / 2, y: y(d.last), w: lw, h: base - y(d.last) })} rx="2" fill="${GREY}" fill-opacity=".28"/>`
    if (!d.isFuture && d.cost > 0) out += `<rect ${barAttrs({ x: cx - tw / 2, y: y(d.cost), w: tw, h: base - y(d.cost) })} rx="2" fill="${ACCENT}"/>`
    if (!d.isFuture) out += `<text class="t" x="${pct(cx)}" y="${(y(d.cost) - 4).toFixed(1)}" text-anchor="middle">${esc(money(d.cost))}</text>`
    out += `<text class="t${i === today ? ' b' : ''}" x="${pct(cx)}" y="${base + 15}" text-anchor="middle">${esc(d.label)}</text>`
    const edge = i === 0 ? 'left' : i === days.length - 1 ? 'right' : ''
    if (d.sub) out += centredText(cx, base + 27, d.sub, 't', edge, ' font-size="9" fill-opacity=".7"')
  })
  out += `<line class="a" x1="0" x2="100%" y1="${base + 0.5}" y2="${base + 0.5}"/>`
  return { source: `${out}</svg>`, height: h }
}

export const hh = (h: number) => String(h).padStart(2, '0')

/** The hours of a day with use, costliest first (earlier hour first on a tie). */
export function topHours(day: CostPaneHourDay, n: number): number[] {
  return day.hours
    .map((c, h) => [c ?? 0, h] as const)
    .filter(([c]) => c > 0)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, n)
    .map(([, h]) => h)
}

/** 24 bars, 00 to 23: a faint stub for an hour with no use, nothing for one to come; a label every 3rd hour, the figure on the top 3. */
export function hourlySvg(day: CostPaneHourDay): Chart {
  const h = HOUR_CHART_HEIGHT
  // Room for two rows of figures: a figure that would overlap a neighbour's goes one row up.
  const top = 30
  const base = h - 20
  const max = Math.max(0.01, ...day.hours.map(c => c ?? 0))
  const slot = 100 / 24
  const bw = slot * 0.7
  const marked = topHours(day, 3)
  const y = (v: number) => base - ((base - top) * v) / max
  let out = svgOpenWide(h)
  day.hours.forEach((c, i) => {
    const x = slot * i + slot / 2 - bw / 2
    if (c === null) return
    if (c > 0) out += `<rect ${barAttrs({ x, y: y(c), w: bw, h: base - y(c) })} rx="1.5" fill="${ACCENT}"/>`
    else out += `<rect ${barAttrs({ x, y: base - 1.5, w: bw, h: 1.5 })} fill="${GREY}" fill-opacity=".5"/>`
  })
  // A figure about 12% of the frame across (about 40px in a narrow frame) from one at the same height goes one row up.
  const placed: { x: number; y: number }[] = []
  for (const i of marked) {
    const c = day.hours[i] ?? 0
    const cx = slot * i + slot / 2
    let ty = y(c) - 4
    for (const p of placed) if (Math.abs(p.x - cx) < 12 && Math.abs(p.y - ty) < 12) ty = p.y - 12
    placed.push({ x: cx, y: ty })
    // The first and last hour's figure starts or ends at its bar, so it stays inside the frame.
    const [tx, anchor] = i === 0 ? [cx - bw / 2, 'start'] : i === 23 ? [cx + bw / 2, 'end'] : [cx, 'middle']
    out += `<text class="t" x="${pct(tx)}" y="${ty.toFixed(1)}" text-anchor="${anchor}">${esc(money(c))}</text>`
  }
  for (let i = 0; i < 24; i += 3) out += centredText(slot * i + slot / 2, h - 5, hh(i), 't', i === 0 ? 'left' : '')
  out += `<line class="a" x1="0" x2="100%" y1="${base + 0.5}" y2="${base + 0.5}"/>`
  return { source: `${out}</svg>`, height: h }
}

/** A day's name as the tab writes it: "Mon from 9am" on the week's first and last bar, "Tue" otherwise. */
export const dayName = (d: CostPaneDay) => (d.sub ? `${d.label} ${d.sub}` : d.label)

/** The line under the By day chart: each day with a cost so far, in order ("Mon from 9am $12 · Tue $12"). */
export function dayFigures(days: CostPaneDay[]): string {
  const used = days.filter(d => !d.isFuture && d.cost > 0)
  return used.length ? used.map(d => `${dayName(d)} ${money(d.cost)}`).join(' · ') : 'No cost yet this plan week.'
}

/** The line under the By hour chart: the 5 costliest hours of the day, in time order. */
export function topHoursLine(day: CostPaneHourDay): string {
  const top = topHours(day, 5).sort((a, b) => a - b)
  return top.length ? `Top hours: ${top.map(h => `${hh(h)}:00 ${money(day.hours[h] ?? 0)}`).join(' · ')}` : `No cost on ${day.label}.`
}

const LOWER = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** The terminal's hourly chart: `rows` lines of bars, `cw` cells per hour, then a baseline (blank for hours to come) and the hour labels. */
export function hourlyText(day: CostPaneHourDay, cw: number, rows = 3): string[] {
  const max = Math.max(0.01, ...day.hours.map(c => c ?? 0))
  const lines: string[] = []
  for (let r = rows - 1; r >= 0; r--) {
    lines.push(
      day.hours
        .map(c => {
          const eighths = c ? Math.max(1, Math.round((c / max) * rows * 8)) : 0
          return LOWER[Math.max(0, Math.min(8, eighths - r * 8))]!.repeat(cw)
        })
        .join(''),
    )
  }
  lines.push(day.hours.map(c => (c === null ? ' ' : '─').repeat(cw)).join(''))
  let axis = ''
  for (let i = 0; i < 24; i += 3) axis += hh(i).padEnd(3 * cw)
  lines.push(axis.trimEnd())
  return lines
}

/** One bar split into colored parts by value. */
export function stackSvg(parts: { value: number; color: string }[], w: number): string {
  const h = 14
  const sum = parts.reduce((a, p) => a + p.value, 0) || 1
  let x = 0
  let out = svgOpen(w, h) + `<clipPath id="r"><rect width="${w}" height="${h}" rx="4"/></clipPath><g clip-path="url(#r)">`
  for (const p of parts) {
    const pw = (w * p.value) / sum
    if (pw > 0) out += `<rect x="${x.toFixed(1)}" width="${pw.toFixed(1)}" height="${h}" fill="${p.color}"/>`
    x += pw
  }
  return out + '</g></svg>'
}

/** A thin bar of `frac` (0 to 1) on a faint track. */
export function barSvg(frac: number, w: number): string {
  const h = 8
  const fw = Math.max(0, Math.min(1, frac)) * w
  return `${svgOpen(w, h)}<rect width="${w}" height="${h}" rx="3" fill="${GREY}" fill-opacity=".18"/><rect width="${fw.toFixed(1)}" height="${h}" rx="3" fill="${ACCENT}"/></svg>`
}
