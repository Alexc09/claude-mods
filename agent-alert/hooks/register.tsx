// Agent Alert (based on Agent Standup's band) for Claude Code (a mod: Claude Code's function hooks). In the session you are in, a line above the prompt says when another Claude Code session
// on this computer needs you (an approval, an answer), and a toast says when one needs you or has finished its turn. It reads only the status file each session keeps
// in <config dir>/sessions/<pid>.json (written by Claude Code 2.1.221 and later in the terminal, 2.1.269 elsewhere; mods run from 2.1.294) and asks `ps` whether a waiting session's process still runs. Nothing is sent anywhere.
// A desktop-app session's row has a Go button that opens that chat in the Claude desktop app (the claude:// link its Dock menu "Sessions Waiting for You" uses).
// Peek on a row opens a side pane that shows, read-only, the last messages of that chat (from the tail of its transcript) and what it asks you.
// When a chat ends its turn with a question in the desktop app's next-step box (its last turn called mcp__ccd_turn__wrap_up with an `ask`), that chat waits on you too:
// its transcript's tail is read once when it goes busy → idle (and at the first look for each idle one), and kept until its status changes.
import type { EngineInterface, Register } from 'claude-code'
import type { PeekLine, PeekView } from '../types'

// What the band shows, kept in the module and not in $.state: $.state needs a "types" contract in plugin.json, which Claude Code before 2.1.29x refuses in a manifest.
// A reload of the module starts them over, and the next look (every 4 s) fills them again.
type Need = { id: string; where: string; what: string; host?: string; ask?: string }   // the session that waits; its folder, name and app; "an approval", "an answer"; its desktop-app chat id, when it has a valid one; the next-step question it ends its turn with
let needs: readonly Need[] = []
let hidden: ReadonlySet<string> = new Set()   // the waits you put away with "Hide": the band stays away until another one comes; one that ends is forgotten, so the same session asking again shows
const keyOf = (n: Need): string => n.id + ':' + n.what + (n.ask === undefined ? '' : ':' + n.ask)
let shown = ''   // what the band drew at the last look

// Peek: which chat the pane shows is the $.state value (the pane draws it again when it changes); its status file is kept here to read again at each look
const PANE = 'peek'
const PEEK = { plugin: 'agent-alert', key: 'peek' } as const
let projects = ''   // <config dir>/projects, where each chat's transcript is
let seen = new Map<string, Status>()   // the status files of the last look, by session id
let peeked: Status | null = null   // the chat the open pane shows
let peekShown = ''
// The next-step question each idle chat ended its turn with, by session id, read for the status it has now (status and statusUpdatedAt); null when it asked nothing
type Ask = { ask: string; buttons: string[] }
let asked = new Map<string, { at: string; ask: Ask | null }>()

type Status = { pid?: unknown; sessionId?: unknown; status?: unknown; statusUpdatedAt?: unknown; waitingFor?: unknown; cwd?: unknown; name?: unknown; nameSource?: unknown; entrypoint?: unknown; hostSessionId?: unknown }

// "web-shop · release (VS Code)": the folder, the name you gave the session (not the one Claude Code made up), the app it runs in
export const whereOf = (s: Status): string => {
  const cwd = typeof s.cwd === 'string' ? s.cwd : ''
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop() || 'A session'
  const named = typeof s.name === 'string' && s.name && s.nameSource !== 'derived' ? ' · ' + s.name : ''
  const app = s.entrypoint === 'claude-vscode' ? ' (VS Code)' : s.entrypoint === 'claude-desktop' ? ' (desktop app)' : ''
  return folder + named + app
}
// the name you or the app gave the chat (not the one Claude Code made up), else whereOf
export const nameOf = (s: Status): string => (typeof s.name === 'string' && s.name && s.nameSource !== 'derived' ? s.name : whereOf(s))
// the desktop app's id for the chat (local_<uuid>), and nothing for anything else: it is the one part of the link Go opens, so only that shape is let through
export const hostOf = (s: Status): string | undefined =>
  typeof s.hostSessionId === 'string' && /^local_[0-9a-f-]{36}$/i.test(s.hostSessionId) ? s.hostSessionId : undefined
