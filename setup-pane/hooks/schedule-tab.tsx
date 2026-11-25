import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SchedulePaneChatTimer, SchedulePaneData, SchedulePaneJob } from '../types'
import { countdown, cronWords, dayTime, nextCronRun } from './cron'
import type { PaneInput } from './pane-input'
import { TZ } from './sources'
import { MINUTE, refreshTab, toggle } from './state'

// This file's handles on the pane's state (validate reads each from a const of the file that uses it); state.ts has the same.
const chatTimersAtom = atom({ plugin: 'setup-pane', key: 'chatTimers' } as const, [] as SchedulePaneChatTimer[], { shape: 'timers-1' })
const dataAtom = atom({ plugin: 'setup-pane', key: 'data' } as const, null as SchedulePaneData | null, { shape: 'data-2' })
const jobsExpandedAtom = atom({ plugin: 'setup-pane', key: 'jobsExpanded' } as const, [] as string[])
const nowAtom = atom({ plugin: 'setup-pane', key: 'now' } as const, 0)
const openJobsAtom = atom({ plugin: 'setup-pane', key: 'openJobs' } as const, [] as string[])
const readingAtom = atom({ plugin: 'setup-pane', key: 'isReading' } as const, false)

// The Scheduled tab: the Claude app's scheduled tasks and this chat's timers.

const SHORT = 5
const RECENT = 3
const ACCENT = '#d97757'

const PAUSED_NOTE = 'Paused = turned off: it will not run until it is turned back on.'
const CHAT_NOTE = 'Timers this chat set (with /loop or a reminder). They stop when this chat closes.'

/** Active jobs, soonest first; ones with no known next run last. */
export function comingUp(jobs: SchedulePaneJob[]): SchedulePaneJob[] {
  return jobs.filter(j => j.isActive).sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name))
}

export function pausedJobs(jobs: SchedulePaneJob[]): SchedulePaneJob[] {
  return jobs.filter(j => !j.isActive).sort((a, b) => a.name.localeCompare(b.name))
}

/** The last `RECENT` runs across every task, newest first. */
export function recentRuns(jobs: SchedulePaneJob[]): SchedulePaneJob[] {
  return jobs.filter(j => j.lastRunAt !== null).sort((a, b) => b.lastRunAt! - a.lastRunAt!).slice(0, RECENT)
}

