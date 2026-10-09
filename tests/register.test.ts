// harness-scope through the engine's events: pass-through, filtering, refusals, lifecycle.
// The test's own `on` hooks stand for the engine (session, fs, env and the composed text).
import type { On, SessionUsage } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

const HOME = '/h'
const ROOT = '/r'
const SELECTOR = `${ROOT}/.claude/harness-scope.json`
const OWN_PROFILE = `${HOME}/.claude/harness-scope/profiles/writing.json`
// Claude Code's configuration directory as the userConfig field gives it; the plugin under test lives in a checkout.
const CFG = { options: { configDir: `${HOME}/.claude` } }

const LISTING = [
  'The following skills are available for use with the Skill tool:',
  '',
  '- adr-writer: Record a design decision.',
  '- writing-ecosystem: Draft and review articles.',
  '- tdd: RED GREEN REFACTOR.',
  '- hookify:configure: Enable or disable hookify rules',
].join('\n')

const FILES = [
  { path: `${HOME}/.claude/CLAUDE.md`, kind: 'user', content: 'harness' },
  { path: `${HOME}/.claude/rules/common/testing.md`, kind: 'user', content: 'coverage 80%' },
  { path: `${ROOT}/CLAUDE.md`, kind: 'project', content: 'repo' },
] as const

// Every skill in the listing's order; `own` are the repo's (source projectSettings).
function usage(order: readonly string[], own: readonly string[]): SessionUsage {
  const skillFrontmatter = order.map((name) => ({
    name,
    source: own.includes(name) ? 'projectSettings' : 'userSettings',
    tokens: 1,
  }))
  return { context: { breakdown: { skills: { skillFrontmatter } } } } as unknown as SessionUsage
}
const ORDER = ['adr-writer', 'writing-ecosystem', 'tdd', 'hookify:configure']

/** The world beneath the mod. Unanswered calls throw, so a test fails if the mod reads what it should not. */
type WorldOpts = { surfaces?: readonly ('terminal' | 'desktop')[]; order?: readonly string[]; status?: string[] }

/** The kit hands a stub an absolute path for the host OS (`D:\r\...` on Windows); `disk` is keyed by POSIX paths. */
const diskKey = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

function world(on: On, disk: Record<string, string>, opts: WorldOpts = {}) {
  const logs: string[] = []
  on('session.root', () => ({ value: ROOT }))
  on('session.repo', () => ({ value: null }))
  on('fs.exists', (_$, e) => ({ value: diskKey(e.path) in disk }))
  on('fs.read', (_$, e) => {
    const text = disk[diskKey(e.path)]
    return text === undefined ? { deny: `no file ${e.path}` } : { value: text }
  })
  on('session.usage', () => ({ value: usage(opts.order ?? ORDER, ['writing-ecosystem']) }))
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('ui.log', (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    opts.status?.push(e.text ?? '(cleared)')
    return { value: undefined }
  })
  on('prompt.attachment', (_$, e) => ({ text: e.text }))
  on('prompt.context', (_$, e) => ({ blocks: e.blocks, instructionFiles: e.instructionFiles }))
  on('agent.offer', () => ({ isOffered: true }))
  on('tool.describe', (_$, e) => ({ description: e.description }))
  on('tool.call', () => ({ result: 'ran' }))
  on('classic.SessionStart', () => ({}))
  return logs
}

// The engine stamps origin and presentation on a typed command; the test leaves them to it.
const RUN_PROSE_MOD = { command: 'harness-scope', args: '' } as never

const WRITING = JSON.stringify({
  skills: { allow: ['adr-*'] },
  agents: { deny: ['refactor-cleaner'] },
  instructions: { deny: ['~/.claude/rules/common/testing.md'] },
  tools: { deny: ['LSP'] },
})

