import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CostPaneStatus, CostPaneSummary, SchedulePaneChatTimer, SchedulePaneData, SetupPaneInventoryStatus, SetupPaneTab } from '../types'
import type { Inventory } from './inventory-types'
import { readSources } from './sources'

// The pane's state, and the three readers behind it: scan.py (Cost), the app's task files (Scheduled), inventory.py (setup tabs).

export const PANE = 'setup-pane'
export const TITLE = 'My setup'
export const MINUTE = 60_000
// Cost data older than this is read again while a tab that shows it is on screen.
const COST_STALE_MS = 10 * MINUTE
// Scheduled tasks and the inventory are read again when this old.
const SCHED_STALE_MS = 5 * MINUTE
const INVENTORY_STALE_MS = 5 * MINUTE
// The first scan reads up to two weeks of logs (several GB); later ones read only new bytes.
const SCAN_TIMEOUT_MS = 10 * MINUTE
const INVENTORY_TIMEOUT_MS = MINUTE
// The dropdown's value for All projects: never a working folder, which always starts with '/'.
export const ALL = 'all'


export const tabAtom = atom({ plugin: 'setup-pane', key: 'tab' } as const, 'overview' as SetupPaneTab)
export const nowAtom = atom({ plugin: 'setup-pane', key: 'now' } as const, 0)
// Change a shape tag when that value's fields change: a value an earlier version stored outlives a reload.
export const summaryAtom = atom({ plugin: 'setup-pane', key: 'summary' } as const, null as CostPaneSummary | null, { shape: 'summary-6' })
export const statusAtom = atom({ plugin: 'setup-pane', key: 'status' } as const, { isScanning: false, error: '' } as CostPaneStatus)
export const updatedAtom = atom({ plugin: 'setup-pane', key: 'updatedAt' } as const, 0)
export const costExpandedAtom = atom({ plugin: 'setup-pane', key: 'costExpanded' } as const, [] as string[])
export const openTasksAtom = atom({ plugin: 'setup-pane', key: 'openTasks' } as const, [] as string[])
export const chatCostAtom = atom({ plugin: 'setup-pane', key: 'chatCost' } as const, -1)
export const chartViewAtom = atom({ plugin: 'setup-pane', key: 'chartView' } as const, 'day' as 'day' | 'hour')
export const hourDayAtom = atom({ plugin: 'setup-pane', key: 'hourDay' } as const, '')
export const projectAtom = atom({ plugin: 'setup-pane', key: 'project' } as const, '')
export const dataAtom = atom({ plugin: 'setup-pane', key: 'data' } as const, null as SchedulePaneData | null, { shape: 'data-2' })
export const readingAtom = atom({ plugin: 'setup-pane', key: 'isReading' } as const, false)
export const openJobsAtom = atom({ plugin: 'setup-pane', key: 'openJobs' } as const, [] as string[])
export const jobsExpandedAtom = atom({ plugin: 'setup-pane', key: 'jobsExpanded' } as const, [] as string[])
export const chatTimersAtom = atom({ plugin: 'setup-pane', key: 'chatTimers' } as const, [] as SchedulePaneChatTimer[], { shape: 'timers-1' })
export const inventoryAtom = atom({ plugin: 'setup-pane', key: 'inventory' } as const, null as Inventory | null, { shape: 'inventory-1' })
export const inventoryStatusAtom = atom({ plugin: 'setup-pane', key: 'inventoryStatus' } as const, { isReading: false, error: '' } as SetupPaneInventoryStatus)
export const setupExpandedAtom = atom({ plugin: 'setup-pane', key: 'setupExpanded' } as const, [] as string[])
export const setupMdRunAtom = atom({ plugin: 'setup-pane', key: 'setupMdRun' } as const, false)

export const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id])

// One read of each kind at a time from this chat; scan.py's lock file keeps other chats' scans apart.
let scanning: Promise<void> | null = null
let readingJobs: Promise<void> | null = null
let readingInventory: Promise<void> | null = null
// When inventory.py was last started; a failed read waits as long as a good one before the next try.
let inventoryTriedAt = 0

/** The scan's failure in one line: the JSON error scan.py printed, else the end of stderr. */
function failure(exitCode: number, stdout: string, stderr: string, script: string): string {
  const last = stdout.trim().split('\n').pop() ?? ''
  try {
    const j = JSON.parse(last) as { ok?: boolean; error?: string }
    if (j.ok === false && j.error) return j.error
  } catch {
    // Not JSON: fall through to stderr.
  }
  const err = stderr.trim().split('\n').slice(-3).join(' ').slice(-300)
  return err || `${script} stopped with exit code ${exitCode} and printed nothing`
}

const why = (err: unknown) => (err instanceof Error ? err.message : String(err))

export async function refreshChatCost($: EngineInterface) {
  try {
    const usd = (await $.session.usage()).cost?.usd
    await update($, chatCostAtom, () => (typeof usd === 'number' ? usd : -1))
  } catch {
    // The chat's own figure is a nice-to-have.
  }
}

