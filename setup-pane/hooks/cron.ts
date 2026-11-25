// Five-field cron ("M H DoM Mon DoW"), read in a fixed time zone: the next run, and the schedule in words.

const MINUTE = 60_000
const DAY = 86_400_000
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

type Field = { values: number[]; isAny: boolean }
export type Cron = { minute: Field; hour: Field; dom: Field; month: Field; dow: Field }

function num(text: string): number {
  const named = NAMES[text.toLowerCase()]
  if (named !== undefined) return named
  if (!/^\d+$/.test(text)) throw new Error(`"${text}" is not a number`)
  return Number(text)
}

/** One field: `*`, `5`, `1,4`, `1-5`, `*\/5`, `6-11/2`, names (`mon`). */
function field(text: string, lo: number, hi: number): Field {
  const values = new Set<number>()
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/') as [string, string | undefined]
    const step = stepText === undefined ? 1 : num(stepText)
    if (step < 1) throw new Error(`bad step in "${part}"`)
    let from = lo
    let to = hi
    if (range !== '*') {
      const [a, b] = range.split('-') as [string, string | undefined]
      from = num(a)
      to = b === undefined ? (stepText === undefined ? from : hi) : num(b)
    }
    if (from < lo || to > hi || from > to) throw new Error(`"${part}" is out of range ${lo}-${hi}`)
    for (let v = from; v <= to; v += step) values.add(v)
  }
  return { values: [...values].sort((a, b) => a - b), isAny: text === '*' }
}

/** Parses a five-field cron expression; throws with the reason on anything else. */
export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`"${expr}" does not have 5 fields`)
  const dow = field(parts[4]!.replace(/\b7\b/g, '0'), 0, 6)
  return {
    minute: field(parts[0]!, 0, 59),
    hour: field(parts[1]!, 0, 23),
    dom: field(parts[2]!, 1, 31),
    month: field(parts[3]!, 1, 12),
    dow,
  }
}

/** Whether a calendar day matches: day-of-month and day-of-week are OR-ed when both are set, as in cron. */
function dayMatches(c: Cron, dom: number, month: number, dow: number): boolean {
  if (!c.month.values.includes(month)) return false
  const isDom = c.dom.values.includes(dom)
  const isDow = c.dow.values.includes(dow)
  if (!c.dom.isAny && !c.dow.isAny) return isDom || isDow
  return isDom && isDow
}

/**
 * The first run strictly after `afterMs`, in a zone `offsetMin` minutes ahead of UTC.
 * Null when nothing matches within five years (say `0 0 31 2 *`) or the expression is bad.
 */
export function nextCronRun(expr: string, afterMs: number, offsetMin: number): number | null {
  let c: Cron
  try {
    c = parseCron(expr)
  } catch {
    return null
  }
  const shift = offsetMin * MINUTE
  // Local wall-clock time, kept in a Date read with UTC getters.
  const start = Math.floor((afterMs + shift) / MINUTE) * MINUTE + MINUTE
  const startDay = Math.floor(start / DAY) * DAY
  for (let d = 0; d < 366 * 5; d++) {
    const day = startDay + d * DAY
    const date = new Date(day)
    if (!dayMatches(c, date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCDay())) continue
    for (const h of c.hour.values) {
      for (const m of c.minute.values) {
        const local = day + h * 3_600_000 + m * MINUTE
        if (local >= start) return local - shift
      }
    }
  }
  return null
}

const pad = (n: number) => String(n).padStart(2, '0')
const andList = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

/** "Every Sunday at 09:00", "Every day at 10:30 and 13:30", "Every Mon and Thu at 07:00"; the expression itself when it is too odd to say. */
export function cronWords(expr: string): string {
  let c: Cron
  try {
    c = parseCron(expr)
  } catch {
    return `Cron "${expr}"`
  }
  const raw = `Cron "${expr.trim()}" (local time)`
  if (!c.month.isAny) return raw
  let when: string
  const isMinuteStep = c.minute.values.length > 1
  if (isMinuteStep) {
    const v = c.minute.values
    const step = v[1]! - v[0]!
    const isEven = v.every((x, i) => i === 0 || x - v[i - 1]! === step) && v[0]! < step && v[v.length - 1]! + step >= 60
    if (!isEven) return raw
    const hours = c.hour.isAny ? '' : contiguous(c.hour.values) ? `, ${pad(c.hour.values[0]!)}:00-${pad(c.hour.values[c.hour.values.length - 1]!)}:59` : ''
    if (!c.hour.isAny && !hours) return raw
    when = `every ${step} minutes${hours}`
  } else {
    if (c.hour.isAny || c.hour.values.length > 6) return raw
    when = `at ${andList(c.hour.values.map(h => `${pad(h)}:${pad(c.minute.values[0]!)}`))}`
  }
  let days: string
  if (c.dom.isAny && c.dow.isAny) days = 'Every day'
  else if (c.dom.isAny) {
    const d = c.dow.values
    if (d.join() === '1,2,3,4,5') days = 'Every weekday (Mon to Fri)'
    else if (d.length === 1) days = `Every ${DAY_NAMES[d[0]!]}`
    else days = `Every ${andList(d.map(x => DAY_SHORT[x]!))}`
  } else if (c.dow.isAny) {
    const v = c.dom.values
    const step = v.length > 1 ? v[1]! - v[0]! : 0
    if (v[0] === 1 && step > 1 && v.every((x, i) => i === 0 || x - v[i - 1]! === step)) days = `Every ${step} days (days ${v.slice(0, 3).join(', ')}, ... of each month)`
    else if (v.length <= 4) days = `Every month on day ${andList(v.map(String))}`
    else return raw
  } else return raw
  if (isMinuteStep) return days === 'Every day' ? cap(when) : `${days}, ${when}`
  return `${days} ${when}`
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

function contiguous(v: number[]): boolean {
  return v.every((x, i) => i === 0 || x - v[i - 1]! === 1)
}

/** "Sun 29 Nov, 09:00" in the zone `offsetMin` ahead of UTC; with `withYear`, "Mon 7 Dec 2026 09:00". */
export function dayTime(ms: number, offsetMin: number, withYear = false): string {
  const d = new Date(ms + offsetMin * MINUTE)
  const date = `${DAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  return withYear ? `${date} ${d.getUTCFullYear()} ${time}` : `${date}, ${time}`
}

/** "in 6 days", "tomorrow", "in 3 h", "in 12 min", "now"; "was due 2 h ago" for a time past. */
export function countdown(ms: number, nowMs: number, offsetMin: number): string {
  const diff = ms - nowMs
  if (diff < -MINUTE) return `was due ${span(-diff)} ago`
  if (diff < MINUTE) return 'now'
  if (diff < 3_600_000) return `in ${Math.round(diff / MINUTE)} min`
  if (diff < 20 * 3_600_000) return `in ${Math.round(diff / 3_600_000)} h`
  const shift = offsetMin * MINUTE
  const days = Math.round((Math.floor((ms + shift) / DAY) * DAY - Math.floor((nowMs + shift) / DAY) * DAY) / DAY)
  if (days <= 0) return `in ${Math.round(diff / 3_600_000)} h`
  return days === 1 ? 'tomorrow' : `in ${days} days`
}

function span(ms: number): string {
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / MINUTE))} min`
  if (ms < DAY) return `${Math.round(ms / 3_600_000)} h`
  const d = Math.round(ms / DAY)
  return `${d} day${d === 1 ? '' : 's'}`
}
