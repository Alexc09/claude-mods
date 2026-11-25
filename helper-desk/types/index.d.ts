export type HelperPhase = 'working' | 'done' | 'failed'

export type StepKind = 'Command' | 'Connector' | 'File read' | 'File write' | 'Skill' | 'Web' | 'Subagent' | 'Tool'

export type Step = {
  kind: StepKind
  /** Short label for the step list: "Gmail · search threads", "pre-outline.md". */
  label: string
  /** Dim text after the label: a file's folder. Empty when there is none. */
  dim: string
  /** The same step in plain words for the live line: "Reading pre-outline.md". */
  live: string
}

export type Helper = {
  /** The id `agent.spawn` answered; tool calls and turns of its loop carry it. */
  id: string
  description: string
  /** The agent type: general-purpose, Explore, a plugin's agent. */
  type: string
  /** Display model ("Opus 5.5"), empty when not known yet. */
  model: string
  /** Effort the engine asked for on its last step, empty when not known. */
  effort: string
  phase: HelperPhase
  /** Clock time it started and, once over, when it ended. */
  startedAt: number
  endedAt: number
  /** How many tool calls it made in all. */
  count: number
  /** Its last 200 steps, oldest first; the last one is the live step. */
  steps: Step[]
  /** Tokens from finished turns, plus the live turn's steps so far. */
  tokens: number
  turnTokens: number
  /** True once the engine reported any usage for it. */
  hasUsage: boolean
  /** Position in the desk, in start order. */
  seat: number
  /** Which of the 8 body colours its pet wears; running helpers never share one while there are 8 or fewer. */
  hue: number
  /** The crew member (a mascot id from hooks/mascots.ts CREW) its card wears in crew mode; set once, when the card is made. */
  crew?: string  /** Clock time its live step last changed (a subagent's tool call); the Ice floe shows a new step in a bubble for a while. */
  stepAt?: number
}

/**
 * One item of the project checklist: [~] in progress, [ ] to do, [x] done. From TODO.md the section decides:
 * 'claimed' is Claimed done (Claude says done, the user has not checked it) and 'done' is Confirmed done.
 */
export type CheckState = 'doing' | 'todo' | 'claimed' | 'done'
export type CheckItem = { text: string; state: CheckState }

/**
 * The project checklist: the checkbox items of TODO.md (`from: 'TODO.md'`), else of RESUME.md's "What the user asked
 * for" (`from: 'RESUME.md'`); and the plain bullets of RESUME.md's "Waiting on the user" and "In progress" sections.
 */
export type Checklist = { from: 'TODO.md' | 'RESUME.md'; items: CheckItem[]; waiting: string[]; now: string[] }

export type PlanStatus = 'pending' | 'in_progress' | 'completed'

/** What the plan band draws: the chat's plan, and whether the band shows it now. */
export type BandPlan = {
  title: string
  steps: { text: string; status: PlanStatus }[]
  /** False once a finished plan has held at 100% for 20 s, or for an empty list. */
  shown: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'helper-desk': {
      /** Running helpers, and done or failed ones for 10 s after they end. */
      helpers: Helper[]
      /** The main chat's card: this turn's steps, or the last turn's once it ended; null before its first turn. */
      main: Helper | null
      /** Tick count (spinner and pet frames) and the clock time of the last tick, for elapsed times. */
      clock: { tick: number; now: number }
      /** Which cards show their full step list. */
      view: { open: string[] }
      /** The chat's /cost total in US dollars, null where the host keeps none. */
      cost: { usd: number | null }
      /** True while switches.json turns the mod off. */
      off: boolean
      /** True while switches.json hides the band and the pane ("helper-desk:hidden"). */
      hidden: boolean
      /** The plan the band draws; null before the first plan. */
      plan: BandPlan | null
      /** Shimmer tick for the step in progress; it counts only while one is in progress. */
      shimmer: number
      /** True while the side pane is open and placed; the band's button reads "Close Helper Desk" then. */
      paneOpen: boolean
      /** The id of the main card's mascot (hooks/mascots.ts); /mascot sets it, $.store keeps it. */
      mascot: string
      /** Crew mode: subagent cards wear their crew member instead of a crab. /crew sets it, $.store keeps it. */
      crew: boolean
      /** Which view the pane draws: 'cards' or 'floe' (the Ice floe penguins). /desk and the pane's buttons set it, $.store keeps it. */
      desk: 'cards' | 'floe'
      /**
       * The project checklist (TODO.md, else RESUME.md); null when no group has an item. Up to 1.9.1 this held a bare
       * CheckItem[], which a reload can still meet: the pane reads that as null until the next read.
       */
      checklist: Checklist | null
      /** The pane's tab while a checklist is shown: 'agents' (default) or 'checklist'. Per session; back to 'agents' when the list goes. */
      tab: 'agents' | 'checklist'
    }
  }
}
