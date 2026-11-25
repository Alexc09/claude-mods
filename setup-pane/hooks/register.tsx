import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SchedulePaneChatTimer, SetupPaneTab } from '../types'
import { costTab } from './cost-tab'
import { scheduleTab } from './schedule-tab'
import { scrub } from './sources'
import { TAB_LABELS, agentsTab, listTab, overviewTab } from './setup-tabs'
import { MINUTE, PANE, TITLE, isPaneShown, readIfStale, readInventory, refreshChatCost } from './state'

// This file's handles on the pane's state (validate reads each from a const of the file that uses it); state.ts has the same.
const chatTimersAtom = atom({ plugin: 'setup-pane', key: 'chatTimers' } as const, [] as SchedulePaneChatTimer[], { shape: 'timers-1' })
const nowAtom = atom({ plugin: 'setup-pane', key: 'now' } as const, 0)
const setupMdRunAtom = atom({ plugin: 'setup-pane', key: 'setupMdRun' } as const, false)
const tabAtom = atom({ plugin: 'setup-pane', key: 'tab' } as const, 'overview' as SetupPaneTab)

export { ago, taskSplit, taskSplitWords } from './cost-tab'
export { comingUp, pausedJobs, recentRuns } from './schedule-tab'
export { missingByTab, onFirst, onOffCount } from './setup-tabs'
export { money } from './charts'

const COMMAND = {
  name: 'my-setup',
  description: 'Show your Claude Code setup: cost, scheduled tasks, agents, mods, plugins, skills, MCP servers and hooks',
}
const TABS = Object.keys(TAB_LABELS) as SetupPaneTab[]

let ticker: { cancel: () => void } | undefined

/** Once a minute, only while the pane shows: move the clocks, and read again what the tab shows once it is old. */
async function tick($: EngineInterface) {
  if (!(await isPaneShown($))) return
  const t = await $.clock.now()
  await update($, nowAtom, () => t)
  const tab = await read($, tabAtom)
  if (tab === 'cost' || tab === 'overview') await refreshChatCost($)
  await readIfStale($, tab)
}

async function showTab($: EngineInterface, tab: SetupPaneTab) {
  await update($, tabAtom, () => tab)
  if (tab === 'cost') void refreshChatCost($)
  void readIfStale($, tab).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // If another plugin owns /my-setup, the engine refuses this plugin's register with a throw: keep the rest of the start.
    try {
      await $.command.register({ name: COMMAND.name, description: COMMAND.description, immediate: true })
    } catch {
      // Owned by another plugin for this session.
    }
    ticker?.cancel()
    ticker = $.clock.every(MINUTE, () => {
      void tick($).catch(() => undefined)
    })
    void refreshChatCost($)
    // A pane left open before a reload or resume is read again if its data is old.
    void isPaneShown($)
      .then(async shown => (shown ? readIfStale($, await read($, tabAtom)) : undefined))
      .catch(() => undefined)
    return next(e)
  })

  // Once per session (not on a mod reload): refresh the list inventory.py keeps in ~/.claude/SETUP.md, in the background.
  on('classic.SessionStart', async ($, e, next) => {
    const done = await next(e)
    if (!(await read($, setupMdRunAtom))) {
      await update($, setupMdRunAtom, () => true)
      void readInventory($, true).catch(() => undefined)
    }
    return done
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND.name }, async $ => {
    await showTab($, 'overview')
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return { text: opened.isPlaced ? `Opened My setup on the ${TAB_LABELS.overview} tab.` : `The My setup pane is waiting: ${opened.reason}` }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refreshChatCost($)
    return done
  }).catch(($, e, next) => next(e))

  // The engine reports this chat's own timers at the end of each turn.
  on('classic.Stop', async ($, e, next) => {
    const done = await next(e)
    const crons = e.session_crons ?? []
    await update($, chatTimersAtom, () => crons.map(c => ({ id: c.id, schedule: c.schedule, isRecurring: c.recurring, prompt: scrub(c.prompt) })))
    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Select } = $.ui.resolve(e)
    const isTerminal = e.surface === 'terminal'
    const width = Math.max(24, e.props.bodyColumns)
    const tab = await read($, tabAtom)
    const picker = (
      <Box key="tab-row" width={width}>
        <Select
          key="tab"
          options={TABS.map(t => ({ value: t, label: TAB_LABELS[t] }))}
          value={tab}
          onSelect={value => void showTab($, value as SetupPaneTab)}
        />
      </Box>
    )
    const body =
      tab === 'cost'
        ? await costTab($, e)
        : tab === 'scheduled'
          ? await scheduleTab($, e)
          : tab === 'agents'
            ? await agentsTab($, e)
            : tab === 'overview'
              ? await overviewTab($, e)
              : await listTab($, e, tab)
    return (
      <Box flexDirection="column" width={width} gap={isTerminal ? 1 : 'md'}>
        {picker}
        {body as never}
      </Box>
    )
  })
}