describe('pass-through', () => {
  test('a repo without a selector changes nothing and reads no file', CFG, async ($, on) => {
    world(on, {})
    const listing = await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    expect(listing.text).toBe(LISTING)
    const ctx = await $.prompt.context({ blocks: [], instructionFiles: FILES })
    expect(ctx.instructionFiles).toEqual(FILES)
    expect(
      (
        await $.agent.offer({
          agent: 'refactor-cleaner',
          description: 'd',
          source: 'userSettings',
          provider: { plugin: 'engine', tier: 'core' },
        })
      ).isOffered,
    ).toBe(true)
  })

  test('a broken profile passes everything through and says so once', CFG, async ($, on) => {
    const logs = world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: '{"skills":' })
    const listing = await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    expect(listing.text).toBe(LISTING)
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    expect(logs.filter((l) => l.includes('passing everything through')).length).toBe(1)
  })

  test('a selector that tries to carry a profile body is refused', CFG, async ($, on) => {
    world(on, { [SELECTOR]: JSON.stringify({ profile: 'writing', instructions: { deny: ['~/.claude/rules/*'] } }) })
    const ctx = await $.prompt.context({ blocks: [], instructionFiles: FILES })
    expect(ctx.instructionFiles).toEqual(FILES)
  })

  test('hook and plugin output is never touched', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    const r = await $.prompt.attachment({
      type: 'skill_listing',
      text: LISTING,
      origin: { kind: 'hook', event: 'SessionStart' },
    })
    expect(r.text).toBe(LISTING)
  })
})

describe('with the writing profile', () => {
  test('the skill listing keeps allowed skills and the repo’s own, byte for byte', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    const r = await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    expect(r.text).toBe(
      [
        'The following skills are available for use with the Skill tool:',
        '',
        '- adr-writer: Record a design decision.',
        '- writing-ecosystem: Draft and review articles.',
      ].join('\n'),
    )
    const again = await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    expect(again.text).toBe(r.text)
  })

  test('a removed skill is refused through the Skill tool; a kept one runs', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    const off = await $.tool.call({ tool: 'Skill', skill: 'tdd' })
    expect(off.deny ?? '').toContain('turned off in this repo')
    expect((await $.tool.call({ tool: 'Skill', skill: '/tdd' })).deny ?? '').toContain('turned off in this repo')
    const kept = await $.tool.call({ tool: 'Skill', skill: 'writing-ecosystem' })
    expect(kept.deny).toBeUndefined()
  })

  test('user instruction files and their imports go; project files stay', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    const ctx = await $.prompt.context({ blocks: [], instructionFiles: FILES })
    expect(ctx.instructionFiles?.map((f) => f.path)).toEqual([`${HOME}/.claude/CLAUDE.md`, `${ROOT}/CLAUDE.md`])
  })

  test('agents: denied ones are withheld, the repo’s own always offered', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    const provider = { plugin: 'engine', tier: 'core' } as const
    expect(
      (await $.agent.offer({ agent: 'refactor-cleaner', description: 'd', source: 'userSettings', provider }))
        .isOffered,
    ).toBe(false)
    expect((await $.agent.offer({ agent: 'Explore', description: 'd', source: 'built-in', provider })).isOffered).toBe(
      true,
    )
  })

  test('tools: an off tool is deferred and refused', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    const d = await $.tool.describe({ tool: 'LSP', description: 'lsp', provider: { plugin: 'engine', tier: 'core' } })
    expect(d.isDeferred).toBe(true)
    const kept = await $.tool.describe({
      tool: 'Read',
      description: 'read',
      provider: { plugin: 'engine', tier: 'core' },
    })
    expect(kept.isDeferred).toBeUndefined()
    const call = await $.tool.call({
      tool: 'LSP',
      operation: 'hover',
      filePath: '/r/a.ts',
      line: 1,
      character: 1,
    } as never)
    expect(call.deny ?? '').toContain('turned off in this repo')
  })

  test('turning Skill itself off in tools refuses every skill call', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: JSON.stringify({ tools: { deny: ['Skill'] } }) })
    expect((await $.tool.call({ tool: 'Skill', skill: 'writing-ecosystem' })).deny ?? '').toContain('turned off')
  })

  test('activation is announced on screen with the selector that chose it', CFG, async ($, on) => {
    const logs = world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    await $.prompt.context({ blocks: [], instructionFiles: FILES })
    expect(logs.some((l) => l.includes('profile "writing"') && l.includes('selected by'))).toBe(true)
  })

  test('a selector naming an object built-in is not a bundled profile', CFG, async ($, on) => {
    const logs = world(on, { [SELECTOR]: '{"profile":"constructor"}' })
    const r = await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    expect(r.text).toBe(LISTING)
    expect(logs.join('\n')).toContain('not found')
  })

  test('the bundled profile applies when the user has none of that name', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}' })
    const r = await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    expect(r.text).toBe(
      [
        'The following skills are available for use with the Skill tool:',
        '',
        '- writing-ecosystem: Draft and review articles.',
      ].join('\n'),
    )
  })
})

