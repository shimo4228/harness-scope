// prose-mod: turn global skills, agents, instruction files and tools on or off per repo with a named profile.
// Plan: docs/plans/rfc-0001-r2-profile-allowlist.md. Invariants (tests/): no selector, a broken profile or an
// unknown format means pass-through; output is a stable function of input and profile; the repo's own parts,
// managed files and hook/plugin output are never touched; no network, processes or model calls.
import type { EngineInterface, On } from 'claude-code'
import { BUNDLED } from './bundled'
import { filterInstructionFiles } from './instructions'
import { filterDeferredTools, filterSkillListing } from './listing'
import { compileRule, type Profile, parseProfile, parseSelector, type Rule, unmatchedPatterns } from './profile'

const SELECTOR = '.claude/prose-mod.json'

type Active = {
  readonly status: 'on'
  readonly name: string
  readonly from: string
  readonly selector: string
  readonly profile: Profile
  readonly keepSkill: (n: string) => boolean
  readonly keepAgent: (n: string) => boolean
  readonly keepFile: (p: string) => boolean
  readonly keepTool: (n: string) => boolean
}
type Loaded = { readonly status: 'off' } | { readonly status: 'error'; readonly reason: string } | Active

type Receipt = {
  skills: Set<string>
  agents: Set<string>
  files: Set<string>
  tools: Set<string>
  seenSkills: Set<string>
  seenAgents: Set<string>
  seenFiles: Set<string>
  seenTools: Set<string>
  notes: string[]
}

function newReceipt(): Receipt {
  return {
    skills: new Set(),
    agents: new Set(),
    files: new Set(),
    tools: new Set(),
    seenSkills: new Set(),
    seenAgents: new Set(),
    seenFiles: new Set(),
    seenTools: new Set(),
    notes: [],
  }
}

// Per conversation: reset on /clear and resume (session.start does not fire there, and prompt.context fires before it).
let loading: Promise<Loaded> | undefined
let projectSkills: Promise<Set<string> | null> | undefined
let receipt = newReceipt()
let home = ''

function expandHome(rule: Rule | undefined): Rule | undefined {
  if (rule === undefined) return undefined
  return { ...rule, patterns: rule.patterns.map((p) => (p.startsWith('~/') ? `${home}${p.slice(1)}` : p)) }
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
    keepFile: compileRule(expandHome(profile.instructions)),
    keepTool: compileRule(profile.tools),
  }
}

async function readSelector($: EngineInterface): Promise<{ path: string; text: string } | null> {
  const root = await $.session.root()
  const repo = await $.session.repo()
  const dirs = repo !== null && repo.root !== root ? [root, repo.root] : [root]
  for (const dir of dirs) {
    const path = `${dir}/${SELECTOR}`
    if (await $.fs.exists(path)) {
      const text = await $.fs.read(path)
      return typeof text === 'string' ? { path, text } : null
    }
  }
  return null
}

async function load($: EngineInterface): Promise<Loaded> {
  home = (await $.env.get('HOME')) ?? ''
  const selector = await readSelector($)
  if (selector === null) return { status: 'off' }
  const sel = parseSelector(selector.text)
  if (!sel.ok) return { status: 'error', reason: `${selector.path}: ${sel.reason}` }
  const own = `${home}/.claude/prose-mod/profiles/${sel.profile}.json`
  if (home !== '' && (await $.fs.exists(own))) {
    const text = await $.fs.read(own)
    const parsed = typeof text === 'string' ? parseProfile(text) : { ok: false as const, reason: 'not text' }
    if (!parsed.ok) return { status: 'error', reason: `${own}: ${parsed.reason}` }
    return activate(sel.profile, own, selector.path, parsed.profile)
  }
  const bundled = Object.hasOwn(BUNDLED, sel.profile) ? BUNDLED[sel.profile] : undefined
  if (bundled !== undefined) return activate(sel.profile, `bundled profile "${sel.profile}"`, selector.path, bundled)
  return { status: 'error', reason: `profile "${sel.profile}" not found (looked for ${own} and the bundled profiles)` }
}

async function current($: EngineInterface): Promise<Loaded> {
  if (loading === undefined) {
    loading = load($).catch((err: unknown) => ({ status: 'error' as const, reason: String(err) }))
    const loaded = await loading
    if (loaded.status === 'error') $.ui.log(`prose-mod: passing everything through — ${loaded.reason}`)
    // A repo chooses which of the user's profiles applies; say so on screen every time one turns on.
    if (loaded.status === 'on') {
      $.ui.log(
        `prose-mod: profile "${loaded.name}" from ${shortPath(loaded.from)}, selected by ${shortPath(loaded.selector)}`,
      )
    }
  }
  return loading
}

// Names of the repo's own skills, which stay whatever the profile says. null = unknown, so the listing passes through.
async function ownSkills($: EngineInterface): Promise<Set<string> | null> {
  if (projectSkills === undefined) {
    projectSkills = $.session
      .usage({ breakdown: 'summary' })
      .then((u) => {
        const list = u.context.breakdown?.skills?.skillFrontmatter
        if (list === undefined) return null
        return new Set(list.filter((s) => s.source === 'projectSettings').map((s) => s.name))
      })
      .catch(() => null)
  }
  return projectSkills
}

