// Filters for the text listings Claude Code injects (2.1.287 formats; see docs/measurements/2026-10-03-phase0.md).
// Pure. Kept items stay byte for byte, so the output is a stable function of the input (prompt cache).

const SKILL_HEADER = 'The following skills are available for use with the Skill tool:'

export type Filtered = { readonly text: string; readonly removed: readonly string[] }

/** An item runs from a line starting "- " to just before the next one; its name ends at the first ": " (or the line). */
function itemName(item: string): string {
  const firstLine = item.slice(2).split('\n', 1)[0] ?? ''
  const cut = firstLine.indexOf(': ')
  return cut === -1 ? firstLine : firstLine.slice(0, cut)
}

/**
 * Removes skill items whose name `keep` rejects. Returns null when the text is not the listing format
 * this build writes, so the caller passes it through instead of guessing.
 */
export function filterSkillListing(text: string, keep: (name: string) => boolean): Filtered | null {
  if (!text.startsWith(SKILL_HEADER)) return null
  const parts = text.split(/\n(?=- )/)
  const head = parts[0] ?? ''
  // Skill names hold no whitespace, so a "- " line whose name would have some is a bullet inside the previous description.
  const items: string[] = []
  for (const part of parts.slice(1)) {
    const last = items.length - 1
    if (/\s/.test(itemName(part)) && last >= 0) items[last] = `${items[last]}\n${part}`
    else items.push(part)
  }
  if (items.length === 0) return null
  const removed: string[] = []
  const kept = items.filter((item) => {
    const name = itemName(item)
    if (keep(name)) return true
    removed.push(name)
    return false
  })
  return { text: [head, ...kept].join('\n'), removed }
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
