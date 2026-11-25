// Cost tab: what scan.py prints.

/** One row of "By helper agent type": runs of one type, model and effort this week. */
export type CostPaneTypeRow = { type: string; model: string; effort: string; runs: number; cost: number }

/** One helper run listed under an expanded task. */
export type CostPaneTaskRun = { type: string; model: string; effort: string; cost: number; label: string }

/** One row of "Most expensive tasks": one typed message and everything it caused this week. */
export type CostPaneTaskRow = {
  /** The task's key in scan.py's cache; stays the same across scans. */
  id: string
  /** `main` + `helperCost`. */
  cost: number
  /** The calls of the main chat itself. */
  main: number
  /** The calls of every helper run the task started. */
  helperCost: number
  /** The chat's latest custom title, else its AI title, else "Untitled chat". */
  title: string
  /** Last part of the chat's working folder: "web-shop". */
  project: string
  /** Local day the message was typed: "20 Nov". */
  date: string
  /** First 10 words of the typed message, secrets shown as [hidden]. */
  text: string
  /** Up to 2,000 characters of the typed message, line breaks kept, secrets shown as [hidden]. */
  fullText: string
  /** Helper runs the task started (helpers of helpers too). */
  helpers: number
  /** The 5 costliest of them, costliest first. */
  helperRuns: CostPaneTaskRun[]
  /** The runs past those 5, and what they cost together. */
  moreRuns: number
  moreCost: number
}

/** Where a bar's cost went. scan.py still sends it; since 1.0.11 (no hover cards) the pane does not show it. */
export type CostPaneBarDetail = {
  /** `main` + `helpers` = the bar's cost. */
  main: number
  helpers: number
  /** Helper runs with calls in the bar's span. */
  runs: number
  /** The 3 costliest helper types in the span (type, model, effort), costliest first. */
  types: CostPaneTypeRow[]
  /** The task that cost most in the span, and the first 8 words of its message (secrets shown as [hidden]); null when no call was in a task. */
  task: { cost: number; text: string } | null
}

/** One bar of the By day chart: a midnight-to-midnight day, or one of the two halves of the reset day (a reset that is not at midnight splits it). */
export type CostPaneDay = {
  label: string
  /** "Mon 23 Nov", and the same day last week: "Mon 16 Nov" (the shown time zone). */
  date: string
  lastDate: string
  /** "from 9am" on the week's first bar, "to 9am" on its last (the reset hour), '' otherwise. */
  sub?: string
  cost: number
  /** Null for a bar with no cost. */
  detail: CostPaneBarDetail | null
  last: number
  isFuture: boolean
}

/** One calendar day (the Mac's local time, midnight to midnight) of the hourly chart. */
export type CostPaneHourDay = {
  /** "2026-11-23". */
  date: string
  /** "Mon 23 Nov". */
  label: string
  cost: number
  /** 24 costs, 00:00 to 23:00; null for an hour still to come or before the records kept. */
  hours: (number | null)[]
  /** Each hour's breakdown (not shown since 1.0.11); null for an hour with no cost. */
  details: (CostPaneBarDetail | null)[]
}

/** One part of the by-model bar. */
export type CostPaneModelRow = { model: string; cost: number; share: number }

/** One row of "Most expensive helper runs". */
export type CostPaneRunRow = {
  cost: number
  type: string
  model: string
  effort: string
  /** First 8 words of the task description Claude gave the helper. */
  label: string
  date: string
  /** Title of the chat the run came from. */
  title: string
}

/** One project in the pane's project dropdown: a main chat's working folder. Helpers count toward the chat that started them. */
export type CostPaneProject = {
  /** The full working folder: "/Users/you/projects/web-shop"; '' for chats with none recorded. */
  cwd: string
  /** The last folder name, "web-shop"; with its parent ("work/api") where two share it. */
  label: string
  /** This week's cost, and last week's. */
  cost: number
  lastCost: number
}

