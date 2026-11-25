#!/usr/bin/env python3
"""Cost scanner: what Claude Code use cost at API prices, read-only over ~/.claude/projects.

Run as `python3 -I scan.py --data <plugin data folder>`. Prints one JSON summary on stdout.

Default mode: "this week" is the last plan reset (RESET_WEEKDAY at RESET_HOUR_UTC, below) to now,
"last week" the full week before it. Only log files changed inside those two weeks are opened.
A cache in --data keeps, per file, how far it was read, and the per-call records of the two
weeks; a refresh reads only the new bytes. A lock file keeps two chats from scanning at once.

Test mode: --since/--until (ISO) total one range with no cache.

A task is one message the person typed in a main chat plus everything it caused until their
next typed message: the chat's own calls and every helper run an Agent call in that span started
(helpers of helpers too). Calls before a chat's first typed message belong to no task.

Privacy: the cache and the output hold only excerpts, secrets replaced: the first 10 words and the
first 2,000 characters of each typed message, chat titles, and the first 8 words of a helper's task label.
"""
import argparse, fcntl, glob, hashlib, json, os, re, sys, time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

BASE = os.path.expanduser("~/.claude/projects")
CACHE_VERSION = 3

# When the weekly plan week starts: a weekday (0 = Monday ... 5 = Saturday, 6 = Sunday) and an hour in UTC.
# Set these to your own plan's weekly reset, shown in Claude's usage settings.
RESET_WEEKDAY = 5
RESET_HOUR_UTC = 10
# The time zone days and times are shown in, in hours ahead of UTC (1 for UTC+1, -5 for UTC-5).
# None uses this computer's own time zone.
DISPLAY_UTC_OFFSET_HOURS = None


def tz_offset(ts):
    """Seconds ahead of UTC for the shown time zone at `ts`."""
    if DISPLAY_UTC_OFFSET_HOURS is not None:
        return int(DISPLAY_UTC_OFFSET_HOURS * 3600)
    return time.localtime(ts).tm_gmtoff


def tz_name(ts):
    """"UTC+1", "UTC-5", "UTC+5:30" for the shown time zone at `ts`."""
    off = tz_offset(ts)
    sign = "+" if off >= 0 else "-"
    h, m = divmod(abs(off) // 60, 60)
    return f"UTC{sign}{h}" + (f":{m:02d}" if m else "")


def shown(ts, fmt):
    """`ts` formatted in the shown time zone."""
    return time.strftime(fmt, time.gmtime(ts + tz_offset(ts)))

# --- Prices and the typed-message reader (prices checked against ccusage 2026-11-23) ---
# USD per million tokens, from platform.claude.com/docs/en/about-claude/pricing (read 2026-11-23)
# (input, 5m cache write, 1h cache write, cache read, output)
PRICES = {
    "fable-5-2": (8, 10, 16, 0.20, 40), "mythos-5-2": (8, 10, 16, 0.20, 40),
    "fable-5-1": (10, 12.5, 20, 0.25, 50), "fable-5": (10, 12.5, 20, 1, 50),
    "opus-5-5": (4, 5, 8, 0.20, 20), "opus-5": (5, 6.25, 10, 0.50, 25),
    "opus-4-8": (5, 6.25, 10, 0.5, 25), "opus-4-7": (5, 6.25, 10, 0.5, 25),
    "opus-4-6": (5, 6.25, 10, 0.5, 25), "opus-4-5": (5, 6.25, 10, 0.5, 25),
    "opus-4-1": (15, 18.75, 30, 1.5, 75), "opus-4": (15, 18.75, 30, 1.5, 75),
    "sonnet-5-5": (2, 2.5, 4, 0.10, 10), "sonnet-5": (2, 2.5, 4, 0.20, 10),
    "sonnet-4-6": (3, 3.75, 6, 0.3, 15), "sonnet-4-5": (3, 3.75, 6, 0.3, 15),
    "sonnet-4": (3, 3.75, 6, 0.3, 15),
    "haiku-5-5": (0.10, 0.125, 0.20, 0.01, 0.50),       # prompts <= 100k tokens
    "haiku-5-5-long": (0.50, 0.625, 1.0, 0.05, 2.50),   # prompts > 100k tokens
    "haiku-4-5": (1, 1.25, 2, 0.1, 5),
}
FAST = {"fable-5-2": (16, 80), "opus-5-5": (8, 40), "opus-5": (10, 50), "opus-4-8": (10, 50)}


def family(model):
    m = re.sub(r"^claude-", "", model or "")
    m = re.sub(r"-\d{8}$", "", m).replace("[1m]", "")
    for k in sorted(PRICES, key=len, reverse=True):
        if k != "haiku-5-5-long" and m.startswith(k):
            return k
    return m or "unknown"


def call_cost(fam, u, fast):
    inp = u.get("input_tokens") or 0
    out = u.get("output_tokens") or 0
    cr = u.get("cache_read_input_tokens") or 0
    cc = u.get("cache_creation") or {}
    c1h = cc.get("ephemeral_1h_input_tokens") or 0
    c5m = cc.get("ephemeral_5m_input_tokens")
    if c5m is None:
        c5m = (u.get("cache_creation_input_tokens") or 0) - c1h
    key = fam
    if fam == "haiku-5-5" and inp + cr + c5m + c1h > 100_000:
        key = "haiku-5-5-long"
    p = PRICES.get(key)
    if not p:
        return None
    pi, p5, p1, pr, po = p
    if fast and fam in FAST:  # fast mode premium on input/output (stacks with cache multipliers)
        mult = FAST[fam][0] / pi
        pi, p5, p1, pr, po = pi * mult, p5 * mult, p1 * mult, pr * mult, FAST[fam][1]
    return (inp * pi + c5m * p5 + c1h * p1 + cr * pr + out * po) / 1e6


SECRET = re.compile(
    r"(sk-[A-Za-z0-9_\-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9\-]{10,}"
    r"|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-.]+|[A-Za-z0-9_\-]{32,}|[\w.+-]+@[\w-]+\.[\w.]+)"
)
TAG = re.compile(r"<[^>]{1,80}>")
CDATA = re.compile(r"<!\[CDATA\[|\]\]>")


def typed_text(msg):
    """Text the person typed (not tool results). Returns None for tool-result turns."""
    c = msg.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in c):
            return None
        return "\n".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
    return None