describe('lifecycle', () => {
  test('/clear reads the selector again', CFG, async ($, on) => {
    const disk: Record<string, string> = {}
    world(on, disk)
    expect((await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })).text).toBe(
      LISTING,
    )
    disk[SELECTOR] = '{"profile":"writing"}'
    disk[OWN_PROFILE] = WRITING
    await $.classic.SessionStart({ source: 'clear' })
    expect(
      (await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })).text,
    ).not.toBe(LISTING)
  })
})

describe('receipt and edges', () => {
  test('/harness-scope shows the names on screen and returns nothing the model reads', CFG, async ($, on) => {
    const logs = world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    const r = await $.command.run(RUN_PROSE_MOD)
    expect(r.text).toBeUndefined()
    expect(logs.join('\n')).toContain('skills (allow): 2 off — tdd, hookify:configure')
    // The terminal draws a screen line as one row, and puts the plugin's name in front of it itself.
    expect(logs.filter((l) => l.includes('\n') || l.startsWith('harness-scope:'))).toEqual([])
  })

  test('headless, the receipt comes back as text', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING }, { surfaces: [] })
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    const r = await $.command.run(RUN_PROSE_MOD)
    expect(r.text ?? '').toContain('profile "writing"')
    expect(r.text ?? '').toContain('skills (allow): 2 off — tdd, hookify:configure')
    expect(r.text ?? '').not.toMatch(/^harness-scope:/)
  })

  test('a pattern that matched no offered name is shown, so a typo is visible', CFG, async ($, on) => {
    const profile = JSON.stringify({ skills: { allow: ['adr-*', 'writng-*'] } })
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: profile }, { surfaces: [] })
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    const text = (await $.command.run(RUN_PROSE_MOD)).text ?? ''
    expect(text).toContain('skills patterns that matched nothing: writng-*')
  })

  test('before anything is composed, the receipt says so instead of "matched nothing"', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING }, { surfaces: [] })
    const r = await $.command.run(RUN_PROSE_MOD)
    expect(r.text ?? '').toContain('skills (allow): not composed yet in this conversation')
    expect(r.text ?? '').not.toContain('matched nothing')
  })

  test('the repo’s own agents stay under an allowlist', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}' })
    const provider = { plugin: 'engine', tier: 'core' } as const
    expect(
      (await $.agent.offer({ agent: 'editor', description: 'd', source: 'projectSettings', provider })).isOffered,
    ).toBe(true)
    expect(
      (await $.agent.offer({ agent: 'adr-reviewer', description: 'd', source: 'userSettings', provider })).isOffered,
    ).toBe(false)
  })

  test('off tools leave the deferred-tools list too', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    const text = 'The following deferred tools are now available via ToolSearch. Use ToolSearch:\nLSP\nWebFetch'
    const r = await $.prompt.attachment({ type: 'deferred_tools_delta', text, origin: { kind: 'engine' } })
    expect(r.text).toBe('The following deferred tools are now available via ToolSearch. Use ToolSearch:\nWebFetch')
  })

  test('a 1,000-skill listing filters well inside a hook’s time limit', CFG, async ($, on) => {
    const order = Array.from({ length: 1000 }, (_, n) => `skill-${n}`)
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING }, { order })
    const big = [
      'The following skills are available for use with the Skill tool:',
      '',
      ...Array.from({ length: 1000 }, (_, i) => `- skill-${i}: description ${i}`),
    ].join('\n')
    const t0 = Date.now()
    const r = await $.prompt.attachment({ type: 'skill_listing', text: big, origin: { kind: 'engine' } })
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(r.text).toBe('The following skills are available for use with the Skill tool:\n')
  })
})

describe('configuration directory', () => {
  test('with no configDir and a checkout install, only bundled profiles load and no env is read', async ($, on) => {
    world(on, {
      [SELECTOR]: JSON.stringify({ profile: 'writing' }),
      [OWN_PROFILE]: JSON.stringify({ skills: { allow: ['tdd'] } }),
    })
    const listing = await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    // The bundled writing profile keeps only the repo's own skills, so the user's file (allowing tdd) was not read.
    expect(listing.text).not.toContain('- tdd:')
    expect(listing.text).toContain('- writing-ecosystem:')
  })
})

