#!/usr/bin/env python3
"""Reads the live Claude Code setup on this Mac and prints one JSON `Inventory`
(see hooks/inventory-types.ts). With --write-setup-md it also keeps the
auto-generated section of SETUP.md current.

Read-only except for that one section. Stdlib only, no network, spawns nothing.
Never prints env values, prompt bodies, full hook command lines or MCP URLs, and
every shown string passes through `clean` (secret filter + home shortened to ~).
A file that cannot be read becomes one sentence in `problems`; the script always
exits 0 with valid JSON.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import re
import sys
import tempfile
import time

# Minutes ahead of UTC that cron fields and shown times use: this computer's time zone.
# Set a fixed number (for example -5 * 60 for UTC-5) to use another one.
TZ_OFFSET_MIN = time.localtime().tm_gmtoff // 60
NOTE_MAX_CHARS = 220
HANDLES_MAX_CHARS = 200
# Your own local marketplace of mods (~/.claude/mods/.claude-plugin/marketplace.json), shown in the
# Mods card. Other plugins go in the Plugins card. Without that folder the Mods card is empty.
MY_MODS = 'my-mods'
SECTION_START = '<!-- auto-inventory:start -->'
SECTION_END = '<!-- auto-inventory:end -->'
SECTION_HEADING = '## Live inventory (auto-generated)'
SECTION_INTRO = ('Written by the setup-pane mod from the live config; do not edit by hand. '
                 'Plain-word descriptions live in the sections above.')
NOT_DESCRIBED = 'not described above yet'
# A heading in ~/.claude/CLAUDE.md whose bullets say when to use each agent; the Agents tab shows the bullet
# that names an agent. Without that heading the rule column stays empty.
RULE_HEADING = 'Agents'
APP_SESSIONS_DIR = 'Library/Application Support/Claude/claude-code-sessions'
HOOKS_PATH_LABEL = '~/.claude/settings.json › hooks'
SCRIPT_EXTENSIONS = 'sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl'

# ---------------------------------------------------------------- cleaning

_SECRET_RULES = [
    (re.compile(r'(?i)\bbearer\s+[^\s"\']+'), '[hidden]'),
    (re.compile(r'\b(?:sk|pk|rk)-[A-Za-z0-9_\-]{8,}'), '[hidden]'),
    (re.compile(r'\b(?:ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abprs])[-_][A-Za-z0-9_\-]{8,}'), '[hidden]'),
    (re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{12,}'), '[hidden]'),
    (re.compile(r'\bAIza[A-Za-z0-9_\-]{20,}'), '[hidden]'),
    (re.compile(r'://[^/\s:@]+:[^/\s@]+@'), '://[hidden]@'),
    (re.compile(r'(?i)\b([\w-]*(?:key|token|secret|password|passwd|auth))(\s*=\s*|:(?=\S))[^\s&"\',;]+'),
     r'\1\2[hidden]'),
    (re.compile(r'\b[0-9a-fA-F]{32,}\b'), '[hidden]'),
]
_LONG_RUN = re.compile(r'[A-Za-z0-9+_\-=]{24,}')


def _hide_long_run(match: re.Match) -> str:
    run = match.group(0)
    looks_random = re.search(r'\d', run) and re.search(r'[A-Za-z]', run)
    return '[hidden]' if looks_random else run


def hide_secrets(text: str) -> str:
    for pattern, replacement in _SECRET_RULES:
        text = pattern.sub(replacement, text)
    return _LONG_RUN.sub(_hide_long_run, text)


class Cleaner:
    def __init__(self, home: str):
        self.home = home.rstrip('/')

    def tilde(self, path: str) -> str:
        if self.home and (path == self.home or path.startswith(self.home + '/')):
            return '~' + path[len(self.home):]
        return path

    def __call__(self, text: str) -> str:
        text = str(text or '')
        if self.home:
            text = text.replace(self.home + '/', '~/')
        return re.sub(r'\s+', ' ', hide_secrets(text)).strip()


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    head = text[:limit]
    sentence_end = head.rfind('. ')
    if sentence_end >= limit // 2:
        return head[:sentence_end + 1]
    return head[:head.rfind(' ', 0, limit - 1)].rstrip(' ,;:') + '…'


def strip_markdown(text: str) -> str:
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
    return re.sub(r'\s+', ' ', text.replace('**', '').replace('`', '')).strip()

# ---------------------------------------------------------------- reading files


class Reader:
    """Reads files under the chosen home; every failure becomes one sentence in `problems`."""

    def __init__(self, home: str):
        self.home = home
        self.clean = Cleaner(home)
        self.problems: list[str] = []

    def path(self, *parts: str) -> str:
        return os.path.join(self.home, *parts)

    def problem(self, sentence: str) -> None:
        self.problems.append(self.clean(sentence))

    def text(self, path: str, required: bool = False) -> str | None:
        try:
            with open(path, encoding='utf-8') as handle:
                return handle.read()
        except FileNotFoundError:
            if required:
                self.problem(f'Could not find {self.clean.tilde(path)}.')
        except (OSError, UnicodeDecodeError) as err:
            self.problem(f'Could not read {self.clean.tilde(path)} ({type(err).__name__}).')
        return None

    def json(self, path: str, required: bool = False):
        raw = self.text(path, required)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError as err:
            self.problem(f'Could not read {self.clean.tilde(path)}: it is not valid JSON (line {err.lineno}).')
            return None


def as_dict(value) -> dict:
    return value if isinstance(value, dict) else {}


def unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
        inner = value[1:-1]
        return inner.replace('\\"', '"') if value[0] == '"' else inner.replace("''", "'")
    return value


def parse_frontmatter(text: str) -> dict:
    """The simple `key: value` pairs of a YAML frontmatter, including `>`/`|` blocks."""
    found = re.match(r'^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|$)', text or '', re.S)
    if not found:
        return {}
    lines = found.group(1).splitlines()
    fields: dict[str, str] = {}
    index = 0
    while index < len(lines):
        pair = re.match(r'^([A-Za-z_][\w-]*):\s*(.*)$', lines[index])
        index += 1
        if not pair:
            continue
        key, value = pair.group(1), pair.group(2).strip()
        if value == '' or re.fullmatch(r'[>|][-+]?', value):
            block = []
            while index < len(lines) and (lines[index][:1] in (' ', '\t') or not lines[index].strip()):
                block.append(lines[index].strip())
                index += 1
            joiner = '\n' if value.startswith('|') else ' '
            value = joiner.join(part for part in block if part).strip()
        else:
            value = unquote(value)
        fields[key] = value
    return fields

# ---------------------------------------------------------------- SETUP.md matching


class SetupMd:
    """Finds where hand-written SETUP.md text mentions an item, ignoring the auto section."""

    def __init__(self, text: str | None):
        self.blocks = self._blocks(remove_section(text or ''))

    @staticmethod
    def _blocks(text: str) -> list[tuple[str, str]]:
        blocks: list[tuple[str, str]] = []  # (kind, text): kind is bullet, para, table or heading
        current: list[str] = []
        kind = 'para'

        def flush():
            if current:
                blocks.append((kind, ' '.join(current)))
            current.clear()

        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                flush()
            elif stripped.startswith(('|', '#')):
                flush()
                blocks.append(('table' if stripped.startswith('|') else 'heading', stripped))
            elif re.match(r'^[-*]\s+', stripped):
                flush()
                kind = 'bullet'
                current.append(re.sub(r'^[-*]\s+', '', stripped))
            else:
                if not current:
                    kind = 'para'
                current.append(stripped)
        flush()
        return blocks

    @staticmethod
    def _marked(name: str) -> str:
        escaped = re.escape(name)
        return rf'(?:`{escaped}`|\*\*{escaped}\*\*)'

    @staticmethod
    def _word(name: str) -> str:
        return rf'(?<![\w\-/.~@:]){re.escape(name)}(?![\w\-/@])(?!\.\w)'

    def mentions(self, names: list[str], marked_only: bool = False, loose: list[str] = ()) -> bool:
        for _, text in self.blocks:
            for name in names:
                if re.search(self._marked(name), text):
                    return True
                if not marked_only and re.search(self._word(name), text):
                    return True
            for name in loose:
                if re.search(self._word(name), text, re.I):
                    return True
        return False

    def note(self, names: list[str], marked_only: bool = False, loose: list[str] = ()) -> str:
        patterns = [self._marked(n) if marked_only else rf'(?:{self._marked(n)}|{self._word(n)})' for n in names]
        patterns += [rf'(?i:{self._word(n)})' for n in loose]
        for finder in (self._note_at_start, self._note_in_brackets):
            for pattern in patterns:
                for kind, text in self.blocks:
                    if kind in ('table', 'heading'):
                        continue
                    found = finder(pattern, text)
                    if found:
                        return found
        return ''

    @staticmethod
    def _note_at_start(pattern: str, text: str) -> str:
        start = re.match(pattern, text)
        if not start:
            return ''
        rest = text[start.end():]
        rest = re.sub(r'^(?:\s*\([^()]*(?:\([^()]*\)[^()]*)*\))+', '', rest).lstrip()
        if rest[:1] in (':', ',', '—', '–'):
            return strip_markdown(rest[1:])
        return strip_markdown(text)

    @staticmethod
    def _note_in_brackets(pattern: str, text: str) -> str:
        chained = r'(?:\s+and\s+(?:`[^`]+`|\*\*[^*]+\*\*))?'  # "`a` and `b` (both ...)", not longer lists
        bracket = r'\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)'
        for found in re.finditer(pattern + chained + bracket, text):
            inside = strip_markdown(found.group(1))
            if len(inside.split()) >= 5:
                return inside
        return ''


def remove_section(text: str) -> str:
    start, end = text.find(SECTION_START), text.find(SECTION_END)
    if start != -1 and end > start:
        return text[:start] + text[end + len(SECTION_END):]
    return text

# ---------------------------------------------------------------- items


class Builder:
    def __init__(self, reader: Reader, setup: SetupMd):
        self.reader = reader
        self.clean = reader.clean
        self.setup = setup

    def item(self, name, is_on, detail, own_note, path, rule='', match_names=None,
             marked_only=False, loose=(), extra=None, prefer_own_note=False) -> dict:
        names = [n for n in (match_names or [name]) if n]
        is_described = self.setup.mentions(names, marked_only, list(loose))
        use_setup_note = is_described and not (prefer_own_note and own_note)
        setup_note = self.setup.note(names, marked_only, list(loose)) if use_setup_note else ''
        built = {
            'name': self.clean(name),
            'isOn': bool(is_on),
            'detail': self.clean(detail),
            'note': truncate(self.clean(setup_note or own_note), NOTE_MAX_CHARS),
            'isInSetupMd': is_described,
            'path': self.clean(self.clean.tilde(path)) if path else '',
            'rule': self.clean(rule),
        }
        for key, value in (extra or {}).items():
            built['_' + key] = self.clean(value) if isinstance(value, str) else value
        return built


def join_detail(*parts: str) -> str:
    return ' · '.join(part for part in parts if part)

# ---------------------------------------------------------------- mods and plugins


def read_mods(b: Builder, settings: dict) -> list[dict]:
    r = b.reader
    base = r.path('.claude', 'mods')
    market = as_dict(r.json(os.path.join(base, '.claude-plugin', 'marketplace.json')))
    switches = as_dict(r.json(os.path.join(base, 'switches.json')))
    enabled = as_dict(settings.get('enabledPlugins'))
    listed = [as_dict(p) for p in market.get('plugins') or []]
    names = [p.get('name', '') for p in listed if p.get('name')]
    on_disk = sorted(os.path.basename(os.path.dirname(os.path.dirname(f)))
                     for f in glob.glob(os.path.join(base, 'plugins', '*', '.claude-plugin', 'plugin.json')))
    by_name = {p.get('name'): p for p in listed}
    items = []
    for name in names + [n for n in on_disk if n not in names]:
        folder = os.path.join(base, 'plugins', name)
        manifest = as_dict(r.json(os.path.join(folder, '.claude-plugin', 'plugin.json')))
        listing = as_dict(by_name.get(name))
        key = f'{name}@{MY_MODS}'
        is_switched_off = switches.get(name) is False
        is_hidden = switches.get(f'{name}:hidden') is True
        is_on = enabled.get(key) is True and not is_switched_off
        detail = join_detail(
            str(manifest.get('version') or listing.get('version') or ''),
            f'not in the {MY_MODS} marketplace' if name not in names else '',
            'off in settings' if enabled.get(key) is False else ('not installed' if key not in enabled else ''),
            'switched off in switches.json' if is_switched_off else '',
            'hidden in every chat' if is_hidden else '')
        own = manifest.get('description') or listing.get('description') or ''
        items.append(b.item(name, is_on, detail, own, folder))
    return items


def project_enables(r: Reader, project: str, key: str) -> bool:
    for file_name in ('settings.local.json', 'settings.json'):
        try:
            with open(os.path.join(project, '.claude', file_name), encoding='utf-8') as handle:
                value = as_dict(json.load(handle)).get('enabledPlugins', {}).get(key)
        except (OSError, ValueError, AttributeError):
            continue  # another project's settings are optional: missing or odd means "not turned on"
        if value is not None:
            return value is True
    return False


def read_plugins(b: Builder, settings: dict) -> tuple[list[dict], dict]:
    """Other installed plugins, plus {plugin name: (is_on, install path)} for the MCP reader."""
    r = b.reader
    installed = as_dict(r.json(r.path('.claude', 'plugins', 'installed_plugins.json'), required=True))
    enabled = as_dict(settings.get('enabledPlugins'))
    items, installs = [], {}
    for key, entries in sorted(as_dict(installed.get('plugins')).items()):
        name, _, market = key.partition('@')
        entry = as_dict((entries or [{}])[0] if isinstance(entries, list) else {})
        install_path = str(entry.get('installPath') or '')
        project = str(entry.get('projectPath') or '')
        is_on = project_enables(r, project, key) if entry.get('scope') == 'local' and project \
            else enabled.get(key) is True
        installs[name] = (is_on, install_path)
        if market == MY_MODS:
            continue
        manifest = as_dict(r.json(os.path.join(install_path, '.claude-plugin', 'plugin.json'))) if install_path else {}
        detail = join_detail(market, str(entry.get('version') or ''),
                             f'project {b.clean.tilde(project)}' if project else '')
        items.append(b.item(name, is_on, detail, manifest.get('description', ''), install_path))
    return items, installs

# ---------------------------------------------------------------- agents and skills

MODEL_LABELS = {'haiku': 'Haiku', 'sonnet': 'Sonnet', 'opus': 'Opus', 'fable': 'Fable',
                'inherit': 'same model as the main chat'}


def read_rules(r: Reader) -> list[str]:
    """The bullets under RULE_HEADING in ~/.claude/CLAUDE.md, markdown stripped."""
    text = r.text(r.path('.claude', 'CLAUDE.md')) or ''
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines) if RULE_HEADING in line), None)
    if start is None:
        return []
    indent = len(lines[start]) - len(lines[start].lstrip())
    rules = []
    for line in lines[start + 1:]:
        depth = len(line) - len(line.lstrip())
        if not line.strip() or depth <= indent:
            break
        rules.append(re.sub(r'^[-*]\s+', '', line.strip()))
    return rules


def rule_for(name: str, rules: list[str]) -> str:
    for rule in rules:
        if f'`{name}`' in rule:
            return strip_markdown(rule)
    for rule in rules:
        if re.search(SetupMd._word(name), rule):
            return strip_markdown(rule)
    return ''


def unset_effort(model: str, settings: dict) -> str:
    """What effort an agent file with no `effort:` line runs at (code.claude.com/docs/en/sub-agents, "Choose an
    effort level"): on the main chat's model it uses the main chat's level; on another model that level does not
    apply and the model's own default does, which is medium for Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5
    (docs/en/model-config, "Default effort per model")."""
    family = model.lower()
    main = str(settings.get('model') or '').lower()
    if family and family != 'inherit' and family not in main:
        return 'medium effort (the model\'s own default)'
    saved = ''
    for model_id, conf in as_dict(settings.get('modelSettings')).items():
        if main and main in str(model_id).lower():
            saved = str(as_dict(conf).get('effortLevel') or '')
    return f'same effort as the main chat ({saved} in your settings)' if saved else 'same effort as the main chat'


def read_agents(b: Builder, settings: dict) -> list[dict]:
    r = b.reader
    rules = read_rules(r)
    items = []
    for path in sorted(glob.glob(r.path('.claude', 'agents', '*.md')), key=lambda p: p.lower()):
        fields = parse_frontmatter(r.text(path) or '')
        name = fields.get('name') or os.path.splitext(os.path.basename(path))[0]
        model = fields.get('model', '')
        model_label = MODEL_LABELS.get(model.lower(), model) if model else 'default model'
        effort_label = f"{fields['effort']} effort" if fields.get('effort') else unset_effort(model, settings)
        description = fields.get('description', '')
        items.append(b.item(name, True, join_detail(model_label, effort_label), description, path,
                            rule=rule_for(name, rules), prefer_own_note=True,
                            extra={'model': model_label, 'effort': effort_label, 'handles': description}))
    return items


def skill_source(lock_entry: dict, linked: str, tilde) -> str:
    """Where a skill came from, in words short enough to pass the pane's secret filter (no long paths)."""
    if '.app/' in linked:  # the files in use now are the app's own copy, whatever the installer once fetched
        app = linked.split('.app/')[0].rsplit('/', 1)[-1]
        return f'comes with the {app} app'
    source = str(lock_entry.get('source') or '')
    if lock_entry.get('sourceType') == 'github' and source.count('/') == 1:
        owner, repo = source.split('/')
        return f'installed from GitHub: {repo} by {owner}'
    if source:
        return f'installed from {source}'
    if linked:
        return f'linked from {tilde(os.path.dirname(linked))}'
    return ''


def read_skills(b: Builder, settings: dict) -> list[dict]:
    r = b.reader
    overrides = as_dict(settings.get('skillOverrides'))
    # Skills added with the `skills` installer: name -> {source: 'owner/repo', sourceType: 'github', ...}.
    installed = as_dict(as_dict(r.json(r.path('.agents', '.skill-lock.json'))).get('skills'))
    items = []
    for folder_name, is_folder_on in (('skills', True), ('skills-off', False)):
        base = r.path('.claude', folder_name)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base), key=str.lower):
            folder = os.path.join(base, name)
            skill_file = os.path.join(folder, 'SKILL.md')
            if not os.path.isfile(skill_file):
                continue
            fields = parse_frontmatter(r.text(skill_file) or '')
            override = overrides.get(name)
            is_on = is_folder_on and override != 'off'
            linked = os.path.realpath(folder) if os.path.islink(folder) else ''
            detail = join_detail(
                '' if is_folder_on else 'in skills-off',
                'turned off in settings (skillOverrides)' if override == 'off' else '',
                'name only in the skill list' if override == 'name-only' else '',
                skill_source(as_dict(installed.get(name)), linked, b.clean.tilde))
            items.append(b.item(name, is_on, detail, fields.get('description', ''), folder))
    return items

