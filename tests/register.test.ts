// prose-mod through the engine's events: pass-through, filtering, refusals, lifecycle.
// The test's own `on` hooks stand for the engine (session, fs, env and the composed text).
import type { On, SessionUsage } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

const HOME = '/h'
const ROOT = '/r'
const SELECTOR = `${ROOT}/.claude/prose-mod.json`
const OWN_PROFILE = `${HOME}/.claude/prose-mod/profiles/writing.json`

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

function usage(projectSkills: readonly string[]): SessionUsage {
  const skillFrontmatter = projectSkills.map((name) => ({ name, source: 'projectSettings', tokens: 1 }))
  return { context: { breakdown: { skills: { skillFrontmatter } } } } as unknown as SessionUsage
}

/** The world beneath the mod. Unanswered calls throw, so a test fails if the mod reads what it should not. */
function world(on: On, disk: Record<string, string>, opts: { surfaces?: readonly ('terminal' | 'desktop')[] } = {}) {
  const logs: string[] = []
  on('session.root', () => ({ value: ROOT }))
  on('session.repo', () => ({ value: null }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.exists', (_$, e) => ({ value: e.path in disk }))
  on('fs.read', (_$, e) => {
    const text = disk[e.path]
    return text === undefined ? { deny: `no file ${e.path}` } : { value: text }
  })
  on('session.usage', () => ({ value: usage(['writing-ecosystem']) }))
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('ui.log', (_$, e) => {
    logs.push(e.text)
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
const RUN_PROSE_MOD = { command: 'prose-mod', args: '' } as never

const WRITING = JSON.stringify({
  skills: { allow: ['adr-*'] },
  agents: { deny: ['refactor-cleaner'] },
  instructions: { deny: ['~/.claude/rules/common/testing.md'] },
  tools: { deny: ['LSP'] },
})

describe('pass-through', () => {
  test('a repo without a selector changes nothing and reads no file', async ($, on) => {
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

  test('a broken profile passes everything through and says so once', async ($, on) => {
    const logs = world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: '{"skills":' })
    const listing = await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    expect(listing.text).toBe(LISTING)
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    expect(logs.filter((l) => l.includes('passing everything through')).length).toBe(1)
  })

  test('a selector that tries to carry a profile body is refused', async ($, on) => {
    world(on, { [SELECTOR]: JSON.stringify({ profile: 'writing', instructions: { deny: ['~/.claude/rules/*'] } }) })
    const ctx = await $.prompt.context({ blocks: [], instructionFiles: FILES })
    expect(ctx.instructionFiles).toEqual(FILES)
  })

  test('hook and plugin output is never touched', async ($, on) => {
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
  test('the skill listing keeps allowed skills and the repo’s own, byte for byte', async ($, on) => {
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

  test('a removed skill is refused through the Skill tool; a kept one runs', async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    const off = await $.tool.call({ tool: 'Skill', skill: 'tdd' })
    expect(off.deny ?? '').toContain('turned off in this repo')
    expect((await $.tool.call({ tool: 'Skill', skill: '/tdd' })).deny ?? '').toContain('turned off in this repo')
    const kept = await $.tool.call({ tool: 'Skill', skill: 'writing-ecosystem' })
    expect(kept.deny).toBeUndefined()
  })

  test('user instruction files and their imports go; project files stay', async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    const ctx = await $.prompt.context({ blocks: [], instructionFiles: FILES })
    expect(ctx.instructionFiles?.map((f) => f.path)).toEqual([`${HOME}/.claude/CLAUDE.md`, `${ROOT}/CLAUDE.md`])
  })

  test('agents: denied ones are withheld, the repo’s own always offered', async ($, on) => {
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

  test('tools: an off tool is deferred and refused', async ($, on) => {
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

  test('turning Skill itself off in tools refuses every skill call', async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: JSON.stringify({ tools: { deny: ['Skill'] } }) })
    expect((await $.tool.call({ tool: 'Skill', skill: 'writing-ecosystem' })).deny ?? '').toContain('turned off')
  })

  test('activation is announced on screen with the selector that chose it', async ($, on) => {
    const logs = world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    await $.prompt.context({ blocks: [], instructionFiles: FILES })
    expect(logs.some((l) => l.includes('profile "writing"') && l.includes('selected by'))).toBe(true)
  })

  test('a selector naming an object built-in is not a bundled profile', async ($, on) => {
    const logs = world(on, { [SELECTOR]: '{"profile":"constructor"}' })
    const r = await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    expect(r.text).toBe(LISTING)
    expect(logs.join('\n')).toContain('not found')
  })

  test('the bundled profile applies when the user has none of that name', async ($, on) => {
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
  test('/clear reads the selector again', async ($, on) => {
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
  test('/prose-mod shows the names on screen and returns nothing the model reads', async ($, on) => {
    const logs = world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    const r = await $.command.run(RUN_PROSE_MOD)
    expect(r.text).toBeUndefined()
    expect(logs.join('\n')).toContain('skills (allow): 2 off — tdd, hookify:configure')
  })

  test('headless, the receipt comes back as text', async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING }, { surfaces: [] })
    await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
    const r = await $.command.run(RUN_PROSE_MOD)
    expect(r.text ?? '').toContain('profile "writing"')
    expect(r.text ?? '').toContain('skills (allow): 2 off — tdd, hookify:configure')
    expect(r.text ?? '').not.toMatch(/^prose-mod:/)
  })

  test('before anything is composed, the receipt says so instead of "matched nothing"', async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING }, { surfaces: [] })
    const r = await $.command.run(RUN_PROSE_MOD)
    expect(r.text ?? '').toContain('skills (allow): not composed yet in this conversation')
    expect(r.text ?? '').not.toContain('matched nothing')
  })

  test('the repo’s own agents stay under an allowlist', async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}' })
    const provider = { plugin: 'engine', tier: 'core' } as const
    expect(
      (await $.agent.offer({ agent: 'editor', description: 'd', source: 'projectSettings', provider })).isOffered,
    ).toBe(true)
    expect(
      (await $.agent.offer({ agent: 'adr-reviewer', description: 'd', source: 'userSettings', provider })).isOffered,
    ).toBe(false)
  })

  test('off tools leave the deferred-tools list too', async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
    const text = 'The following deferred tools are now available via ToolSearch. Use ToolSearch:\nLSP\nWebFetch'
    const r = await $.prompt.attachment({ type: 'deferred_tools_delta', text, origin: { kind: 'engine' } })
    expect(r.text).toBe('The following deferred tools are now available via ToolSearch. Use ToolSearch:\nWebFetch')
  })

  test('a 1,000-skill listing filters well inside a hook’s time limit', async ($, on) => {
    world(on, { [SELECTOR]: '{"profile":"writing"}', [OWN_PROFILE]: WRITING })
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
