import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CostPaneStatus, CostPaneSummary, SchedulePaneData, SetupPaneInventoryStatus, SetupPaneTab } from '../types'
import { money } from './charts'
import { countdown, dayTime } from './cron'
import type { Inventory, SetupItem } from './inventory-types'
import type { PaneInput } from './pane-input'
import { comingUp } from './schedule-tab'
import { TZ, scrub } from './sources'
import { MINUTE, refreshTab, toggle } from './state'

// This file's handles on the pane's state (validate reads each from a const of the file that uses it); state.ts has the same.
const dataAtom = atom({ plugin: 'setup-pane', key: 'data' } as const, null as SchedulePaneData | null, { shape: 'data-2' })
const inventoryAtom = atom({ plugin: 'setup-pane', key: 'inventory' } as const, null as Inventory | null, { shape: 'inventory-1' })
const inventoryStatusAtom = atom({ plugin: 'setup-pane', key: 'inventoryStatus' } as const, { isReading: false, error: '' } as SetupPaneInventoryStatus)
const nowAtom = atom({ plugin: 'setup-pane', key: 'now' } as const, 0)
const setupExpandedAtom = atom({ plugin: 'setup-pane', key: 'setupExpanded' } as const, [] as string[])
const statusAtom = atom({ plugin: 'setup-pane', key: 'status' } as const, { isScanning: false, error: '' } as CostPaneStatus)
const summaryAtom = atom({ plugin: 'setup-pane', key: 'summary' } as const, null as CostPaneSummary | null, { shape: 'summary-6' })
const tabAtom = atom({ plugin: 'setup-pane', key: 'tab' } as const, 'overview' as SetupPaneTab)

// The Overview tab and the tabs that list the setup (Agents, Mods & plugins, Skills, MCP, Hooks & settings), from inventory.py.

const SHORT = 5
const ACCENT = '#d97757'
const GREEN = '#4caf7a'
// Longest note drawn under a list item; the rest is cut with "…".
const NOTE_MAX = 220
const AGENT_NOTE_MAX = 600

export const TAB_LABELS: Record<SetupPaneTab, string> = {
  overview: 'Overview',
  cost: 'Cost',
  scheduled: 'Scheduled',
  agents: 'Agents',
  plugins: 'Mods & plugins',
  skills: 'Skills',
  mcp: 'MCP',
  hooks: 'Hooks & settings',
}

const LOADING = 'Reading your setup…'
const NOT_IN_NOTE =
  '"not described in SETUP.md" = the hand-written part of ~/.claude/SETUP.md (your own overview to read) does not explain it yet. Nothing is set from that file.'
const REFRESH_NOTE = 'Refresh also updates the list that is made for you in ~/.claude/SETUP.md.'
const AGENTS_NOTE =
  'Agents are the helpers (subagents) the main chat hands work to. "Hand-over rule" = when the main chat picks this one, from ~/.claude/CLAUDE.md. ' +
  'Effort = how hard it thinks. An agent file with no effort line uses the main chat\'s effort when it runs the same model as the main chat, and the model\'s own default (medium) on any other model.'

/** Each setup tab: its sections, which Inventory list each shows, and the line that explains its words. */
// `hasOnOff` false: the list has no off state (hooks, settings), so no on/off mark is drawn unless an item is off.
// `id` + `pick`: a card that shows only part of a list (Skills: the ones SETUP.md describes, then the rest).
type ListCard = { key: keyof Inventory & string; id?: string; pick?: (i: SetupItem) => boolean; title: string; note: string; hasOnOff?: false; hasTag?: false }
const LIST_TABS: Record<'plugins' | 'skills' | 'mcp' | 'hooks', ListCard[]> = {
  plugins: [
    { key: 'mods', title: 'Your mods', note: 'Mods = plugins you made yourself, kept in ~/.claude/mods. Off = installed but turned off.' },
    { key: 'plugins', title: 'Plugins', note: 'Plugins you installed from others; the line under the name says the version and where it came from.' },
  ],
  skills: [
    {
      key: 'skills', id: 'skills-main', pick: i => i.isInSetupMd, hasTag: false, title: 'Important skills',
      note: 'The skills your own ~/.claude/SETUP.md describes. On = in ~/.claude/skills, so Claude can use it. Off = moved to ~/.claude/skills-off.',
    },
    {
      key: 'skills', id: 'skills-other', pick: i => !i.isInSetupMd, hasTag: false, title: 'Other skills',
      note: 'Skills SETUP.md does not describe. Describe one there and it moves up to Important skills.',
    },
  ],
  mcp: [{ key: 'mcp', title: 'MCP servers', note: 'MCP servers connect Claude to other apps and tools. Off = needs sign-in or is not connected.' }],
  hooks: [
    { key: 'hooks', title: 'Hooks', note: 'Hooks = commands Claude Code runs by itself at set moments (for example when a chat starts), from ~/.claude/settings.json.', hasOnOff: false },
    { key: 'settings', title: 'Settings', note: 'A few key settings from ~/.claude/settings.json.', hasOnOff: false, hasTag: false },
  ],
}