# ---------------------------------------------------------------- MCP servers


def transport(server: dict) -> str:
    if server.get('type'):
        return str(server['type'])
    return 'stdio' if server.get('command') else ('http' if server.get('url') else 'unknown')


def read_mcp(b: Builder, installs: dict) -> list[dict]:
    r = b.reader
    claude_json = as_dict(r.json(r.path('.claude.json'), required=True))
    needs_sign_in = set(as_dict(r.json(r.path('.claude', 'mcp-needs-auth-cache.json'))).keys())
    needs_sign_in |= {str(n) for n in claude_json.get('mcpNeedsAuthNoticed') or []}
    items = []

    def add(name, server, scope, path, is_on=True, auth_key=None):
        needs = (auth_key or name) in needs_sign_in
        detail = join_detail(scope, transport(as_dict(server)), 'needs sign-in' if needs else '')
        items.append(b.item(name, is_on and not needs, detail, '', path,
                            extra={'scope': scope, 'transport': transport(as_dict(server)), 'needsSignIn': needs}))

    for name, server in as_dict(claude_json.get('mcpServers')).items():
        add(name, server, 'user', '~/.claude.json')
    for project, data in sorted(as_dict(claude_json.get('projects')).items()):
        for name, server in as_dict(as_dict(data).get('mcpServers')).items():
            add(name, server, f'project {b.clean.tilde(project)}', '~/.claude.json › projects')
    for plugin, (is_on, install_path) in sorted(installs.items()):
        if not is_on or not install_path:
            continue
        for name, server in plugin_servers(r, install_path).items():
            add(name, server, f'plugin {plugin}', install_path, auth_key=f'plugin:{plugin}:{name}')
    for path in sorted(glob.glob(r.path('.claude', 'mcp-off', '*.json'))):
        server = as_dict(r.json(path))
        add(os.path.splitext(os.path.basename(path))[0], server, 'turned off (~/.claude/mcp-off)', path, is_on=False)
    connectors = [str(n) for n in claude_json.get('claudeAiMcpEverConnected') or []]
    for label in connectors:
        name = label.removeprefix('claude.ai ').strip()
        items.append(b.item(name, True, 'claude.ai connector · connected before', '', '',
                            match_names=[name, label], extra={'scope': 'claude.ai connector', 'transport': ''}))
    if connectors:
        r.problem('claude.ai connectors are listed from the record in ~/.claude.json of ones connected before; '
                  'whether each one is connected right now is not stored on disk.')
    return items


