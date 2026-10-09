// harness-scope: turn global skills, agents, instruction files and tools on or off per repo with a named profile.
// Plan: docs/plans/rfc-0001-r2-profile-allowlist.md. Invariants (tests/): no selector, a broken profile or an
// unknown format means pass-through; output is a stable function of input and profile; the repo's own parts,
// managed files and hook/plugin output are never touched; no network, processes or model calls.
import type { EngineInterface, On, PluginOptions } from 'claude-code'
import { BUNDLED } from './bundled'
import { filterInstructionFiles } from './instructions'
import { deferredToolNames, filterDeferredTools, filterSkillListing, type SkillItem } from './listing'
import {
  compileRule,
  configDirFromPluginRoot,
  expandTilde,
  type Profile,
  parseProfile,
  parseSelector,
  type Rule,
  toForwardSlashes,
  unmatchedPatterns,
} from './profile'

const SELECTOR = '.claude/harness-scope.json'

type Active = {
  readonly status: 'on'
  readonly name: string
  readonly from: string // a profile file's path, or '' for a bundled profile
  readonly selector: string // as shown: relative to the session root when it sits there
  readonly profile: Profile
  readonly keepSkill: (n: string) => boolean
  readonly keepAgent: (n: string) => boolean
  readonly keepFile: (p: string) => boolean
  readonly keepTool: (n: string) => boolean
}
type Loaded =
  | { readonly status: 'off' }
  | { readonly status: 'error'; readonly reason: string; readonly selector: string }
  | Active

type Receipt = {
  skills: Set<string>
  // Names (and aliases) the Skill tool refuses: only what this conversation removed from the listing.
  refused: Set<string>
  agents: Set<string>
  files: Set<string>
  tools: Set<string>
  seenSkills: Set<string>
  seenAgents: Set<string>
  seenFiles: Set<string>
  seenTools: Set<string>
  keptSkills: Set<string>
  notes: Set<string>
  // Everything the conversation offered, profile or not, for `/harness-scope names`.
  listings: string[]
  offeredAgents: Set<string>
  offeredTools: Set<string>
}

function newReceipt(): Receipt {
  return {
    skills: new Set(),
    refused: new Set(),
    agents: new Set(),
    files: new Set(),
    tools: new Set(),
    seenSkills: new Set(),
    seenAgents: new Set(),
    seenFiles: new Set(),
    seenTools: new Set(),
    keptSkills: new Set(),
    notes: new Set(),
    listings: [],
    offeredAgents: new Set(),
    offeredTools: new Set(),
  }
}

// Skill names from `session.usage`, in the listing's order, and which of them are the repo's own.
type SkillNames = { readonly order: readonly string[]; readonly own: ReadonlySet<string> }

// Per conversation: reset on /clear and resume (session.start does not fire there, and prompt.context fires before it).
let loading: Promise<Loaded> | undefined
let receipt = newReceipt()
let statusShown = false
// Claude Code's configuration directory: the userConfig field, else read off the install path. '' = unknown.
let configuredDir = ''
let configDir = ''

// Instruction-file patterns and paths are both compared with forward slashes, so a Windows path matches `~/...`.
function expandHome(rule: Rule | undefined): Rule | undefined {
  if (rule === undefined) return undefined
  const expand = (p: string) => toForwardSlashes(configDir === '' ? p : expandTilde(p, configDir))
  return { ...rule, patterns: rule.patterns.map(expand) }
}

function compilePathRule(rule: Rule | undefined): (path: string) => boolean {
  const keep = compileRule(expandHome(rule))
  return (path) => keep(toForwardSlashes(path))
}

function activate(name: string, from: string, selector: string, profile: Profile): Active {
  return {
    status: 'on',
    name,
    from,
    selector,
    profile,
    keepSkill: compileRule(profile.skills),
    keepAgent: compileRule(profile.agents),
    keepFile: compilePathRule(profile.instructions),
    keepTool: compileRule(profile.tools),
  }
}

async function readSelector($: EngineInterface): Promise<{ path: string; shown: string; text: string } | null> {
  const root = await $.session.root()
  const repo = await $.session.repo()
  const dirs = repo !== null && repo.root !== root ? [root, repo.root] : [root]
  for (const dir of dirs) {
    const path = `${dir}/${SELECTOR}`
    if (await $.fs.exists(path)) {
      const text = await $.fs.read(path)
      return typeof text === 'string' ? { path, shown: dir === root ? SELECTOR : path, text } : null
    }
  }
  return null
}