def excerpt(text, n):
    words = TAG.sub(" ", CDATA.sub(" ", text)).split()
    out = SECRET.sub("[hidden]", " ".join(words[:n]))
    return out + ("…" if len(words) > n else "")


FULL_CHARS = 2000


def full_text(text):
    """The typed message for the expanded task row: tags gone, secrets hidden, line breaks kept,
    cut at FULL_CHARS characters."""
    lines = [" ".join(ln.split()) for ln in TAG.sub(" ", CDATA.sub(" ", text)).splitlines()]
    out = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    out = SECRET.sub("[hidden]", out)  # before the cut, so no part of a secret is left
    return out[:FULL_CHARS].rstrip() + f"…(cut at {FULL_CHARS:,} characters)" if len(out) > FULL_CHARS else out


# Messages in the person's role that they did not type: they never start a task.
NOT_TYPED = ("<local-command", "<command-", "<task-notification", "<side-sessions-event",
             "<ci-monitor-event", "<system-reminder", "<!-- reply", "[Request interrupted",
             "Another Claude session sent a message", "This session is being continued", "<teammate-message",
             "<open_design", "<![CDATA[", "<scheduled-task", "Caveat:")


def is_typed(t):
    return bool(t.strip()) and not t.lstrip().startswith(NOT_TYPED)


def project_name(cwd):
    return os.path.basename(cwd.rstrip("/")) if cwd else ""


