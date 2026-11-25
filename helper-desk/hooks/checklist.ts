// The project checklist: the project's TODO.md (To do, In progress, Claimed done, Confirmed done), else the
// `## What the user asked for` list of its RESUME.md; plus RESUME.md's In progress and Waiting on the user bullets.
// Read only: nothing here writes a file.

import type { CheckItem, CheckState, Checklist } from '../types'

export const CHECK_FILE = 'RESUME.md'
export const TODO_FILE = 'TODO.md'
const SECTION = /^##\s+What the user asked for\b/i
// A heading of level 1 or 2 ends the section; a ### inside it does not.
const END = /^#{1,2}\s/
// A top-level markdown checkbox: "- [ ] ", "- [~] ", "- [x] " or "- [X] ".
const ITEM = /^[-*+]\s+\[([ ~xX])\]\s*(.*)$/
// A top-level plain bullet of RESUME.md: "- text" or "* text".
const BULLET = /^[-*]\s+(.*)$/
// The placeholder an empty RESUME.md section holds: "- (none)".
const NONE = /^\(?none\)?\.?$/i
// A leading date, "(2026-11-20) text", "(2026-11-20 night) text" or "2026-11-19 text", and a ":" or dash after it.
const DATE = /^(?:\(\d{4}-\d{2}-\d{2}[^)]*\)|\d{4}-\d{2}-\d{2}\b)\s*(?:[:\-–—]\s+)?/

const MARKS: Record<string, CheckState> = { ' ': 'todo', '~': 'doing', x: 'done', X: 'done' }

