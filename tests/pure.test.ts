// Pure parts of harness-scope: profile parsing, listing filters, instruction-file filters.
// Fixtures mimic the 2.1.287 formats measured in docs/measurements/2026-10-03-phase0.md.
import { describe, expect, test } from 'claude-code/testing'
import { filterInstructionFiles } from '../hooks/instructions'
import { filterDeferredTools, filterSkillListing, type SkillItem } from '../hooks/listing'
import { compileRule, configDirFromPluginRoot, expandTilde, parseProfile, parseSelector } from '../hooks/profile'

const LISTING = [
  'The following skills are available for use with the Skill tool:',
  '',
  '- adr-writer: Record a design decision.',
  '- claude-api: Reference for the Claude API.',
  'TRIGGER — read BEFORE opening the target file.',
  'SKIP only when another provider is being worked on.',
  '- growth-astra',
  '- hookify:configure: Enable or disable hookify rules',
  '- apps/web:deploy: Deploy the web app',
  '- writing-ecosystem: Draft and review articles.',
  '- tdd: RED GREEN REFACTOR.',
].join('\n')

describe('parseSelector', () => {
  test('reads the profile name', () => {
    expect(parseSelector('{ "profile": "writing" }')).toEqual({ ok: true, profile: 'writing' })
  })
  test('rejects anything but a single profile name', () => {
    expect(parseSelector('{ "profile": "" }').ok).toBe(false)
    expect(parseSelector('{ "skills": { "allow": [] } }').ok).toBe(false)
    expect(parseSelector('{ "profile": "writing", "skills": {} }').ok).toBe(false)
    expect(parseSelector('{ "profile": "../etc" }').ok).toBe(false)
    expect(parseSelector('not json').ok).toBe(false)
  })
})

describe('parseProfile', () => {
  test('reads allow and deny per category', () => {
    const r = parseProfile('{ "skills": { "allow": ["a"] }, "tools": { "deny": ["LSP"] } }')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.profile.skills).toEqual({ mode: 'allow', patterns: ['a'] })
      expect(r.profile.tools).toEqual({ mode: 'deny', patterns: ['LSP'] })
      expect(r.profile.agents).toBeUndefined()
    }
  })
  test('rejects both allow and deny in one category, unknown keys, and non-string patterns', () => {
    expect(parseProfile('{ "skills": { "allow": ["a"], "deny": ["b"] } }').ok).toBe(false)
    expect(parseProfile('{ "plugins": { "deny": ["x"] } }').ok).toBe(false)
    expect(parseProfile('{ "skills": { "allow": [1] } }').ok).toBe(false)
    expect(parseProfile('{ "skills": { "allow": [] } }').ok).toBe(true)
  })
})

describe('compileRule', () => {
  test('allow keeps only matches, deny drops only matches, globs work', () => {
    const allow = compileRule({ mode: 'allow', patterns: ['writing-*', 'anthropic-skills:docx'] })
    expect(allow('writing-ecosystem')).toBe(true)
    expect(allow('anthropic-skills:docx')).toBe(true)
    expect(allow('tdd')).toBe(false)
    const deny = compileRule({ mode: 'deny', patterns: ['pr-review-toolkit:*'] })
    expect(deny('pr-review-toolkit:code-reviewer')).toBe(false)
    expect(deny('Explore')).toBe(true)
  })
  test('no rule keeps everything', () => {
    expect(compileRule(undefined)('anything')).toBe(true)
  })
})