/** What scan.py prints. Money is US dollars at API list prices; times are epoch seconds. */
export type CostPaneSummary = {
  ok: true
  thisWeek: { start: number; end: number; cost: number; calls: number }
  /** `sameTime`: last week's cost up to the same point in its week. */
  lastWeek: { start: number; end: number; cost: number; sameTime: number } | null
  split: { main: { cost: number; share: number }; helpers: { cost: number; share: number; runs: number } }
  /** The plan week's days, reset to reset (see scan.py RESET_WEEKDAY). */
  days: CostPaneDay[]
  /** The calendar days with use in this plan week and last week, and today always; oldest first, today last. */
  hourly: CostPaneHourDay[]
  byModel: CostPaneModelRow[]
  byType: CostPaneTypeRow[]
  topTasks: CostPaneTaskRow[]
  topRuns: CostPaneRunRow[]
  /** All tasks' cost this week, and the cost of calls in no task; the two add up to `thisWeek.cost`. */
  tasksTotal: number
  outsideTasks: number
  /** Every project with use this week or last week, costliest this week first; from all calls, whatever `project` is. */
  projects: CostPaneProject[]
  /** The project every other figure counts (scan.py's `--project`); null for all projects, or when the one asked for has no use left. */
  project: CostPaneProject | null
  /** Model families with no known price, counted as $0. */
  unpriced: string[]
  /** "Mon 09:00": when this week started, local time. */
  sinceLabel: string
  /** "Mon 30 Nov, 09:00": the next reset, local time. */
  resetLabel: string
  generatedAt: number
  filesRead: number
  bytesRead: number
  seconds: number
}

/** Whether a scan runs, and the last scan's failure. */
export type CostPaneStatus = {
  isScanning: boolean
  /** The real reason the last scan failed; '' when it worked. */
  error: string
}

// Scheduled tab.

/** One task of the Claude app's Scheduled list, read-only, with only the fields the pane shows (never a prompt or a token). */
export type SchedulePaneJob = {
  /** The app's task id. */
  id: string
  name: string
  /** One line: the task file's `description:`; '' when there is none. */
  description: string
  /** A one-off job (Claude `fireAt`), not a repeating one. */
  isOnce: boolean
  /** On and scheduled; false for a task turned off in the app. */
  isActive: boolean
  /** Epoch ms of the next run; null when it can't be known. */
  nextRunAt: number | null
  /** "Every Sunday at 09:00", "Once, Mon 7 Dec 2026 09:00". */
  scheduleWords: string
  /** Epoch ms of the last run; null for never. */
  lastRunAt: number | null
  /** The folder it runs in, `~` for the home folder; '' when none. */
  folder: string
  /** The task's SKILL.md. */
  taskFile: string
  /** Why it is paused, in words; '' for an active job. */
  pausedWhy: string
}

/** A timer of this chat (CronCreate, ScheduleWakeup, /loop), as the Stop hook reports it. */
export type SchedulePaneChatTimer = {
  id: string
  /** The cron expression. */
  schedule: string
  isRecurring: boolean
  /** The first 80 characters of what it will send, secrets hidden. */
  prompt: string
}

/** One read of the app's scheduled tasks. */
export type SchedulePaneData = {
  jobs: SchedulePaneJob[]
  /** One line per file that could not be read: which file and why. */
  problems: string[]
  /** Epoch ms of the read. */
  readAt: number
}

// Setup tabs: what inventory.py prints. A copy of hooks/inventory-types.ts (the contract with inventory.py),
// because this file may import nothing; tsc fails when the two differ (the inventory atom is typed by both).

/** One thing in the user's setup: a mod, plugin, agent, skill, MCP server, hook or setting. */
export type SetupItem = {
  /** What the user calls it: `setup-pane`, `code-reviewer`, `pdf`, `gmail`. */
  name: string
  /** On (enabled, loaded, connected) or off. Items that have no off state are `true`. */
  isOn: boolean
  /** One short line of facts: version, model + effort, scope, transport, marketplace. '' when none. */
  detail: string
  /** The plain description: SETUP.md's text for this item when it has one, else the item's own description. */
  note: string
  /** Whether SETUP.md mentions this item by name. */
  isInSetupMd: boolean
  /** Where it lives, home shortened to `~`: a folder, a file, or `settings.json › hooks`. '' when none. */
  path: string
  /** Agents only: when the main agent hands work to it, the matching bullet under a heading in your
   *  ~/.claude/CLAUDE.md whose bullets say when to use each agent, markdown stripped. '' when CLAUDE.md has no line for it. */
  rule: string
}