/** Which tab shows each Inventory list, for the Overview's "not described in SETUP.md" line. */
const LIST_TAB: [keyof Inventory & string, SetupPaneTab][] = [
  ['agents', 'agents'],
  ['mods', 'plugins'],
  ['plugins', 'plugins'],
  ['skills', 'skills'],
  ['mcp', 'mcp'],
  ['hooks', 'hooks'],
]

const items = (inv: Inventory, key: keyof Inventory & string): SetupItem[] => {
  const v = inv[key]
  return Array.isArray(v) ? (v as SetupItem[]) : []
}

/** On items first, then off ones, each group in the order inventory.py gave. */
export const onFirst = (list: SetupItem[]) => [...list.filter(i => i.isOn), ...list.filter(i => !i.isOn)]

/** "7" when all are on, else "6 on, 3 off". */
export function onOffCount(list: SetupItem[]): string {
  const off = list.filter(i => !i.isOn).length
  return off ? `${list.length - off} on, ${off} off` : String(list.length)
}

/** Items SETUP.md does not mention, counted by the tab that shows them: "2 in Skills, 1 in MCP". */
export function missingByTab(inv: Inventory): { total: number; words: string; firstTab: SetupPaneTab | null } {
  const counts = new Map<SetupPaneTab, number>()
  for (const [key, tab] of LIST_TAB) {
    const n = items(inv, key).filter(i => !i.isInSetupMd).length
    if (n) counts.set(tab, (counts.get(tab) ?? 0) + n)
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  const words = [...counts].map(([tab, n]) => `${n} in ${TAB_LABELS[tab]}`).join(', ')
  return { total, words, firstTab: counts.size ? [...counts.keys()][0]! : null }
}

/** Free text from inventory.py as the pane draws it: anything shaped like a key hidden, cut to `max`. */
const hide = (text: string, max: number) => scrub(text ?? '', max)

/** The shared pieces every setup tab draws with. */
function kit($: EngineInterface, e: PaneInput, expanded: string[]) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const isTerminal = e.surface === 'terminal'
  const width = Math.max(24, e.props.bodyColumns)
  const inner = width - 4
  const padY = isTerminal ? 1 : 'sm'
  const gapY = isTerminal ? 1 : 'md'
  const dim = (key: string, text: string) => (
    <Text key={key} dimColor wrap="wrap">
      {text}
    </Text>
  )
  const row = (key: string, left: unknown, right: unknown, w = inner) => (
    <Box key={key} flexDirection="row" justifyContent="space-between" width={w} height={1} gap={1}>
      <Box flexShrink={1} flexGrow={1} height={1} overflow="hidden">
        {left as never}
      </Box>
      {right ? <Box flexShrink={0}>{right as never}</Box> : null}
    </Box>
  )
  const section = (key: string, title: string, body: unknown) => (
    <Box key={key} flexDirection="column" borderStyle="round" paddingX={1} paddingY={padY} width={width} flexShrink={0}>
      <Text weight="semibold">{title}</Text>
      {body as never}
    </Box>
  )
  /** 5 items with space between them, and Show more for the rest. */
  const list = <T,>(key: string, rows: T[], draw: (r: T, i: number) => unknown, empty: string, w = inner) => {
    if (!rows.length) return dim(`${key}-none`, empty)
    const isOpen = expanded.includes(key)
    const shown = isOpen ? rows : rows.slice(0, SHORT)
    return (
      <Box key={`${key}-list`} flexDirection="column" width={w} gap={gapY}>
        {shown.map(draw) as never}
        {rows.length > SHORT ? (
          <Box key={`${key}-nav`} flexDirection="row" justifyContent="flex-end" width={w}>
            <Button key={`more-${key}`} plain onPress={() => update($, setupExpandedAtom, cur => toggle(cur, key))}>
              {isOpen ? 'Show less' : `Show more (${rows.length - SHORT})`}
            </Button>
          </Box>
        ) : null}
      </Box>
    )
  }
  return { Box, Text, Button, width, inner, gapY, dim, row, section, list }
}