function shortPath(path: string): string {
  return home !== '' && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

// Claude Code prefixes the command's output with the plugin name, so the lines carry none of their own.
function receiptText(loaded: Loaded): string {
  if (loaded.status === 'off') return `no ${SELECTOR} in this repo, so nothing is turned off.`
  if (loaded.status === 'error') return `passing everything through — ${loaded.reason}`
  const r = receipt
  const p = loaded.profile
  const line = (label: string, rule: Rule | undefined, removed: Set<string>, seen: Set<string>) => {
    if (rule === undefined) return `${label}: not in the profile`
    // Before the first request nothing has been composed yet; "matched nothing" would be wrong then.
    if (seen.size === 0 && removed.size === 0) return `${label} (${rule.mode}): not composed yet in this conversation`
    const miss = unmatchedPatterns(rule, seen)
    const names = [...removed].map(shortPath).join(', ')
    return `${label} (${rule.mode}): ${removed.size} off${names ? ` — ${names}` : ''}${miss.length ? `\n  matched nothing: ${miss.join(', ')}` : ''}`
  }
  return [
    `profile "${loaded.name}" from ${shortPath(loaded.from)}, selected by ${shortPath(loaded.selector)}`,
    line('skills', p.skills, r.skills, r.seenSkills),
    line('agents', p.agents, r.agents, r.seenAgents),
    line('instructions', expandHome(p.instructions), r.files, r.seenFiles),
    line('tools', p.tools, r.tools, r.seenTools),
    ...r.notes,
  ].join('\n')
}

function skillDeny(name: string, profile: string): string {
  return `The skill "${name}" is turned off in this repo by the prose-mod profile "${profile}". If it is needed, ask the user to run /${name} themselves.`
}

// The skill listing with off skills removed; the input unchanged when it cannot be filtered safely.
async function skillListing($: EngineInterface, loaded: Active, text: string): Promise<string> {
  if (loaded.profile.skills === undefined) return text
  const own = await ownSkills($)
  if (own === null) {
    receipt.notes.push('could not tell the repo’s own skills apart, so the skill listing passed through')
    return text
  }
  const out = filterSkillListing(text, (n) => {
    receipt.seenSkills.add(n)
    return own.has(n) || loaded.keepSkill(n)
  })
  if (out === null) {
    receipt.notes.push('the skill listing had an unexpected format, so it passed through')
    return text
  }
  for (const n of out.removed) receipt.skills.add(n)
  return out.text
}

function deferredTools(loaded: Active, text: string): string {
  if (loaded.profile.tools === undefined) return text
  const out = filterDeferredTools(text, loaded.keepTool)
  for (const n of out.removed) receipt.tools.add(n)
  return out.text
}

export function register(on: On): void {
  on('classic.SessionStart', async (_$, e, next) => {
    if (e.source === 'clear' || e.source === 'resume') {
      loading = undefined
      projectSkills = undefined
      receipt = newReceipt()
    }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prose-mod',
      description: 'Show what the prose-mod profile turned off in this repo',
    })
    return next(e)
  })

  on('command.run', async ($, e, next) => {
    if (e.command !== 'prose-mod') return next(e)
    const text = receiptText(await current($))
    // The command's text output reaches the model; on a screen, show the names there instead.
    if ((await $.session.surfaces()).length === 0) return { text }
    $.ui.log(text)
    return {}
  })

  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    const loaded = await current($)
    if (loaded.status !== 'on' || loaded.profile.instructions === undefined) return r
    if (r.instructionFiles === undefined) {
      receipt.notes.push('instruction files were rewritten upstream, so none were turned off')
      return r
    }
    for (const f of r.instructionFiles) if (f.kind === 'user') receipt.seenFiles.add(f.path)
    const out = filterInstructionFiles(r.instructionFiles, loaded.keepFile)
    if (out.removed.length === 0) return r
    for (const p of out.removed) receipt.files.add(p)
    return { ...r, instructionFiles: out.files }
  })

  on('prompt.attachment', async ($, e, next) => {
    const r = await next(e)
    if (e.origin.kind !== 'engine' || r.text === null) return r
    const loaded = await current($)
    if (loaded.status !== 'on') return r
    if (e.type === 'skill_listing') return { ...r, text: await skillListing($, loaded, r.text) }
    if (e.type === 'deferred_tools_delta') return { ...r, text: deferredTools(loaded, r.text) }
    return r
  })

  on('agent.offer', async ($, e, next) => {
    const loaded = await current($)
    if (loaded.status !== 'on' || loaded.profile.agents === undefined || e.source === 'projectSettings') return next(e)
    receipt.seenAgents.add(e.agent)
    if (loaded.keepAgent(e.agent)) return next(e)
    receipt.agents.add(e.agent)
    return { isOffered: false }
  })

  on('tool.describe', async ($, e, next) => {
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
      return { deny: `The tool ${e.tool} is turned off in this repo by the prose-mod profile "${loaded.name}".` }
    }
    if (e.tool === 'Skill') {
      const name = String(e.skill ?? '').replace(/^\//, '')
      // Only names this conversation actually removed from the listing, so the listing and the refusals agree.
      if (receipt.skills.has(name)) return { deny: skillDeny(name, loaded.name) }
    }
    return next(e)
  })
}
