import type { BoxProps, ButtonProps, ElementConstructor, EngineInterface, Register, TextProps } from 'claude-code'

import type { BandPlan, CheckItem, Checklist, Helper, HelperPhase, PlanStatus, Step, StepKind } from '../types'
import { CHECK_FILE, GROUP_ORDER, TODO_FILE, buildChecklist, confirmed, findFile, groupsOf, ticked, type GroupId } from './checklist'
import { connectorName, splitTool } from './connectors'
import { BAR_VARIANTS, BURST_MS, STEP_MS, burstBarSvg, burstSvg, textFade } from './dissolve'
import { SAY_MS as FLOE_SAY_MS, floeScene } from './floe'
import { CREW, DEFAULT_MASCOT, MASCOTS, MASCOT_PX, mascotOf, mascotSvg, type Mascot } from './mascots'

const NAME = 'helper-desk'
const PANE = 'helpers'
// The name a person reads; the plugin and its /helpers command keep their old names.
const TITLE = 'Helper Desk'
const HELPERS = { plugin: 'helper-desk', key: 'helpers' } as const
const CLOCK = { plugin: 'helper-desk', key: 'clock' } as const
const VIEW = { plugin: 'helper-desk', key: 'view' } as const
const COST = { plugin: 'helper-desk', key: 'cost' } as const
const OFF = { plugin: 'helper-desk', key: 'off' } as const
const HIDDEN = { plugin: 'helper-desk', key: 'hidden' } as const
const PLAN = { plugin: 'helper-desk', key: 'plan' } as const
const SHIM = { plugin: 'helper-desk', key: 'shimmer' } as const
const PANE_OPEN = { plugin: 'helper-desk', key: 'paneOpen' } as const
// The main chat's card: its own key, so the subagent count and tiles leave it out.
const MAIN = { plugin: 'helper-desk', key: 'main' } as const
const MAIN_ID = 'main'
// Which mascot the main card draws: the id, kept in $.store under STORE_MASCOT across sessions.
const MASCOT = { plugin: 'helper-desk', key: 'mascot' } as const
const STORE_MASCOT = 'mascot'
// Crew mode: each subagent card wears one of the fast-food crew (CREW in ./mascots) instead of a crab.
// On unless /crew off saved false in $.store under STORE_CREW.
const CREW_ON = { plugin: 'helper-desk', key: 'crew' } as const
const STORE_CREW = 'crew'
// Where the crew hand-out carries on from, kept across sessions so a new chat starts with someone new.
const STORE_CREW_NEXT = 'crewNext'
// Which view the pane draws: the cards, or the Ice floe (./floe). /desk and the pane's buttons set it, $.store keeps it.
const DESK = { plugin: 'helper-desk', key: 'desk' } as const
const STORE_DESK = 'desk'
type Desk = 'cards' | 'floe'
const DESK_NAME: Record<Desk, string> = { cards: 'Cards', floe: 'Ice floe' }
// The project checklist (TODO.md, else RESUME.md), read on the switches poll; each value is drawn only when it changes.
const CHECKLIST = { plugin: 'helper-desk', key: 'checklist' } as const
// The pane's tab while a checklist is shown: Agents (the cards or the floe) or Checklist. Per session, not stored.
const TAB = { plugin: 'helper-desk', key: 'tab' } as const
type Tab = 'agents' | 'checklist'
// Far past any helper's seat, so its bar's SVG ids are its own; an orange pet.
const MAIN_SEAT = 1000
const MAIN_HUE = 1

const TICK_MS = 300
const POLL_MS = 2000
const SWITCH_MS = 3000
const HISTORY = 3
const MAX_STEPS = 200
const TAG_W = 11
// Columns the pet takes beside a card; the Svg is 48 by 36 CSS pixels.
const PET_W = 8
const PET_PX_W = 48
const PET_PX_H = 36
// A running pet changes frame every second tick: about every 600 ms.
const FRAME_TICKS = 2
// How long a done or failed card stays in the pane before it is removed. Its last BURST_MS it bursts (./dissolve).
const GONE_MS = 10_000
// While a card bursts the clock ticks this fast, so its text and border fade in steps; pets still step every TICK_MS.
const FAST_MS = STEP_MS
// What a bursting card's text and border fade toward. A hook cannot tell a light pane from a dark one,
// so a mid grey with about the same contrast on both (white and #262624).
const FADE_TO = '#828282'

const ACCENT = '#d97757'
const GOOD = '#16a34a'
const BAD = '#dc2626'
// The task bar is a purple gradient, light at the start and deep at the head (after Johnny's Savvy Progress).
const P_LIGHT = '#c4b5fd'
const P_MID = '#8b5cf6'
const P_DEEP = '#6d28d9'
// Quarter circles read clearly on desktop fonts and in the terminal.
const SPIN = ['◐', '◓', '◑', '◒']
const PULSE = ['●∙∙', '∙●∙', '∙∙●', '∙●∙']

const KIND_COLOR: Record<StepKind, string> = {
  Command: '#ca8a04',
  Connector: '#2563eb',
  'File read': '#16a34a',
  'File write': '#d97757',
  Skill: '#9333ea',
  Web: '#0891b2',
  Subagent: '#db2777',
  Tool: '#78716c',
}

// ---------- Pets: a pixel Claude crab, one body colour per helper ----------

type Px = [x: number, y: number]

// Eight body colours that are easy to tell apart and read on light and dark.
const HUES: { name: string; color: string }[] = [
  { name: 'red', color: '#dc2626' },
  { name: 'orange', color: '#ea580c' },
  { name: 'yellow', color: '#eab308' },
  { name: 'green', color: '#16a34a' },
  { name: 'teal', color: '#0d9488' },
  { name: 'blue', color: '#2563eb' },
  { name: 'purple', color: '#9333ea' },
  { name: 'pink', color: '#db2777' },
]
const hueOf = (hue: number) => HUES[((hue % HUES.length) + HUES.length) % HUES.length]!

// Eyes and outline are the same on every pet.
const EYE = '#2b1d16'
const OUTLINE = '#2b1d16'
const FRAMES = 4

const span = (y: number, from: number, to: number): Px[] => Array.from({ length: to - from + 1 }, (_, i) => [from + i, y] as Px)

/**
 * One frame of the crab on a 16 by 12 grid. Frame 0 stands; 1 hops up a pixel with
 * its legs moved; 2 stands and blinks; 3 raises both claws.
 */
function crab(frame: number): { body: Px[]; eyes: Px[] } {
  const dy = frame === 1 ? 0 : 1
  const clawsUp = frame === 3
  const body: Px[] = [
    ...span(1, 3, 12),
    ...span(2, 3, 12),
    ...span(3, 3, 12),
    ...(clawsUp ? span(4, 3, 12) : span(4, 1, 14)),
    ...(clawsUp ? span(5, 3, 12) : span(5, 1, 14)),
    ...span(6, 3, 12),
    ...span(7, 3, 12),
  ]
  if (clawsUp) body.push([1, 2], [2, 2], [1, 3], [2, 3], [13, 2], [14, 2], [13, 3], [14, 3])
  const legs = frame % 2 === 1 ? [3, 5, 10, 12] : [4, 6, 9, 11]
  for (const x of legs) body.push([x, 8], [x, 9])
  const eyes: Px[] = frame === 2 ? [[5, 4], [10, 4]] : [[5, 3], [5, 4], [10, 3], [10, 4]]
  const move = (p: Px): Px => [p[0], p[1] + dy]
  return { body: body.map(move), eyes: eyes.map(move) }
}

const petCache = new Map<string, string>()

function petSvg(hue: number, frame: number) {
  const key = `${hue % HUES.length}:${frame}`
  const hit = petCache.get(key)
  if (hit) return hit
  const { body, eyes } = crab(frame)
  const fill = hueOf(hue).color
  const has = new Set(body.map(([x, y]) => `${x},${y}`))
  // A one-pixel outline round the body, so every colour reads on light and dark.
  const ring = new Set<string>()
  for (const [x, y] of body) {
    for (const [ax, ay] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as Px[]) {
      const k = `${ax},${ay}`
      if (!has.has(k)) ring.add(k)
    }
  }
  const rect = (x: number, y: number, c: string) => `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${c}"/>`
  const parts = [
    ...[...ring].map(k => {
      const [x, y] = k.split(',').map(Number)
      return rect(x!, y!, OUTLINE)
    }),
    ...body.map(([x, y]) => rect(x, y, fill)),
    ...eyes.map(([x, y]) => rect(x, y, EYE)),
  ]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 13" width="${PET_PX_W}" height="${PET_PX_H}" shape-rendering="crispEdges">${parts.join('')}</svg>`
  petCache.set(key, svg)
  return svg
}

// The main chat's pet is a mascot from ./mascots (swap it with /mascot).

// ---------- The desk itself; $.state carries a copy for the pane to draw ----------

let helpers: Helper[] = []
let main: Helper | null = null
// True from a prompt's submit until a turn takes it: that turn gets a fresh main card.
let freshTurn = false
let seats = 0
// The next body colour to hand out, in HUES order.
let nextHue = 0
// The next crew member to hand out, as an index into CREW, and the main card's mascot (no card shares it).
let crewNext = 0
let mainMascot = DEFAULT_MASCOT
let desk: Desk = 'cards'
let tickN = 0
let home = ''
let sessionId = ''
let off = false
// "helper-desk:hidden": true in switches.json closes the pane and stops it opening by itself.
let hidden = false
let ticker: { cancel: () => void } | null = null
// The ticker's period now, and the ms counted toward the next pet and spinner step.
let tickMs = 0
let sinceStep = 0
let poller: { cancel: () => void } | null = null
let switcher: { cancel: () => void } | null = null
// One timer per done or failed helper: it starts the card's burst, then removes the card GONE_MS after it ended.
const removals = new Map<string, { cancel: () => void }>()
// The cards bursting now: the ticker runs at FAST_MS while there are any.
const dissolving = new Set<string>()
const strangers = new Set<string>()

function toolWords(tool: string, connector: string) {
  const words = tool
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase())
  // "slack_search_public" from Slack reads "Slack · search public".
  if (words.length > 1 && words[0] === connector.split(' ')[0]!.toLowerCase()) words.shift()
  return words.join(' ')
}

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const cut = (t: string, n: number) => (n <= 0 ? '' : t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t)
const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim()

function folder(p: string) {
  const parts = p.split('/')
  parts.pop()
  const dir = parts.join('/')
  return home && dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir
}