/** Everything the setup tabs show, read live at `readAt`. */
export type Inventory = {
  /** The user's own mods: plugins of the `my-mods` marketplace (~/.claude/mods). */
  mods: SetupItem[]
  /** Every other installed plugin (claude-plugins-official and others), marketplace in `detail`. */
  plugins: SetupItem[]
  /** Subagent types in ~/.claude/agents. `detail`: model and effort, e.g. `Opus · medium effort`
   *  (no `effort:` line → `default effort`). `note`: the agent file's `description`. `rule`: the hand-over rule. */
  agents: SetupItem[]
  /** The user's own skills (~/.claude/skills on, ~/.claude/skills-off off). */
  skills: SetupItem[]
  /** MCP servers and connectors this session has (`isOn` false when it needs sign-in or is disconnected). */
  mcp: SetupItem[]
  /** Hooks from ~/.claude/settings.json (`name`: the event; `detail`: the command's file name). */
  hooks: SetupItem[]
  /** Scheduled tasks of the Claude app (~/.claude/scheduled-tasks + the app's scheduled-tasks.json),
   *  `detail`: the schedule in words and the next run in local time. Never the task's prompt. */
  scheduled: SetupItem[]
  /** A few key settings (model, effort, permission mode, output style, status line). Never secret values. */
  settings: SetupItem[]
  /** Files that could not be read, each as one plain sentence. */
  problems: string[]
  /** Epoch milliseconds. */
  readAt: number
}

/** Whether inventory.py runs, and its last failure in one plain sentence ('' when it worked). */
export type SetupPaneInventoryStatus = { isReading: boolean; error: string }

/** The pane's tabs. */
export type SetupPaneTab = 'overview' | 'cost' | 'scheduled' | 'agents' | 'plugins' | 'skills' | 'mcp' | 'hooks'

declare module 'claude-code' {
  interface PluginState {
    'setup-pane': {
      /** The tab the pane shows. */
      tab: SetupPaneTab
      /** The clock, moved once a minute while the pane shows, so "Updated 2 min ago" and countdowns stay right. */
      now: number

      // Cost tab.
      summary: Shaped<CostPaneSummary | null>
      status: CostPaneStatus
      /** Milliseconds since the epoch when `summary` was read; 0 for never. */
      updatedAt: number
      /** Cost lists the person expanded with Show more: types, tasks, runs. */
      costExpanded: string[]
      /** Ids of the task rows the person opened with Details. */
      openTasks: string[]
      /** This chat's own cost from $.session.usage(), US dollars; -1 when unknown. */
      chatCost: number
      /** What the "By day" card shows: the 7 plan days, or the 24 hours of one day. */
      chartView: 'day' | 'hour'
      /** The `date` of the day the hourly chart shows; '' for today. */
      hourDay: string
      /** The working folder of the project the person chose in the dropdown; '' for All projects. */
      project: string

      // Scheduled tab.
      data: Shaped<SchedulePaneData | null>
      isReading: boolean
      /** Ids of the job rows opened with Details. */
      openJobs: string[]
      /** Lists opened with Show more, and `paused` when the Paused card is open. */
      jobsExpanded: string[]
      chatTimers: Shaped<SchedulePaneChatTimer[]>

      // Setup tabs.
      /** What inventory.py printed last; null before the first read. */
      inventory: Shaped<Inventory | null>
      inventoryStatus: SetupPaneInventoryStatus
      /** Setup lists opened with Show more. */
      setupExpanded: string[]
      /** True once this session started `inventory.py --write-setup-md`, so a reload does not run it again. */
      setupMdRun: boolean
    }
  }
}
