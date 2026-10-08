// Filters for the text listings Claude Code injects (formats measured on 2.1.287 and 2.1.294; see docs/measurements/).
// Pure. Kept items stay byte for byte, so the output is a stable function of the input (prompt cache).

const SKILL_HEADER = 'The following skills are available for use with the Skill tool:'
// "- name", "- name: description", "- name (alias): description". Names and aliases hold no whitespace.
const ITEM_LINE = /^- (\S+)(?: \((\S+)\))?(?:: |$)/

export type Filtered = { readonly text: string; readonly removed: readonly string[] }

/** One skill as the listing writes it: `key` is the name `session.usage` gives it. */
export type SkillItem = { readonly name: string; readonly alias: string | undefined; readonly key: string }

export type SkillFiltered = Filtered & {
  readonly items: readonly SkillItem[]
  readonly removedItems: readonly SkillItem[]
}

// The usage name a listing line stands for: its name, its alias, or the name past a plugin prefix (synced skills
// are `docx` in usage and `anthropic-skills:docx` in the listing).
function resolve(known: ReadonlySet<string>, name: string, alias: string | undefined): string | undefined {
  if (known.has(name)) return name
  if (alias !== undefined && known.has(alias)) return alias
  const colon = name.indexOf(':')
  if (colon !== -1 && known.has(name.slice(colon + 1))) return name.slice(colon + 1)
  return undefined
}

type Candidate = { readonly line: number; readonly item: SkillItem }

// Line numbers that start an item, aligned with `order` (the listing keeps usage's order). A description line that
// looks like an item ("- other-skill: when …") is a second candidate for that key; the alignment decides which line
// is the item. null when the order is broken or two alignments fit (the caller passes the listing through).
function align(order: readonly string[], candidates: readonly Candidate[]): Candidate[] | null {
  const byKey = new Map<string, Candidate[]>()
  for (const c of candidates) byKey.set(c.item.key, [...(byKey.get(c.item.key) ?? []), c])
  const keys = order.filter((k) => byKey.has(k)) // a skill the listing left out (budget) has no line to align
  const first: Candidate[] = []
  for (const k of keys) {
    const after = first.at(-1)?.line ?? -1
    const c = byKey.get(k)?.find((x) => x.line > after)
    if (c === undefined) return null
    first.push(c)
  }
  const last: Candidate[] = []
  for (const k of [...keys].reverse()) {
    const before = last.at(-1)?.line ?? Number.POSITIVE_INFINITY
    const c = byKey.get(k)?.findLast((x) => x.line < before)
    if (c === undefined) return null
    last.push(c)
  }
  last.reverse()
  return first.every((c, i) => c.line === last[i]?.line) ? first : null
}

/**
 * Removes skill items that `keep` rejects. `order` is every skill name `session.usage` reports, in its order.
 * Returns null when the text is not the listing format this build writes, or when which lines start items is
 * ambiguous, so the caller passes it through instead of guessing.
 */
export function filterSkillListing(
  text: string,
  order: readonly string[],
  keep: (item: SkillItem) => boolean,
): SkillFiltered | null {
  if (!text.startsWith(SKILL_HEADER)) return null
  const known = new Set(order)
  const lines = text.split('\n')
  const candidates: Candidate[] = []
  lines.forEach((line, i) => {
    const m = i === 0 ? null : ITEM_LINE.exec(line)
    const name = m?.[1]
    if (name === undefined) return
    const key = resolve(known, name, m?.[2])
    if (key !== undefined) candidates.push({ line: i, item: { name, alias: m?.[2], key } })
  })
  const starts = align(order, candidates)
  if (starts === null || starts.length === 0) return null
  const out = lines.slice(0, starts[0]?.line)
  const removedItems: SkillItem[] = []
  starts.forEach((s, i) => {
    const body = lines.slice(s.line, starts[i + 1]?.line ?? lines.length)
    if (keep(s.item)) out.push(...body)
    else removedItems.push(s.item)
  })
  return {
    text: out.join('\n'),
    removed: removedItems.map((r) => r.name),
    removedItems,
    items: starts.map((s) => s.item),
  }
}

/** Names of the tools in a deferred-tools list (one per line, no spaces). */
export function deferredToolNames(text: string): string[] {
  return text.split('\n').filter((line) => line.length > 0 && !/\s/.test(line))
}

/** Removes tool names (one per line, no spaces) that `keep` rejects; headers and blank lines stay. */
export function filterDeferredTools(text: string, keep: (name: string) => boolean): Filtered {
  const removed: string[] = []
  const lines = text.split('\n').filter((line) => {
    const isName = line.length > 0 && !/\s/.test(line)
    if (!isName || keep(line)) return true
    removed.push(line)
    return false
  })
  return { text: lines.join('\n'), removed }
}
