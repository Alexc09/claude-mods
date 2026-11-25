/** One line of a peeked chat: what you said, what Claude said, or the tools it used in a row ("Bash, Read"). */
export type PeekLine = { who: 'You' | 'Claude' | 'tool'; text: string }

/** What the Peek pane draws: one chat, read from its status file and the tail of its transcript. */
export type PeekView = {
  /** The peeked session's id. */
  id: string
  /** The pane's title: "Peek: <chat name>". */
  title: string
  /** "<chat name> · waiting for you: needs an approval", "<chat name> · working". */
  header: string
  /** Its desktop-app chat id (local_<uuid>) for Go to answer, null for a terminal chat. */
  host: string | null
  /** False when its transcript was not found on disk. */
  found: boolean
  /** Its last few messages, oldest first. */
  lines: PeekLine[]
  /** A pending AskUserQuestion's questions and option labels, or the next-step box's question and button labels an idle chat ended its turn with. */
  questions: { question: string; options: string[] }[]
  /** "Permission needed: Bash · npm test", or what it waits for, while it waits and no question is pending; null otherwise. */
  pending: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-alert': {
      /** The chat the Peek pane shows; null when the pane is closed. */
      peek: PeekView | null
    }
  }
}