describe('filterSkillListing', () => {
  // session.usage's names, in the listing's order (measured equal on 2.1.294).
  const ORDER = [
    'adr-writer',
    'claude-api',
    'growth-astra',
    'hookify:configure',
    'apps/web:deploy',
    'writing-ecosystem',
    'tdd',
  ]
  const H = 'The following skills are available for use with the Skill tool:'
  const keepWriting = (i: SkillItem) => i.name === 'writing-ecosystem' || i.name === 'claude-api'

  test('removes whole items, including multi-line descriptions, and reports their names', () => {
    const r = filterSkillListing(LISTING, ORDER, keepWriting)
    expect(r).not.toBeNull()
    expect(r?.text).toBe(
      [
        H,
        '',
        '- claude-api: Reference for the Claude API.',
        'TRIGGER — read BEFORE opening the target file.',
        'SKIP only when another provider is being worked on.',
        '- writing-ecosystem: Draft and review articles.',
      ].join('\n'),
    )
    expect(r?.removed).toEqual(['adr-writer', 'growth-astra', 'hookify:configure', 'apps/web:deploy', 'tdd'])
  })
  test('names keep their namespace: split at the first ": ", not the first ":"', () => {
    expect(filterSkillListing(LISTING, ORDER, () => true)?.items.map((i) => i.name)).toEqual(ORDER)
  })
  test('keeping everything returns the input byte for byte, and filtering twice changes nothing', () => {
    expect(filterSkillListing(LISTING, ORDER, () => true)?.text).toBe(LISTING)
    const once = filterSkillListing(LISTING, ORDER, keepWriting)?.text ?? ''
    expect(filterSkillListing(once, ORDER, keepWriting)?.text).toBe(once)
  })
  test('an aliased line "- name (alias): text" is one item, matched by either name', () => {
    const text = [
      H,
      '',
      '- hookify:list',
      '- hookify:writing-rules (hookify:writing-hookify-rules): Write rules.',
    ].join('\n')
    const order = ['hookify:list', 'hookify:writing-hookify-rules']
    const r = filterSkillListing(text, order, (i) => i.name !== 'hookify:list')
    expect(r?.text).toBe([H, '', '- hookify:writing-rules (hookify:writing-hookify-rules): Write rules.'].join('\n'))
    expect(r?.items[1]).toEqual({
      name: 'hookify:writing-rules',
      alias: 'hookify:writing-hookify-rules',
      key: 'hookify:writing-hookify-rules',
    })
  })
  test('a synced skill is listed under its plugin prefix', () => {
    const text = [H, '', '- anthropic-skills:docx: Word files.', '- tdd: Tests.'].join('\n')
    const r = filterSkillListing(text, ['docx', 'tdd'], (i) => i.key === 'tdd')
    expect(r?.removed).toEqual(['anthropic-skills:docx'])
  })
  test('bullets inside a description stay with their skill, even when one names a real skill', () => {
    const text = [
      H,
      '',
      '- helper: Help.',
      '- router: Route a request.',
      '- helper: when the request needs the helper',
      '- note: keep it short',
      '- tdd: Tests.',
    ].join('\n')
    const order = ['helper', 'router', 'tdd']
    const r = filterSkillListing(text, order, (i) => i.name !== 'helper')
    expect(r?.text).toBe(text.replace('\n- helper: Help.', ''))
    expect(r?.removed).toEqual(['helper'])
    expect(r?.items.map((i) => i.name)).toEqual(order)
  })
  test('when either line could be the item, the listing is not parsed (null)', () => {
    // "helper" comes after router in the order, so its bullet inside router's description and its own line both fit.
    const text = [H, '', '- router: Route.', '- helper: when needed', '- helper: Help.'].join('\n')
    expect(filterSkillListing(text, ['router', 'helper'], () => false)).toBeNull()
  })
  test('a skill the listing left out (budget) is skipped; an order the listing breaks is not parsed', () => {
    const text = [H, '', '- a: A.', '- c: C.'].join('\n')
    expect(filterSkillListing(text, ['a', 'b', 'c'], () => true)?.text).toBe(text)
    expect(filterSkillListing(text, ['c', 'a'], () => true)).toBeNull()
  })
  test('an unexpected format is not parsed (null), so the caller passes it through', () => {
    expect(filterSkillListing('Something else entirely\n- a: b', ['a'], () => false)).toBeNull()
    expect(filterSkillListing('', [], () => false)).toBeNull()
    expect(filterSkillListing(`${H}\n\n- unknown: x`, ['a'], () => false)).toBeNull()
  })
})