async function load($: EngineInterface): Promise<Loaded> {
  configDir = configuredDir !== '' ? configuredDir : (configDirFromPluginRoot($.plugin.root) ?? '')
  const selector = await readSelector($)
  if (selector === null) return { status: 'off' }
  const fail = (reason: string): Loaded => ({ status: 'error', reason, selector: selector.shown })
  const sel = parseSelector(selector.text)
  if (!sel.ok) return fail(`${selector.shown}: ${sel.reason}`)
  const own = configDir === '' ? '' : `${configDir}/harness-scope/profiles/${sel.profile}.json`
  if (own !== '' && (await $.fs.exists(own))) {
    const text = await $.fs.read(own)
    const parsed = typeof text === 'string' ? parseProfile(text) : { ok: false as const, reason: 'not text' }
    if (!parsed.ok) return fail(`${shortPath(own)}: ${parsed.reason}`)
    return activate(sel.profile, own, selector.shown, parsed.profile)
  }
  const bundled = Object.hasOwn(BUNDLED, sel.profile) ? BUNDLED[sel.profile] : undefined
  if (bundled !== undefined) return activate(sel.profile, '', selector.shown, bundled)
  const where =
    own === ''
      ? 'the bundled profiles (set configDir with `claude plugin configure harness-scope` to use your own)'
      : `${shortPath(own)} and the bundled profiles`
  return fail(`profile "${sel.profile}" not found (looked in ${where})`)
}

function profileLabel(loaded: Active): string {
  return loaded.from === ''
    ? `profile "${loaded.name}" (bundled)`
    : `profile "${loaded.name}" from ${shortPath(loaded.from)}`
}

// The pinned line under the prompt: present in every conversation of a repo that selects a profile, so its absence
// there is the sign that the Mod did not load. Repos without a selector get none.
function showStatus($: EngineInterface, loaded: Loaded): void {
  if (loaded.status === 'off') {
    // After the selector is deleted and /clear, the line from before must not stay.
    if (statusShown) $.ui.status(undefined)
    statusShown = false
    return
  }
  statusShown = true
  if (loaded.status === 'error') {
    $.ui.status('passing everything through (see /harness-scope)')
    return
  }
  const passed = receipt.notes.size > 0 ? ' (some lists passed through, see /harness-scope)' : ''
  $.ui.status(`profile "${loaded.name}" on${passed}`)
}

// A list that could not be filtered: once on screen, once in the receipt, and in the status line.
function note($: EngineInterface, loaded: Loaded, text: string): void {
  if (receipt.notes.has(text)) return
  receipt.notes.add(text)
  $.ui.log(text)
  showStatus($, loaded)
}

async function current($: EngineInterface): Promise<Loaded> {
  if (loading === undefined) {
    loading = load($).catch((err: unknown) => ({ status: 'error' as const, reason: String(err), selector: SELECTOR }))
    const loaded = await loading
    if (loaded.status === 'error') $.ui.log(`passing everything through — ${loaded.reason}`)
    // A repo chooses which of the user's profiles applies; say so on screen every time one turns on.
    if (loaded.status === 'on') {
      $.ui.log(`${profileLabel(loaded)} on, selected by ${loaded.selector} — /harness-scope for details`)
    }
    showStatus($, loaded)
  }
  return loading
}

// Read again for every listing (17–35 ms measured), so a skill added mid-conversation is known when its listing comes.
function names($: EngineInterface): Promise<SkillNames | null> {
  return $.session
    .usage({ breakdown: 'summary' })
    .then((u) => {
      const list = u.context.breakdown?.skills?.skillFrontmatter
      if (list === undefined) return null
      const own = new Set(list.filter((s) => s.source === 'projectSettings').map((s) => s.name))
      return { order: list.map((s) => s.name), own }
    })
    .catch(() => null)
}

function shortPath(path: string): string {
  if (configDir.endsWith('/.claude') && path.startsWith(`${configDir}/`)) {
    return `~/.claude${path.slice(configDir.length)}`
  }
  return path
}

function undoLine(selector: string): string {
  return `To turn it off: delete ${selector}, then /clear. harness-scope writes no files.`
}