def plugin_servers(r: Reader, install_path: str) -> dict:
    found = as_dict(r.json(os.path.join(install_path, '.mcp.json')))
    servers = as_dict(found.get('mcpServers')) if 'mcpServers' in found else found
    manifest = as_dict(r.json(os.path.join(install_path, '.claude-plugin', 'plugin.json')))
    servers = {**{k: v for k, v in servers.items() if isinstance(v, dict)}}
    servers.update({k: v for k, v in as_dict(manifest.get('mcpServers')).items() if isinstance(v, dict)})
    return servers

# ---------------------------------------------------------------- hooks and settings

_SCRIPT_RE = re.compile(rf'(["\']?)(\S*?/)?([\w.\-]+\.(?:{SCRIPT_EXTENSIONS}))(?![\w])')


def hook_file(command: str) -> tuple[str, str]:
    """(the command's file name, the tool folder it lives in, e.g. `mytool` for ~/.mytool/...)."""
    scripts = _SCRIPT_RE.findall(command)
    if scripts:
        _, folder, file_name = scripts[-1]
        tool = next((part[1:] for part in folder.replace('"', '').split('/')
                     if part.startswith('.') and part not in ('.', '..', '.claude')), '')
        return file_name, tool
    first = command.strip().split()[0] if command.strip() else ''
    if '/' in first:
        return os.path.basename(first.strip('"\'')), ''
    return 'inline shell command', ''


