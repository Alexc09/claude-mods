import type { EngineInterface } from 'claude-code'

import type { SchedulePaneData, SchedulePaneJob } from '../types'
import { cronWords, dayTime, nextCronRun } from './cron'

/**
 * The time zone cron fields and every time shown are read in, in minutes ahead of UTC: this computer's own.
 * Set a fixed number (for example -5 * 60 for UTC-5) to use another one.
 */
export const TZ = -new Date().getTimezoneOffset()

const CLAUDE_DIR = 'Library/Application Support/Claude/claude-code-sessions'
const CLAUDE_FILE = 'scheduled-tasks.json'
const MCP_SERVER = 'scheduled-tasks'
const MCP_TIMEOUT_MS = 4_000

/** Hides anything shaped like a key or token, then cuts to `max` characters. */
export function scrub(text: string, max = 80): string {
  const hidden = text
    .replace(/\b(sk|pk|ghp|gho|xox[abp]|AKIA|AIza)[-_A-Za-z0-9]{8,}/g, '[hidden]')
    .replace(/[A-Za-z0-9_\-+/=]{24,}/g, '[hidden]')
    .replace(/\s+/g, ' ')
    .trim()
  return hidden.length > max ? `${hidden.slice(0, max - 1)}…` : hidden
}

export const tilde = (path: string, home: string) => (home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)

/** The `description:` line of a SKILL.md's YAML frontmatter; '' when there is none. */
export function frontmatterDescription(text: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const line = m?.[1]?.split(/\r?\n/).find(l => /^description:/.test(l))
  if (!line) return ''
  return line.replace(/^description:\s*/, '').replace(/^["']|["']$/g, '').trim()
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const time = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v) {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

/** What the app's scheduled-tasks MCP server says of one task: its next run (with the app's few minutes of delay) and description. */
export type ClaudeLive = { nextRunAt: number | null; description: string }

/** The tasks of one scheduled-tasks.json. `descriptions` is keyed by task file path; `live` by task id, when the MCP server answered. */
export function parseClaudeTasks(
  json: unknown,
  descriptions: Record<string, string>,
  live: Record<string, ClaudeLive> | null,
  now: number,
  home: string,
): SchedulePaneJob[] {
  const list = (json as { scheduledTasks?: unknown })?.scheduledTasks
  if (!Array.isArray(list)) throw new Error('it has no scheduledTasks list')
  return list.map((raw: Record<string, unknown>): SchedulePaneJob => {
    const id = str(raw.id)
    const filePath = str(raw.filePath)
    const fireAt = time(raw.fireAt)
    const cron = str(raw.cronExpression)
    const isOnce = fireAt !== null
    const isActive = raw.enabled !== false
    const known = live?.[id]
    const nextRunAt = known?.nextRunAt ?? (isOnce ? fireAt : cron ? nextCronRun(cron, now, TZ) : null)
    return {
      id,
      name: str(raw.displayName) || id,
      description: scrub(descriptions[filePath] || known?.description || '', 1000),
      isOnce,
      isActive,
      nextRunAt,
      scheduleWords: isOnce ? `Once, ${dayTime(fireAt, TZ, true)}` : cron ? `${cronWords(cron)} (the app starts it a few minutes late on purpose)` : 'No schedule set',
      lastRunAt: time(raw.lastRunAt),
      folder: tilde(str(raw.cwd), home),
      taskFile: tilde(filePath, home),
      pausedWhy: isActive ? '' : "Turned off in the app's Scheduled list",
    }
  })
}

const why = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Asks the app's scheduled-tasks server for each task's next run; null when a mod can't reach it. */
async function claudeLive($: EngineInterface): Promise<Record<string, ClaudeLive> | null> {
  try {
    const call = $.mcp.call(MCP_SERVER, 'list_scheduled_tasks', {})
    const timeout = $.clock.sleep(MCP_TIMEOUT_MS).then(() => null)
    const result = await Promise.race([call, timeout])
    if (!result || result.isError) return null
    const text = result.content.map(b => ('text' in b && typeof b.text === 'string' ? b.text : '')).join('')
    const list = JSON.parse(text) as Record<string, unknown>[]
    if (!Array.isArray(list)) return null
    return Object.fromEntries(list.map(t => [str(t.taskId), { nextRunAt: time(t.nextRunAt), description: str(t.description) }]))
  } catch {
    return null
  }
}

async function readClaude($: EngineInterface, home: string, now: number, problems: string[]): Promise<SchedulePaneJob[]> {
  const base = `${home}/${CLAUDE_DIR}`
  let files: string[] = []
  try {
    for (const account of await $.fs.list(base)) {
      if (account.kind !== 'dir') continue
      for (const org of await $.fs.list(`${base}/${account.name}`).catch(() => [])) {
        const file = `${base}/${account.name}/${org.name}/${CLAUDE_FILE}`
        if (org.kind === 'dir' && (await $.fs.exists(file))) files.push(file)
      }
    }
  } catch (err) {
    problems.push(`Claude tasks: could not open ~/${CLAUDE_DIR} (${why(err)}).`)
    return []
  }
  if (!files.length) {
    problems.push(`Claude tasks: no ${CLAUDE_FILE} found under ~/${CLAUDE_DIR}.`)
    return []
  }
  files = files.sort()
  const live = await claudeLive($)
  const seen = new Set<string>()
  const jobs: SchedulePaneJob[] = []
  for (const file of files) {
    try {
      const json = JSON.parse(await $.fs.read(file)) as { scheduledTasks?: { filePath?: unknown }[] }
      const descriptions: Record<string, string> = {}
      for (const t of Array.isArray(json?.scheduledTasks) ? json.scheduledTasks : []) {
        const path = str(t?.filePath)
        if (path) descriptions[path] = frontmatterDescription(await $.fs.read(path).catch(() => ''))
      }
      for (const job of parseClaudeTasks(json, descriptions, live, now, home)) {
        if (seen.has(job.id)) continue
        seen.add(job.id)
        jobs.push(job)
      }
    } catch (err) {
      problems.push(`Claude tasks: could not read ${tilde(file, home)} (${why(err)}).`)
    }
  }
  return jobs
}

/** Reads the app's scheduled tasks; a file that fails adds a line to `problems` and the rest still show. Never writes anything. */
export async function readSources($: EngineInterface): Promise<SchedulePaneData> {
  const now = await $.clock.now()
  const home = (await $.env.get('HOME')) ?? ''
  const problems: string[] = []
  const jobs = await readClaude($, home, now, problems)
  return { jobs, problems, readAt: now }
}
