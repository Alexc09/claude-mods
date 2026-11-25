import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CostPaneStatus, CostPaneSummary, CostPaneTaskRow } from '../types'
import {
  ACCENT, BLUE, GREY, MODEL_COLOR, barSvg, dailySvg, dayFigures, dayName, hh, hourlySvg, hourlyText, money, splitCells, stackSvg, textBar, topHours,
  topHoursLine,
} from './charts'
import type { PaneInput } from './pane-input'
import { ALL, MINUTE, chooseProject, refreshTab, toggle } from './state'

// This file's handles on the pane's state (validate reads each from a const of the file that uses it); state.ts has the same.
const chartViewAtom = atom({ plugin: 'setup-pane', key: 'chartView' } as const, 'day' as 'day' | 'hour')
const chatCostAtom = atom({ plugin: 'setup-pane', key: 'chatCost' } as const, -1)
const costExpandedAtom = atom({ plugin: 'setup-pane', key: 'costExpanded' } as const, [] as string[])
const hourDayAtom = atom({ plugin: 'setup-pane', key: 'hourDay' } as const, '')
const nowAtom = atom({ plugin: 'setup-pane', key: 'now' } as const, 0)
const openTasksAtom = atom({ plugin: 'setup-pane', key: 'openTasks' } as const, [] as string[])
const projectAtom = atom({ plugin: 'setup-pane', key: 'project' } as const, '')
const statusAtom = atom({ plugin: 'setup-pane', key: 'status' } as const, { isScanning: false, error: '' } as CostPaneStatus)
const summaryAtom = atom({ plugin: 'setup-pane', key: 'summary' } as const, null as CostPaneSummary | null, { shape: 'summary-6' })
const updatedAtom = atom({ plugin: 'setup-pane', key: 'updatedAt' } as const, 0)

// The Cost tab: what Claude Code cost this plan week at API prices, and where it went.

const SHORT = 5
const LONG = 15