describe('filterDeferredTools', () => {
  const DELTA = [
    'The following tools just became available and are ready to use:',
    'mcp__claude_ai_Claude_Docs__batch',
    '',
    'The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:',
    'CronCreate',
    'LSP',
    'mcp__claude_ai_Slack__slack_send_message',
    'WebFetch',
  ].join('\n')

  test('drops the names of tools that are off, keeps headers and the rest', () => {
    const r = filterDeferredTools(DELTA, (n) => n !== 'LSP' && !n.startsWith('mcp__claude_ai_Slack__'))
    expect(r.text).not.toContain('\nLSP')
    expect(r.text).not.toContain('slack_send_message')
    expect(r.text).toContain('\nCronCreate\n')
    expect(r.text).toContain('The following deferred tools')
    expect(r.removed).toEqual(['LSP', 'mcp__claude_ai_Slack__slack_send_message'])
  })
  test('keeping everything returns the input unchanged', () => {
    expect(filterDeferredTools(DELTA, () => true).text).toBe(DELTA)
  })
})

describe('filterInstructionFiles', () => {
  const files = [
    { path: '/h/.claude/CLAUDE.md', kind: 'user', content: 'a' },
    { path: '/h/.claude/rules/common/testing.md', kind: 'user', content: 'bb' },
    {
      path: '/h/.claude/rules/common/imported.md',
      kind: 'user',
      content: 'c',
      parent: '/h/.claude/rules/common/testing.md',
    },
    {
      path: '/h/.claude/rules/common/deeper.md',
      kind: 'user',
      content: 'd',
      parent: '/h/.claude/rules/common/imported.md',
    },
    { path: '/r/CLAUDE.md', kind: 'project', content: 'p' },
    { path: '/org/CLAUDE.md', kind: 'managed', content: 'm' },
    { path: '/h/.claude/projects/x/memory/MEMORY.md', kind: 'memory', content: 'mem' },
  ] as const

  test('drops matching user files and everything they imported', () => {
    const r = filterInstructionFiles(files, (p) => !p.endsWith('/testing.md'))
    expect(r.files.map((f) => f.path)).toEqual([
      '/h/.claude/CLAUDE.md',
      '/r/CLAUDE.md',
      '/org/CLAUDE.md',
      '/h/.claude/projects/x/memory/MEMORY.md',
    ])
    expect(r.removed).toEqual([
      '/h/.claude/rules/common/testing.md',
      '/h/.claude/rules/common/imported.md',
      '/h/.claude/rules/common/deeper.md',
    ])
  })
  test('never drops project, local, managed or memory files, even when they match', () => {
    const r = filterInstructionFiles(files, () => false)
    expect(r.files.map((f) => f.kind)).toEqual(['project', 'managed', 'memory'])
  })
  test('keeping everything returns the same list', () => {
    expect(filterInstructionFiles(files, () => true).files).toEqual(files)
  })
})

describe('configDirFromPluginRoot', () => {
  test('an installed copy sits under <config dir>/plugins/', () => {
    expect(configDirFromPluginRoot('/u/me/.claude/plugins/cache/harness-scope/harness-scope/0.1.1')).toBe(
      '/u/me/.claude',
    )
    expect(configDirFromPluginRoot('/cfg/plugins/marketplaces/harness-scope/plugin')).toBe('/cfg')
  })
  test('a checkout loaded with --plugin-dir has no config dir', () => {
    expect(configDirFromPluginRoot('/u/me/src/harness-scope/plugin')).toBe(null)
  })
})

describe('expandTilde', () => {
  test('~/.claude/ maps onto the config dir', () => {
    expect(expandTilde('~/.claude/rules/a.md', '/cfg')).toBe('/cfg/rules/a.md')
  })
  test('other ~/ paths use the home above a .claude config dir', () => {
    expect(expandTilde('~/notes/CLAUDE.md', '/u/me/.claude')).toBe('/u/me/notes/CLAUDE.md')
  })
  test('without a home to derive, other ~/ paths stay as written', () => {
    expect(expandTilde('~/notes/CLAUDE.md', '/cfg')).toBe('~/notes/CLAUDE.md')
    expect(expandTilde('/abs/x.md', '/cfg')).toBe('/abs/x.md')
  })
})