def parse_ts(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def last_reset(now):
    """Most recent RESET_WEEKDAY at RESET_HOUR_UTC:00 UTC at or before `now` (epoch seconds)."""
    d = datetime.fromtimestamp(now, timezone.utc)
    sat = (d - timedelta(days=(d.weekday() - RESET_WEEKDAY) % 7)).replace(hour=RESET_HOUR_UTC, minute=0, second=0, microsecond=0)
    if sat.timestamp() > now:
        sat -= timedelta(days=7)
    return sat.timestamp()


A_MARK = b'"type":"assistant"'
U_MARK = b'"type":"user"'
USAGE = b'"usage"'
TOOL_RESULT = b'"type":"tool_result"'
TOOL_USE = b'"type":"tool_use"'
TITLE_MARKS = (b'"type":"custom-title"', b'"type":"ai-title"')
AGENT_TOOLS = ("Agent", "Task")


class Store:
    """The cache's tables: files read, sessions, tasks, helper runs, the tool calls that start them,
    and per-call records."""

    def __init__(self, raw=None):
        raw = raw if raw and raw.get("v") == CACHE_VERSION else {}
        self.files = raw.get("files", {})        # path -> [inode, offset, task key the file is in]
        self.sessions = raw.get("sessions", {})  # sid -> [project, date, custom title, ai title, main chat's cwd]
        self.tasks = raw.get("tasks", {})        # task key -> [sid, ts, first 10 words, first 2,000 characters]
        self.agents = raw.get("agents", {})      # sid/agent-x -> [type, label, toolUseId]
        self.tools = raw.get("tools", {})        # Agent tool_use id -> [sid, agent ("" = main), task key]
        self.recs = raw.get("recs", [])          # [ts, key, sid, agent ("" = main), is_sub, family, effort, cost, task]
        self.seen = {r[1] for r in self.recs}
        self.unpriced = set(raw.get("unpriced", []))

    def dump(self):
        return {"v": CACHE_VERSION, "files": self.files, "sessions": self.sessions, "tasks": self.tasks,
                "agents": self.agents, "tools": self.tools, "recs": self.recs, "unpriced": sorted(self.unpriced)}

    def drop_file(self, sid, agent):
        keep = [r for r in self.recs if not (r[2] == sid and r[3] == agent)]
        self.seen = {r[1] for r in keep}
        self.recs = keep


def file_ids(path):
    """(session id, agent id or '') for a main log or a helper log."""
    rel = os.path.relpath(path, BASE).split(os.sep)
    name = os.path.basename(path)[:-6]
    if len(rel) == 2:
        return name, ""
    return rel[1], name


def read_meta(path):
    try:
        with open(path[:-6] + ".meta.json") as fh:
            meta = json.load(fh)
    except Exception:
        meta = {}
    label = excerpt(meta.get("description") or "", 8)
    return [meta.get("agentType") or "helper", label, meta.get("toolUseId") or ""]


def session_row(store, sid):
    row = store.sessions.get(sid) or ["", "", "", "", ""]
    row += [""] * (5 - len(row))  # rows cached before the cwd was kept
    store.sessions[sid] = row
    return row


def note_cwd(row, d, main):
    """Keep the chat's project name, and its main chat's full working folder (a helper may run elsewhere)."""
    cwd = d.get("cwd") or ""
    row[0] = row[0] or project_name(cwd)
    if main and cwd and not row[4]:
        row[4] = cwd


def scan_file(path, start, task, lo, hi, store):
    """Read `path` from byte `start`; add records with lo <= ts < hi.
    `task` is the task the file was in at `start`. Returns (new offset, task at the new offset)."""
    sid, agent = file_ids(path)
    main = agent == ""
    if agent and sid + "/" + agent not in store.agents:
        store.agents[sid + "/" + agent] = read_meta(path)
    offset = start
    with open(path, "rb") as fh:
        fh.seek(start)
        for line in fh:
            if not line.endswith(b"\n"):
                break  # a line still being written: read it next time
            offset += len(line)
            is_a = A_MARK in line and USAGE in line
            is_u = main and not is_a and U_MARK in line and TOOL_RESULT not in line
            is_t = main and not is_a and not is_u and (TITLE_MARKS[0] in line or TITLE_MARKS[1] in line)
            if not (is_a or is_u or is_t):
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            t = d.get("type")
            if t == "custom-title" and d.get("customTitle"):
                session_row(store, sid)[2] = excerpt(d["customTitle"], 12)
            elif t == "ai-title" and d.get("aiTitle"):
                session_row(store, sid)[3] = excerpt(d["aiTitle"], 12)
            elif t == "user" and is_u:
                if d.get("isMeta") or d.get("isSidechain") or d.get("isCompactSummary"):
                    continue
                txt = typed_text(d.get("message") or {})
                if not txt or not is_typed(txt):
                    continue
                ts = parse_ts(d.get("timestamp") or "") or 0
                # The same typed message copied into a resumed session's new file gets the same key.
                task = hashlib.blake2b(f"{d.get('timestamp')}|{txt[:200]}".encode(), digest_size=8).hexdigest()
                if task not in store.tasks:
                    store.tasks[task] = [sid, round(ts), excerpt(txt, 10), full_text(txt)]
                row = session_row(store, sid)
                note_cwd(row, d, main)
                row[1] = row[1] or day_label(ts)
            elif t == "assistant":
                m = d.get("message") or {}
                if TOOL_USE in line:
                    for b in m.get("content") or []:
                        if (isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") in AGENT_TOOLS
                                and b.get("id") and b["id"] not in store.tools):
                            store.tools[b["id"]] = [sid, agent, task if main else ""]
                u = m.get("usage")
                model = m.get("model")
                if not u or not model or model == "<synthetic>":
                    continue
                ts = parse_ts(d.get("timestamp") or "")
                if ts is None:
                    continue
                row = session_row(store, sid)
                note_cwd(row, d, main)
                row[1] = row[1] or day_label(ts)
                if not (lo <= ts < hi):
                    continue
                key = hashlib.blake2b(f"{m.get('id')}|{d.get('requestId')}".encode(), digest_size=8).hexdigest()
                if key in store.seen:
                    continue
                fam = family(model)
                cost = call_cost(fam, u, u.get("speed") == "fast")
                if cost is None:
                    store.unpriced.add(fam)
                    cost = 0.0
                eff = d.get("effort") or d.get("perTurnEffort")
                eff = eff if isinstance(eff, str) else ""
                is_sub = 1 if (agent or d.get("isSidechain")) else 0
                store.seen.add(key)
                store.recs.append([round(ts), key, sid, agent, is_sub, fam, eff, round(cost, 6), task if main else ""])
    return offset, task


def day_label(ts):
    return time.strftime("%-d %b", time.localtime(ts)) if ts else ""


def when_label(ts):
    """Weekday, date and time in the shown time zone (DISPLAY_UTC_OFFSET_HOURS)."""
    return shown(ts, "%a %-d %b, %H:%M") + f" ({tz_name(ts)})" if ts else ""


def log_files(since_mtime):
    """Every main and helper log changed since `since_mtime`, oldest first."""
    paths = glob.glob(os.path.join(BASE, "*", "*.jsonl"))
    paths += glob.glob(os.path.join(BASE, "*", "*", "**", "agent-*.jsonl"), recursive=True)
    out = []
    for p in paths:
        try:
            st = os.stat(p)
        except OSError:
            continue
        if st.st_mtime >= since_mtime:
            out.append((st.st_mtime, p, st))
    out.sort()
    return [(p, st) for _, p, st in out]


def scan_into(store, lo, hi, use_offsets):
    read_bytes = 0
    opened = 0
    for path, st in log_files(lo):
        sid, agent = file_ids(path)
        start, task = 0, ""
        if use_offsets:
            ino, off, cur = store.files.get(path) or [None, 0, ""]
            if ino == st.st_ino and off <= st.st_size:
                start, task = off, cur
            elif ino is not None:
                store.drop_file(sid, agent)  # replaced or shrank: read it again from the top
            if start == st.st_size:
                continue
        opened += 1
        try:
            end, task = scan_file(path, start, task, lo, hi, store)
        except OSError:
            continue
        read_bytes += end - start
        store.files[path] = [st.st_ino, end, task]
    return opened, read_bytes


MODEL_NAME = {"fable": "Fable", "mythos": "Mythos", "opus": "Opus", "sonnet": "Sonnet", "haiku": "Haiku"}
MODEL_ORDER = ["Opus", "Fable", "Mythos", "Sonnet", "Haiku"]


def model_word(fam):
    return MODEL_NAME.get(fam.split("-")[0], fam)


def task_resolver(store, this):
    """A function from a helper run (sid, agent) to the task key that started it, or ''.

    Linked by the run's meta toolUseId to the Agent call that started it: in the main chat, that
    call's task; in another helper, that helper's task. A run with no such link (workflow helpers)
    goes to the task its chat was in when the run made its first call."""
    first_ts = {}
    for r in this:
        if r[3]:
            k = (r[2], r[3])
            first_ts[k] = min(first_ts.get(k, r[0]), r[0])
    by_sid = defaultdict(list)
    for key, (sid, ts, *_) in store.tasks.items():
        by_sid[sid].append((ts, key))
    for v in by_sid.values():
        v.sort()
    memo = {}

    def by_time(sid, ts):
        best = ""
        for t, key in by_sid.get(sid, []):
            if t > ts:
                break
            best = key
        return best

    def resolve(sid, agent, depth=0):
        k = (sid, agent)
        if k in memo:
            return memo[k]
        out = ""
        meta = store.agents.get(sid + "/" + agent)
        tool = store.tools.get(meta[2]) if meta and len(meta) > 2 and meta[2] else None
        if tool and depth < 10:
            out = tool[2] if not tool[1] else resolve(tool[0], tool[1], depth + 1)
        if not out and k in first_ts:
            out = by_time(sid, first_ts[k])
        memo[k] = out
        return out

    return resolve


def hourly(recs, lo, now, detail):
    """Per calendar day (the Mac's local time), the cost of each of its 24 hours, for the days from
    `lo` to `now` that have calls, and `now`'s day always. An hour before `lo` or after `now` is None:
    outside the records kept, or still to come. `details` holds `detail(records, cost)` for each
    hour with a cost, None for the others."""
    sums = defaultdict(float)
    by_hour = defaultdict(list)
    for r in recs:
        d = datetime.fromtimestamp(r[0])
        sums[(d.date(), d.hour)] += r[7]
        by_hour[(d.date(), d.hour)].append(r)
    used = {k[0] for k in sums}
    first, last = datetime.fromtimestamp(lo).date(), datetime.fromtimestamp(now).date()
    out = []
    day = first
    while day <= last:
        if day in used or day == last:
            hours = []
            for h in range(24):
                start = datetime(day.year, day.month, day.day, h).timestamp()
                hours.append(round(sums.get((day, h), 0.0), 2) if start + 3600 > lo and start <= now else None)
            out.append({"date": day.isoformat(), "label": f"{day:%a} {day.day} {day:%b}",
                        "cost": round(sum(sums.get((day, h), 0.0) for h in range(24)), 2), "hours": hours,
                        "details": [detail(by_hour[(day, h)], c) if c else None for h, c in enumerate(hours)]})
        day += timedelta(days=1)
    return out


TASK_RUNS = 5  # helper runs listed under an expanded task
BAR_TYPES = 3  # helper types on a bar's hover card
BAR_TASK_WORDS = 8  # words of the costliest task's message on a bar's hover card


def run_kinds(store, recs):
    """(sid, agent) of each helper run -> (type, model word, effort): the run's most used model and effort."""
    models, efforts = defaultdict(Counter), defaultdict(Counter)
    for r in recs:
        if r[4]:
            models[(r[2], r[3])][r[5]] += 1
            if r[6]:
                efforts[(r[2], r[3])][r[6]] += 1
    out = {}
    for (sid, agent), m in models.items():
        typ = (store.agents.get(sid + "/" + agent) or ["main chat side task" if not agent else "helper"])[0]
        eff = efforts[(sid, agent)].most_common(1)[0][0] if efforts[(sid, agent)] else ""
        out[(sid, agent)] = (typ, model_word(m.most_common(1)[0][0]), eff)
    return out


def bar_detail(store, kinds, resolve):
    """A function from one bar's records and its rounded cost to what its hover card shows: main chats
    vs helpers (adding up to the cost), helper runs, the top helper types, and the costliest task."""

    def detail(rs, cost):
        helpers = round(sum(r[7] for r in rs if r[4]), 2)
        groups = defaultdict(lambda: {"runs": set(), "cost": 0.0})
        tasks = defaultdict(float)
        for r in rs:
            if r[4]:
                g = groups[kinds.get((r[2], r[3]), ("helper", "", ""))]
                g["runs"].add((r[2], r[3]))
                g["cost"] += r[7]
            task = resolve(r[2], r[3]) if r[3] else r[8]
            if task and task in store.tasks:
                tasks[task] += r[7]
        top = sorted(groups.items(), key=lambda kv: -kv[1]["cost"])[:BAR_TYPES]
        task = max(tasks.items(), key=lambda kv: kv[1], default=None)
        text = ""
        if task:
            row = store.tasks[task[0]]
            text = excerpt(row[3] if len(row) > 3 and row[3] else row[2], BAR_TASK_WORDS)
        return {"main": round(cost - helpers, 2), "helpers": helpers,
                "runs": len({(r[2], r[3]) for r in rs if r[4]}),
                "types": [{"type": t, "model": m, "effort": e, "runs": len(g["runs"]), "cost": round(g["cost"], 2)}
                          for (t, m, e), g in top],
                "task": {"cost": round(task[1], 2), "text": text} if task else None}

    return detail


def chat_title(store, sid):
    row = store.sessions.get(sid) or ["", "", "", ""]
    return (row[2] if len(row) > 2 else "") or (row[3] if len(row) > 3 else "") or "Untitled chat"


def backfill_cwds(store):
    """Sessions cached before the full working folder was kept: read it from the top of the chat's log."""
    need = {r[2] for r in store.recs} - {k for k, v in store.sessions.items() if len(v) > 4 and v[4]}
    if not need:
        return
    logs = {}
    for path in store.files:
        sid, agent = file_ids(path)
        if sid in need and (not agent or sid not in logs):
            logs[sid] = path  # the main log wins over a helper's
    for sid, path in logs.items():
        try:
            with open(path, "rb") as fh:
                for _, line in zip(range(500), fh):
                    if b'"cwd"' in line:
                        cwd = json.loads(line).get("cwd") or ""
                        if cwd:
                            session_row(store, sid)[4] = cwd
                            break
        except (OSError, ValueError):
            continue


def rec_cwd(store):
    """A function from a call record to its project: the working folder of the chat it belongs to.
    A helper's calls belong to the chat that started it."""
    def cwd_of(r):
        row = store.sessions.get(r[2])
        return row[4] if row and len(row) > 4 else ""

    return cwd_of


def project_list(store, lo, prev_lo):
    """Every project with calls this week or last week, costliest this week first: its working folder,
    a short label (the last folder name, with its parent when two share it), and both weeks' cost."""
    cwd_of = rec_cwd(store)
    this, last = defaultdict(float), defaultdict(float)
    for r in store.recs:
        if r[0] >= lo:
            this[cwd_of(r)] += r[7]
        elif prev_lo is not None and r[0] >= prev_lo:
            last[cwd_of(r)] += r[7]
    cwds = set(this) | set(last)
    short = lambda c, n: "/".join(c.rstrip("/").split("/")[-n:]) if c else "(no folder)"
    # The last folder name; where two share it, the parent too; where that clashes still, the whole path.
    one, two = Counter(short(c, 1) for c in cwds), Counter(short(c, 2) for c in cwds)
    labels = {c: short(c, 1) if one[short(c, 1)] == 1 else short(c, 2) if two[short(c, 2)] == 1 else c or short(c, 1)
              for c in cwds}
    rows = [{"cwd": c, "label": labels[c], "cost": round(this[c], 2), "lastCost": round(last[c], 2)} for c in cwds]
    return sorted(rows, key=lambda x: (-x["cost"], -x["lastCost"], x["label"]))


def keep_project(store, cwd):
    """Keep only the calls of one project (helpers count toward the chat that started them)."""
    cwd_of = rec_cwd(store)
    store.recs = [r for r in store.recs if cwd_of(r) == cwd]
    store.seen = {r[1] for r in store.recs}


def summarise(store, lo, hi, prev_lo=None, now=None):
    this = [r for r in store.recs if lo <= r[0] < hi]
    last = [r for r in store.recs if prev_lo is not None and prev_lo <= r[0] < lo]
    last_total = sum(r[7] for r in last)
    total = sum(r[7] for r in this)
    helpers = sum(r[7] for r in this if r[4])
    main = total - helpers
    share = lambda x: round(100 * x / total, 1) if total else 0.0
    now = hi if now is None else now

    # Days run midnight to midnight in the shown time zone, except the reset day, which a reset that is not at
    # midnight splits in two: the week opens with reset-24:00 and closes with 00:00-reset, so it has 8 bars.
    to_midnight = (86400 - (lo + tz_offset(lo)) % 86400) % 86400
    if to_midnight:
        edges = [lo] + [lo + to_midnight + k * 86400 for k in range(7)] + [lo + 7 * 86400]
    else:  # a reset at midnight: seven whole days
        edges = [lo + k * 86400 for k in range(8)]
    reset_at = shown(lo, "%-I%p").lower()  # "9am"
    detail = bar_detail(store, run_kinds(store, last + this), task_resolver(store, last + this))
    days = []
    for i in range(len(edges) - 1):
        a, b = edges[i], edges[i + 1]
        rs = [r for r in this if a <= r[0] < b]
        cost = round(sum(r[7] for r in rs), 2)
        days.append({"label": shown(a, "%a"), "date": shown(a, "%a %-d %b"), "lastDate": shown(a - 7 * 86400, "%a %-d %b"),
                     "sub": "" if not to_midnight else f"from {reset_at}" if i == 0
                     else f"to {reset_at}" if i == len(edges) - 2 else "",
                     "cost": cost, "detail": detail(rs, cost) if cost else None,
                     "last": round(sum(r[7] for r in last if a - 7 * 86400 <= r[0] < b - 7 * 86400), 2)
                     if prev_lo is not None else 0.0,
                     "isFuture": a > now})
    same_time = sum(r[7] for r in last if r[0] < now - 7 * 86400)

    models = defaultdict(float)
    for r in this:
        models[model_word(r[5])] += r[7]
    by_model = sorted(({"model": m, "cost": round(c, 2), "share": share(c)} for m, c in models.items()),
                      key=lambda x: (MODEL_ORDER.index(x["model"]) if x["model"] in MODEL_ORDER else 99, -x["cost"]))

    resolve = task_resolver(store, this)
    runs = defaultdict(lambda: {"cost": 0.0, "models": Counter(), "efforts": Counter(), "first": 0})
    tasks = defaultdict(lambda: {"cost": 0.0, "helpers": defaultdict(float)})
    outside = 0.0
    for r in this:
        task = resolve(r[2], r[3]) if r[3] else r[8]
        if task and task in store.tasks:
            tasks[task]["cost"] += r[7]
            if r[3]:
                tasks[task]["helpers"][(r[2], r[3])] += r[7]
        else:
            outside += r[7]
        if r[4]:
            run = runs[(r[2], r[3])]
            run["cost"] += r[7]
            run["models"][r[5]] += 1
            if r[6]:
                run["efforts"][r[6]] += 1
            run["first"] = run["first"] or r[0]

    groups = defaultdict(lambda: {"runs": 0, "cost": 0.0})
    top_runs = []
    run_info = {}
    for (sid, agent), run in runs.items():
        typ, label = (store.agents.get(sid + "/" + agent) or ["main chat side task" if not agent else "helper", ""])[:2]
        fam = run["models"].most_common(1)[0][0]
        eff = run["efforts"].most_common(1)[0][0] if run["efforts"] else ""
        g = groups[(typ, model_word(fam), eff)]
        g["runs"] += 1
        g["cost"] += run["cost"]
        run_info[(sid, agent)] = {"type": typ, "model": model_word(fam), "effort": eff, "label": label}
        top_runs.append({"cost": round(run["cost"], 2), "type": typ, "model": model_word(fam), "effort": eff,
                         "label": label, "date": day_label(run["first"]), "title": chat_title(store, sid)})
    by_type = sorted(({"type": t, "model": m, "effort": e, "runs": g["runs"], "cost": round(g["cost"], 2)}
                      for (t, m, e), g in groups.items()), key=lambda x: -x["cost"])[:15]
    top_runs = sorted(top_runs, key=lambda x: -x["cost"])[:15]
    top_tasks = []
    for key, tk in sorted(tasks.items(), key=lambda kv: -kv[1]["cost"])[:15]:
        sid, ts, text = store.tasks[key][:3]
        full = store.tasks[key][3] if len(store.tasks[key]) > 3 else text
        proj = (store.sessions.get(sid) or [""])[0]
        by_cost = sorted(tk["helpers"].items(), key=lambda kv: -kv[1])
        helper_cost = sum(c for _, c in by_cost)
        more = by_cost[TASK_RUNS:]
        top_tasks.append({
            "id": key, "cost": round(tk["cost"], 2), "title": chat_title(store, sid), "project": proj or "?",
            "date": when_label(ts), "text": text, "fullText": full, "helpers": len(by_cost),
            "main": round(tk["cost"] - helper_cost, 2), "helperCost": round(helper_cost, 2),
            "helperRuns": [{**run_info.get(k, {"type": "helper", "model": "", "effort": "", "label": ""}),
                            "cost": round(c, 2)} for k, c in by_cost[:TASK_RUNS]],
            "moreRuns": len(more), "moreCost": round(sum(c for _, c in more), 2)})
    return {
        "ok": True,
        "thisWeek": {"start": lo, "end": hi, "cost": round(total, 2), "calls": len(this)},
        "lastWeek": None if prev_lo is None else {"start": prev_lo, "end": lo, "cost": round(last_total, 2),
                                                  "sameTime": round(same_time, 2)},
        "split": {"main": {"cost": round(main, 2), "share": share(main)},
                  "helpers": {"cost": round(helpers, 2), "share": share(helpers), "runs": len(runs)}},
        "days": days, "byModel": by_model,
        "hourly": hourly(last + this, lo if prev_lo is None else prev_lo, min(now, hi - 1), detail),
        "byType": by_type, "topTasks": top_tasks, "topRuns": top_runs,
        "tasksTotal": round(sum(t["cost"] for t in tasks.values()), 2), "outsideTasks": round(outside, 2),
        "unpriced": sorted(store.unpriced),
    }


def pick_project(store, projects, cwd):
    """Filter the store to `cwd` when it is a project with use in either week; returns its list row, or
    None (all projects) when none was asked for or it has no use left."""
    row = next((p for p in projects if p["cwd"] == cwd), None) if cwd is not None else None
    if row:
        keep_project(store, cwd)
    return row


def labels(lo, nxt):
    since = time.strftime("%a %H:%M", time.localtime(lo))
    resets = time.strftime("%a %-d %b, %H:%M", time.localtime(nxt))
    return since, resets


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", help="plugin data folder for the cache and lock")
    ap.add_argument("--since")
    ap.add_argument("--until")
    ap.add_argument("--project", help="a project's working folder: every figure counts only its calls")
    a = ap.parse_args()
    t0 = time.time()
    now = time.time()

    if a.since:
        lo = datetime.fromisoformat(a.since).timestamp()
        hi = datetime.fromisoformat(a.until).timestamp() if a.until else now
        store = Store()
        opened, read_bytes = scan_into(store, lo, hi, use_offsets=False)
        projects = project_list(store, lo, None)
        project = pick_project(store, projects, a.project)
        out = summarise(store, lo, hi)
    else:
        if not a.data:
            raise SystemExit("--data is required without --since")
        os.makedirs(a.data, exist_ok=True)
        lock = open(os.path.join(a.data, "scan.lock"), "w")
        fcntl.flock(lock, fcntl.LOCK_EX)  # another chat's scan finishes first; ours is then quick
        cache_path = os.path.join(a.data, "cache.json")
        try:
            with open(cache_path) as fh:
                raw = json.load(fh)
        except Exception:
            raw = None
        store = Store(raw)
        lo = last_reset(now)
        prev_lo = lo - 7 * 86400
        store.recs = [r for r in store.recs if r[0] >= prev_lo]  # the week before last is gone
        store.seen = {r[1] for r in store.recs}
        opened, read_bytes = scan_into(store, prev_lo, now + 86400, use_offsets=True)
        used = {r[2] for r in store.recs}
        store.files = {p: v for p, v in store.files.items() if os.path.exists(p)}
        current = {v[2] for v in store.files.values() if len(v) > 2 and v[2]}
        store.tasks = {k: v for k, v in store.tasks.items() if v[0] in used or k in current}
        store.tools = {k: v for k, v in store.tools.items() if v[0] in used}
        keep = used | {v[0] for v in store.tasks.values()}
        store.sessions = {k: v for k, v in store.sessions.items() if k in keep}
        store.agents = {k: v for k, v in store.agents.items() if k.split("/")[0] in used}
        backfill_cwds(store)
        tmp = cache_path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(store.dump(), fh, separators=(",", ":"))
        os.replace(tmp, cache_path)
        projects = project_list(store, lo, prev_lo)
        project = pick_project(store, projects, a.project)  # after the save: the cache keeps every project
        out = summarise(store, lo, now + 86400, prev_lo, now)
        out["thisWeek"]["end"] = now
        out["sinceLabel"], out["resetLabel"] = labels(lo, lo + 7 * 86400)
        out["nextReset"] = lo + 7 * 86400
    out["projects"] = projects
    out["project"] = project
    out["generatedAt"] = now
    out["filesRead"] = opened
    out["bytesRead"] = read_bytes
    out["seconds"] = round(time.time() - t0, 2)
    print(json.dumps(out))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as err:  # the pane shows the real reason
        print(json.dumps({"ok": False, "error": f"{type(err).__name__}: {err}"}))
        sys.exit(1)