def read_hooks(b: Builder, settings: dict) -> list[dict]:
    items = []
    for event, groups in as_dict(settings.get('hooks')).items():
        for group in groups if isinstance(groups, list) else []:
            matcher = str(as_dict(group).get('matcher') or '')
            for hook in as_dict(group).get('hooks') or []:
                hook = as_dict(hook)
                command = str(hook.get('command') or hook.get('url') or '')
                file_name, tool = hook_file(command) if hook.get('type', 'command') == 'command' \
                    else (f"{hook.get('type')} hook", '')
                own = f'Runs {file_name} on {event}' + (f' (matcher {matcher})' if matcher else '') + '.'
                # A script hook is matched by its file name (and tool folder); only an inline one by its event.
                is_script = '.' in file_name
                names = [file_name, os.path.splitext(file_name)[0]] if is_script else [event]
                items.append(b.item(event, True, file_name, own, HOOKS_PATH_LABEL, match_names=names,
                                    loose=[tool] if tool else (), extra={'matcher': matcher}))
    return items


SETTING_NOTES = {
    'model': 'The model new chats start with.',
    'effortLevel': 'How much thinking effort the model uses by default.',
    'permissions.defaultMode': 'The permission mode new chats start in.',
    'outputStyle': 'How Claude formats and explains its replies.',
    'statusLine': 'The script that draws the status line.',
    'modelSettings': 'Settings for one model only.',
    'autoUpdatesChannel': 'Which release channel Claude Code updates from.',
    'attribution': 'Text Claude adds to commits and pull requests.',
}
CORE_SETTINGS = ('model', 'effortLevel', 'permissions.defaultMode', 'outputStyle', 'statusLine')
SKIPPED_SETTINGS = {'env', 'hooks', 'permissions', 'enabledPlugins', 'extraKnownMarketplaces', 'skillOverrides',
                    'autoMode', 'statusLine', 'modelSettings', 'attribution', 'model', 'effortLevel', 'outputStyle'}