/** One tool call: its kind, a short label for the list, and plain words for the live line. */
function describe(tool: string, args: Record<string, unknown>): Step {
  const s = (k: string) => (typeof args[k] === 'string' ? oneLine(args[k] as string) : '')
  const file = (verb: string, kind: StepKind, key = 'file_path'): Step => {
    const p = typeof args[key] === 'string' ? (args[key] as string) : ''
    const name = base(p) || 'a file'
    return { kind, label: name, dim: p ? folder(p) : '', live: `${verb} ${name}` }
  }
  if (tool.startsWith('mcp__')) {
    const { server, name: toolName } = splitTool(tool)
    const name = connectorName(server, toolName)
    const words = toolWords(toolName.replace(/__/g, '_'), name)
    return { kind: 'Connector', label: `${name} · ${words}`, dim: '', live: `${name}: ${words}` }
  }
  switch (tool) {
    case 'Read':
      return file('Reading', 'File read')
    case 'Write':
      return file('Writing', 'File write')
    case 'Edit':
    case 'MultiEdit':
      return file('Editing', 'File write')
    case 'NotebookEdit':
      return file('Editing', 'File write', 'notebook_path')
    case 'Grep':
    case 'Glob': {
      const pat = s('pattern')
      const p = s('path')
      return {
        kind: 'File read',
        label: pat ? `Search "${cut(pat, 60)}"` : 'Search files',
        dim: p ? (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p) : '',
        live: pat ? `Searching files for "${cut(pat, 40)}"` : 'Searching files',
      }
    }
    case 'Bash': {
      const label = s('description') || cut(s('command'), 80) || 'a command'
      return { kind: 'Command', label, dim: '', live: `Running: ${label}` }
    }
    case 'WebSearch':
      return { kind: 'Web', label: s('query') || 'web search', dim: '', live: `Searching the web: ${s('query')}` }
    case 'WebFetch': {
      let host = 'a web page'
      try {
        host = new URL(s('url')).host
      } catch {
        // Not a URL: keep the plain words.
      }
      return { kind: 'Web', label: host, dim: '', live: `Opening ${host}` }
    }
    case 'Skill':
      return { kind: 'Skill', label: s('skill') || 'a skill', dim: '', live: `Using the ${s('skill') || 'a'} skill` }
    case 'Agent':
    case 'Task':
      return {
        kind: 'Subagent',
        label: s('description') || 'Start a subagent',
        dim: '',
        live: s('description') ? `Starting a subagent: ${s('description')}` : 'Starting a subagent',
      }
    case 'SendMessage':
      return { kind: 'Subagent', label: 'Send a message', dim: '', live: 'Sending a message' }
    case 'TodoWrite':
      return { kind: 'Tool', label: 'Update its to-do list', dim: '', live: 'Updating its to-do list' }
    case 'ToolSearch':
      return { kind: 'Tool', label: 'Load tools', dim: '', live: 'Loading tools' }
    default:
      return { kind: 'Tool', label: tool, dim: '', live: `Using ${tool}` }
  }
}

function clockTime(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/**
 * The pane header's status: "3 subagents running", or "3 running" where the long one, the view button and Hide
 * would not fit on one row of `width` columns. A button costs its label and 4 (the terminal's `[ label ]`).
 */
function statusText(n: number, width: number, viewLabel: string) {
  const long = n ? `${n} subagent${n === 1 ? '' : 's'} running` : 'No subagents running'
  const fits = long.length + 1 + (viewLabel.length + 4) + 1 + ('Hide'.length + 4) <= width
  return fits ? long : n ? `${n} running` : 'None running'
}

/**
 * The Agents tab's label: "Agents · 3", else "Agents 3", else "Agents", the first that keeps the tabbed header on one
 * row of `width` columns. As in statusText, a framed button costs its label and 4: the pressed tab, the view button
 * and Hide are framed, the other tab is its label alone.
 */
function agentsLabel(n: number, width: number, viewLabel: string) {
  const forms = n ? [`Agents · ${n}`, `Agents ${n}`, 'Agents'] : ['Agents']
  const rest = 4 + 1 + 'Checklist'.length + 1 + (viewLabel.length + 4) + 1 + ('Hide'.length + 4)
  return forms.find(f => f.length + rest <= width) ?? forms[forms.length - 1]!
}

function tokenText(n: number) {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** "claude-opus-5-5" reads "Opus 5.5"; "haiku" reads "Haiku". */
function shortModel(model: string) {
  const hit = /(opus|sonnet|haiku|fable)(?:[-_ ](\d+))?(?:[-_.](\d+))?/i.exec(model)
  if (!hit) return model
  const fam = hit[1]![0]!.toUpperCase() + hit[1]!.slice(1).toLowerCase()
  return hit[2] ? `${fam} ${hit[2]}${hit[3] ? `.${hit[3]}` : ''}` : fam
}

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
const usageTotal = (u: Usage) => u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

const working = () => helpers.filter(hp => hp.phase === 'working').length

/** The next colour in order that no running helper wears; with all 8 taken, the next in order. */
function pickHue() {
  const used = new Set(helpers.filter(hp => hp.phase === 'working').map(hp => hp.hue % HUES.length))
  let hue = nextHue % HUES.length
  for (let i = 0; i < HUES.length; i += 1) {
    const h = (nextHue + i) % HUES.length
    if (!used.has(h)) {
      hue = h
      break
    }
  }
  nextHue = hue + 1
  return hue
}

/**
 * The crew member for a new card: the next one from the cursor on that no card in the pane wears
 * (the main card's mascot counts too). With all of them on screen, the one whose latest card is oldest.
 */
function pickCrew(): string {
  const latest = new Map<string, number>()
  for (const hp of helpers) if (hp.crew) latest.set(hp.crew, Math.max(latest.get(hp.crew) ?? -1, hp.seat))
  let id: string | undefined
  for (let i = 0; i < CREW.length && !id; i += 1) {
    const c = CREW[(crewNext + i) % CREW.length]!
    if (!latest.has(c) && c !== mainMascot) id = c
  }
  id ??= [...CREW].sort((a, b) => (a === mainMascot ? Infinity : latest.get(a) ?? -1) - (b === mainMascot ? Infinity : latest.get(b) ?? -1))[0]!
  crewNext = (CREW.indexOf(id) + 1) % CREW.length
  return id
}

async function saveCrewNext($: EngineInterface) {
  await $.store.set(STORE_CREW_NEXT, crewNext).catch(err => log($, `save crew cursor: ${String(err)}`))
}
const copy = (hp: Helper): Helper => ({ ...hp, steps: hp.steps.map(st => ({ ...st })) })

async function log($: EngineInterface, line: string) {
  try {
    const dir = `${home}/.claude/mods-logs`
    const path = `${dir}/${NAME}.log`
    let old = ''
    if (await $.fs.exists(path).catch(() => false)) old = String(await $.fs.read(path))
    else await $.process.run(['mkdir', '-p', dir])
    await $.fs.write(path, `${old}${new Date().toISOString()} ${line}\n`)
  } catch {
    // Logging must never break the session.
  }
}

/** Moves the clock on by `step` ms; the tick count (pets, spinner, pulse) only once a whole TICK_MS has gone by. */
async function tick($: EngineInterface, step: number) {
  sinceStep += step
  if (sinceStep >= TICK_MS) {
    sinceStep = 0
    tickN += 1
  }
  await $.state.set(CLOCK, { tick: tickN, now: await $.clock.now() })
}

async function readCost($: EngineInterface) {
  try {
    const u = await $.session.usage()
    await $.state.set(COST, { usd: typeof u.cost?.usd === 'number' ? u.cost.usd : null })
  } catch {
    // No ledger here: the tile stays hidden.
  }
}

async function poll($: EngineInterface) {
  if (!working()) return
  const list = await $.agent.list()
  const now = await $.clock.now()
  let changed = false
  for (const a of list) {
    const hp = helpers.find(x => x.id === a.id)
    if (!hp || hp.phase !== 'working') continue
    // The list may lag a turn's end; it only ever moves a card out of working.
    const next: HelperPhase | null =
      a.status === 'completed' || a.status === 'idle' ? 'done' : a.status === 'failed' || a.status === 'killed' ? 'failed' : null
    if (next) {
      hp.phase = next
      hp.endedAt = now
      scheduleRemoval($, hp.id, GONE_MS)
      sayLater($)
      changed = true
    }
    if (!hp.description && a.description) {
      hp.description = a.description
      changed = true
    }
  }
  if (changed) await publish($)
  else await readCost($)
}

function syncTimers($: EngineInterface) {
  const busy = (working() || main?.phase === 'working') && !off
  const ms = dissolving.size ? FAST_MS : TICK_MS
  if (busy || (dissolving.size && !off)) {
    if (ticker && tickMs !== ms) {
      ticker.cancel()
      ticker = null
    }
    tickMs = ms
    ticker ??= $.clock.every(ms, () => {
      void tick($, ms).catch(() => undefined)
    })
  } else {
    ticker?.cancel()
    ticker = null
  }
  if (busy) {
    poller ??= $.clock.every(POLL_MS, () => {
      void poll($).catch(err => log($, `poll: ${String(err)}`))
    })
  } else {
    poller?.cancel()
    poller = null
  }
}

async function publish($: EngineInterface) {
  await $.state.set(HELPERS, helpers.map(copy))
  if (main) await $.state.set(MAIN, copy(main))
  await $.state.set(CLOCK, { tick: tickN, now: await $.clock.now() })
  await readCost($)
  // No status line: on desktop it drew over other mods' footer bars. The pane shows the count.
  $.ui.status(undefined)
  syncTimers($)
}

async function addHelper($: EngineInterface, id: string, description: string, type: string, model: string) {
  const known = helpers.find(hp => hp.id === id)
  if (known) {
    // Found first through its own tool calls: fill in what the spawn knows.
    if (description) known.description = description
    if (type) known.type = type
    if (model && !known.model) known.model = model
    await publish($)
    return
  }
  const wasIdle = working() === 0
  const now = await $.clock.now()
  helpers.push({
    id,
    description: description || 'Subagent',
    type: type || 'subagent',
    model,
    effort: '',
    phase: 'working',
    startedAt: now,
    endedAt: 0,
    count: 0,
    steps: [],
    tokens: 0,
    turnTokens: 0,
    hasUsage: false,
    seat: seats,
    hue: pickHue(),
    // Its crew member for as long as the card lives, drawn while crew mode is on.
    crew: pickCrew(),
  })
  seats += 1
  await saveCrewNext($)
  await publish($)
  // The pane opens by itself when a new round of helpers starts.
  if (wasIdle && !hidden) void $.ui.open({ id: PANE, title: TITLE }).catch(err => log($, `open: ${String(err)}`))
}

/** A loop whose spawn this mod missed (a reload, a race): take it from $.agent.list(). */
async function adopt($: EngineInterface, id: string) {
  if (helpers.some(hp => hp.id === id) || strangers.has(id)) return
  const a = (await $.agent.list()).find(x => x.id === id)
  if (!a) {
    // The engine's own forks carry ids no list names: leave them out.
    strangers.add(id)
    return
  }
  await addHelper($, id, a.description, a.type, '')
}

async function noteTool($: EngineInterface, id: string, step: Step) {
  if (!helpers.some(x => x.id === id)) await adopt($, id)
  const hp = helpers.find(x => x.id === id)
  if (!hp) return
  addStep(hp, step)
  // When its live step changed: the Ice floe shows it in a bubble for a while.
  hp.stepAt = await $.clock.now()
  await publish($)
}

function addStep(hp: Helper, step: Step) {
  hp.count += 1
  hp.steps = [...hp.steps, step].slice(-MAX_STEPS)
  // A teammate that finished a turn and picks up work again is working again.
  if (hp.phase !== 'working') {
    hp.phase = 'working'
    hp.endedAt = 0
    cancelRemoval(hp.id)
  }
}

/** The main chat's card, working; the turn after a new prompt starts it afresh. */
async function mainCard($: EngineInterface, turnStart: boolean): Promise<Helper> {
  const now = await $.clock.now()
  // A step's first request starts its turn; a tool call after an ended turn means a new one began unseen.
  if (!main || (freshTurn && (turnStart || main.phase !== 'working'))) {
    freshTurn = false
    main = {
      id: MAIN_ID,
      description: 'Main chat',
      type: 'main agent',
      model: main?.model ?? '',
      effort: main?.effort ?? '',
      phase: 'working',
      startedAt: now,
      endedAt: 0,
      count: 0,
      steps: [],
      tokens: 0,
      turnTokens: 0,
      hasUsage: false,
      seat: MAIN_SEAT,
      hue: MAIN_HUE,
    }
  } else if (main.phase !== 'working') {
    main.phase = 'working'
    main.endedAt = 0
  }
  return main
}

async function noteMain($: EngineInterface, step: Step) {
  addStep(await mainCard($, false), step)
  await publish($)
}

/** One model request: no `id` is the main chat's. */
async function noteStep($: EngineInterface, id: string | undefined, model: string, effort: string, usage: Usage | null) {
  if (id && !helpers.some(x => x.id === id)) await adopt($, id)
  const hp = id ? helpers.find(x => x.id === id) : main
  if (!hp) return
  if (model) hp.model = shortModel(model)
  if (effort) hp.effort = effort
  if (usage) {
    hp.turnTokens += usageTotal(usage)
    hp.hasUsage = true
  }
  await publish($)
}

/** A turn's end: no `id` is the main chat's, which stays in the pane. */
async function finish($: EngineInterface, id: string | undefined, phase: HelperPhase, usage: Usage | null) {
  const hp = id ? helpers.find(x => x.id === id) : main
  if (!hp) return
  // The turn's own sum wins over the steps counted so far.
  hp.tokens += usage ? usageTotal(usage) : hp.turnTokens
  hp.turnTokens = 0
  if (usage) hp.hasUsage = true
  hp.phase = phase
  hp.endedAt = await $.clock.now()
  if (id) {
    scheduleRemoval($, id, GONE_MS)
    sayLater($)
  }
  await publish($)
}

/** On the Ice floe the main chat reacts to a helper that ended for FLOE_SAY_MS: redraw once then, ticker or not. */
function sayLater($: EngineInterface) {
  if (desk !== 'floe') return
  $.clock.after(FLOE_SAY_MS + 50, () => {
    void tick($, 0).catch(() => undefined)
  })
}

async function setDesk($: EngineInterface, value: Desk) {
  desk = value
  await $.store.set(STORE_DESK, value).catch(err => log($, `save desk: ${String(err)}`))
  await $.state.set(DESK, value)
}

/** The pane shows running helpers only: a done or failed one bursts over its last BURST_MS and leaves after `ms`. */
function scheduleRemoval($: EngineInterface, id: string, ms: number) {
  cancelRemoval(id)
  removals.set(
    id,
    $.clock.after(Math.max(0, ms - BURST_MS), () => {
      // The pane draws the burst from the clock; the fast ticker moves the clock while it runs.
      dissolving.add(id)
      syncTimers($)
      void tick($, 0).catch(() => undefined)
      removals.set(
        id,
        $.clock.after(Math.min(ms, BURST_MS), () => {
          removals.delete(id)
          void removeHelper($, id).catch(err => log($, `remove: ${String(err)}`))
        }),
      )
    }),
  )
}

function cancelRemoval(id: string) {
  removals.get(id)?.cancel()
  removals.delete(id)
  dissolving.delete(id)
}

/** Drops a helper that is still over from the desk and from $.state, so a reload does not bring it back. */
async function removeHelper($: EngineInterface, id: string) {
  dissolving.delete(id)
  const hp = helpers.find(x => x.id === id)
  if (!hp || hp.phase === 'working') return syncTimers($)
  helpers = helpers.filter(x => x.id !== id)
  await publish($)
}

async function setOff($: EngineInterface, value: boolean) {
  if (value === off) return
  off = value
  await $.state.set(OFF, off)
  if (off) {
    $.ui.status(undefined)
    await $.ui.close({ id: PANE }).catch(() => undefined)
  }
  syncTimers($)
  syncShimmer($)
}

const HIDE_KEY = `${NAME}:hidden`
const switchesPath = () => `${home}/.claude/mods/switches.json`

async function readSwitches($: EngineInterface): Promise<Record<string, unknown>> {
  if (!(await $.fs.exists(switchesPath()))) return {}
  const json = JSON.parse(String(await $.fs.read(switchesPath()))) as unknown
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {}
}

async function readSwitch($: EngineInterface) {
  try {
    const json = await readSwitches($)
    const nowHidden = json[`${NAME}:hidden`] === true
    if (nowHidden && !hidden) await $.ui.close({ id: PANE }).catch(() => undefined)
    if (nowHidden !== hidden) {
      hidden = nowHidden
      // The band reads this key, so a change redraws it.
      await $.state.set(HIDDEN, hidden)
      syncShimmer($)
    }
    await setOff($, json[NAME] === false)
  } catch {
    // A broken file never turns the mod off.
  }
}

// Read, change, write the whole file, so every chat sees the choice within 3 s.
async function setHidden($: EngineInterface, value: boolean) {
  try {
    const json = await readSwitches($)
    if (value) json[HIDE_KEY] = true
    else delete json[HIDE_KEY]
    await $.process.run(['mkdir', '-p', `${home}/.claude/mods`])
    await $.fs.write(switchesPath(), `${JSON.stringify(json, null, 2)}\n`)
  } catch (err) {
    await log($, `save hidden: ${String(err)}`)
  }
  hidden = value
  await $.state.set(HIDDEN, hidden)
  syncShimmer($)
  if (value) await $.ui.close({ id: PANE }).catch(() => undefined)
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: TITLE })
}