/** The status of the inventory read: a loading line or the failure, before any data or above old data. */
async function inventoryHead($: EngineInterface, e: PaneInput, tab: SetupPaneTab) {
  const k = kit($, e, [])
  const { Box, Text } = k
  const inv = await read($, inventoryAtom)
  const status = await read($, inventoryStatusAtom)
  const now = Math.max(await read($, nowAtom), inv?.readAt ?? 0)
  const error = status.error ? (
    <Box key="inv-error" flexDirection="column" width={k.width}>
      <Text wrap="wrap">{hide(status.error, 400)}</Text>
    </Box>
  ) : null
  const age = inv ? Math.floor((now - inv.readAt) / MINUTE) : 0
  const footer = (
    <Box key="footer" flexDirection="column" width={k.width}>
      <Box key="footer-row" flexDirection="row" justifyContent="space-between" width={k.width} gap={1}>
        <Text dimColor wrap="truncate-end">
          {status.isReading ? 'Reading…' : inv ? `Read ${age < 1 ? 'just now' : `${age} min ago`}` : 'Not read yet'}
        </Text>
        <k.Button key="refresh" label="Refresh" onPress={() => void refreshTab($, tab)} />
      </Box>
      {tab === 'overview' ? null : k.dim('refresh-note', REFRESH_NOTE)}
    </Box>
  )
  const loading = !inv && !status.error ? k.dim('inv-loading', LOADING) : null
  return { inv, error, footer, loading }
}

/** One mod, plugin, skill, MCP server, hook or setting: name and on/off, detail and the SETUP.md tag, the note. */
function itemBox(k: ReturnType<typeof kit>, key: string, it: SetupItem, hasOnOff = true, hasTag = true) {
  const { Box, Text } = k
  const onOff = it.isOn ? hasOnOff ? <Text color={GREEN}>on</Text> : null : <Text dimColor>off</Text>
  const tag = it.isInSetupMd || !hasTag ? null : <Text color={ACCENT}>not described in SETUP.md</Text>
  const detail = hide(it.detail, 200)
  const note = hide(it.note, NOTE_MAX)
  return (
    <Box key={key} flexDirection="column" width={k.inner}>
      {k.row(
        `${key}-name`,
        <Text weight="semibold" wrap="truncate-end" dimColor={!it.isOn}>
          {hide(it.name, 120)}
        </Text>,
        onOff,
      )}
      {detail || tag ? k.row(`${key}-detail`, <Text dimColor wrap="truncate-end">{detail}</Text>, tag) : null}
      {note ? <Text key={`${key}-note`} wrap="wrap" dimColor={!it.isOn}>{note}</Text> : null}
    </Box>
  )
}

/** Mods & plugins, Skills, MCP, Hooks & settings: one card per list, on items first. */
export async function listTab($: EngineInterface, e: PaneInput, tab: 'plugins' | 'skills' | 'mcp' | 'hooks'): Promise<unknown[]> {
  const k = kit($, e, await read($, setupExpandedAtom))
  const head = await inventoryHead($, e, tab)
  if (!head.inv) return [head.error, head.loading, head.footer]
  const inv = head.inv
  const parts = LIST_TABS[tab]
  const hasMissing = parts.some(p => (p.hasTag ?? true) && items(inv, p.key).some(i => !i.isInSetupMd))
  return [
    head.error,
    ...parts.map(p => {
      const id = p.id ?? p.key
      const rows = onFirst(items(inv, p.key).filter(p.pick ?? (() => true)))
      return k.section(id, p.title, [
        k.dim(`${id}-about`, p.note),
        k.list(id, rows, (it, i) => itemBox(k, `${id}-${i}`, it, p.hasOnOff ?? true, p.hasTag ?? true), 'None found.'),
      ])
    }),
    hasMissing ? k.dim('not-in-note', NOT_IN_NOTE) : null,
    head.footer,
  ]
}