export const linkOf = (host: string): string => 'claude://code/continue?session=' + host + '&source=desktop_action'
export const whatOf = (w: unknown): string => (w === 'permission prompt' ? 'an approval' : w === 'input needed' ? 'an answer' : 'you')
// waiting, and not on a dialog the person opened there themselves (/model, /config…): those say "dialog open"
const waits = (s: Status): boolean => s.status === 'waiting' && s.waitingFor !== 'dialog open'
// what a cached next-step question was read for: the status, and when it was set (a busy stretch missed between two looks still changes it)
const stampOf = (s: Status): string => String(s.status) + ':' + String(s.statusUpdatedAt)
// a session a program started with claude -p (entrypoint sdk-cli): its questions go to that program, and its turns are not yours. An Agent SDK host (sdk-ts, sdk-py: Zed, a home-made app)
// may show its menus to a person, so those are kept (as liveStatus in Agent Standup's server)
const byProgram = (s: Status): boolean => s.entrypoint === 'sdk-cli'

// The processes that still run, of those asked about. A session that crashed leaves its file behind, saying what it was doing then.
const alive = async ($: EngineInterface, pids: readonly number[]): Promise<Set<number>> => {
  if (!pids.length) return new Set()
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['ps', '-o', 'pid=', '-p', pids.join(',')], { timeoutMs: 5000 })
    // ps exits 1 with nothing on stderr when none of them runs. Any other failure is a ps that cannot answer (Git for Windows, BusyBox: no -o): every file is taken at its word
    if (exitCode !== 0 && (exitCode !== 1 || stderr.trim())) return new Set(pids)
    return new Set(stdout.split(/\s+/).filter(Boolean).map(Number))
  } catch {
    return new Set(pids)   // no ps (Windows): every file is taken at its word
  }
}