// TODO.md's sections; the section, not the mark, decides an item's group (but see stateIn).
const TODO_SECTIONS: { heading: RegExp; state: CheckState }[] = [
  { heading: /^##\s+To[\s-]?do\b/i, state: 'todo' },
  { heading: /^##\s+In progress\b/i, state: 'doing' },
  { heading: /^##\s+Claimed done\b/i, state: 'claimed' },
  { heading: /^##\s+Confirmed done\b/i, state: 'done' },
]
// RESUME.md's sections shown beside the checklist. A heading may come more than once, and may run on: "## In progress (night run)".
const WAITING = /^##\s+Waiting on the user\b/i
const NOW = /^##\s+In progress\b/i

/** The shown text of an item: one line, no leading date. */
export function itemText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().replace(DATE, '').trim()
}

/** Every checkbox item of RESUME.md's requests section, in file order; lines without a checkbox are skipped. */
export function parseChecklist(md: string): CheckItem[] {
  const items: CheckItem[] = []
  let inside = false
  for (const line of md.split(/\r?\n/)) {
    if (!inside) {
      inside = SECTION.test(line)
      continue
    }
    if (END.test(line)) break
    const m = ITEM.exec(line)
    if (!m) continue
    const text = itemText(m[2]!)
    if (text) items.push({ text, state: MARKS[m[1]!]! })
  }
  return items
}

/**
 * An item's group in TODO.md: its section's, except that an [x] still under To do or In progress is Claimed done
 * (Claude ticked it, the user has not confirmed it) and a [~] under To do is In progress.
 */
function stateIn(section: CheckState, mark: string): CheckState {
  const isTicked = mark === 'x' || mark === 'X'
  if (isTicked && (section === 'todo' || section === 'doing')) return 'claimed'
  if (mark === '~' && section === 'todo') return 'doing'
  return section
}

/** Every top-level checkbox item under TODO.md's four sections, in file order; sub-items and other sections are skipped. */
export function parseTodo(md: string): CheckItem[] {
  const items: CheckItem[] = []
  let section: CheckState | null = null
  for (const line of md.split(/\r?\n/)) {
    if (END.test(line)) {
      section = TODO_SECTIONS.find(s => s.heading.test(line))?.state ?? null
      continue
    }
    if (!section) continue
    const m = ITEM.exec(line)
    if (!m) continue
    const text = itemText(m[2]!)
    if (text) items.push({ text, state: stateIn(section, m[1]!) })
  }
  return items
}

/** Every top-level bullet under each section `heading` matches, in file order, dates stripped; "(none)" is skipped. */
export function parseBullets(md: string, heading: RegExp): string[] {
  const texts: string[] = []
  let inside = false
  for (const line of md.split(/\r?\n/)) {
    if (END.test(line)) {
      inside = heading.test(line)
      continue
    }
    if (!inside) continue
    const m = BULLET.exec(line)
    if (!m) continue
    const text = itemText(m[1]!)
    if (text && !NONE.test(text)) texts.push(text)
  }
  return texts
}

/**
 * The checklist from the two files' text (null for a file not found): TODO.md's items, else RESUME.md's requests;
 * and RESUME.md's Waiting on the user and In progress bullets. Null when no group would have an item.
 */
export function buildChecklist(todoMd: string | null, resumeMd: string | null): Checklist | null {
  const list: Checklist = {
    from: todoMd === null ? CHECK_FILE : TODO_FILE,
    items: todoMd !== null ? parseTodo(todoMd) : resumeMd !== null ? parseChecklist(resumeMd) : [],
    waiting: resumeMd === null ? [] : parseBullets(resumeMd, WAITING),
    now: resumeMd === null ? [] : parseBullets(resumeMd, NOW),
  }
  return list.items.length || list.waiting.length || list.now.length ? list : null
}

const parentOf = (dir: string) => {
  const cut = dir.replace(/\/+$/, '').lastIndexOf('/')
  return cut <= 0 ? '/' : dir.slice(0, cut)
}

/**
 * The file `name` (RESUME.md, TODO.md) for a session started in `start`: in that folder, else the nearest one above
 * it, going no higher than the git root (a folder holding `.git`) or `home`. Null when there is none.
 */
export async function findFile(name: string, exists: (path: string) => Promise<boolean>, start: string, home: string): Promise<string | null> {
  let dir = start.replace(/\/+$/, '') || '/'
  const top = home.replace(/\/+$/, '')
  for (;;) {
    const file = `${dir === '/' ? '' : dir}/${name}`
    if (await exists(file)) return file
    if (dir === '/' || dir === top || (await exists(`${dir === '/' ? '' : dir}/.git`))) return null
    dir = parentOf(dir)
  }
}

/** A group of the Checklist tab: RESUME.md's two bullet lists, then the checkbox items by state. */
export type GroupId = 'waiting' | 'now' | CheckState
export type CheckGroup = { id: GroupId; label: string; texts: string[] }

/** Every group, in the order the Checklist tab draws them. */
export const GROUP_ORDER: GroupId[] = ['waiting', 'now', 'doing', 'todo', 'claimed', 'done']

const LABELS: Record<GroupId, string> = {
  waiting: 'Waiting on you',
  now: 'Working on now',
  doing: 'In progress',
  todo: 'To do',
  claimed: 'Done, waiting for your check',
  done: 'Confirmed done',
}

/** The groups that have an item, in GROUP_ORDER. RESUME.md's own done items keep their old label, "Completed". */
export function groupsOf(list: Checklist): CheckGroup[] {
  const textsOf = (id: GroupId) =>
    id === 'waiting' ? list.waiting : id === 'now' ? list.now : list.items.filter(it => it.state === id).map(it => it.text)
  return GROUP_ORDER.map(id => ({
    id,
    label: id === 'done' && list.from === CHECK_FILE ? 'Completed' : LABELS[id],
    texts: textsOf(id),
  })).filter(g => g.texts.length)
}

const isOpen = (s: CheckState) => s === 'doing' || s === 'todo'
const isDone = (s: CheckState) => s === 'claimed' || s === 'done'

/** The items that were open in `before` and are claimed or confirmed done in `after`, matched by text. */
export function ticked(before: CheckItem[], after: CheckItem[]): CheckItem[] {
  const open = new Set(before.filter(it => isOpen(it.state)).map(it => it.text))
  return after.filter(it => isDone(it.state) && open.has(it.text))
}

/** The items that were claimed done in `before` and are confirmed done in `after`, matched by text. */
export function confirmed(before: CheckItem[], after: CheckItem[]): CheckItem[] {
  const claimed = new Set(before.filter(it => it.state === 'claimed').map(it => it.text))
  return after.filter(it => it.state === 'done' && claimed.has(it.text))
}