// The band's button reads this key, so a change redraws it.
async function setPaneOpen($: EngineInterface, value: boolean) {
  const { value: was = false } = await $.state.get(PANE_OPEN)
  if (was !== value) await $.state.set(PANE_OPEN, value)
}

// The engine's record: a reload, or a close no event told of, still shows the right label.
async function syncPaneOpen($: EngineInterface) {
  await setPaneOpen($, (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced))
}

async function checkOpen($: EngineInterface) {
  if (!sessionId) return
  const path = `${home}/.claude/mods/.open-${NAME}-${sessionId}`
  if (!(await $.fs.exists(path).catch(() => false))) return
  await $.process.run(['rm', '-f', path])
  if (!off) await openPane($)
}

// ---------- The project checklist: TODO.md, else RESUME.md's "What the user asked for"; read only ----------

// Ids kept in view.open: Confirmed done (or Completed) opened, and each long group shown in full.
const CL_DONE = 'checklist-done'
/** A long group's id in view.open, and its "+N more" button's key ('cl-todo' and 'checklist-todo' as before TODO.md). */
const moreId = (id: GroupId) => `checklist-${id === 'done' ? 'done-more' : id}`
const moreKey = (id: GroupId) => `cl-${id === 'done' ? 'done-more' : id}`
const CL_PRESS: Record<string, string> = { 'cl-done': CL_DONE, ...Object.fromEntries(GROUP_ORDER.map(id => [moreKey(id), moreId(id)])) }
// Items a group shows before its "+N more".
const GROUP_CAP = 8
const DONE_FOLD = 3
/** The last list drawn, as JSON, and its checkbox items; null before the first read. */
let checkJson: string | null = null
let checkItems: CheckItem[] = []

/** The stored checklist, or null for a value of the old shape (a bare item list, up to 1.9.1) a reload left behind. */
function storedList(value: unknown): Checklist | null {
  const list = value as Checklist | null
  const isList = !!list && typeof list === 'object' && !Array.isArray(list)
  return isList && Array.isArray(list.items) && Array.isArray(list.waiting) && Array.isArray(list.now) ? list : null
}

/** Finds and parses the project's TODO.md and RESUME.md; sets the state only when the list changed, compared by content. */
async function readChecklist($: EngineInterface) {
  try {
    const start = await $.session.root().catch(() => $.session.cwd())
    const exists = (p: string) => $.fs.exists(p).catch(() => false)
    const readOf = async (name: string) => {
      const path = await findFile(name, exists, start, home)
      return path ? String(await $.fs.read(path)) : null
    }
    const list = buildChecklist(await readOf(TODO_FILE), await readOf(CHECK_FILE))
    const json = JSON.stringify(list)
    if (json === checkJson) return
    const first = checkJson === null
    const before = checkItems
    const items = list?.items ?? []
    checkJson = json
    checkItems = items
    await $.state.set(CHECKLIST, list)
    // No checklist, no Checklist tab: back to Agents.
    if (!list) await $.state.set(TAB, 'agents')
    if (first) return
    for (const it of ticked(before, items)) say($, `Ticked: ${cut(it.text, 60)}`)
    for (const it of confirmed(before, items)) say($, `Confirmed: ${cut(it.text, 60)}`)
  } catch (err) {
    // An unreadable file keeps the last list drawn.
    await log($, `checklist: ${String(err)}`)
  }
}

async function switchPoll($: EngineInterface) {
  await readSwitch($)
  if (!off) await readChecklist($)
  await checkOpen($).catch(err => log($, `open request: ${String(err)}`))
  await syncPaneOpen($).catch(err => log($, `pane sync: ${String(err)}`))
}

// ---------- The plan: one list per chat, also saved to ~/.claude/mods-state/plan-<session id>.json ----------

const PLAN_TOOL = 'mcp__helper-desk__plan'
const OPEN_LABEL = 'Open Helper Desk'
const CLOSE_LABEL = 'Close Helper Desk'
const MIRRORED = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])
const PLAN_PROMPT =
  'Your to-do list is the mcp__helper-desk__plan tool (this app has no TodoWrite). The user watches it as a progress bar. ' +
  'For any task that needs 2 or more steps or tool calls, call it first, before other tools, with every step in order and the first one in_progress. ' +
  'Call it again with the full list each time a step finishes or a new one starts. Mark the last step completed before your final answer. ' +
  'When you write a plan for the user to approve, save its steps with the tool too, all pending, so the plan shows in the bar. ' +
  'A step that launches subagents is one step. Skip it only for a one-line answer with no tool calls.'
// Main-chat tool calls in a turn before the nudge to make a plan.
const NUDGE_AFTER = 1
// Tool calls since the last plan update before the nudge to tick it.
const STALE_AFTER = 8
const NUDGE_NEW =
  'Helper Desk: you have no plan for this task yet. Call mcp__helper-desk__plan now with every step in order, so the user sees your progress.'
const NUDGE_CONT =
  'Helper Desk: the plan has not changed this turn. If this is a new task, call mcp__helper-desk__plan with its steps. If it carries on the last one, send the updated list.'
const NUDGE_STALE =
  'Helper Desk: the plan has not changed in a while. If a step finished, call mcp__helper-desk__plan with the full list now.'
const STATUSES: readonly PlanStatus[] = ['pending', 'in_progress', 'completed']
const SHIMMER_MS = 350
// How long a finished plan stays at 100% before the band goes away.
const DONE_HOLD_MS = 20_000
const BAR_FALLBACK = 30

type PlanStep = { text: string; status: PlanStatus; doneAt?: string; id?: string }
type Plan = { title: string; steps: PlanStep[]; updatedAt: string }
type StepIn = { text: string; status: PlanStatus; id?: string }