// A chat's transcript is <config dir>/projects/<slug>/<session id>.jsonl, the slug its folder with every character but a letter or digit as '-' (a slug over 200
// characters is cut and given a hash, so then any project folder holding that file is taken). Only its last 2 MB is read: process.run keeps the first 4 MiB of what tail writes
const TAIL = '2000000'
const transcript = async ($: EngineInterface, s: Status): Promise<string | null> => {
  const id = String(s.sessionId), cwd = typeof s.cwd === 'string' ? s.cwd : ''
  if (!/^[A-Za-z0-9_-]+$/.test(id) || !projects) return null
  const tries: string[][] = [['sh', '-c', 'for f in "$0"/*/"$1".jsonl; do [ -f "$f" ] && exec tail -c ' + TAIL + ' "$f"; done; exit 1', projects, id]]
  if (cwd) tries.unshift(['tail', '-c', TAIL, projects + '/' + cwd.replace(/[^A-Za-z0-9]/g, '-') + '/' + id + '.jsonl'])
  for (const argv of tries) {
    try {
      const { exitCode, stdout } = await $.process.run(argv, { timeoutMs: 5000 })
      if (exitCode === 0) return stdout
    } catch {
      // no tail or sh here: the next try, then not found
    }
  }
  return null
}
const cut = (t: string, n: number): string => ([...t].length > n ? [...t].slice(0, n - 1).join('') + '…' : t)
// a tool call's input, short: its command, file, url or query, else its JSON
const brief = (input: unknown): string => {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const v = ['command', 'file_path', 'path', 'url', 'pattern', 'query', 'description'].map(k => o[k]).find(x => typeof x === 'string' && x)
  return cut(typeof v === 'string' ? v : JSON.stringify(input ?? {}), 120)
}
type Block = { type?: unknown; text?: unknown; name?: unknown; id?: unknown; input?: unknown; tool_use_id?: unknown }
const WRAP_UP = 'mcp__ccd_turn__wrap_up'   // the desktop app's next-step box: { recap, ask?, actions?: [{ label?, action? }], blocked? }
// The chat's last messages as You and Claude lines (text only; tool calls in a row as one line), its last tool call when it has no result yet,
// and the question of its last next-step box when no message of yours came after it
export const readTranscript = (raw: string): { lines: PeekLine[]; open: { name: string; input: unknown } | null; ask: Ask | null } => {
  const lines: PeekLine[] = [], answered = new Set<string>(), uses: { id: string; name: string; input: unknown }[] = []
  let ask: Ask | null = null
  for (const row of raw.split('\n')) {
    let j: { type?: unknown; isMeta?: unknown; isSidechain?: unknown; isCompactSummary?: unknown; message?: { content?: unknown } }
    try {
      j = JSON.parse(row)
    } catch {
      continue   // the cut first line, or not JSON
    }
    if (!j || (j.type !== 'user' && j.type !== 'assistant') || j.isMeta || j.isSidechain || j.isCompactSummary) continue
    const content = j.message?.content
    const blocks: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
    for (const b of blocks) {
      if (!b) continue
      if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') answered.add(b.tool_use_id)
      else if (b.type === 'text' && typeof b.text === 'string') {
        const t = b.text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
        if (t && !/^<[a-z][a-z-]*>/.test(t)) {   // a tag first: a command's echo, a task notification
          lines.push({ who: j.type === 'user' ? 'You' : 'Claude', text: cut(t, 300) })
          if (j.type === 'user') ask = null   // you wrote after it
        }
      } else if (b.type === 'tool_use' && j.type === 'assistant' && typeof b.name === 'string') {
        uses.push({ id: String(b.id), name: b.name, input: b.input })
        if (b.name === WRAP_UP) {
          const o = (b.input && typeof b.input === 'object' ? b.input : {}) as { ask?: unknown; actions?: unknown }
          const buttons = Array.isArray(o.actions) ? o.actions.map((a: { label?: unknown; action?: unknown }) => String(a?.label || a?.action || '')).filter(Boolean) : []
          ask = typeof o.ask === 'string' && o.ask.trim() ? { ask: o.ask.trim(), buttons } : null   // a recap alone asks nothing
        }
        const last = lines[lines.length - 1]
        if (last?.who !== 'tool') lines.push({ who: 'tool', text: b.name })
        else if (!last.text.split(', ').includes(b.name)) last.text += ', ' + b.name
      }
    }
  }
  const lastUse = uses[uses.length - 1], open = lastUse && !answered.has(lastUse.id) ? lastUse : undefined   // its last tool call, while it has no result: what it waits on
  return { lines: lines.slice(-8), open: open ? { name: open.name, input: open.input } : null, ask }
}
const viewOf = async ($: EngineInterface, s: Status): Promise<PeekView> => {
  const id = String(s.sessionId), name = nameOf(s)
  const raw = await transcript($, s)
  const { lines, open, ask } = raw === null ? { lines: [], open: null, ask: null } : readTranscript(raw)
  const asks = s.status === 'idle' ? ask : null
  const header = name + (waits(s) ? ' · waiting for you: needs ' + whatOf(s.waitingFor) : s.status === 'busy' ? ' · working' : asks ? ' · waiting for you: asks' : ' · idle')
  let questions: PeekView['questions'] = asks ? [{ question: asks.ask, options: asks.buttons }] : [], pending: string | null = null
  if (waits(s)) {
    const qs = open?.name === 'AskUserQuestion' ? (open.input as { questions?: unknown } | null)?.questions : undefined
    if (Array.isArray(qs) && qs.length) {
      questions = qs.map((q: { question?: unknown; options?: unknown }) => ({
        question: String(q?.question ?? ''),
        options: Array.isArray(q?.options) ? q.options.map((o: { label?: unknown }) => String(o?.label ?? '')) : [],
      }))
    } else if (s.waitingFor === 'permission prompt' && open) pending = 'Permission needed: ' + open.name + ' · ' + brief(open.input)
    else pending = 'Waiting for: ' + String(s.waitingFor ?? 'you')
  }
  return { id, title: 'Peek: ' + name, header, host: hostOf(s) ?? null, found: raw !== null, lines, questions, pending }
}
// Peek: the pane shows that chat; pressed on another row, it switches to it
const peek = async ($: EngineInterface, id: string): Promise<void> => {
  const s = seen.get(id)
  if (!s) return
  peeked = s
  const view = await viewOf($, s)
  peekShown = JSON.stringify(view)
  await $.state.set(PEEK, view)
  await $.ui.open({ id: PANE, title: view.title })
}