SECRET_SETTING = re.compile(r'(?i)key|token|secret|password|helper|credential|header|url|env|export')


def setting_value(value) -> str:
    if isinstance(value, bool):
        return 'on' if value else 'off'
    if isinstance(value, dict):
        return ', '.join(f'{k}: {setting_value(v)}' for k, v in value.items()
                         if isinstance(v, (str, int, float, bool)) and not SECRET_SETTING.search(k))
    return str(value)


def read_settings(b: Builder, settings: dict) -> list[dict]:
    path = '~/.claude/settings.json'
    status = as_dict(settings.get('statusLine'))
    core = {
        'model': settings.get('model') or 'not set (Claude Code default)',
        'effortLevel': settings.get('effortLevel') or 'not set (default)',
        'permissions.defaultMode': as_dict(settings.get('permissions')).get('defaultMode') or 'not set (default)',
        'outputStyle': settings.get('outputStyle') or 'not set (default)',
        'statusLine': hook_file(str(status.get('command') or ''))[0] if status else 'not set',
    }
    items = [b.item(key, True, str(core[key]), SETTING_NOTES[key], path, marked_only=True) for key in CORE_SETTINGS]
    for model, values in as_dict(settings.get('modelSettings')).items():
        parts = [f'{v} effort' if k == 'effortLevel' else
                 f'auto-compact at {v:,} tokens' if k == 'autoCompactWindow' and isinstance(v, int) else
                 f'{k}: {setting_value(v)}' for k, v in as_dict(values).items() if not SECRET_SETTING.search(k)]
        items.append(b.item(f'modelSettings › {model}', True, ', '.join(parts), SETTING_NOTES['modelSettings'],
                            path, match_names=['modelSettings'], marked_only=True))
    if 'attribution' in settings:
        texts = as_dict(settings['attribution'])
        has_text = any(str(v).strip() for v in texts.values())
        detail = 'custom text' if has_text else 'off (nothing added to commits or PRs)'
        items.append(b.item('attribution', has_text, detail, SETTING_NOTES['attribution'], path, marked_only=True))
    for key, value in settings.items():
        if key in SKIPPED_SETTINGS or SECRET_SETTING.search(key) or isinstance(value, list):
            continue
        if isinstance(value, dict) and not setting_value(value):
            continue
        is_on = value is not False and not (isinstance(value, dict) and value.get('enabled') is False)
        items.append(b.item(key, is_on, setting_value(value), SETTING_NOTES.get(key, ''), path, marked_only=True))
    return items