let plan: Plan | null = null
// True once every step is done; a list with work left in it starts the next plan.
let planDone = false
let planShown = false
let shimmer: { cancel: () => void } | null = null
let holdTimer: { cancel: () => void } | null = null
let shimN = 0
// The plan nudge: main-chat tool calls this turn, and whether a plan came in.
let turnCalls = 0
let turnPlanned = false
let nudged = false
let sincePlan = 0
let staleNudged = false

// A short reminder after a tool's result, read by the model only.
function withNudge<R>(r: R): R {
  turnCalls++
  sincePlan++
  const live = !!plan && !planDone && plan.steps.length > 0
  let note: string | null = null
  if (!turnPlanned && !nudged && turnCalls >= NUDGE_AFTER) {
    nudged = true
    note = live ? NUDGE_CONT : NUDGE_NEW
  } else if (live && !staleNudged && sincePlan >= STALE_AFTER) {
    staleNudged = true
    note = NUDGE_STALE
  }
  if (!note || !r || typeof r !== 'object' || 'deny' in (r as object)) return r
  const had = (r as { context?: readonly string[] }).context ?? []
  return { ...r, context: [...had, note] }
}
let stateDirMade = false

const planPath = () => `${home}/.claude/mods-state/plan-${sessionId}.json`
const doneCount = (steps: { status: PlanStatus }[]) => steps.filter(st => st.status === 'completed').length
const isStatus = (v: unknown): v is PlanStatus => typeof v === 'string' && (STATUSES as readonly string[]).includes(v)

async function writePlan($: EngineInterface) {
  if (!plan || !sessionId || !home) return
  try {
    if (!stateDirMade) {
      await $.process.run(['mkdir', '-p', `${home}/.claude/mods-state`])
      stateDirMade = true
    }
    const body = {
      title: plan.title,
      steps: plan.steps.map(st => ({ text: st.text, status: st.status, ...(st.doneAt ? { doneAt: st.doneAt } : {}) })),
      updatedAt: plan.updatedAt,
    }
    await $.fs.write(planPath(), `${JSON.stringify(body, null, 2)}\n`)
  } catch (err) {
    await log($, `write plan: ${String(err)}`)
  }
}

async function drawPlan($: EngineInterface) {
  const value: BandPlan | null = plan
    ? { title: plan.title, steps: plan.steps.map(st => ({ text: st.text, status: st.status })), shown: planShown }
    : null
  await $.state.set(PLAN, value)
  syncShimmer($)
}

/** The shimmer clock runs only while a shown plan has a step in progress. */
function syncShimmer($: EngineInterface) {
  const need = !off && !hidden && planShown && !!plan?.steps.some(st => st.status === 'in_progress')
  if (need) {
    shimmer ??= $.clock.every(SHIMMER_MS, () => {
      shimN += 1
      void $.state.set(SHIM, shimN).catch(() => undefined)
    })
  } else {
    shimmer?.cancel()
    shimmer = null
  }
}

function say($: EngineInterface, text: string) {
  try {
    $.ui.toast(cut(text, 140))
  } catch {
    // A toast is only a hint.
  }
}

/** Takes a whole new list, keeps done times, toasts what just finished, and saves. */
async function applyPlan($: EngineInterface, title: string | undefined, incoming: StepIn[]) {
  const now = new Date(await $.clock.now()).toISOString()
  const allDone = incoming.length > 0 && incoming.every(st => st.status === 'completed')
  // A list with work left in it after a finished plan is a new plan.
  const fresh = !plan || (planDone && !allDone)
  const old = fresh ? [] : plan!.steps
  const used = new Set<number>()
  const match = (st: StepIn) => {
    const i = old.findIndex((o, k) => !used.has(k) && (st.id ? o.id === st.id : o.text === st.text))
    if (i >= 0) used.add(i)
    return i >= 0 ? old[i] : undefined
  }
  const justDone: string[] = []
  const steps: PlanStep[] = incoming.map(st => {
    const was = match(st)
    const step: PlanStep = { text: st.text, status: st.status, ...(st.id ? { id: st.id } : {}) }
    if (st.status === 'completed') {
      step.doneAt = was?.status === 'completed' && was.doneAt ? was.doneAt : now
      if (was?.status !== 'completed' && !fresh) justDone.push(st.text)
    }
    return step
  })
  const wasDone = planDone && !fresh
  plan = { title: title?.trim() || (fresh ? 'Plan' : plan!.title), steps, updatedAt: now }
  planDone = allDone
  if (!steps.length) planShown = false
  else if (allDone && !wasDone) {
    planShown = true
    say($, steps.length === 1 ? 'All steps done.' : `All ${steps.length} steps done.`)
    holdTimer?.cancel()
    holdTimer = $.clock.after(DONE_HOLD_MS, () => {
      holdTimer = null
      planShown = false
      void drawPlan($).catch(err => log($, `hide plan: ${String(err)}`))
    })
  } else if (!allDone) {
    planShown = true
    holdTimer?.cancel()
    holdTimer = null
    if (justDone.length) say($, `Done: ${justDone.join(', ')}`)
  }
  await writePlan($)
  await drawPlan($)
}

/** The plan tool's own call: check the input, save it, answer in one line. */
async function planFromTool($: EngineInterface, args: Record<string, unknown>) {
  const raw = args.steps
  if (!Array.isArray(raw)) return 'Plan not saved: send steps as a list of { text, status }.'
  const steps: StepIn[] = []
  for (const st of raw as unknown[]) {
    const o = (st && typeof st === 'object' ? st : {}) as Record<string, unknown>
    const text = typeof o.text === 'string' ? oneLine(o.text) : ''
    if (!text) return 'Plan not saved: every step needs its text.'
    if (!isStatus(o.status)) return `Plan not saved: "${cut(text, 40)}" needs a status of pending, in_progress or completed.`
    steps.push({ text, status: o.status })
  }
  await applyPlan($, typeof args.title === 'string' ? oneLine(args.title) : undefined, steps)
  return `Plan saved: ${doneCount(steps)} of ${steps.length} steps done.`
}

/** TodoWrite, TaskCreate and TaskUpdate on the main chat feed the same plan. */
async function mirror($: EngineInterface, tool: string, args: Record<string, unknown>, r: unknown) {
  const res = (r as { result?: unknown; isError?: boolean; deny?: string } | undefined) ?? {}
  if (res.deny || res.isError) return
  if (tool === 'TodoWrite') {
    const todos = Array.isArray(args.todos) ? (args.todos as unknown[]) : []
    const steps: StepIn[] = []
    for (const t of todos) {
      const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
      const text = typeof o.content === 'string' ? oneLine(o.content) : ''
      if (text) steps.push({ text, status: isStatus(o.status) ? o.status : 'pending' })
    }
    await applyPlan($, undefined, steps)
    return
  }
  const current: StepIn[] = plan && !planDone ? plan.steps.map(st => ({ text: st.text, status: st.status, ...(st.id ? { id: st.id } : {}) })) : []
  if (tool === 'TaskCreate') {
    const text = typeof args.subject === 'string' ? oneLine(args.subject) : ''
    if (!text) return
    const out = (res.result ?? {}) as { task?: { id?: unknown } }
    const id = typeof out.task?.id === 'string' ? out.task.id : undefined
    await applyPlan($, undefined, [...current, { text, status: 'pending', ...(id ? { id } : {}) }])
    return
  }
  // TaskUpdate: find the task by its id; an unknown one with a subject joins the list.
  const id = typeof args.taskId === 'string' ? args.taskId : ''
  const all: StepIn[] = plan ? plan.steps.map(st => ({ text: st.text, status: st.status, ...(st.id ? { id: st.id } : {}) })) : []
  const i = all.findIndex(st => st.id === id)
  const subject = typeof args.subject === 'string' ? oneLine(args.subject) : ''
  if (args.status === 'deleted') {
    if (i >= 0) await applyPlan($, undefined, all.filter((_, k) => k !== i))
    return
  }
  const status = isStatus(args.status) ? args.status : undefined
  if (i < 0) {
    if (subject) await applyPlan($, undefined, [...current, { text: subject, status: status ?? 'pending', id }])
    return
  }
  all[i] = { ...all[i]!, ...(subject ? { text: subject } : {}), ...(status ? { status } : {}) }
  await applyPlan($, undefined, all)
}

/** A reload or resume carries on with the plan this chat already saved. */
async function loadPlan($: EngineInterface) {
  if (plan || !sessionId || !home) return
  try {
    if (!(await $.fs.exists(planPath()))) return
    const json = JSON.parse(String(await $.fs.read(planPath()))) as { title?: unknown; steps?: unknown; updatedAt?: unknown }
    const steps: PlanStep[] = (Array.isArray(json.steps) ? (json.steps as Record<string, unknown>[]) : [])
      .filter(st => st && typeof st.text === 'string' && isStatus(st.status))
      .map(st => ({ text: String(st.text), status: st.status as PlanStatus, ...(typeof st.doneAt === 'string' ? { doneAt: st.doneAt } : {}) }))
    plan = {
      title: typeof json.title === 'string' && json.title ? json.title : 'Plan',
      steps,
      updatedAt: typeof json.updatedAt === 'string' ? json.updatedAt : '',
    }
    planDone = steps.length > 0 && steps.every(st => st.status === 'completed')
    planShown = steps.length > 0 && !planDone
    await drawPlan($)
  } catch (err) {
    await log($, `load plan: ${String(err)}`)
  }
}

async function toggleIn($: EngineInterface, field: 'open', id: string) {
  const { value = { open: [] } } = await $.state.get(VIEW)
  const list = value[field]
  const nextList = list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  await $.state.set(VIEW, { ...value, [field]: nextList })
}

// ---------- Drawing ----------

/** A label then dim text, both cut to fit `w` cells; the folder gives way first. */
function fitRow(label: string, dim: string, w: number): [string, string] {
  if (label.length >= w || !dim) return [cut(label, w), '']
  const room = w - label.length - 2
  if (room < 4) return [label, '']
  return [label, dim.length > room ? `…${dim.slice(-(room - 1))}` : dim]
}

/** The terminal bar: one thick row of blocks, full when over, a sliding piece while working. */
function barParts(phase: HelperPhase, w: number, tick: number, seat: number): [string, string, string] {
  if (phase !== 'working') return ['', '█'.repeat(w), '']
  const piece = Math.max(3, Math.floor(w / 4))
  const span = w + piece
  const head = ((tick + seat * 5 + piece) % span) - piece
  const from = Math.max(0, head)
  const to = Math.min(w, head + piece)
  return ['░'.repeat(from), '█'.repeat(Math.max(0, to - from)), '░'.repeat(w - Math.max(from, to))]
}

// ---------- Sparkle bars: SVG for the desktop ----------

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
const CELL = 3

// Fixed noise, so the sparkles sit still between redraws and only their CSS twinkle moves.
const noise = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return v - Math.floor(v)
}
const xml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
// A rough width of system UI text, enough to place the bar after the title.
const textPx = (s: string, size: number) => [...s].reduce((n, ch) => n + (/[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Zmw@%]/.test(ch) ? 0.72 : 0.56) * size, 0)
const fitPx = (s: string, size: number, max: number) => {
  if (textPx(s, size) <= max) return s
  let out = ''
  for (const ch of s) {
    if (textPx(`${out}${ch}…`, size) > max) break
    out += ch
  }
  return `${out}…`
}