// Claude Code prefixes the command's output, screen lines and the status line with the plugin name, so the text
// carries none of its own.
function receiptText(loaded: Loaded): string {
  if (loaded.status === 'off') {
    return `no ${SELECTOR} in this repo, so nothing is turned off. /harness-scope names lists names for a profile.`
  }
  if (loaded.status === 'error') return `passing everything through — ${loaded.reason}\n${undoLine(loaded.selector)}`
  const r = receipt
  const p = loaded.profile
  const line = (label: string, rule: Rule | undefined, removed: Set<string>, seen: Set<string>, kept?: Set<string>) => {
    if (rule === undefined) return `${label}: not in the profile`
    // Before the first request nothing has been composed yet; "matched nothing" would be wrong then.
    if (seen.size === 0 && removed.size === 0) return `${label} (${rule.mode}): not composed yet in this conversation`
    const miss = unmatchedPatterns(rule, seen)
    const off = [...removed].map(shortPath)
    const stayed = rule.mode === 'allow' ? [...(kept ?? seen)].filter((n) => !removed.has(n)).map(shortPath) : []
    return [
      `${label} (${rule.mode}): ${removed.size} off${off.length ? ` — ${off.join(', ')}` : ''}`,
      ...(stayed.length ? [`${label} kept: ${stayed.join(', ')}`] : []),
      ...(miss.length ? [`${label} patterns that matched nothing: ${miss.join(', ')}`] : []),
    ].join('\n')
  }
  return [
    `${profileLabel(loaded)}, selected by ${loaded.selector}`,
    line('skills', p.skills, r.skills, r.seenSkills, r.keptSkills),
    line('agents', p.agents, r.agents, r.seenAgents),
    line('instructions', expandHome(p.instructions), r.files, r.seenFiles),
    line('tools', p.tools, r.tools, r.seenTools),
    ...r.notes,
    undoLine(loaded.selector),
  ].join('\n')
}

async function namesText($: EngineInterface): Promise<string> {
  const r = receipt
  if (r.listings.length === 0 && r.offeredAgents.size === 0 && r.offeredTools.size === 0) {
    return 'nothing composed yet in this conversation: send a prompt first, then run /harness-scope names'
  }
  const known = await names($)
  const parsed = r.listings.map((l) => (known === null ? null : filterSkillListing(l, known.order, () => true)))
  const skills = parsed.some((p) => p === null)
    ? '(could not read the skill listing)'
    : [...new Set(parsed.flatMap((p) => p?.items.map((i) => i.name) ?? []))].join(', ')
  return [
    'names offered in this conversation, as a profile matches them (globs * and ? work):',
    `skills: ${skills}`,
    `agents: ${[...r.offeredAgents].join(', ')}`,
    `tools: ${[...r.offeredTools].join(', ')}`,
    'instructions match file paths; in a pattern, ~/.claude/ stands for your configuration directory.',
  ].join('\n')
}

function skillDeny(name: string, profile: string): string {
  return `The skill "${name}" is turned off in this repo by the harness-scope profile "${profile}". If it is needed, ask the user to run /${name} themselves.`
}

// The skill listing with off skills removed; the input unchanged when it cannot be filtered safely.
async function skillListing($: EngineInterface, loaded: Active, text: string): Promise<string> {
  if (loaded.profile.skills === undefined) return text
  const known = await names($)
  if (known === null) {
    note($, loaded, 'could not tell the skills apart (no session usage), so the skill listing passed through')
    return text
  }
  const keep = (item: SkillItem) => {
    const ns = [...new Set([item.name, item.alias ?? item.name, item.key])]
    for (const n of ns) receipt.seenSkills.add(n)
    // allow keeps an item either name matches; deny drops an item either name matches.
    const kept =
      known.own.has(item.key) ||
      (loaded.profile.skills?.mode === 'deny' ? ns.every(loaded.keepSkill) : ns.some(loaded.keepSkill))
    if (kept) receipt.keptSkills.add(item.name)
    return kept
  }
  const out = filterSkillListing(text, known.order, keep)
  if (out === null) {
    note($, loaded, 'the skill listing had an unexpected format, so no skill was turned off')
    // The model now sees every skill, so refusing one would contradict the listing.
    receipt.refused.clear()
    return text
  }
  for (const item of out.removedItems) {
    receipt.skills.add(item.name)
    for (const n of [item.name, item.alias ?? item.name, item.key]) receipt.refused.add(n)
  }
  return out.text
}