# ---------------------------------------------------------------- cron (same rules as hooks/cron.ts)

DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
CRON_NAMES = {n: i for i, n in enumerate(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])}
CRON_NAMES.update({n: i + 1 for i, n in enumerate(m.lower() for m in MONTH_SHORT)})
MINUTE_MS, DAY_MS, HOUR_MS = 60_000, 86_400_000, 3_600_000


def _cron_number(text: str) -> int:
    if text.lower() in CRON_NAMES:
        return CRON_NAMES[text.lower()]
    if not text.isdigit():
        raise ValueError(f'"{text}" is not a number')
    return int(text)


def _cron_field(text: str, low: int, high: int) -> tuple[list[int], bool]:
    values = set()
    for part in text.split(','):
        span, _, step_text = part.partition('/')
        step = _cron_number(step_text) if step_text else 1
        start, end = low, high
        if span != '*':
            first, _, last = span.partition('-')
            start = _cron_number(first)
            end = _cron_number(last) if last else (start if not step_text else high)
        if step < 1 or start < low or end > high or start > end:
            raise ValueError(f'"{part}" is out of range')
        values.update(range(start, end + 1, step))
    return sorted(values), text == '*'


def parse_cron(expr: str) -> dict:
    parts = expr.split()
    if len(parts) != 5:
        raise ValueError(f'"{expr}" does not have 5 fields')
    return {'minute': _cron_field(parts[0], 0, 59), 'hour': _cron_field(parts[1], 0, 23),
            'dom': _cron_field(parts[2], 1, 31), 'month': _cron_field(parts[3], 1, 12),
            'dow': _cron_field(re.sub(r'\b7\b', '0', parts[4]), 0, 6)}


def _day_matches(cron: dict, date: dt.datetime) -> bool:
    if date.month not in cron['month'][0]:
        return False
    is_dom = date.day in cron['dom'][0]
    is_dow = (date.weekday() + 1) % 7 in cron['dow'][0]
    if not cron['dom'][1] and not cron['dow'][1]:
        return is_dom or is_dow
    return is_dom and is_dow


def next_cron_run(expr: str, after_ms: int, offset_min: int = TZ_OFFSET_MIN) -> int | None:
    try:
        cron = parse_cron(expr)
    except ValueError:
        return None
    shift = offset_min * MINUTE_MS
    start = (after_ms + shift) // MINUTE_MS * MINUTE_MS + MINUTE_MS
    start_day = start // DAY_MS * DAY_MS
    for offset_days in range(366 * 5):
        day = start_day + offset_days * DAY_MS
        if not _day_matches(cron, dt.datetime.fromtimestamp(day / 1000, dt.timezone.utc)):
            continue
        for hour in cron['hour'][0]:
            for minute in cron['minute'][0]:
                local = day + hour * HOUR_MS + minute * MINUTE_MS
                if local >= start:
                    return local - shift
    return None


def _and_list(words: list[str]) -> str:
    return words[0] if len(words) < 2 else f"{', '.join(words[:-1])} and {words[-1]}"


def cron_words(expr: str) -> str:
    """"Every Sunday at 09:00", "Every day at 10:30 and 13:30"; the expression itself when too odd to say."""
    try:
        cron = parse_cron(expr)
    except ValueError:
        return f'Cron "{expr}"'
    raw = f'Cron "{expr.strip()}" (local time)'
    minutes, hours = cron['minute'][0], cron['hour'][0]
    if not cron['month'][1] or len(minutes) > 1 or cron['hour'][1] or len(hours) > 6:
        return raw
    when = 'at ' + _and_list([f'{h:02d}:{minutes[0]:02d}' for h in hours])
    dom, dom_any = cron['dom']
    dow, dow_any = cron['dow']
    if dom_any and dow_any:
        days = 'Every day'
    elif dom_any:
        days = ('Every weekday (Mon to Fri)' if dow == [1, 2, 3, 4, 5] else
                f'Every {DAY_NAMES[dow[0]]}' if len(dow) == 1 else f"Every {_and_list([DAY_SHORT[d] for d in dow])}")
    elif dow_any and len(dom) <= 4:
        days = f"Every month on day {_and_list([str(d) for d in dom])}"
    else:
        return raw
    return f'{days} {when}'


def tz_name(offset_min: int = TZ_OFFSET_MIN) -> str:
    """"UTC+1", "UTC-5", "UTC+5:30"."""
    hours, minutes = divmod(abs(offset_min), 60)
    return f"UTC{'+' if offset_min >= 0 else '-'}{hours}" + (f':{minutes:02d}' if minutes else '')


def day_time(ms: int, with_year: bool = False, offset_min: int = TZ_OFFSET_MIN) -> str:
    local = dt.datetime.fromtimestamp((ms + offset_min * MINUTE_MS) / 1000, dt.timezone.utc)
    date = f'{DAY_SHORT[(local.weekday() + 1) % 7]} {local.day} {MONTH_SHORT[local.month - 1]}'
    clock = f'{local.hour:02d}:{local.minute:02d}'
    return f'{date} {local.year} {clock}' if with_year else f'{date}, {clock}'

# ---------------------------------------------------------------- scheduled tasks


def _ms(value) -> int | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    if isinstance(value, str) and value:
        try:
            return int(dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)
        except ValueError:
            return None
    return None