/** Twinkle classes s0 to s3, out of phase; `slow` for a finished bar. */
const twinkleCss = (slow: boolean) =>
  `.s0,.s1,.s2,.s3{animation:tw ${slow ? 3.2 : 2.1}s ease-in-out infinite}` +
  `.s1{animation-duration:${slow ? 3.8 : 2.7}s;animation-delay:-.7s}.s2{animation-duration:${slow ? 4.4 : 1.8}s;animation-delay:-1.3s}` +
  `.s3{animation-duration:${slow ? 3.5 : 3.1}s;animation-delay:-.4s}` +
  `@keyframes tw{0%,100%{opacity:.95}50%{opacity:${slow ? 0.55 : 0.15}}}`

/** Dither squares over `w` by `h` pixels: sparse at the left, dense at the right. */
function sparkles(w: number, h: number, size: number, base: number, rise: number, salt = 0): string {
  const cols = Math.floor(w / CELL)
  const rows = Math.max(1, Math.floor(h / CELL))
  const out: string[] = []
  for (let c = 0; c < cols; c++) {
    const density = base + rise * Math.pow(c / Math.max(1, cols), 1.3)
    for (let r = 0; r < rows; r++) {
      if (noise(c + salt, r) < density) {
        out.push(`<rect class="s${Math.floor(noise(r, c + salt) * 4)}" x="${c * CELL + 0.5}" y="${r * CELL + (h - rows * CELL) / 2 + 0.5}" width="${size}" height="${size}"/>`)
      }
    }
  }
  return out.join('')
}