/** One card per agent: name, model and effort, what it handles, its hand-over rule. */
export async function agentsTab($: EngineInterface, e: PaneInput): Promise<unknown[]> {
  const k = kit($, e, await read($, setupExpandedAtom))
  const { Box, Text } = k
  const head = await inventoryHead($, e, 'agents')
  if (!head.inv) return [head.error, head.loading, head.footer]
  const agents = onFirst(head.inv.agents)
  const card = (a: SetupItem) => {
    const key = `agent-${a.name}`
    const rule = hide(a.rule, AGENT_NOTE_MAX)
    const note = hide(a.note, AGENT_NOTE_MAX)
    return (
      <Box key={key} flexDirection="column" borderStyle="round" paddingX={1} width={k.width} flexShrink={0}>
        {k.row(
          `${key}-name`,
          <Text weight="semibold" wrap="truncate-end">
            {hide(a.name, 120)}
          </Text>,
          a.isOn ? (a.isInSetupMd ? null : <Text color={ACCENT}>not described in SETUP.md</Text>) : <Text dimColor>off</Text>,
          k.inner,
        )}
        {a.detail ? <Text key={`${key}-detail`} color={ACCENT} wrap="wrap">{hide(a.detail, 200)}</Text> : null}
        {note ? <Text key={`${key}-handles`} wrap="wrap">{`Handles: ${note}`}</Text> : null}
        {rule ? <Text key={`${key}-rule`} wrap="wrap">{`Hand-over rule: ${rule}`}</Text> : null}
      </Box>
    )
  }
  return [
    head.error,
    k.dim('agents-note', AGENTS_NOTE),
    k.list('agents', agents, card, 'No agents found in ~/.claude/agents.', k.width),
    agents.some(a => !a.isInSetupMd) ? k.dim('not-in-note', NOT_IN_NOTE) : null,
    head.footer,
  ]
}

/** One line per part of the setup with counts, this week's cost, the next scheduled task, what SETUP.md misses, problems. */
export async function overviewTab($: EngineInterface, e: PaneInput): Promise<unknown[]> {
  const k = kit($, e, [])
  const { Text, Button } = k
  const head = await inventoryHead($, e, 'overview')
  const summary = await read($, summaryAtom)
  const costStatus = await read($, statusAtom)
  const jobs = await read($, dataAtom)
  const now = Math.max(await read($, nowAtom), jobs?.readAt ?? 0)
  const go = (key: string, tab: SetupPaneTab) => (
    <Button key={`go-${key}`} plain onPress={() => update($, tabAtom, () => tab)}>
      Open
    </Button>
  )
  const line = (key: string, text: string, tab: SetupPaneTab | null) => k.row(key, <Text wrap="truncate-end">{text}</Text>, tab ? go(key, tab) : null)

  const inv = head.inv
  const setup = inv
    ? [
        line('agents', `Agents: ${inv.agents.length}`, 'agents'),
        line('mods', `Mods: ${onOffCount(inv.mods)}`, 'plugins'),
        line('plugins', `Plugins: ${onOffCount(inv.plugins)}`, 'plugins'),
        line('skills', `Skills: ${onOffCount(inv.skills)}`, 'skills'),
        line('mcp', `MCP servers: ${onOffCount(inv.mcp)}`, 'mcp'),
        line('hooks', `Hooks: ${onOffCount(inv.hooks)}`, 'hooks'),
      ]
    : [head.loading ?? k.dim('inv-none', 'Not read.')]

  const cost = summary
    ? `Cost so far: ${money(summary.thisWeek.cost)}`
    : costStatus.isScanning
      ? 'Cost so far: reading your logs…'
      : costStatus.error
        ? 'Cost so far: could not read your logs'
        : 'Cost so far: not read yet'
  const next = jobs ? comingUp(jobs.jobs)[0] : undefined
  const week = [
    line('cost', cost, 'cost'),
    summary ? k.dim('cost-note', "Estimate at API prices, not your plan's bill.") : null,
    line('next', 'Next scheduled task', 'scheduled'),
    <Text key="next-name" wrap="truncate-end">
      {jobs ? (next ? next.name : 'Nothing is set to run.') : 'Not read yet.'}
    </Text>,
    next && next.nextRunAt !== null ? (
      <Text key="next-when" color={ACCENT} wrap="truncate-end">
        {`${dayTime(next.nextRunAt, TZ)} · ${countdown(next.nextRunAt, now, TZ)}`}
      </Text>
    ) : null,
  ]

  const missing = inv ? missingByTab(inv) : null
  const setupMd = missing
    ? missing.total
      ? [
          line('missing', `${missing.total} item${missing.total === 1 ? '' : 's'} not described in SETUP.md`, missing.firstTab),
          <Text key="missing-where" wrap="wrap">{`${missing.words}.`}</Text>,
          k.dim('missing-note', NOT_IN_NOTE),
        ]
      : [k.dim('missing-none', 'Everything here is in SETUP.md, your setup overview file.')]
    : []

  const problems = inv?.problems?.length ? k.section('problems', 'Could not read', inv.problems.map((p, i) => k.dim(`problem${i}`, hide(p, 300)))) : null
  return [
    head.error,
    k.section('setup', 'Your setup', [...setup, ...setupMd]),
    k.section('week', 'This week', week),
    problems,
    head.footer,
  ]
}