// Go: macOS `open` hands the link to the desktop app, which shows that chat
const go = async ($: EngineInterface, host: string): Promise<void> => {
  try {
    const { exitCode, stderr } = await $.process.run(['open', linkOf(host)], { timeoutMs: 5000 })
    if (exitCode !== 0) $.ui.toast(`Couldn't open that chat: ${stderr.trim() || 'open exited with ' + exitCode}`)
  } catch (err) {
    $.ui.toast(`Couldn't open that chat: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || ((await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '') + '/.claude'
    const dir = config.replace(/[\\/]+$/, '') + '/sessions'
    projects = config.replace(/[\\/]+$/, '') + '/projects'
    let before = new Map<string, string>()   // session id → what it was doing at the last look; nothing is announced at the first look
    let first = true
    let looks = 0, applied = 0   // looks overlap when ps is slow: one that ends after a newer one has been applied is dropped, so the band never goes back in time

    const look = async () => {
      const mine = ++looks
      const self = await $.session.id()   // read at every look: /clear and resume go on under another id, and no session.start fires for it
      let names: string[] = []
      try {
        names = (await $.fs.list(dir)).filter(f => f.kind === 'file' && /^\d+\.json$/.test(f.name)).map(f => f.name)
      } catch {
        names = []   // no such folder: a Claude Code that writes no status, or none has run yet
      }
      const rows: Status[] = []
      for (const n of names) {
        try {
          const s = JSON.parse(await $.fs.read(dir + '/' + n)) as Status
          if (s && typeof s.sessionId === 'string' && s.sessionId !== self && !byProgram(s)) rows.push(s)
        } catch {
          // a file being written, or not one of Claude Code's: skipped
        }
      }
      // an idle chat's next-step question: its transcript is read when it went busy → idle, at the first look, or when its status changed since it was read; else the one read is kept
      const fresh = new Map<string, Ask | null>()
      for (const s of rows) {
        const id = String(s.sessionId), c = asked.get(id)
        if (s.status !== 'idle' || (c ? c.at === stampOf(s) : !first && before.get(id) !== 'busy')) continue
        const raw = await transcript($, s)
        fresh.set(id, raw === null ? null : readTranscript(raw).ask)
      }
      const askOf = (s: Status): Ask | null => {
        const id = String(s.sessionId)
        return s.status !== 'idle' ? null : fresh.has(id) ? fresh.get(id) ?? null : asked.get(id)?.ask ?? null
      }
      const pids = rows.filter(s => waits(s) || askOf(s)).map(s => Number(s.pid)).filter((p, i, all) => Number.isInteger(p) && p > 0 && all.indexOf(p) === i)
      const live = await alive($, pids)
      if (mine < applied) return
      applied = mine
      seen = new Map(rows.map(s => [String(s.sessionId), s]))
      const kept = new Map<string, { at: string; ask: Ask | null }>()   // only idle chats keep theirs: one that goes busy (you answered) or goes away is forgotten
      for (const s of rows) {
        const id = String(s.sessionId), c = asked.get(id)
        if (fresh.has(id)) kept.set(id, { at: stampOf(s), ask: fresh.get(id) ?? null })
        else if (c && s.status === 'idle') kept.set(id, c)
      }
      asked = kept
      const list: Need[] = rows
        .filter(s => (waits(s) || askOf(s)) && live.has(Number(s.pid)))
        .map(s => {
          const a = askOf(s)
          return a ? { id: String(s.sessionId), where: whereOf(s), what: 'asks', host: hostOf(s), ask: a.ask } : { id: String(s.sessionId), where: whereOf(s), what: whatOf(s.waitingFor), host: hostOf(s) }
        })
      const now = new Map(rows.map(s => [String(s.sessionId), waits(s) ? 'waiting' : String(s.status)]))
      const keys = new Set(list.map(keyOf))
      if ([...hidden].some(k => !keys.has(k))) hidden = new Set([...hidden].filter(k => keys.has(k)))
      needs = list
      const draw = JSON.stringify(list)
      if (draw !== shown) {
        shown = draw
        $.ui.invalidate('ui.render')
      }

      if (!first) {
        for (const s of rows) {
          const was = before.get(String(s.sessionId)), is = now.get(String(s.sessionId))
          if (is === 'waiting' && was !== 'waiting' && live.has(Number(s.pid))) $.ui.toast(`✋ ${nameOf(s)} is waiting for you: needs ${whatOf(s.waitingFor)}`)
          else if (is === 'idle' && was === 'busy') {
            const a = askOf(s)
            $.ui.toast(a ? `✋ ${nameOf(s)} asks: ${a.ask}` : `✓ ${nameOf(s)} finished. Nothing waiting, reply when you like.`)
          }
        }
      }
      before = now
      first = false

      if (peeked) {   // the open pane follows its chat
        const s = seen.get(String(peeked.sessionId)) ?? peeked
        peeked = s
        const view = await viewOf($, s)
        if (peeked === s && JSON.stringify(view) !== peekShown) {
          peekShown = JSON.stringify(view)
          await $.state.set(PEEK, view)
        }
      }
    }

    await look().catch(() => undefined)
    $.clock.every(4000, () => {
      look().catch(() => undefined)
    })
    return started
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = needs
    if (e.props.hasSurvey || !list.map(keyOf).some(k => !hidden.has(k))) return next(e)
    const below = await next(e)   // what the other mods and the engine draw there stays, under the band
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {list.slice(0, 3).map(n => {
          const host = n.host
          return (
            <Box key={n.id} flexDirection="row" gap={1}>
              {n.ask !== undefined ? (
                <Text wrap="truncate-end">
                  ✋ {n.where} <Text dimColor>asks:</Text> {n.ask}
                </Text>
              ) : (
                <Text wrap="truncate-end">
                  ✋ {n.where} <Text dimColor>needs {n.what}</Text>
                </Text>
              )}
              {host ? <Button key={'go-' + n.id} label="Go" plain onPress={() => go($, host)} /> : null}
              <Button key={'peek-' + n.id} label="Peek" plain onPress={() => peek($, n.id)} />
            </Box>
          )
        })}
        {list.length > 3 ? <Text dimColor>and {list.length - 3} more</Text> : null}
        <Box flexDirection="row" gap={1}>
          <Text dimColor>Agent Alert</Text>
          <Button
            key="hide"
            label="Hide"
            plain
            onPress={() => {
              hidden = new Set(list.map(keyOf))
              $.ui.invalidate('ui.render')
            }}
          />
        </Box>
        {below}
      </Box>
    )
  })

  // the Peek pane: read-only; Go to answer opens a desktop-app chat, nothing is sent from here
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { value: v = null } = await $.state.get(PEEK)
    if (!v) return <Text dimColor>Press Peek on a row of the band to see that chat here.</Text>
    const host = v.host
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{v.header}</Text>
        {v.found ? (
          <Box flexDirection="column">
            {v.lines.map((l, i) =>
              l.who === 'tool' ? (
                <Text key={'line-' + i} dimColor>
                  · used {l.text}
                </Text>
              ) : (
                <Text key={'line-' + i}>
                  <Text bold>{l.who}:</Text> {l.text}
                </Text>
              ),
            )}
          </Box>
        ) : (
          <Text dimColor>Couldn't find this chat's conversation on disk.</Text>
        )}
        {v.questions.map((q, i) => (
          <Box key={'question-' + i} flexDirection="column">
            <Text bold>{q.question}</Text>
            {q.options.map((o, k) => (
              <Text key={'option-' + i + '-' + k}>○ {o}</Text>
            ))}
          </Box>
        ))}
        {v.pending ? <Text>{v.pending}</Text> : null}
        {host ? <Button key="peek-go" label="Go to answer" onPress={() => go($, host)} /> : <Text dimColor>Terminal chat: switch to its terminal to answer</Text>}
      </Box>
    )
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const r = await next(e)
    peeked = null
    peekShown = ''
    await $.state.set(PEEK, null).catch(() => undefined)
    return r
  })
}