describe('being able to tell it is working', () => {
  test('a profile pins a status line; a repo without a selector gets none', CFG, async ($, on) => {
    const status: string[] = []
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING }, { status })
    await $.prompt.context({ blocks: [], instructionFiles: FILES })
    expect(status).toEqual(['profile "writing" on'])
  })

  test('no selector: no status line and no screen line', CFG, async ($, on) => {
    const status: string[] = []
    const logs = world(on, {}, { status })
    await $.prompt.context({ blocks: [], instructionFiles: FILES })
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    expect(status).toEqual([])
    expect(logs).toEqual([])
  })

  test('a broken profile pins a pass-through status line', CFG, async ($, on) => {
    const status: string[] = []
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: '{"skills":' }, { status })
    await $.prompt.context({ blocks: [], instructionFiles: FILES })
    expect(status).toEqual(['passing everything through (see /harness-scope)'])
  })

  test('an unrecognised skill listing is said once on screen and in the status line', CFG, async ($, on) => {
    const status: string[] = []
    const logs = world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING }, { status })
    const odd = 'Skills you can use:\n- tdd: x'
    for (let i = 0; i < 2; i++) {
      const r = await $.prompt.attachment({ type: 'skill_listing', text: odd, origin: { kind: 'engine' } })
      expect(r.text).toBe(odd)
    }
    expect(logs.filter((l) => l.includes('unexpected format')).length).toBe(1)
    expect(status.at(-1)).toContain('passed through')
  })

  test('the activation line is short and names the selector relative to the repo', CFG, async ($, on) => {
    const logs = world(on, { [SELECTOR]: '{"profile":"writing"}' })
    await $.prompt.context({ blocks: [], instructionFiles: FILES })
    expect(logs).toEqual([
      'profile "writing" (bundled) on, selected by .claude/harness-scope.json — /harness-scope for details',
    ])
  })

  test('the receipt says how to undo it and that nothing is written', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING }, { surfaces: [] })
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    const text = (await $.command.run(RUN_PROSE_MOD)).text ?? ''
    expect(text).toContain('skills kept: adr-writer, writing-ecosystem')
    expect(text.split('\n').at(-1)).toBe(
      'To turn it off: delete .claude/harness-scope.json, then /clear. harness-scope writes no files.',
    )
  })
})

describe('names for writing a profile', () => {
  test('/harness-scope names lists what was offered, in a repo with no selector', CFG, async ($, on) => {
    world(on, {}, { surfaces: [] })
    const provider = { plugin: 'engine', tier: 'core' } as const
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    await $.agent.offer({ agent: 'Explore', description: 'd', source: 'built-in', provider })
    await $.tool.describe({ tool: 'Read', description: 'read', provider })
    const delta = 'The following deferred tools are now available via ToolSearch:\nLSP'
    await $.prompt.attachment({ type: 'deferred_tools_delta', text: delta, origin: { kind: 'engine' } })
    const text = (await $.command.run({ command: 'harness-scope', args: 'names' } as never)).text ?? ''
    expect(text).toContain('skills: adr-writer, writing-ecosystem, tdd, hookify:configure')
    expect(text).toContain('agents: Explore')
    expect(text).toContain('tools: Read, LSP')
  })

  test('before a prompt, names says to send one first', CFG, async ($, on) => {
    world(on, {}, { surfaces: [] })
    const text = (await $.command.run({ command: 'harness-scope', args: 'names' } as never)).text ?? ''
    expect(text).toContain('send a prompt first')
  })
})