function deferredTools(loaded: Active, text: string): string {
  if (loaded.profile.tools === undefined) return text
  const out = filterDeferredTools(text, loaded.keepTool)
  for (const n of out.removed) receipt.tools.add(n)
  return out.text
}

// What `/harness-scope names` lists, kept whether or not a profile is on.
function remember(type: string, agentId: string | undefined, text: string): void {
  if (type === 'skill_listing' && agentId === undefined) receipt.listings.push(text)
  if (type === 'deferred_tools_delta') for (const n of deferredToolNames(text)) receipt.offeredTools.add(n)
}

export function register(on: On, options: PluginOptions): void {
  const configured = options.configDir
  configuredDir = typeof configured === 'string' ? toForwardSlashes(configured).replace(/\/+$/, '') : ''
  on('classic.SessionStart', async (_$, e, next) => {
    if (e.source === 'clear' || e.source === 'resume') {
      loading = undefined
      receipt = newReceipt()
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'harness-scope',
      description: 'Show what the harness-scope profile turned off in this repo',
      argumentHint: '[names]',
    })
    return next(e)
  })

  on('command.run', async ($, e, next) => {
    if (e.command !== 'harness-scope') return next(e)
    const arg = e.args.trim().toLowerCase()
    const text =
      arg === ''
        ? receiptText(await current($))
        : arg === 'names'
          ? await namesText($)
          : `unknown argument "${e.args.trim()}": use /harness-scope, or /harness-scope names`
    // The command's text output reaches the model; on a screen, show the names there instead.
    if ((await $.session.surfaces()).length === 0) return { text }
    // A screen line is one row (a newline draws as a stray glyph), so the receipt goes out line by line.
    for (const line of text.split('\n')) $.ui.log(line)
    return {}
  })

  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    const loaded = await current($)
    if (loaded.status !== 'on' || loaded.profile.instructions === undefined) return r
    if (r.instructionFiles === undefined) {
      note($, loaded, 'instruction files were rewritten upstream, so none were turned off')
      return r
    }
    for (const f of r.instructionFiles) if (f.kind === 'user') receipt.seenFiles.add(toForwardSlashes(f.path))
    const out = filterInstructionFiles(r.instructionFiles, loaded.keepFile)
    if (out.removed.length === 0) return r
    for (const p of out.removed) receipt.files.add(toForwardSlashes(p))
    return { ...r, instructionFiles: out.files }
  })

  on('prompt.attachment', async ($, e, next) => {
    const r = await next(e)
    if (e.origin.kind !== 'engine' || r.text === null) return r
    remember(e.type, e.agentId, r.text)
    const loaded = await current($)
    if (loaded.status !== 'on') return r
    if (e.type === 'skill_listing') return { ...r, text: await skillListing($, loaded, r.text) }
    if (e.type === 'deferred_tools_delta') return { ...r, text: deferredTools(loaded, r.text) }
    return r
  })

  on('agent.offer', async ($, e, next) => {
    receipt.offeredAgents.add(e.agent)
    const loaded = await current($)
    if (loaded.status !== 'on' || loaded.profile.agents === undefined || e.source === 'projectSettings') return next(e)
    receipt.seenAgents.add(e.agent)
    if (loaded.keepAgent(e.agent)) return next(e)
    receipt.agents.add(e.agent)
    return { isOffered: false }
  })

  on('tool.describe', async ($, e, next) => {
    receipt.offeredTools.add(e.tool)
    const r = await next(e)
    const loaded = await current($)
    if (loaded.status !== 'on' || loaded.profile.tools === undefined) return r
    receipt.seenTools.add(e.tool)
    if (loaded.keepTool(e.tool)) return r
    receipt.tools.add(e.tool)
    return { ...r, isDeferred: true }
  })

  on('tool.call', async ($, e, next) => {
    const loaded = await current($)
    if (loaded.status !== 'on') return next(e)
    if (loaded.profile.tools !== undefined && !loaded.keepTool(e.tool)) {
      return { deny: `The tool ${e.tool} is turned off in this repo by the harness-scope profile "${loaded.name}".` }
    }
    if (e.tool === 'Skill') {
      const name = String(e.skill ?? '').replace(/^\//, '')
      // Only names this conversation actually removed from the listing, so the listing and the refusals agree.
      if (receipt.refused.has(name)) return { deny: skillDeny(name, loaded.name) }
    }
    return next(e)
  })
}
