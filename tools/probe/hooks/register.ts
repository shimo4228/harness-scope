// Records what Claude Code composes for the model, unchanged (RFC-0001 Phase 0).
// Every hook reads the result of next(e): prompt.compose's input carries no sections.
// Output: JSON lines at $PROSE_PROBE_OUT, rewritten after each event; nothing is written when it is unset.
import type { EngineInterface, On } from 'claude-code'

type Row = Record<string, unknown>

const rows: Row[] = []
let outPath: string | undefined
let outResolved = false
let usageRecorded = false

// Kinds whose full text the fixtures need; other attachments keep only their size.
const FULL_TEXT = new Set([
  'skill_listing',
  'instructions',
  'deferred_tools_delta',
  'agent_listing_delta',
  'nested_memory',
])

async function flush($: EngineInterface, row: Row): Promise<void> {
  rows.push({ at: rows.length, ...row })
  if (!outResolved) {
    outPath = await $.env.get('PROSE_PROBE_OUT')
    outResolved = true
  }
  if (outPath === undefined) return
  await $.fs.write(outPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`)
}

export function register(on: On): void {
  on('classic.SessionStart', async ($, e, next) => {
    await flush($, { kind: 'session_start', source: e.source })
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    await flush($, {
      kind: 'compose',
      model: e.model,
      traits: e.traits,
      outputStyle: e.outputStyle,
      sections: r.sections.map((s) => ({ id: s.id, scope: s.scope, chars: s.text.length, text: s.text })),
    })
    return r
  })

  on('prompt.section', async ($, e, next) => {
    const r = await next(e)
    await flush($, { kind: 'section', id: e.name, chars: (r.text ?? '').length })
    return r
  })

  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    await flush($, {
      kind: 'context',
      blocks: r.blocks.map((b) => ({ name: b.name, chars: b.text.length })),
      instructionFiles:
        r.instructionFiles?.map((f) => ({ path: f.path, kind: f.kind, parent: f.parent, chars: f.content.length })) ??
        null,
    })
    return r
  })

  on('prompt.attachment', async ($, e, next) => {
    const r = await next(e)
    const text = r.text ?? ''
    await flush($, {
      kind: 'attachment',
      type: e.type,
      origin: e.origin.kind,
      agentId: e.agentId,
      chars: text.length,
      text: FULL_TEXT.has(e.type) ? text : undefined,
    })
    return r
  })

  on('tool.describe', async ($, e, next) => {
    const r = await next(e)
    await flush($, {
      kind: 'tool',
      id: e.tool,
      provider: e.provider,
      isDeferredIn: e.isDeferred ?? false,
      isDeferredOut: r.isDeferred,
      chars: r.description.length,
    })
    return r
  })

  on('agent.offer', async ($, e, next) => {
    const r = await next(e)
    await flush($, {
      kind: 'agent',
      id: e.agent,
      source: e.source,
      provider: e.provider,
      chars: e.description.length,
      isOffered: r.isOffered,
    })
    return r
  })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    await flush($, { kind: 'skill_call', input: { ...e } })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!usageRecorded && e.agentId === undefined) {
      usageRecorded = true
      const usage = await $.session.usage({ breakdown: 'summary' })
      await flush($, { kind: 'usage', context: usage.context })
    }
    return next(e)
  })
}