def schedule_words(task: dict) -> str:
    fire_at, cron = _ms(task.get('fireAt')), str(task.get('cronExpression') or '')
    if fire_at is not None:
        return f'Once, {day_time(fire_at, with_year=True)}'
    return cron_words(cron) if cron else 'No schedule set'


def read_scheduled(b: Builder, now_ms: int) -> list[dict]:
    r = b.reader
    tasks: dict[str, dict] = {}
    files = sorted(glob.glob(r.path(APP_SESSIONS_DIR, '*', '*', 'scheduled-tasks.json')))
    for path in files:
        for task in as_dict(r.json(path)).get('scheduledTasks') or []:
            task = as_dict(task)
            tasks.setdefault(str(task.get('id') or ''), task)
    task_dirs = sorted(glob.glob(r.path('.claude', 'scheduled-tasks', '*', 'SKILL.md')))
    for path in task_dirs:
        task_id = os.path.basename(os.path.dirname(path))
        tasks.setdefault(task_id, {'id': task_id, 'filePath': path, '_notListed': True})
    items = []
    for task_id, task in tasks.items():
        skill_path = str(task.get('filePath') or r.path('.claude', 'scheduled-tasks', task_id, 'SKILL.md'))
        fields = parse_frontmatter(r.text(skill_path) or '')  # only name/description are used, never the prompt
        display = str(task.get('displayName') or fields.get('name') or task_id)
        words = schedule_words(task)
        items.append(b.item(display, task.get('enabled') is not False and not task.get('_notListed'),
                            scheduled_detail(task, words, now_ms), fields.get('description', ''), skill_path,
                            match_names=[display, re.sub(r'\s*\([^)]*\)\s*$', '', display), task_id],
                            extra={'id': task_id, 'words': words}))
    if not files and not task_dirs:
        r.problem(f'No scheduled tasks found: there is no scheduled-tasks.json under ~/{APP_SESSIONS_DIR}.')
    return items


def scheduled_detail(task: dict, words: str, now_ms: int) -> str:
    if task.get('_notListed'):
        return "not in the app's scheduled list"
    fire_at, cron = _ms(task.get('fireAt')), str(task.get('cronExpression') or '')
    next_run = fire_at if fire_at is not None else (next_cron_run(cron, now_ms) if cron else None)
    last_run = _ms(task.get('lastRunAt'))
    if fire_at is not None:
        state = f'ran {day_time(last_run)}' if last_run else ('was due, not run yet' if fire_at < now_ms else '')
        return join_detail(f'{words} ({tz_name()})', state, 'turned off' if task.get('enabled') is False else '')
    next_text = f'next {day_time(next_run)} ({tz_name()})' if next_run and task.get('enabled') is not False else ''
    return join_detail(words, next_text, 'turned off' if task.get('enabled') is False else '')

# ---------------------------------------------------------------- inventory


def build_inventory(home: str, setup_md_path: str, now_ms: int | None = None) -> dict:
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    reader = Reader(home)
    setup = SetupMd(reader.text(setup_md_path))
    builder = Builder(reader, setup)
    settings = as_dict(reader.json(reader.path('.claude', 'settings.json'), required=True))
    plugins, installs = read_plugins(builder, settings)
    sections = {
        'mods': lambda: read_mods(builder, settings),
        'plugins': lambda: plugins,
        'agents': lambda: read_agents(builder, settings),
        'skills': lambda: read_skills(builder, settings),
        'mcp': lambda: read_mcp(builder, installs),
        'hooks': lambda: read_hooks(builder, settings),
        'scheduled': lambda: read_scheduled(builder, now_ms),
        'settings': lambda: read_settings(builder, settings),
    }
    inventory: dict = {}
    for key, read in sections.items():
        try:
            inventory[key] = read()
        except Exception as err:  # one broken source must not hide the others
            reader.problem(f'Could not list {key} ({type(err).__name__}).')
            inventory[key] = []
    inventory['problems'] = reader.problems
    inventory['readAt'] = now_ms
    return inventory


def public(inventory: dict) -> dict:
    """The Inventory as the pane sees it: private `_` fields removed."""
    return {key: [{k: v for k, v in item.items() if not k.startswith('_')} for item in value]
            if isinstance(value, list) and value and isinstance(value[0], dict) else value
            for key, value in inventory.items()}

# ---------------------------------------------------------------- SETUP.md section


def _code(name: str) -> str:
    return f'`{name}`'


def _cell(text: str) -> str:
    return text.replace('|', '\\|').replace('\n', ' ')


def _on_off(items: list[dict], label=lambda i: _code(i['name'])) -> list[str]:
    lines = []
    for title, wanted in (('On', True), ('Off', False)):
        chosen = [label(i) for i in items if i['isOn'] is wanted]
        if chosen:
            lines.append(f"- {title}: {', '.join(chosen)}.")
    return lines + _not_described(items)


def _not_described(items: list[dict]) -> list[str]:
    names = list(dict.fromkeys(_code(i['name']) for i in items if not i['isInSetupMd']))
    return [f"- {NOT_DESCRIBED.capitalize()}: {', '.join(names)}."] if names else []


def _with_detail(item: dict) -> str:
    return f"{_code(item['name'])} ({item['detail']})" if item['detail'] else _code(item['name'])


