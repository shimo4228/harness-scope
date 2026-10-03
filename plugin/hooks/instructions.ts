// Instruction-file filter for prompt.context. Pure.
// Only the user's own files (kind "user") can be turned off; project, local, managed and memory files always stay.

export type InstructionFileLike = { readonly path: string; readonly kind: string; readonly parent?: string }

export function filterInstructionFiles<F extends InstructionFileLike>(
  files: readonly F[],
  keepPath: (path: string) => boolean,
): { readonly files: readonly F[]; readonly removed: readonly string[] } {
  const dropped = new Set<string>()
  // Files arrive with each import after the file that imported it, so one pass carries a drop down the chain.
  for (const f of files) {
    if (f.kind !== 'user') continue
    if (!keepPath(f.path) || (f.parent !== undefined && dropped.has(f.parent))) dropped.add(f.path)
  }
  if (dropped.size === 0) return { files, removed: [] }
  return { files: files.filter((f) => !dropped.has(f.path)), removed: [...dropped] }
}