/** A colour between `a` and `b`, both #rrggbb; `t` from 0 to 1. */
function mix(a: string, b: string, t: number): string {
  const at = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map(i => Math.round(at(a, i) + (at(b, i) - at(a, i)) * t).toString(16).padStart(2, '0')).join('')}`
}

const BAND_H = 24
const TRACK_H = 14

/** The task bar above the prompt, one drawing: dot, title, purple gradient track, ticks, Tasks pill, percent. */
function bandSvg(p: BandPlan, W: number): string {
  const n = p.steps.length
  const done = doneCount(p.steps)
  const ratio = n ? done / n : 0
  const title = fitPx(p.title, 13, Math.max(60, W * 0.35))
  const percent = `${Math.round(ratio * 100)}%`
  const barX = Math.round(14 + textPx(title, 13) + 12)
  const barW = Math.max(60, W - barX - 44)
  const y0 = (BAND_H - TRACK_H) / 2
  const fillW = Math.round(barW * ratio)
  // The step in progress glows softly from the fill to that step's end.
  const live = p.steps.some(st => st.status === 'in_progress')
  const liveW = live ? Math.round((barW * Math.min(n, done + 1)) / n) - fillW : 0
  const ticks: string[] = []
  for (let i = 1; i < n; i++) {
    const x = Math.round((barW * i) / n)
    if (x > fillW + 3) ticks.push(`<rect x="${x}" y="${TRACK_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }
  const label = `Tasks ${done}/${n}`
  const pillW = Math.round(18 + label.length * 6.4)
  const pillX = Math.max(0, Math.min(barW - pillW, fillW - pillW))
  const finished = n > 0 && done === n
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAND_H}" viewBox="0 0 ${W} ${BAND_H}">
<style>
.tt{fill:#1f1f1f}.pc{fill:#6b6b6b}.k{fill:#ece9fb}.tk{fill:#c9c2f0}
@media (prefers-color-scheme: dark){.tt{fill:#ececec}.pc{fill:#a3a3a3}.k{fill:#2a2640}.tk{fill:#4c4470}}
${twinkleCss(finished)}
.lv{animation:gl 1.6s ease-in-out infinite}@keyframes gl{0%,100%{opacity:.18}50%{opacity:.5}}
.sh{animation:sw 2.6s linear infinite}@keyframes sw{from{transform:translateX(-70px)}to{transform:translateX(${fillW + 70}px)}}
@media (prefers-reduced-motion: reduce){.s0,.s1,.s2,.s3,.lv,.sh{animation:none}}
</style>
<defs>
<linearGradient id="hdb-g" x1="0" x2="1"><stop offset="0" stop-color="${P_LIGHT}"/><stop offset=".55" stop-color="${P_MID}"/><stop offset="1" stop-color="${P_DEEP}"/></linearGradient>
<linearGradient id="hdb-s" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="hdb-c"><rect width="${barW}" height="${TRACK_H}" rx="${TRACK_H / 2}"/></clipPath>
<clipPath id="hdb-f"><rect width="${fillW}" height="${TRACK_H}"/></clipPath>
</defs>
<circle cx="5" cy="${BAND_H / 2}" r="4" fill="${P_DEEP}"/>
<text class="tt" x="14" y="${BAND_H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="600">${xml(title)}</text>
<g transform="translate(${barX},${y0})">
<rect class="k" width="${barW}" height="${TRACK_H}" rx="${TRACK_H / 2}"/>
<g clip-path="url(#hdb-c)">
${liveW > 0 ? `<rect class="lv" x="${fillW}" width="${liveW}" height="${TRACK_H}" fill="${P_MID}"/>` : ''}
${fillW > 0 ? `<rect width="${fillW}" height="${TRACK_H}" fill="url(#hdb-g)"/>` : ''}
<g fill="#ffffff">${sparkles(fillW, TRACK_H, 1.6, 0.12, 0.4)}</g>
${fillW > 0 && !finished ? `<g clip-path="url(#hdb-f)"><rect class="sh" width="70" height="${TRACK_H}" fill="url(#hdb-s)"/></g>` : ''}
<g class="tk">${ticks.join('')}</g>
</g>
<rect x="${pillX}" width="${pillW}" height="${TRACK_H}" rx="${TRACK_H / 2}" fill="${P_DEEP}"/>
<text x="${pillX + pillW / 2}" y="${TRACK_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(label)}</text>
</g>
<text class="pc" x="${W - 4}" y="${BAND_H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${percent}</text>
</svg>`
}

const CARD_BAR_H = 10

/**
 * One thick sparkle bar per subagent card. While it works a bright piece sweeps the track
 * (its length is not known); once over the whole bar fills and glows slowly. The drawing
 * depends only on the phase, so CSS moves it and redraws do not restart it.
 * Drawn `isInteractive`: the desktop keeps an unchanged frame across redraws, but swaps an image.
 */
function cardBarSvg(phase: HelperPhase, color: string, W: number, seat: number): string {
  const id = `hdc${seat}`
  const H = CARD_BAR_H
  const fill = phase === 'failed' ? BAD : color
  const piece = Math.max(30, Math.round(W * 0.35))
  const working = phase === 'working'
  const body = working
    ? `<g class="mv"><rect width="${piece}" height="${H}" fill="url(#${id}-p)"/><g fill="#ffffff">${sparkles(piece, H, 1.6, 0.1, 0.35, seat * 11)}</g></g>`
    : `<rect width="${W}" height="${H}" fill="url(#${id}-g)"/><g fill="#ffffff">${sparkles(W, H, 1.6, 0.18, 0.3, (seat % BAR_VARIANTS) * 11)}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
${twinkleCss(!working)}
.mv{animation:mv${seat} 1.8s ease-in-out infinite;animation-delay:-${(seat * 0.37) % 1.8}s}
@keyframes mv${seat}{from{transform:translateX(-${piece}px)}to{transform:translateX(${W}px)}}
@media (prefers-reduced-motion: reduce){.s0,.s1,.s2,.s3,.mv{animation:none}}
</style>
<defs>
<linearGradient id="${id}-g" x1="0" x2="1"><stop offset="0" stop-color="${fill}" stop-opacity=".55"/><stop offset="1" stop-color="${fill}"/></linearGradient>
<linearGradient id="${id}-p" x1="0" x2="1"><stop offset="0" stop-color="${fill}" stop-opacity="0"/><stop offset=".7" stop-color="${fill}"/><stop offset="1" stop-color="${fill}" stop-opacity=".9"/></linearGradient>
<clipPath id="${id}-c"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath>
</defs>
<g clip-path="url(#${id}-c)">
<rect width="${W}" height="${H}" fill="${fill}" opacity=".16"/>
${body}
</g>
</svg>`
}

type ChecklistEls = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps>; Button: ElementConstructor<ButtonProps> }

// Each group's mark. Claimed done is a bare tick, Confirmed done a boxed one; RESUME.md's plain bullets get a dot.
const GROUP_MARK: Record<GroupId, string> = { waiting: '•', now: '•', doing: '◐', todo: '☐', claimed: '✓', done: '☑' }
const GROUP_COLOR: Partial<Record<GroupId, string>> = { waiting: ACCENT, doing: ACCENT, claimed: GOOD, done: GOOD }

/**
 * The Checklist tab: "N of M confirmed · K to check" (from RESUME.md alone: "N of M done"), then Waiting on you,
 * Working on now, In progress, To do, Done, waiting for your check, and Confirmed done (or Completed; folded as
 * "Confirmed done (N)" past 3). Each group shows its first 8 items, "+N more" for the rest. Each item is one line,
 * cut with "…" to the pane width.
 */
function checklistBox({ Box, Text, Button }: ChecklistEls, list: Checklist, open: string[], width: number) {
  const { items } = list
  const done = items.filter(it => it.state === 'done').length
  const toCheck = items.filter(it => it.state === 'claimed').length
  const title =
    list.from === TODO_FILE
      ? `${done} of ${items.length} confirmed${toCheck ? ` · ${toCheck} to check` : ''}`
      : `${done} of ${items.length} done`
  // An item: indent 4, its mark and a space, then the text.
  const textW = Math.max(4, width - 6)
  const row = (id: GroupId) => (text: string, i: number) => (
    <Box key={`cl-${id}-${i}`} flexDirection="row" width={width} paddingLeft={4}>
      <Text color={GROUP_COLOR[id]}>{`${GROUP_MARK[id]} `}</Text>
      <Box width={textW}>
        <Text dimColor={id === 'done'} wrap="truncate-end">
          {cut(text, textW)}
        </Text>
      </Box>
    </Box>
  )
  const label = (text: string) => (
    <Box paddingLeft={2}>
      <Text dimColor>{text}</Text>
    </Box>
  )
  const groups = groupsOf(list).map(({ id, label: name, texts }) => {
    const isFolded = id === 'done' && texts.length > DONE_FOLD
    const isOpen = !isFolded || open.includes(CL_DONE)
    const isFull = texts.length <= GROUP_CAP || open.includes(moreId(id))
    return (
      <Box key={`clg-${id}`} flexDirection="column" width={width}>
        {isFolded ? (
          <Box paddingLeft={2}>
            <Button key="cl-done" plain dimColor onPress={() => undefined}>
              {`${isOpen ? '▾' : '▸'} ${name} (${texts.length})`}
            </Button>
          </Box>
        ) : (
          label(name)
        )}
        {isOpen ? (isFull ? texts : texts.slice(0, GROUP_CAP)).map(row(id)) : null}
        {isOpen && texts.length > GROUP_CAP ? (
          <Box paddingLeft={4}>
            <Button key={moreKey(id)} plain dimColor onPress={() => undefined}>
              {isFull ? 'Show fewer' : `+${texts.length - GROUP_CAP} more`}
            </Button>
          </Box>
        ) : null}
      </Box>
    )
  })
  return (
    <Box key="checklist" flexDirection="column" width={width} marginBottom={1}>
      {items.length ? <Text bold>{title}</Text> : null}
      {groups}
    </Box>
  )
}

/**
 * The Agents tab's one checklist line: "☑ Checklist 6/9 · Now: <first in progress, else first to do> ›", else
 * "· 2 to check" while claimed items wait, else "· All done"; cut to one line. With no checkbox item at all it names
 * RESUME.md's first In progress bullet, else "Waiting on you". Pressing it opens the Checklist tab.
 */
function checklistSummary({ Box, Text, Button }: ChecklistEls, list: Checklist, width: number) {
  const { items } = list
  const done = items.filter(it => it.state === 'done').length
  const toCheck = items.filter(it => it.state === 'claimed').length
  const now = (items.find(it => it.state === 'doing') ?? items.find(it => it.state === 'todo'))?.text ?? (items.length ? undefined : list.now[0])
  const rest = now ? `Now: ${now}` : !items.length ? 'Waiting on you' : toCheck ? `${toCheck} to check` : 'All done'
  const text = `☑ Checklist${items.length ? ` ${done}/${items.length}` : ''} · ${rest}`
  return (
    <Box key="cl-summary-row" flexDirection="row" width={width} marginBottom={1}>
      <Button key="cl-summary" plain onPress={() => undefined}>
        <Text>{cut(text, width - 2)}</Text>
        <Text dimColor>{' ›'}</Text>
      </Button>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = $.plugin.root.split('/.claude/')[0] ?? ''
    sessionId = await $.session.id().catch(() => '')
    await $.command.register({ name: 'helpers', description: 'Show the Helper Desk: the task progress bar and one live card per subagent', immediate: true })
    await $.command.register({
      name: 'mascot',
      description: 'List the Main chat mascots, or switch to one (/mascot fry-cook)',
      argumentHint: '[id]',
      immediate: true,
    })
    await $.command.register({
      name: 'crew',
      description: 'Show the fast-food crew on subagent cards, or the Claude crabs (/crew on, /crew off)',
      argumentHint: '[on|off]',
      immediate: true,
    })
    await $.command.register({
      name: 'desk',
      description: 'Say which Helper Desk view is on, or switch: /desk cards, /desk floe (the Ice floe penguins)',
      argumentHint: '[cards|floe]',
      immediate: true,
    })
    const savedDesk = await $.store.get(STORE_DESK).catch(() => undefined)
    desk = savedDesk === 'floe' ? 'floe' : 'cards'
    await $.state.set(DESK, desk)
    const saved = await $.store.get(STORE_MASCOT).catch(() => undefined)
    mainMascot = mascotOf(typeof saved === 'string' ? saved : DEFAULT_MASCOT).id
    await $.state.set(MASCOT, mainMascot)
    await $.state.set(CREW_ON, (await $.store.get(STORE_CREW).catch(() => undefined)) !== false)
    const cursor = await $.store.get(STORE_CREW_NEXT).catch(() => undefined)
    if (typeof cursor === 'number' && Number.isInteger(cursor)) crewNext = ((cursor % CREW.length) + CREW.length) % CREW.length
    await $.tool.register({
      name: 'plan',
      description:
        'Save the plan for the job in front of you: the steps in order, each pending, in_progress or completed. ' +
        'It draws a progress bar above the prompt for the user. Send the whole list every time, like TodoWrite.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A short name for the job, a few words.' },
          steps: {
            type: 'array',
            description: 'Every step, in order.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'The step in a few plain words.' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['text', 'status'],
            },
          },
        },
        required: ['steps'],
      },
      // In front, not behind ToolSearch: a hidden tool never gets called.
      isDeferred: false,
    }).catch(err => log($, `register plan tool: ${String(err)}`))
    await readSwitch($)
    if (!off) await readChecklist($)
    await loadPlan($)
    await syncPaneOpen($).catch(err => log($, `pane sync: ${String(err)}`))
    switcher ??= $.clock.every(SWITCH_MS, () => {
      void switchPoll($).catch(err => log($, `switch: ${String(err)}`))
    })
    // A reload keeps the drawn copy: carry on from it, less the helpers whose burst had begun
    // (they ended over GONE_MS - BURST_MS ago). One that ended more recently leaves when its GONE_MS is up.
    if (!helpers.length) {
      const { value } = await $.state.get(HELPERS)
      if (value?.length) {
        const now = await $.clock.now()
        // A copy from before body colours has no hue: its seat picks one.
        const all = value.map(hp => ({ ...copy(hp), hue: typeof hp.hue === 'number' ? hp.hue : hp.seat % HUES.length }))
        helpers = all.filter(hp => hp.phase === 'working' || now - hp.endedAt < GONE_MS - BURST_MS)
        // Counted from the whole saved copy, never empty, so seats and colours carry on.
        seats = Math.max(...all.map(hp => hp.seat)) + 1
        nextHue = (Math.max(...all.map(hp => hp.hue)) + 1) % HUES.length
        for (const hp of helpers) if (hp.phase !== 'working') scheduleRemoval($, hp.id, GONE_MS - (now - hp.endedAt))
        // A card saved before the crew came gets its crew member now, and keeps it from here on.
        const unassigned = helpers.filter(hp => !hp.crew)
        for (const hp of unassigned) hp.crew = pickCrew()
        if (unassigned.length) await saveCrewNext($)
        if (helpers.length < all.length || unassigned.length) await $.state.set(HELPERS, helpers.map(copy))
        syncTimers($)
      }
    }
    // The main chat's card is never removed: a reload carries on with it.
    if (!main) {
      const { value } = await $.state.get(MAIN)
      main = value ? copy(value) : null
      syncTimers($)
    }
    return next(e)
  })

  on('command.run', { command: 'helpers' }, async $ => {
    if (off) return { text: `${TITLE} is off. Turn it on by removing "helper-desk": false from ~/.claude/mods/switches.json.` }
    if (hidden) await setHidden($, false)
    await openPane($)
    return { text: helpers.length ? `${TITLE} opened.` : `${TITLE} opened. Cards show up when Claude starts a subagent.` }
  })

  // /mascot lists the mascots; /mascot <id> swaps the main card's one and keeps it for later sessions.
  on('command.run', { command: 'mascot' }, async ($, e) => {
    const { value: now = DEFAULT_MASCOT } = await $.state.get(MASCOT)
    const current = mascotOf(now)
    const ask = e.args.trim().toLowerCase()
    const ids = MASCOTS.map(m => m.id).join(', ')
    if (!ask) {
      const rows = MASCOTS.map(m => `  ${m.id.padEnd(21)}${m.name}${m.id === current.id ? '  (current)' : ''}`)
      return { text: [`Main chat mascots (now ${current.name}):`, ...rows, 'Switch with /mascot <id>.'].join('\n') }
    }
    const pick = MASCOTS.find(m => m.id === ask || m.name.toLowerCase() === ask)
    if (!pick) return { text: `No mascot called "${ask}". Pick one of: ${ids}.` }
    await $.store.set(STORE_MASCOT, pick.id).catch(err => log($, `save mascot: ${String(err)}`))
    mainMascot = pick.id
    await $.state.set(MASCOT, pick.id)
    return { text: `Main chat mascot is now ${pick.name}.` }
  })

  // /crew says whether subagent cards wear the crew; /crew on and /crew off switch, and keep it for later sessions.
  on('command.run', { command: 'crew' }, async ($, e) => {
    const { value: isOn = true } = await $.state.get(CREW_ON)
    const ask = e.args.trim().toLowerCase()
    if (!ask) {
      return {
        text: isOn
          ? 'Crew mode is on: each subagent card shows a fast-food crew member. Turn it off with /crew off.'
          : 'Crew mode is off: subagent cards show the Claude crabs. Turn it on with /crew on.',
      }
    }
    if (ask !== 'on' && ask !== 'off') return { text: `"${ask}" is not a crew setting. Use /crew, /crew on or /crew off.` }
    const value = ask === 'on'
    await $.store.set(STORE_CREW, value).catch(err => log($, `save crew: ${String(err)}`))
    await $.state.set(CREW_ON, value)
    return { text: value ? 'Crew mode on: subagent cards show the fast-food crew.' : 'Crew mode off: subagent cards show the Claude crabs again.' }
  })

  // /desk says which view the pane draws; /desk cards and /desk floe switch, and keep it for later sessions.
  on('command.run', { command: 'desk' }, async ($, e) => {
    const ask = e.args.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
    if (!ask) {
      return {
        text:
          desk === 'floe'
            ? `${TITLE} shows the Ice floe: a penguin for the main chat and one per running subagent. Back to cards with /desk cards, or the Cards button at the top of the pane.`
            : `${TITLE} shows the Cards view. Switch to the penguins with /desk floe, or the Ice floe button at the top of the pane.`,
      }
    }
    const pick: Desk | null = ask === 'cards' || ask === 'card' ? 'cards' : ask === 'floe' || ask === 'ice' || ask === 'ice floe' ? 'floe' : null
    if (!pick) return { text: `"${e.args.trim()}" is not a ${TITLE} view. Use /desk cards or /desk floe.` }
    await setDesk($, pick)
    return {
      text:
        pick === 'floe'
          ? `${TITLE} now shows the Ice floe (drawn in the desktop app; the terminal keeps the cards).`
          : `${TITLE} now shows the Cards view.`,
    }
  })

  // The two view buttons at the top of the pane.
  on('ui.press', { plugin: NAME, element: 'desk-cards' }, async ($, e) => {
    await setDesk($, 'cards')
    return { element: e.element }
  })
  on('ui.press', { plugin: NAME, element: 'desk-floe' }, async ($, e) => {
    await setDesk($, 'floe')
    return { element: e.element }
  })

  on('ui.press', { plugin: NAME, element: 'hide' }, async ($, e) => {
    await setHidden($, true)
    try {
      $.ui.toast(`${TITLE} hidden. Type /helpers to show it.`)
    } catch {
      // The toast is only a hint.
    }
    return { element: e.element }
  })

  // "Open Helper Desk" on the task bar opens the side pane, the same as /helpers; open, it reads "Close Helper Desk" and closes it.
  on('ui.press', { plugin: NAME, element: 'open-desk' }, async ($, e) => {
    const { value: isOpen = false } = await $.state.get(PANE_OPEN)
    if (isOpen) {
      await $.ui.close({ id: PANE }).catch(err => log($, `close from band: ${String(err)}`))
      return { element: e.element }
    }
    if (hidden) await setHidden($, false)
    await openPane($).catch(err => log($, `open from band: ${String(err)}`))
    return { element: e.element }
  })

  // Every open of the pane, whoever asks for it, comes through here.
  on('ui.open', { id: PANE }, async ($, e, next) => {
    const r = await next(e)
    if ('value' in r && r.value) await setPaneOpen($, r.value.isPlaced).catch(err => log($, `pane open state: ${String(err)}`))
    return r
  })

  // Every close but an unload: this mod's own, or the person's close mark or key.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    await log($, `pane closed, origin ${e.origin.kind}`)
    const r = await next(e)
    await setPaneOpen($, false).catch(err => log($, `pane close state: ${String(err)}`))
    return r
  })

  // ✕ on the task bar hides it until the plan changes again.
  on('ui.press', { plugin: NAME, element: 'plan-dismiss' }, async ($, e) => {
    planShown = false
    holdTimer?.cancel()
    holdTimer = null
    await drawPlan($).catch(err => log($, `dismiss plan: ${String(err)}`))
    return { element: e.element }
  })

  on('ui.press', { plugin: NAME }, async ($, e, next) => {
    if (off) return next(e)
    if (e.element.startsWith('steps-')) {
      await toggleIn($, 'open', e.element.slice('steps-'.length))
      return { element: e.element }
    }
    if (e.element in CL_PRESS) {
      await toggleIn($, 'open', CL_PRESS[e.element]!)
      return { element: e.element }
    }
    // The tabs, and the Agents tab's checklist line, which opens the Checklist tab.
    if (e.element === 'tab-agents' || e.element === 'tab-checklist' || e.element === 'cl-summary') {
      await $.state.set(TAB, e.element === 'tab-agents' ? 'agents' : 'checklist')
      return { element: e.element }
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (off) return r
    const id = (r as { agentId?: string }).agentId
    if (id) {
      void addHelper($, id, e.description || 'Subagent', e.subagentType || 'subagent', shortModel(e.model ?? r.model ?? '')).catch(err =>
        log($, `spawn: ${String(err)}`),
      )
    }
    return r
  })

  // One unfiltered hook: a typed tool matcher makes tsc recurse through the connector types.
  on('tool.call', async ($, e, next) => {
    const tool = e.tool as string
    const args = e as unknown as Record<string, unknown>
    const id = e.agentId
    if (tool === PLAN_TOOL) {
      if (off) return { result: `${TITLE} is off, so no plan was saved. Carry on without it.` } as never
      if (id) return { result: 'Only the main chat keeps a plan. Carry on with your task.' } as never
      let said = 'Plan not saved: something went wrong. Carry on.'
      try {
        said = await planFromTool($, args)
      } catch (err) {
        await log($, `plan: ${String(err)}`)
      }
      turnPlanned = true
      sincePlan = 0
      staleNudged = false
      return { result: said } as never
    }
    if (off) return next(e)
    if (id) {
      void noteTool($, id, describe(tool, args)).catch(err => log($, `tool: ${String(err)}`))
      return next(e)
    }
    void noteMain($, describe(tool, args)).catch(err => log($, `main tool: ${String(err)}`))
    if (MIRRORED.has(tool)) {
      const r = await next(e)
      turnPlanned = true
      sincePlan = 0
      void mirror($, tool, args, r).catch(err => log($, `mirror ${tool}: ${String(err)}`))
      return r
    }
    const r = await next(e)
    return withNudge(r)
  })

  // A new prompt is a new task: the plan nudge counts from zero, and its turn gets a fresh main card.
  on('prompt.submit', async ($, e, next) => {
    freshTurn = true
    turnCalls = 0
    turnPlanned = false
    nudged = false
    sincePlan = 0
    staleNudged = false
    return next(e)
  })

  // A short system-prompt section, only while the mod is on.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (off || e.traits.includes('teammate') || e.traits.includes('bare')) return r
    return { sections: [...r.sections, { id: 'helper-desk:plan', text: PLAN_PROMPT, scope: 'session' as const }] }
  })

  // Each model request of a helper or the main chat: its model, effort and token counts.
  on('turn.step', async function* ($, e, next) {
    // The main chat's card works from the first request of each of its turns.
    if (!e.agentId && !off) {
      await mainCard($, e.index === 0).catch(err => log($, `main step: ${String(err)}`))
      void publish($).catch(err => log($, `main step: ${String(err)}`))
    }
    const r = yield* next(e)
    const id = e.agentId
    if (!off) {
      const effort = e.effort === undefined ? '' : String(e.effort)
      void noteStep($, id, e.model, effort, r.usage ?? null).catch(err => log($, `step: ${String(err)}`))
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const id = e.agentId
    if (!off && (id ? helpers.some(hp => hp.id === id) : main)) {
      const failed = e.reason === 'error' || e.reason === 'refusal' || e.isAborted
      void finish($, id, failed ? 'failed' : 'done', e.usage ?? null).catch(err => log($, `turn: ${String(err)}`))
    }
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const { value: isOff = false } = await $.state.get(OFF)
    if (isOff || off) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // Svg draws on desktop, the editor and mobile; the terminal gets a glyph.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const { value: list = [] } = await $.state.get(HELPERS)
    const { value: mainHp = null } = await $.state.get(MAIN)
    const { value: clk = { tick: 0, now: 0 } } = await $.state.get(CLOCK)
    const { value: view = { open: [] } } = await $.state.get(VIEW)
    const { value: cost = { usd: null } } = await $.state.get(COST)
    const width = Math.max(32, e.props.bodyColumns)
    // Inside a card: its border and padding take 4 columns, the pet PET_W more.
    const cw = width - 4 - PET_W

    // The list holds running helpers and those that ended under GONE_MS ago.
    const running = list.filter(hp => hp.phase === 'working')

    // Header tiles over the cards shown: only numbers the engine gave.
    const tiles: { label: string; value: string }[] = []
    if (cost.usd !== null) tiles.push({ label: 'Total chat cost', value: `$${cost.usd.toFixed(2)}` })
    if (list.some(hp => hp.hasUsage)) tiles.push({ label: 'Subagent tokens', value: tokenText(list.reduce((n, hp) => n + hp.tokens + hp.turnTokens, 0)) })
    if (list.length) {
      const start = Math.min(...list.map(hp => hp.startedAt))
      const end = running.length ? Math.max(clk.now, ...running.map(hp => hp.startedAt)) : Math.max(...list.map(hp => hp.endedAt))
      tiles.push({ label: 'Time', value: clockTime(end - start) })
    }
    const tileW = tiles.length ? Math.floor((width - (tiles.length - 1)) / tiles.length) : width

    // A running pet steps through its frames on the clock tick; a finished one stands still.
    const frameOf = (hp: Helper) => (hp.phase === 'working' ? Math.floor(clk.tick / FRAME_TICKS) % FRAMES : 0)

    // The main card's pet: the chosen mascot (/mascot). A subagent card's: its crew member while crew mode is on.
    const { value: mascotId = DEFAULT_MASCOT } = await $.state.get(MASCOT)
    const { value: crewOn = true } = await $.state.get(CREW_ON)
    // A mascot in a frame the desktop keeps while its phase holds; the terminal gets its glyph.
    // A finished subagent card in its last BURST_MS: ms into its burst, else -1. The main card never bursts.
    const burstAt = (hp: Helper) => (hp.phase === 'working' || hp.id === MAIN_ID ? -1 : clk.now - (hp.endedAt + GONE_MS - BURST_MS))

    // The header, one row in both views: the status, then one button naming the other view, then Hide.
    // With a project checklist the status gives way to two tabs, Agents and Checklist; the pressed one is framed.
    // Only Svg surfaces draw the Ice floe.
    const { value: deskView = 'cards' } = await $.state.get(DESK)
    const other: Desk = deskView === 'floe' ? 'cards' : 'floe'
    const { value: stored = null } = await $.state.get(CHECKLIST)
    const checks = storedList(stored)
    const { value: tabPicked = 'agents' } = await $.state.get(TAB)
    const tab: Tab = checks ? tabPicked : 'agents'
    const tabButton = (id: Tab, label: string) =>
      id === tab ? (
        <Button key={`tab-${id}`} label={label} onPress={() => undefined} />
      ) : (
        <Button key={`tab-${id}`} label={label} plain dimColor onPress={() => undefined} />
      )
    const header = (
      <Box key="header" flexDirection="row" justifyContent="space-between" gap={1} width={width} marginBottom={1}>
        {checks ? (
          <Box key="tabs" flexDirection="row" gap={1} flexShrink={0}>
            {tabButton('agents', agentsLabel(running.length, width, DESK_NAME[other]))}
            {tabButton('checklist', 'Checklist')}
          </Box>
        ) : (
          <Text bold color={running.length ? ACCENT : list.length ? GOOD : undefined} wrap="truncate-end">
            {statusText(running.length, width, DESK_NAME[other])}
          </Text>
        )}
        <Box flexDirection="row" gap={1} flexShrink={0}>
          <Button key={`desk-${other}`} label={DESK_NAME[other]} dimColor onPress={() => undefined} />
          <Button key="hide" label="Hide" dimColor onPress={() => undefined} />
        </Box>
      </Box>
    )
    // The Checklist tab: the whole list in place of the cards or the floe.
    if (tab === 'checklist' && checks) {
      return (
        <Box flexDirection="column" width={width}>
          {header}
          {checklistBox({ Box, Text, Button }, checks, view.open, width)}
        </Box>
      )
    }
    // The Agents tab's one checklist line, under the main card (or the floe); none without a checklist.
    const summary = checks ? checklistSummary({ Box, Text, Button }, checks, width) : null
    if (deskView === 'floe' && Svg) {
      const { value: plan = null } = await $.state.get(PLAN)
      return (
        <Box flexDirection="column" width={width}>
          {header}
          {floeScene(
            { Box, Text, Svg },
            { list, main: mainHp, plan, now: clk.now, crewOn, columns: width, burstAt, cardColor: hp => hueOf(hp.hue).color },
          )}
          {summary}
        </Box>
      )
    }
    const mascotPet = (hp: Helper, mascot: Mascot) => {
      if (Svg) {
        // One fixed source for the whole burst, so the desktop keeps the frame and plays it through once.
        const source = burstAt(hp) >= 0 && hp.phase !== 'working' ? burstSvg(mascot.id, hp.phase) : mascotSvg(mascot.id, hp.phase)
        return (
          <Box key={`pet-${hp.id}`} width={PET_W} flexShrink={0}>
            <Svg source={source} alt={mascot.alt} width={MASCOT_PX} height={MASCOT_PX} isInteractive />
          </Box>
        )
      }
      const live = hp.phase === 'working'
      const { top, topColor, face, hand, handColor } = mascot.term
      // Steam or smoke drifts beside the hat while it works, for a mascot that has puffs.
      const puff = !mascot.puffs ? '' : live ? (frameOf(hp) % 2 ? '˚°' : '°˚') : hp.phase === 'done' ? ' ˚' : ''
      const smoke = puff && ' '.repeat(Math.max(0, 6 - top.length)) + puff
      return (
        <Box key={`pet-${hp.id}`} width={PET_W} flexShrink={0} flexDirection="column">
          <Text>
            <Text color={topColor}>{top}</Text>
            <Text dimColor>{smoke}</Text>
          </Text>
          <Text>
            {face}
            <Text color={live ? handColor : undefined} dimColor={!live}>{hand}</Text>
          </Text>
          {mascot.term.low ? <Text color={mascot.term.lowColor}>{mascot.term.low}</Text> : null}
        </Box>
      )
    }

    const pet = (hp: Helper) => {
      if (hp.id === MAIN_ID) return mascotPet(hp, mascotOf(mascotId))
      const crew = crewOn && hp.crew ? MASCOTS.find(m => m.id === hp.crew) : undefined
      if (crew) return mascotPet(hp, crew)
      const hue = hueOf(hp.hue)
      const frame = frameOf(hp)
      if (Svg) {
        return (
          <Box key={`pet-${hp.id}`} width={PET_W} flexShrink={0}>
            <Svg source={petSvg(hp.hue, frame)} alt={`Claude crab, ${hue.name}`} width={PET_PX_W} height={PET_PX_H} />
          </Box>
        )
      }
      return (
        <Box key={`pet-${hp.id}`} width={PET_W} flexShrink={0} flexDirection="column">
          <Text color={hue.color}>{frame % 2 ? ' ▜█▛' : ' ▟█▙'}</Text>
          <Text color={hue.color}>{frame % 2 ? ' ▘ ▝' : '  ▘▝'}</Text>
        </Box>
      )
    }

    const card = (hp: Helper) => {
      const hue = hueOf(hp.hue)
      const live = hp.phase === 'working'
      const isOpen = view.open.includes(hp.id)
      const mark = live ? '●' : hp.phase === 'done' ? '✓' : '✗'
      const markColor = hp.phase === 'failed' ? BAD : GOOD
      const time = clockTime((live ? Math.max(clk.now, hp.startedAt) : hp.endedAt) - hp.startedAt)
      const meta = [hp.hasUsage ? `${tokenText(hp.tokens + hp.turnTokens)} tokens` : '', time].filter(Boolean).join(' · ')
      const who = [hp.type, hp.model, hp.effort].filter(Boolean).join(' · ')
      const current = hp.steps[hp.steps.length - 1]
      const spin = SPIN[clk.tick % SPIN.length]!
      const pulse = PULSE[clk.tick % PULSE.length]!
      const lead = live
        ? `Step ${hp.count} · ${current?.live ?? 'Getting started'}`
        : hp.phase === 'done'
          ? `Done · ${hp.count} step${hp.count === 1 ? '' : 's'}`
          : `Stopped before it finished · ${hp.count} step${hp.count === 1 ? '' : 's'}`
      // Room for the spinner and pulse on a live line.
      const leadW = Math.max(6, cw - (live ? 2 + pulse.length + 1 : 0))
      const history = (live ? hp.steps.slice(0, -1) : hp.steps).slice(-HISTORY)
      const [b1, b2, b3] = barParts(hp.phase, cw, clk.tick, hp.seat)
      const barColor = hp.phase === 'failed' ? BAD : hue.color
      const rowW = cw - TAG_W
      // About 6.5 CSS pixels a column, as the pet's 48 pixels fill its 8.
      const barPx = Math.max(60, Math.floor(cw * 6.5))
      // Bursting: the text and border step toward FADE_TO; one with the theme's own colour goes straight to it.
      const burstMs = burstAt(hp)
      const fade = burstMs >= 0 ? textFade(burstMs) : 0
      const tone = (c?: string) => (fade ? mix(c ?? FADE_TO, FADE_TO, fade) : c)
      const burstBar = burstMs >= 0 && Svg ? burstBarSvg(barColor, barPx, hp.seat) : null

      return (
        <Box
          key={`card-${hp.id}`}
          flexDirection="row"
          width={width}
          marginBottom={1}
          borderStyle="round"
          borderColor={live ? hue.color : tone()}
          borderDimColor={!live}
          paddingX={1}
          paddingY={1}
          gap={0}
        >
          {pet(hp)}
          <Box flexDirection="column" width={cw}>
            <Box flexDirection="row" justifyContent="space-between" width={cw}>
              <Box width={cw - 2}>
                <Text bold color={tone()} wrap="truncate-end">
                  {cut(hp.description, cw - 2)}
                </Text>
              </Box>
              <Text bold color={tone(markColor)}>{mark}</Text>
            </Box>
            <Box flexDirection="row" justifyContent="space-between" width={cw}>
              <Text dimColor color={tone()} wrap="truncate-end">
                {cut(who, Math.max(4, cw - meta.length - 1))}
              </Text>
              <Text dimColor color={tone()}>{meta}</Text>
            </Box>
            <Box flexDirection="row" width={cw} marginTop={1}>
              {live ? <Text bold color={ACCENT}>{`${spin} `}</Text> : null}
              <Box width={leadW}>
                <Text bold={live} color={live ? ACCENT : tone(hp.phase === 'done' ? GOOD : BAD)} wrap="truncate-end">
                  {cut(lead, leadW)}
                </Text>
              </Box>
              {live ? <Text color={ACCENT}>{` ${pulse}`}</Text> : null}
            </Box>
            {!isOpen &&
              history.map((st, i) => (
                <Text key={`h-${hp.id}-${i}`} dimColor color={tone()} wrap="truncate-end">
                  {cut(`  ${st.live}`, cw)}
                </Text>
              ))}
            {Svg ? (
              <Box key={`bar-${hp.id}`} width={cw} marginTop={1}>
                <Svg
                  source={burstBar ?? cardBarSvg(hp.phase, hue.color, barPx, hp.seat)}
                  alt={live ? 'Working' : hp.phase === 'done' ? 'Done' : 'Stopped'}
                  width={barPx}
                  height={CARD_BAR_H}
                  isInteractive
                />
              </Box>
            ) : (
              <Text key={`bar-${hp.id}`} wrap="truncate-end">
                <Text dimColor color={tone()}>{b1}</Text>
                <Text color={tone(barColor)}>{b2}</Text>
                <Text dimColor color={tone()}>{b3}</Text>
              </Text>
            )}
            {hp.steps.length ? (
              <Button key={`steps-${hp.id}`} plain dimColor onPress={() => undefined}>
                {isOpen ? '▾ Hide steps' : `▸ All ${hp.count} step${hp.count === 1 ? '' : 's'}`}
              </Button>
            ) : null}
            {isOpen ? (
              <Box key={`list-${hp.id}`} flexDirection="column" width={cw}>
                {hp.count > hp.steps.length ? <Text dimColor>{`${hp.count - hp.steps.length} older steps not kept`}</Text> : null}
                {hp.steps.map((st, i) => {
                  const [label, dim] = fitRow(st.label, st.dim, rowW)
                  return (
                    <Box key={`s-${hp.id}-${i}`} flexDirection="row" width={cw}>
                      <Box width={TAG_W}>
                        <Text color={tone(KIND_COLOR[st.kind])}>{st.kind}</Text>
                      </Box>
                      <Box width={rowW}>
                        <Text color={tone()} wrap="truncate-end">
                          {label}
                          {dim ? <Text dimColor color={tone()}>{`  ${dim}`}</Text> : null}
                        </Text>
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            ) : null}
          </Box>
        </Box>
      )
    }

    // The Cards view: drawn exactly as before, under the header; the checklist line goes under the main card.
    const cards = (
      <Box flexDirection="column" width={width}>
        {mainHp ? card(mainHp) : null}
        {summary}
        {tiles.length ? (
          <Box key="tiles" flexDirection="row" gap={1} width={width} marginBottom={1}>
            {tiles.map(t => (
              <Box key={`tile-${t.label}`} flexDirection="column" borderStyle="round" paddingX={1} paddingY={1} width={tileW}>
                <Text dimColor wrap="truncate-end">
                  {t.label}
                </Text>
                <Text bold color={ACCENT} wrap="truncate-end">
                  {t.value}
                </Text>
              </Box>
            ))}
          </Box>
        ) : null}
        {list.length ? null : <Text dimColor>Subagent cards show up here when Claude starts one.</Text>}
        {list.length ? (
          <Box key="cards" flexDirection="column" width={width} marginTop={1}>
            {list.map(card)}
          </Box>
        ) : null}
      </Box>
    )
    return (
      <Box flexDirection="column" width={width}>
        {deskView === 'floe' ? <Text dimColor>Ice floe draws in the desktop app</Text> : null}
        {header}
        {cards}
      </Box>
    )
  })

  // The task bar above the prompt: it moves each time a to-do or plan step is marked done.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (off || e.props.hasSurvey) return next(e)
    const { value: isOff = false } = await $.state.get(OFF)
    const { value: isHidden = false } = await $.state.get(HIDDEN)
    const { value: p = null } = await $.state.get(PLAN)
    const { value: isOpen = false } = await $.state.get(PANE_OPEN)
    if (isOff || isHidden || hidden || !p || !p.shown || !p.steps.length) return next(e)
    // The other mods' bands draw above this one. Claude Code's own placeholder is never nested.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const rest = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const cols = typeof e.props.bodyColumns === 'number' && e.props.bodyColumns > 0 ? Math.floor(e.props.bodyColumns) : 0
    const n = p.steps.length
    const done = doneCount(p.steps)
    const pct = `${Math.round((done / n) * 100)}%`
    const label = `Tasks ${done}/${n}`
    const now = p.steps.find(st => st.status === 'in_progress')
    const nextUp = p.steps.find(st => st.status === 'pending')
    const line = now ? `Now: ${now.text}` : done === n ? 'All steps done' : nextUp ? `Next: ${nextUp.text}` : ''
    const dismiss = <Button key="plan-dismiss" label="✕" plain dimColor role="dismiss" onPress={() => undefined} />

    let row: unknown
    let w: number
    if (e.surface !== 'terminal' && 'Svg' in els) {
      const { Svg } = els
      // About 8 CSS pixels a column; the rest is the dismiss button and its gap.
      const px = Math.max(180, Math.min(1600, (cols || 100) * 8 - 56))
      w = cols || BAR_FALLBACK
      row = (
        <Box key="plan-row" flexDirection="row" alignItems="center" gap={1}>
          <Svg key="plan-svg" source={bandSvg(p, px)} alt={`${p.title}: ${label}, ${pct}`} width={px} height={BAND_H} isInteractive />
          {dismiss}
        </Box>
      )
    } else {
      // The terminal: dot, title, a gradient of blocks, the step in progress shimmering, count, percent.
      const { value: tick = 0 } = await $.state.get(SHIM)
      w = cols || BAR_FALLBACK
      const titleW = Math.max(6, Math.min(28, p.title.length, Math.floor(w / 3)))
      const barW = Math.max(6, w - titleW - label.length - pct.length - 10)
      const fillC = Math.round((barW * done) / n)
      const liveC = now ? Math.max(0, Math.round((barW * Math.min(n, done + 1)) / n) - fillC) : 0
      const cells = Array.from({ length: fillC }, (_, i) => mix(P_LIGHT, P_DEEP, fillC > 1 ? i / (fillC - 1) : 1))
      row = (
        <Box key="plan-row" flexDirection="row" gap={1} width={w}>
          <Text color={P_DEEP}>●</Text>
          <Box width={titleW} flexShrink={0}>
            <Text bold wrap="truncate-end">
              {cut(p.title, titleW)}
            </Text>
          </Box>
          <Text key="plan-bar">
            {cells.map((c, i) => (
              <Text key={`f-${i}`} color={c}>
                █
              </Text>
            ))}
            {liveC ? <Text color={tick % 2 ? P_MID : P_LIGHT}>{'▓'.repeat(liveC)}</Text> : null}
            <Text dimColor>{'░'.repeat(Math.max(0, barW - fillC - liveC))}</Text>
          </Text>
          <Text bold color={P_MID}>{label}</Text>
          <Text dimColor>{pct}</Text>
          {dismiss}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {rest as never}
        <Box key="plan-band" flexDirection="column">
          {row as never}
          <Box key="plan-line" flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
            <Text key="plan-now" dimColor wrap="truncate-end">
              {cut(line, w)}
            </Text>
            <Button key="open-desk" label={isOpen ? CLOSE_LABEL : OPEN_LABEL} plain onPress={() => undefined} />
          </Box>
        </Box>
      </Box>
    )
  })
}