def render_section(inventory: dict) -> str:
    out = [SECTION_HEADING, '', SECTION_INTRO, '', '### Agents', '',
           '| Agent | Model | Effort | Handles | Hand-over rule |', '|---|---|---|---|---|']
    for agent in inventory['agents']:
        mark = f' ({NOT_DESCRIBED})' if not agent['isInSetupMd'] else ''
        handles = truncate(agent.get('_handles', ''), HANDLES_MAX_CHARS)
        out.append(f"| {_code(agent['name'])}{mark} | {agent.get('_model', '')} | {agent.get('_effort', '')} "
                   f"| {_cell(handles)} | {_cell(agent['rule'] or '(no line in CLAUDE.md)')} |")
    out += ['', '### Mods', ''] + _on_off(inventory['mods'], _with_detail)
    out += ['', '### Other plugins', ''] + _on_off(inventory['plugins'], _with_detail)
    out += ['', '### Skills', ''] + _on_off(inventory['skills'])
    out += ['', '### MCP servers', ''] + _render_mcp(inventory['mcp'])
    out += ['', '### Hooks', ''] + _render_hooks(inventory['hooks'])
    out += ['', '### Key settings', '']
    out += [f"- {_code(i['name'])}: {i['detail']}" for i in inventory['settings']] + _not_described(inventory['settings'])
    out += ['', '### Scheduled tasks', '']
    for task in inventory['scheduled']:
        mark = f' ({NOT_DESCRIBED})' if not task['isInSetupMd'] else ''
        state = 'on' if task['isOn'] else 'off'
        out.append(f"- **{task['name']}** ({_code(task.get('_id', ''))}): {task.get('_words', '')}, {state}{mark}.")
    return '\n'.join(out) + '\n'


def _render_mcp(items: list[dict]) -> list[str]:
    groups: dict[str, list[str]] = {}
    for item in items:
        facts = ', '.join(f for f in (item.get('_transport', ''), 'needs sign-in' if item.get('_needsSignIn') else '') if f)
        groups.setdefault(item.get('_scope', ''), []).append(f"{_code(item['name'])}" + (f' ({facts})' if facts else ''))
    def label(scope: str) -> str:
        return scope if scope.startswith('claude.ai') else scope[:1].upper() + scope[1:]
    lines = [f"- {label(scope)}: {', '.join(names)}." for scope, names in groups.items()]
    return lines + _not_described(items)


def _render_hooks(items: list[dict]) -> list[str]:
    groups: dict[str, list[str]] = {}
    for item in items:
        matcher = item.get('_matcher', '')
        groups.setdefault(item['detail'], []).append(item['name'] + (f' ({matcher})' if matcher else ''))
    lines = [f"- {_code(script) if '.' in script else script.capitalize()} on {', '.join(events)}."
             for script, events in groups.items()]
    missing = [i['detail'] if '.' in i['detail'] else i['name'] for i in items if not i['isInSetupMd']]
    if missing:
        lines.append(f"- {NOT_DESCRIBED.capitalize()}: {', '.join(_code(m) for m in dict.fromkeys(missing))}.")
    return lines


def replace_section(text: str, section: str) -> str:
    block = f'{SECTION_START}\n{section}{SECTION_END}'
    start, end = text.find(SECTION_START), text.find(SECTION_END)
    if start != -1 and end > start:
        return text[:start] + block + text[end + len(SECTION_END):]
    if not text:
        return f'{block}\n'
    base = text if text.endswith('\n') else text + '\n'
    return f'{base}\n{block}\n'


def write_setup_md(path: str, section: str, reader: Reader) -> bool:
    """Rewrites only the marked section; returns whether the file changed. Atomic: temp file + rename."""
    try:
        with open(path, encoding='utf-8', newline='') as handle:
            old = handle.read()
    except FileNotFoundError:
        return False  # only a SETUP.md you made yourself is kept current; none is created
    except (OSError, UnicodeDecodeError) as err:
        reader.problem(f'Could not update {reader.clean.tilde(path)} ({type(err).__name__}).')
        return False
    new = replace_section(old, section)
    if new == old:
        return False
    folder = os.path.dirname(os.path.abspath(path))
    try:
        mode = os.stat(path).st_mode & 0o777 if os.path.exists(path) else 0o644
        handle, temp_path = tempfile.mkstemp(prefix='.SETUP.md.', dir=folder)
        try:
            with os.fdopen(handle, 'w', encoding='utf-8', newline='') as temp:
                temp.write(new)
                temp.flush()
                os.fsync(temp.fileno())
            os.chmod(temp_path, mode)
            os.replace(temp_path, path)
        except BaseException:
            os.unlink(temp_path)  # best-effort cleanup of our own temp file before reporting
            raise
    except OSError as err:
        reader.problem(f'Could not update {reader.clean.tilde(path)} ({type(err).__name__}).')
        return False
    return True


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--home', default=os.path.expanduser('~'))
    parser.add_argument('--setup-md', default=None)
    parser.add_argument('--write-setup-md', action='store_true')
    args = parser.parse_args(argv)
    home = os.path.abspath(os.path.expanduser(args.home))
    setup_md = args.setup_md or os.path.join(home, '.claude', 'SETUP.md')
    try:
        inventory = build_inventory(home, setup_md)
        if args.write_setup_md:
            reader = Reader(home)
            write_setup_md(setup_md, render_section(inventory), reader)
            inventory['problems'] += reader.problems
        result = public(inventory)
    except Exception as err:  # last guard: the pane must always get valid JSON
        result = {key: [] for key in ('mods', 'plugins', 'agents', 'skills', 'mcp', 'hooks', 'scheduled', 'settings')}
        result['problems'] = [f'The setup could not be read ({type(err).__name__}).']
        result['readAt'] = int(time.time() * 1000)
    sys.stdout.write(json.dumps(result, ensure_ascii=False) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