describe('listing lines that look alike', () => {
  test('an aliased skill is matched by its listed name and refused by either name', CFG, async ($, on) => {
    const text = [
      'The following skills are available for use with the Skill tool:',
      '',
      '- hookify:list',
      '- hookify:writing-rules (hookify:writing-hookify-rules): Write rules.',
    ].join('\n')
    const order = ['hookify:list', 'hookify:writing-hookify-rules']
    world(
      on,
      {
        [SELECTOR]: '{"profile":"p"}',
        [`${HOME}/.claude/harness-scope/profiles/p.json`]: '{"skills":{"deny":["hookify:writing-rules"]}}',
      },
      { order },
    )
    const r = await $.prompt.attachment({ type: 'skill_listing', text, origin: { kind: 'engine' } })
    expect(r.text).toBe(text.split('\n').slice(0, 3).join('\n'))
    for (const skill of ['hookify:writing-rules', 'hookify:writing-hookify-rules']) {
      expect((await $.tool.call({ tool: 'Skill', skill })).deny ?? '').toContain('turned off')
    }
    expect((await $.tool.call({ tool: 'Skill', skill: 'hookify:list' })).deny).toBeUndefined()
  })

  test('a "- name: text" bullet in a kept skill’s description stays', CFG, async ($, on) => {
    const text = [
      'The following skills are available for use with the Skill tool:',
      '',
      '- helper: Help.',
      '- router: Route.',
      '- helper: when the request needs the helper',
      '- note: keep it short',
    ].join('\n')
    world(
      on,
      {
        [SELECTOR]: '{"profile":"p"}',
        [`${HOME}/.claude/harness-scope/profiles/p.json`]: '{"skills":{"deny":["helper"]}}',
      },
      { order: ['helper', 'router'] },
    )
    const r = await $.prompt.attachment({ type: 'skill_listing', text, origin: { kind: 'engine' } })
    expect(r.text).toBe(text.replace('\n- helper: Help.', ''))
  })
})

describe('after review', () => {
  const PROFILE_P = `${HOME}/.claude/harness-scope/profiles/p.json`

  test('deleting the selector and /clear removes the status line', CFG, async ($, on) => {
    const status: string[] = []
    const disk: Record<string, string> = { [SELECTOR]: '{"profile":"writing"}' }
    world(on, disk, { status })
    await $.prompt.context({ blocks: [], instructionFiles: FILES })
    delete disk[SELECTOR]
    await $.classic.SessionStart({ source: 'clear' })
    await $.prompt.context({ blocks: [], instructionFiles: FILES })
    expect(status).toEqual(['profile "writing" on', '(cleared)'])
  })

  test('a synced skill matches and is refused by its usage name as well', CFG, async ($, on) => {
    const text = [
      'The following skills are available for use with the Skill tool:',
      '',
      '- anthropic-skills:docx: Word files.',
      '- tdd: Tests.',
    ].join('\n')
    world(
      on,
      { [SELECTOR]: '{"profile":"p"}', [PROFILE_P]: '{"skills":{"deny":["docx"]}}' },
      { order: ['docx', 'tdd'] },
    )
    const r = await $.prompt.attachment({ type: 'skill_listing', text, origin: { kind: 'engine' } })
    expect(r.text).not.toContain('docx')
    for (const skill of ['docx', 'anthropic-skills:docx']) {
      expect((await $.tool.call({ tool: 'Skill', skill })).deny ?? '').toContain('turned off')
    }
  })

  test('once a later listing passes through, earlier removals are no longer refused', CFG, async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    expect((await $.tool.call({ tool: 'Skill', skill: 'tdd' })).deny ?? '').toContain('turned off')
    await $.prompt.attachment({ type: 'skill_listing', text: 'Skills:\n- tdd: x', origin: { kind: 'engine' } })
    expect((await $.tool.call({ tool: 'Skill', skill: 'tdd' })).deny).toBeUndefined()
  })

  test('names gathers every listing of the conversation', CFG, async ($, on) => {
    world(on, {}, { surfaces: [], order: [...ORDER, 'late-skill'] })
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    const late = 'The following skills are available for use with the Skill tool:\n\n- late-skill: Added later.'
    await $.prompt.attachment({ type: 'skill_listing', text: late, origin: { kind: 'engine' } })
    const text = (await $.command.run({ command: 'harness-scope', args: 'names' } as never)).text ?? ''
    expect(text).toContain('skills: adr-writer, writing-ecosystem, tdd, hookify:configure, late-skill')
  })

  test('an unknown argument says what the command takes', CFG, async ($, on) => {
    world(on, {}, { surfaces: [] })
    const text = (await $.command.run({ command: 'harness-scope', args: 'nmaes' } as never)).text ?? ''
    expect(text).toBe('unknown argument "nmaes": use /harness-scope, or /harness-scope names')
  })
})