/** Runs scan.py off the render path and stores what it prints. Never two at once. */
export function runScan($: EngineInterface): Promise<void> {
  if (scanning) return scanning
  scanning = (async () => {
    await update($, statusAtom, s => ({ ...s, isScanning: true }))
    let error = ''
    try {
      const env = await $.process.hookEnv()
      const data = env.CLAUDE_PLUGIN_DATA
      if (!data) throw new Error('Claude Code gave no plugin data folder (CLAUDE_PLUGIN_DATA)')
      const project = await read($, projectAtom)
      const argv = ['python3', '-I', `${$.plugin.root}/scan.py`, '--data', data, ...(project ? ['--project', project] : [])]
      const ran = await $.process.run(argv, { timeoutMs: SCAN_TIMEOUT_MS })
      if (ran.exitCode !== 0) {
        error = failure(ran.exitCode, ran.stdout, ran.stderr, 'scan.py')
      } else {
        const summary = JSON.parse(ran.stdout.trim().split('\n').pop() ?? '') as CostPaneSummary
        if (!summary.ok) throw new Error('scan.py printed no summary')
        // The chosen project has no use left in either week: scan.py counted all projects, so the dropdown says so too.
        if (project && !summary.project) await update($, projectAtom, cur => (cur === project ? '' : cur))
        await update($, summaryAtom, () => summary)
        await update($, updatedAtom, () => summary.generatedAt * 1000)
      }
    } catch (err) {
      error = why(err)
    }
    await update($, statusAtom, () => ({ isScanning: false, error }))
    const t = await $.clock.now()
    await update($, nowAtom, () => t)
  })().finally(() => {
    scanning = null
  })
  return scanning
}

/** The dropdown's pick: remember it, then read the logs for it once any scan already running is done. */
export async function chooseProject($: EngineInterface, value: string) {
  await update($, projectAtom, () => (value === ALL ? '' : value))
  await (scanning ?? Promise.resolve())
  await runScan($)
}

/** Reads the app's scheduled tasks off the render path. Never two at once. */
export function readJobs($: EngineInterface): Promise<void> {
  if (readingJobs) return readingJobs
  readingJobs = (async () => {
    await update($, readingAtom, () => true)
    try {
      const data = await readSources($)
      await update($, dataAtom, () => data)
      await update($, nowAtom, () => data.readAt)
    } finally {
      await update($, readingAtom, () => false)
    }
  })().finally(() => {
    readingJobs = null
  })
  return readingJobs
}

/**
 * Runs inventory.py off the render path and stores the Inventory it prints. With `writeSetupMd`, inventory.py
 * also rewrites its own section of ~/.claude/SETUP.md (this module never writes that file). Never two at once;
 * a failure becomes one plain sentence in the status, never a throw.
 */
export function readInventory($: EngineInterface, writeSetupMd = false): Promise<void> {
  if (readingInventory) return readingInventory
  readingInventory = (async () => {
    inventoryTriedAt = await $.clock.now()
    await update($, inventoryStatusAtom, s => ({ ...s, isReading: true }))
    let error = ''
    try {
      const script = `${$.plugin.root}/inventory.py`
      if (!(await $.fs.exists(script))) {
        error = 'Could not read your setup: inventory.py is not in the mod folder yet.'
      } else {
        const ran = await $.process.run(['python3', '-I', script, ...(writeSetupMd ? ['--write-setup-md'] : [])], { timeoutMs: INVENTORY_TIMEOUT_MS })
        if (ran.exitCode !== 0) {
          error = `Could not read your setup: ${failure(ran.exitCode, ran.stdout, ran.stderr, 'inventory.py')}`
        } else {
          const inv = JSON.parse(ran.stdout.trim()) as Inventory
          if (!inv || !Array.isArray(inv.agents) || !Array.isArray(inv.mods)) throw new Error('inventory.py printed something that is not a setup list')
          await update($, inventoryAtom, () => inv)
        }
      }
    } catch (err) {
      error = `Could not read your setup: ${why(err)}`
    }
    await update($, inventoryStatusAtom, () => ({ isReading: false, error }))
    const t = await $.clock.now()
    await update($, nowAtom, cur => Math.max(cur, t))
  })().finally(() => {
    readingInventory = null
  })
  return readingInventory
}

/** What each tab shows, so only that is read while it is on screen. */
const NEEDS: Record<SetupPaneTab, ('cost' | 'jobs' | 'inventory')[]> = {
  overview: ['inventory', 'cost', 'jobs'],
  cost: ['cost'],
  scheduled: ['jobs'],
  agents: ['inventory'],
  plugins: ['inventory'],
  skills: ['inventory'],
  mcp: ['inventory'],
  hooks: ['inventory'],
}

/** Reads what `tab` shows when it is old or was never read. Starts the reads and returns without waiting on a slow one. */
export async function readIfStale($: EngineInterface, tab: SetupPaneTab) {
  const now = await $.clock.now()
  const needs = NEEDS[tab]
  const reads: Promise<void>[] = []
  if (needs.includes('cost') && now - (await read($, updatedAtom)) >= COST_STALE_MS) reads.push(runScan($))
  if (needs.includes('jobs')) {
    const data = await read($, dataAtom)
    if (!data || now - data.readAt >= SCHED_STALE_MS) reads.push(readJobs($))
  }
  if (needs.includes('inventory')) {
    const inv = await read($, inventoryAtom)
    // A failed read is not tried again on every tick: Refresh, or the next 5-minute mark, tries again.
    if (now - Math.max(inv?.readAt ?? 0, inventoryTriedAt) >= INVENTORY_STALE_MS) reads.push(readInventory($))
  }
  await Promise.all(reads.map(r => r.catch(() => undefined)))
}

/** Refresh on `tab`: reads what it shows now, whatever its age. Setup tabs rewrite the SETUP.md section too. */
export async function refreshTab($: EngineInterface, tab: SetupPaneTab) {
  const needs = NEEDS[tab]
  const reads: Promise<void>[] = []
  if (needs.includes('cost')) {
    void refreshChatCost($)
      reads.push(runScan($))
  }
  if (needs.includes('jobs')) reads.push(readJobs($))
  if (needs.includes('inventory')) reads.push(readInventory($, true))
  await Promise.all(reads.map(r => r.catch(() => undefined)))
}

export async function isPaneShown($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE && p.isShown && p.isPlaced)
}
