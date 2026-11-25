// The contract between the pane (register.tsx, which draws) and inventory.ts (which reads the live setup).
// Both sides import these types; neither changes them without the other.

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