const LOADING = 'Reading your logs (first time takes a minute or two)…'
const ESTIMATE_NOTE = "Estimate at API prices: what this would cost on the pay-per-token API, not your plan's bill."
const HELPER_NOTE = 'Helper agents = subagents your main chat starts.'
const TASK_NOTE = "A task is one message you typed and everything it caused until your next one. A task's cost includes the helper agents it started."

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function ago(ms: number): string {
  const min = Math.floor(ms / MINUTE)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`
}


/** "= $3.10 main chat + $12 in 4 helper runs": what a task's cost is made of, in one line. */
export function taskSplit(t: CostPaneTaskRow): string {
  if (!t.helpers) return '= all main chat, no helper runs'
  return `= ${money(t.main)} main chat + ${money(t.helperCost)} in ${plural(t.helpers, 'helper run')}`
}

/** The same split as a sentence, for the opened task. */
export function taskSplitWords(t: CostPaneTaskRow): string {
  if (!t.helpers) return `This task cost ${money(t.cost)}, all in the main chat. It started no helper runs.`
  const runs = t.helpers === 1 ? 'the 1 helper run' : `the ${t.helpers} helper runs`
  return `This task cost ${money(t.cost)} in all: ${money(t.main)} in the main chat and ${money(t.helperCost)} in ${runs} it started.`
}


/** The Cost tab's cards, top to bottom, ending with its Updated line and Refresh. */
export async function costTab($: EngineInterface, e: PaneInput): Promise<unknown[]> {
  const els = $.ui.resolve(e)
  const { Box, Text, Button, Select } = els
  // The terminal has no Svg: it draws the charts as text bars.
  const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
  const isTerminal = !Svg
  const width = Math.max(24, e.props.bodyColumns)
  const inner = width - 4
  // The desktop lays cells out at about 7 CSS pixels; the markup scales down if the slot is narrower.
  const px = Math.max(220, Math.min(1000, inner * 7))
  const padY = isTerminal ? 1 : 'sm'
  const gapY = isTerminal ? 1 : 'md'
  const summary = await read($, summaryAtom)
  const status = await read($, statusAtom)
  const updatedAt = await read($, updatedAtom)
  const expanded = await read($, costExpandedAtom)
  const openTasks = await read($, openTasksAtom)
  const chatCost = await read($, chatCostAtom)
  const chartView = await read($, chartViewAtom)
  const hourDay = await read($, hourDayAtom)
  const chosen = await read($, projectAtom)
  const now = Math.max(await read($, nowAtom), updatedAt)

  const dim = (key: string, text: string) => (
    <Text key={key} dimColor wrap="wrap">
      {text}
    </Text>
  )
  const row = (key: string, left: string, right: string) => (
    <Box key={key} flexDirection="row" justifyContent="space-between" width={inner} height={1} gap={1}>
      <Box flexShrink={1} flexGrow={1} height={1} overflow="hidden">
        <Text wrap="truncate-end">{left}</Text>
      </Box>
      {right ? (
        <Box flexShrink={0}>
          <Text color={ACCENT}>{right}</Text>
        </Box>
      ) : null}
    </Box>
  )
  const subline = (key: string, text: string) => (
    <Box key={key} width={inner} height={1} overflow="hidden">
      <Text dimColor wrap="truncate-end">
        {text}
      </Text>
    </Box>
  )
  const section = (key: string, title: string, body: unknown) => (
    <Box key={key} flexDirection="column" borderStyle="round" paddingX={1} paddingY={padY} width={width} flexShrink={0}>
      <Text weight="semibold">{title}</Text>
      {body as never}
    </Box>
  )
  // A bar of `frac` across the card: an Svg on the desktop, eighth-cell blocks on the terminal.
  const bar = (key: string, frac: number, alt: string) =>
    Svg ? (
      <Svg key={key} source={barSvg(frac, px)} alt={alt} />
    ) : (
      <Text key={key} color={ACCENT} wrap="truncate-end">
        {textBar(frac, inner) || ' '}
      </Text>
    )
  // One bar split by value, then one legend row per part.
  const stack = (key: string, parts: { name: string; cost: number; share: number; color: string; note?: string }[]) => {
    const alt = parts.map(p => `${p.name} ${Math.round(p.share)}% (${money(p.cost)})`).join(', ')
    const cells = splitCells(
      parts.map(p => p.cost),
      inner,
    )
    const drawn = Svg ? (
      <Svg key={`${key}-bar`} source={stackSvg(parts.map(p => ({ value: p.cost, color: p.color })), px)} alt={alt} />
    ) : (
      <Box key={`${key}-bar`} flexDirection="row" width={inner} height={1} overflow="hidden">
        {parts.map((p, i) => (cells[i] ? <Text key={`${key}-seg${i}`} color={p.color}>{'█'.repeat(cells[i]!)}</Text> : null))}
      </Box>
    )
    return [
      drawn,
      ...parts.map((p, i) => (
        <Box key={`${key}-leg${i}`} flexDirection="row" justifyContent="space-between" width={inner} height={1} gap={1}>
          <Box flexShrink={1} flexGrow={1} height={1} overflow="hidden">
            <Text wrap="truncate-end">
              <Text color={p.color}>■</Text>
              {` ${p.name}  ${Math.round(p.share)}%${p.note ? ` · ${p.note}` : ''}`}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text color={ACCENT}>{money(p.cost)}</Text>
          </Box>
        </Box>
      )),
    ]
  }
  // 5 items, and Show more for up to 15.
  const list = <T,>(key: string, rows: T[], draw: (r: T, i: number) => unknown, empty: string) => {
    if (!rows.length) return [dim(`${key}-none`, empty)] as never
    const isOpen = expanded.includes(key)
    const shown = rows.slice(0, isOpen ? LONG : SHORT)
    const nav =
      rows.length > SHORT ? (
        <Box key={`${key}-nav`} flexDirection="row" justifyContent="flex-end" width={inner}>
          <Button key={`more-${key}`} plain onPress={() => update($, costExpandedAtom, cur => toggle(cur, key))}>
            {isOpen ? 'Show less' : 'Show more'}
          </Button>
        </Box>
      ) : null
    return [...shown.flatMap((r, i) => [draw(r, i)].flat()), nav] as never
  }

  const footer = (
    <Box key="footer" flexDirection="row" justifyContent="space-between" width={width} gap={1}>
      <Text dimColor wrap="truncate-end">
        {status.isScanning ? 'Updating…' : updatedAt ? `Updated ${ago(now - updatedAt)}` : 'Not read yet'}
      </Text>
      <Button key="refresh" label="Refresh" onPress={() => void refreshTab($, 'cost')} />
    </Box>
  )
  const errorLine = status.error ? (
    <Box key="error" flexDirection="column" borderStyle="round" paddingX={1} paddingY={padY} width={width} flexShrink={0}>
      <Text bold color="red">
        Could not read your logs
      </Text>
      <Text wrap="wrap">{status.error}</Text>
    </Box>
  ) : null

  // The very top: All projects, then each project with use in either week, labelled with this week's cost.
  const projects = summary?.projects ?? []
  const picker = projects.length ? (
    <Box key="project-row" width={width}>
      <Select
        key="project"
        options={[{ value: ALL, label: 'All projects' }, ...projects.map(p => ({ value: p.cwd, label: `${p.label} · ${money(p.cost)}` }))]}
        value={projects.some(p => p.cwd === chosen) ? chosen : ALL}
        onSelect={value => void chooseProject($, value)}
      />
    </Box>
  ) : null

  if (!summary) return [errorLine, status.error ? null : <Text key="loading" dimColor>{LOADING}</Text>, footer]

  const tw = summary.thisWeek
  const lw = summary.lastWeek
  const vsLine = (() => {
    if (!lw) return null
    if (lw.sameTime <= 0) return <Text key="vs">{`vs ${money(lw.cost)} last week`}</Text>
    const pct = Math.round((100 * (tw.cost - lw.sameTime)) / lw.sameTime)
    return <Text key="vs">{`${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs ${money(lw.sameTime)} by this time last week`}</Text>
  })()
  const head = [
    <Text key="total" size="title" weight="bold" color={ACCENT}>
      {money(tw.cost)}
    </Text>,
    dim('since', `this plan week, since ${summary.sinceLabel}`),
    vsLine,
    ...(lw && lw.sameTime > 0 ? [dim('last-all', `Last week in all: ${money(lw.cost)}`)] : []),
    <Text key="chat">{chatCost >= 0 ? `This chat: ${money(chatCost)} so far (estimate)` : 'This chat: no figure yet'}</Text>,
    <Text key="reset">{`Resets ${summary.resetLabel}`}</Text>,
    dim('est-note', ESTIMATE_NOTE),
    ...(summary.unpriced.length ? [dim('unpriced', `No price known for ${summary.unpriced.join(', ')}: counted as $0.`)] : []),
  ]

  const days = summary.days
  const dayAlt = `Cost per day this plan week${summary.sinceLabel ? `, from ${summary.sinceLabel}` : ''}: ${days
    .map(d => `${dayName(d)} ${d.isFuture ? 'not yet' : money(d.cost)} (last week ${money(d.last)})`)
    .join(', ')}`
  const dayMax = Math.max(1, ...days.map(d => Math.max(d.cost, d.last)))
  const labelCells = Math.max(...days.map(d => dayName(d).length), 3)
  const dayBarCells = Math.max(6, inner - labelCells - 22)
  const today = days.reduce((at, d, i) => (d.isFuture ? at : i), -1)
  // The desktop's charts are plain images (no hover), so each has its figures in a line under it.
  const daily = Svg
    ? (() => {
        const drawn = dailySvg(days)
        return [<Svg key="days-chart" source={drawn.source} height={drawn.height} alt={dayAlt} />, dim('days-figures', dayFigures(days))]
      })()
    : [
        ...days.map((d, i) => (
          <Box key={`day${i}`} flexDirection="row" width={inner} height={1} gap={1} overflow="hidden">
            <Text bold={i === today}>{dayName(d).padEnd(labelCells)}</Text>
            <Text color={ACCENT}>{(d.isFuture ? '' : textBar(d.cost / dayMax, dayBarCells)).padEnd(dayBarCells)}</Text>
            <Text color={ACCENT}>{(d.isFuture ? '–' : money(d.cost)).padStart(6)}</Text>
            <Text dimColor wrap="truncate-end">{`last ${money(d.last)}`}</Text>
          </Box>
        )),
      ]

  // The card's toggle: the selected view marked ●, the other dim.
  const viewButton = (view: 'day' | 'hour', label: string) => (
    <Button key={`view-${view}`} plain dimColor={chartView !== view} onPress={() => update($, chartViewAtom, () => view)}>
      {`${chartView === view ? '●' : '○'} ${label}`}
    </Button>
  )
  const hourDays = summary.hourly ?? []
  const picked = hourDays.findIndex(d => d.date === hourDay)
  const shownAt = picked >= 0 ? picked : hourDays.length - 1
  const shown = hourDays[shownAt]
  const step = (to: number, key: string, glyph: string) =>
    to >= 0 && to < hourDays.length ? (
      <Button key={key} plain onPress={() => update($, hourDayAtom, () => (to === hourDays.length - 1 ? '' : hourDays[to]!.date))}>
        {glyph}
      </Button>
    ) : (
      <Text key={key} dimColor>
        {glyph}
      </Text>
    )
  // The toggle on the left; in By hour, the day picker on the right of the same row.
  const viewToggle = (
    <Box key="view" flexDirection="row" justifyContent="space-between" width={inner} gap={2}>
      <Box flexDirection="row" gap={2}>
        {viewButton('day', 'By day')}
        {viewButton('hour', 'By hour')}
      </Box>
      {chartView === 'hour' && shown ? (
        <Box key="hours-pick" flexDirection="row" gap={2}>
          {step(shownAt - 1, 'hour-prev', '‹')}
          <Text>{shown.label}</Text>
          {step(shownAt + 1, 'hour-next', '›')}
        </Box>
      ) : null}
    </Box>
  )
  const hourly = (() => {
    if (!shown) return [dim('hours-none', 'No use yet.')]
    const marked = topHours(shown, 3)
    const alt = `Cost per hour on ${shown.label}, in your Mac's time zone: ${shown.hours
      .map((c, h) => `${hh(h)}:00 ${c === null ? 'not counted' : money(c)}`)
      .join(', ')}`
    const cw = Math.max(1, Math.min(3, Math.floor(inner / 24)))
    const drawn = Svg ? hourlySvg(shown) : undefined
    return Svg && drawn
      ? [<Svg key="hours-chart" source={drawn.source} height={drawn.height} alt={alt} />, dim('hours-top', topHoursLine(shown))]
      : [
          ...hourlyText(shown, cw).map((line, i, all) => (
            <Text key={`hours-line${i}`} color={i < all.length - 2 ? ACCENT : undefined} dimColor={i >= all.length - 2} wrap="truncate-end">
              {line || ' '}
            </Text>
          )),
          ...(marked.length ? [dim('hours-top', `Top hours: ${marked.map(h => `${hh(h)}:00 ${money(shown.hours[h] ?? 0)}`).join(' · ')}`)] : []),
        ]
  })()

  const where = tw.cost
    ? [
        ...stack('split', [
          { name: 'Helper agents', note: plural(summary.split.helpers.runs, 'run'), cost: summary.split.helpers.cost, share: summary.split.helpers.share, color: ACCENT },
          { name: 'Main chats', cost: summary.split.main.cost, share: summary.split.main.share, color: BLUE },
        ]),
        dim('helper-note', HELPER_NOTE),
        <Text key="by-model" weight="semibold">
          By model
        </Text>,
        ...stack(
          'models',
          summary.byModel.map(m => ({ name: m.model, cost: m.cost, share: m.share, color: MODEL_COLOR[m.model] ?? GREY })),
        ),
      ]
    : [dim('split-none', 'No use yet this week.')]

  const typeMax = Math.max(0.01, ...summary.byType.map(t => t.cost))
  const types = list(
    'types',
    summary.byType,
    (t, i) => [
      row(`type${i}`, `${t.type}  ${[t.model, t.effort].filter(Boolean).join(' ')}`, `${t.runs} run${t.runs === 1 ? '' : 's'}  ${money(t.cost)}`),
      bar(`type${i}-bar`, t.cost / typeMax, `${t.type}: ${money(t.cost)}`),
    ],
    'No helper agents this week.',
  )
  const tasks = [
    ...(list(
      'tasks',
      summary.topTasks,
      (t, i) => {
        const isOpen = openTasks.includes(t.id)
        const head = [
          row(`task${i}`, t.text ? `"${t.text}"` : '(no text)', money(t.cost)),
          subline(`task${i}-split`, taskSplit(t)),
          <Box key={`task${i}-from`} flexDirection="row" justifyContent="space-between" width={inner} gap={1}>
            <Box flexShrink={1} flexGrow={1} height={1} overflow="hidden">
              <Text dimColor wrap="truncate-end">
                {[t.date, t.title, t.project].filter(Boolean).join(' · ')}
              </Text>
            </Box>
            <Box flexShrink={0}>
              <Button
                key={`task-${t.id}`}
                plain
                onPress={() => update($, openTasksAtom, cur => (cur.includes(t.id) ? cur.filter(x => x !== t.id) : [...cur, t.id]))}
              >
                {isOpen ? 'Hide details' : 'Details'}
              </Button>
            </Box>
          </Box>,
        ]
        if (!isOpen) return head
        return [
          ...head,
          <Box key={`task${i}-full`} width={inner}>
            <Text wrap="wrap">{t.fullText || t.text || '(no text)'}</Text>
          </Box>,
          <Text key={`task${i}-words`} wrap="wrap">
            {taskSplitWords(t)}
          </Text>,
          ...(t.helperRuns.length
            ? [
                <Text key={`task${i}-runs`} weight="semibold">
                  {t.helpers > t.helperRuns.length ? `Its ${t.helperRuns.length} costliest helper runs` : 'Its helper runs'}
                </Text>,
              ]
            : []),
          ...t.helperRuns.map((r, j) =>
            row(`task${i}-run${j}`, `${r.type}  ${[cap(r.model), r.effort].filter(Boolean).join(' ')}  ${r.label ? `"${r.label}"` : ''}`, money(r.cost)),
          ),
          ...(t.moreRuns ? [dim(`task${i}-more`, `+ ${plural(t.moreRuns, 'more helper run')}, ${money(t.moreCost)}`)] : []),
        ]
      },
      'No tasks this week.',
    ) as unknown[]),
    ...(summary.topTasks.length ? [dim('task-note', TASK_NOTE)] : []),
    ...(summary.outsideTasks >= 0.01 ? [dim('outside', `${money(summary.outsideTasks)} came before any typed message, so it is in no task.`)] : []),
  ]
  const runs = list(
    'runs',
    summary.topRuns,
    (r, i) => [
      row(`run${i}`, `${r.type}  ${[cap(r.model), r.effort].filter(Boolean).join(' ')}  ${r.label ? `"${r.label}"` : ''}`, money(r.cost)),
      subline(`run${i}-from`, `from ${r.title} · ${r.date}`),
    ],
    'No helper runs this week.',
  )

  return [
    picker,
    errorLine,
    section('week', summary.project ? `Cost this week · ${summary.project.label} (estimate at API prices)` : 'Cost this week (estimate at API prices)', head),
    section('days', chartView === 'hour' ? 'By hour' : 'By day', [viewToggle, ...(chartView === 'hour' ? hourly : daily)]),
    section('split', 'Where it went', where),
    section('types', 'By helper agent type', types),
    section('tasks', 'Most expensive tasks', tasks),
    section('runs', 'Most expensive helper runs', runs),
    footer,
  ]
}
