// Profile and selector parsing. Pure: no `$` (the engine interface cannot be passed into imported functions).
// A repo's selector names a profile and nothing else, so a cloned repo cannot turn off the user's own rules.

export type Rule = { readonly mode: 'allow' | 'deny'; readonly patterns: readonly string[] }

export type Profile = {
  readonly skills?: Rule
  readonly agents?: Rule
  readonly instructions?: Rule
  readonly tools?: Rule
}

export type Parsed<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly reason: string }

const CATEGORIES = ['skills', 'agents', 'instructions', 'tools'] as const
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseSelector(text: string): Parsed<{ readonly profile: string }> {
  const v = parseJson(text)
  if (!isRecord(v)) return { ok: false, reason: 'the selector is not a JSON object' }
  const keys = Object.keys(v)
  if (keys.length !== 1 || keys[0] !== 'profile') return { ok: false, reason: 'the selector may only hold "profile"' }
  const name = v.profile
  if (typeof name !== 'string' || !PROFILE_NAME.test(name)) {
    return { ok: false, reason: '"profile" must be a name of letters, digits, "_" and "-"' }
  }
  return { ok: true, profile: name }
}

function parseRule(category: string, v: unknown): Parsed<{ readonly rule: Rule }> {
  if (!isRecord(v)) return { ok: false, reason: `"${category}" must be an object` }
  const keys = Object.keys(v)
  if (keys.length !== 1 || (keys[0] !== 'allow' && keys[0] !== 'deny')) {
    return { ok: false, reason: `"${category}" takes exactly one of "allow" or "deny"` }
  }
  const mode = keys[0]
  const patterns = v[mode]
  if (!Array.isArray(patterns) || !patterns.every((p): p is string => typeof p === 'string')) {
    return { ok: false, reason: `"${category}.${mode}" must be a list of strings` }
  }
  return { ok: true, rule: { mode, patterns } }
}

export function parseProfile(text: string): Parsed<{ readonly profile: Profile }> {
  const v = parseJson(text)
  if (!isRecord(v)) return { ok: false, reason: 'the profile is not a JSON object' }
  const profile: Record<string, Rule> = {}
  for (const key of Object.keys(v)) {
    if (!(CATEGORIES as readonly string[]).includes(key)) {
      return { ok: false, reason: `unknown key "${key}" (use ${CATEGORIES.join(', ')})` }
    }
    const r = parseRule(key, v[key])
    if (!r.ok) return r
    profile[key] = r.rule
  }
  return { ok: true, profile }
}

function globToRegExp(glob: string): RegExp {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${body}$`)
}

/** Returns whether a name is kept under the rule. No rule keeps everything. */
export function compileRule(rule: Rule | undefined): (name: string) => boolean {
  if (rule === undefined) return () => true
  const regs = rule.patterns.map(globToRegExp)
  const matches = (name: string) => regs.some((r) => r.test(name))
  return rule.mode === 'allow' ? matches : (name) => !matches(name)
}

/** Patterns of a rule that matched none of the names seen (typos show up in the receipt). */
export function unmatchedPatterns(rule: Rule | undefined, seen: Iterable<string>): string[] {
  if (rule === undefined) return []
  const names = [...seen]
  return rule.patterns.filter((p) => !names.some((n) => globToRegExp(p).test(n)))
}