/** The Scheduled tab's cards, top to bottom, ending with its Read line and Refresh. */
export async function scheduleTab($: EngineInterface, e: PaneInput): Promise<unknown[]> {
  const { Box, Text, Button } = $.ui.resolve(e)
  const isTerminal = e.surface === 'terminal'
  const width = Math.max(24, e.props.bodyColumns)
  const inner = width - 4
  const padY = isTerminal ? 1 : 'sm'
  const gapY = isTerminal ? 1 : 'md'
  const data = await read($, dataAtom)
  const isReading = await read($, readingAtom)
  const openJobs = await read($, openJobsAtom)
  const expanded = await read($, jobsExpandedAtom)
  const timers = await read($, chatTimersAtom)
  const now = Math.max(await read($, nowAtom), data?.readAt ?? 0)

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
          <Text dimColor>{right}</Text>
        </Box>
      ) : null}
    </Box>
  )
  const accentLine = (key: string, text: string) => (
    <Box key={key} width={inner} height={1} overflow="hidden">
      <Text color={ACCENT} wrap="truncate-end">
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
  // Items with a blank line between them; 5, and Show more for the rest.
  const list = <T,>(key: string, rows: T[], draw: (r: T) => unknown, empty: string) => {
    if (!rows.length) return dim(`${key}-none`, empty)
    const isOpen = expanded.includes(key)
    const shown = isOpen ? rows : rows.slice(0, SHORT)
    return (
      <Box key={`${key}-list`} flexDirection="column" width={inner} gap={gapY}>
        {shown.map(draw) as never}
        {rows.length > SHORT ? (
          <Box key={`${key}-nav`} flexDirection="row" justifyContent="flex-end" width={inner}>
            <Button key={`more-${key}`} plain onPress={() => update($, jobsExpandedAtom, cur => toggle(cur, key))}>
              {isOpen ? 'Show less' : `Show more (${rows.length - SHORT})`}
            </Button>
          </Box>
        ) : null}
      </Box>
    )
  }
  const tag = (j: SchedulePaneJob) => (j.isOnce ? 'once' : '')
  const when = (ms: number | null) => (ms === null ? 'Next run not known' : `${dayTime(ms, TZ)} · ${countdown(ms, now, TZ)}`)

  const jobRow = (j: SchedulePaneJob) => {
    const isOpen = openJobs.includes(j.id)
    const last = j.lastRunAt === null ? 'never' : dayTime(j.lastRunAt, TZ)
    return (
      <Box key={`job-${j.id}`} flexDirection="column" width={inner}>
        {row(`${j.id}-name`, j.name, tag(j))}
        {accentLine(`${j.id}-when`, when(j.nextRunAt))}
        {/* flex-start keeps the Details button on the first line when the open description wraps. */}
        <Box key={`${j.id}-desc`} flexDirection="row" justifyContent="space-between" alignItems="flex-start" width={inner} gap={1}>
          {isOpen ? (
            // Open: the whole description, wrapped over as many lines as it needs.
            <Box key={`${j.id}-desc-full`} flexShrink={1} flexGrow={1}>
              <Text dimColor wrap="wrap">
                {j.description || j.scheduleWords}
              </Text>
            </Box>
          ) : (
            <Box key={`${j.id}-desc-short`} flexShrink={1} flexGrow={1} height={1} overflow="hidden">
              <Text dimColor wrap="truncate-end">
                {j.description || j.scheduleWords}
              </Text>
            </Box>
          )}
          <Box flexShrink={0}>
            <Button key={`details-${j.id}`} plain onPress={() => update($, openJobsAtom, cur => toggle(cur, j.id))}>
              {isOpen ? 'Hide details' : 'Details'}
            </Button>
          </Box>
        </Box>
        {isOpen
          ? [
              <Text key={`${j.id}-sched`} wrap="wrap">{`Schedule: ${j.scheduleWords}`}</Text>,
              <Text key={`${j.id}-last`} wrap="wrap">{`Last run: ${last}`}</Text>,
              ...(j.folder ? [<Text key={`${j.id}-folder`} wrap="wrap">{`Runs in: ${j.folder}`}</Text>] : []),
              <Text key={`${j.id}-file`} wrap="wrap">{`Task file: ${j.taskFile}`}</Text>,
            ]
          : null}
      </Box>
    )
  }

  const footer = (
    <Box key="footer" flexDirection="row" justifyContent="space-between" width={width} gap={1}>
      <Text dimColor wrap="truncate-end">
        {isReading ? 'Reading…' : data ? `Read ${now - data.readAt < MINUTE ? 'just now' : `${Math.floor((now - data.readAt) / MINUTE)} min ago`}` : 'Not read yet'}
      </Text>
      <Button key="refresh" label="Refresh" onPress={() => void refreshTab($, 'scheduled')} />
    </Box>
  )

  if (!data) return [<Text key="loading" dimColor>Reading your scheduled jobs…</Text>, footer]

  const upcoming = comingUp(data.jobs)
  const paused = pausedJobs(data.jobs)
  const recent = recentRuns(data.jobs)
  const isPausedOpen = expanded.includes('paused')

  const pausedBody = [
    <Box key="paused-nav" flexDirection="row" width={inner}>
      <Button key="paused-toggle" plain onPress={() => update($, jobsExpandedAtom, cur => toggle(cur, 'paused'))}>
        {isPausedOpen ? 'Hide paused' : `Show ${paused.length} paused`}
      </Button>
    </Box>,
    ...(isPausedOpen
      ? [
          dim('paused-note', PAUSED_NOTE),
          list(
            'paused',
            paused,
            j => (
              <Box key={`paused-${j.id}`} flexDirection="column" width={inner}>
                {row(`${j.id}-pname`, j.name, tag(j))}
                {dim(`${j.id}-why`, j.pausedWhy)}
                {dim(`${j.id}-was`, `Schedule when on: ${j.scheduleWords}`)}
              </Box>
            ),
            '',
          ),
        ]
      : []),
  ]

  const recentBody = recent.map(j => (
    <Box key={`recent-${j.id}`} flexDirection="column" width={inner}>
      {row(`${j.id}-rname`, j.name, '')}
      {dim(`${j.id}-rwhen`, dayTime(j.lastRunAt!, TZ))}
    </Box>
  ))

  const chatBody = [
    dim('chat-note', CHAT_NOTE),
    ...timers.map(t => {
      const next = nextCronRun(t.schedule, now, TZ)
      return (
        <Box key={`timer-${t.id}`} flexDirection="column" width={inner}>
          {row(`${t.id}-tname`, cronWords(t.schedule), t.isRecurring ? 'repeats' : 'once')}
          {accentLine(`${t.id}-twhen`, when(next))}
          {t.prompt ? dim(`${t.id}-tprompt`, `Sends: ${t.prompt}`) : null}
        </Box>
      )
    }),
  ]

  return [
    ...data.problems.map((p, i) => dim(`problem${i}`, p)),
    section('coming', 'Coming up', list('coming', upcoming, jobRow, 'Nothing is set to run.')),
    timers.length ? section('chat', 'This chat', chatBody) : null,
    paused.length ? section('paused', 'Paused', pausedBody) : null,
    recent.length ? section('recent', 'Recently run', recentBody) : null,
    footer,
  ]
}
