// Profiles shipped with the mod. A profile of the same name in ~/.claude/harness-scope/profiles/ takes precedence.
import type { Profile } from './profile'

export const BUNDLED: Readonly<Record<string, Profile>> = {
  // Writing repos: only the repo's own skills, two general agents, no code-only tools.
  writing: {
    skills: { mode: 'allow', patterns: [] },
    agents: { mode: 'allow', patterns: ['Explore', 'general-purpose'] },
    tools: { mode: 'deny', patterns: ['LSP', 'NotebookEdit', 'EnterWorktree', 'ExitWorktree'] },
  },
}
