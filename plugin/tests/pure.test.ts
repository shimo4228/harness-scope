// Pure parts of harness-scope: profile parsing, listing filters, instruction-file filters.
// Fixtures mimic the 2.1.287 formats measured in docs/measurements/2026-10-03-phase0.md.
import { describe, expect, test } from 'claude-code/testing'
import { filterInstructionFiles } from '../hooks/instructions'
import { filterDeferredTools, filterSkillListing } from '../hooks/listing'
import { compileRule, parseProfile, parseSelector } from '../hooks/profile'

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
  const keepWriting = (name: string) => name === 'writing-ecosystem' || name === 'claude-api'

  test('removes whole items, including multi-line descriptions, and reports their names', () => {
    const r = filterSkillListing(LISTING, keepWriting)
    expect(r).not.toBeNull()
    expect(r?.text).toBe(
      [
        'The following skills are available for use with the Skill tool:',
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
    const seen: string[] = []
    filterSkillListing(LISTING, (n) => {
      seen.push(n)
      return true
    })
    expect(seen).toEqual([
      'adr-writer',
      'claude-api',
      'growth-astra',
      'hookify:configure',
      'apps/web:deploy',
      'writing-ecosystem',
      'tdd',
    ])
  })
  test('keeping everything returns the input byte for byte, and filtering twice changes nothing', () => {
    expect(filterSkillListing(LISTING, () => true)?.text).toBe(LISTING)
    const once = filterSkillListing(LISTING, keepWriting)?.text ?? ''
    expect(filterSkillListing(once, keepWriting)?.text).toBe(once)
  })
  test('a bullet inside a description stays with its skill', () => {
    const text = [
      'The following skills are available for use with the Skill tool:',
      '',
      '- writing-ecosystem: Draft articles.',
      '- Use when drafting an essay',
      '- tdd: RED GREEN REFACTOR.',
    ].join('\n')
    const r = filterSkillListing(text, (n) => n === 'writing-ecosystem')
    expect(r?.removed).toEqual(['tdd'])
    expect(r?.text).toContain('- Use when drafting an essay')
  })
  test('an unexpected format is not parsed (null), so the caller passes it through', () => {
    expect(filterSkillListing('Something else entirely\n- a: b', () => false)).toBeNull()
    expect(filterSkillListing('', () => false)).toBeNull()
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
