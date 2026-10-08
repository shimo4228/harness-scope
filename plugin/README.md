# harness-scope

The Claude Code Mod itself: the folder Claude Code installs. It turns your global skills, agents, instruction files (CLAUDE.md and rules) and tools on or off per repo, using named profiles you keep in `~/.claude/harness-scope/profiles/`. A repo picks one profile with a one-line `.claude/harness-scope.json`; the repo's own skills, agents and CLAUDE.md always stay.

You decide what is hidden. Nothing changes in a repo until you put that file there, and the file can only name one of your profiles.

- **Is it on?** In a repo that selects a profile, a status line under the prompt reads `harness-scope: profile "writing" on`, and one line on screen says which file selected it. If that line is missing in such a repo, the Mod did not load.
- **What did it turn off?** Run `/harness-scope`. It lists what is off and kept, and any profile pattern that matched nothing (a typo).
- **What names can a profile use?** After one prompt, run `/harness-scope names`. It lists the skill, agent and tool names this conversation offered, in any repo.
- **How do I undo it?** Delete `.claude/harness-scope.json` and run `/clear` (or start a new conversation). To remove the Mod itself: `claude plugin uninstall harness-scope`. The Mod writes no files, so there is nothing else to clean up.

## Examples

1. **A writing repo that sees only its own skills.** Put `{ "profile": "writing" }` in the repo's `.claude/harness-scope.json`. The bundled `writing` profile keeps the repo's own skills, the Explore and general-purpose agents, and turns off LSP, NotebookEdit, EnterWorktree and ExitWorktree.
2. **Keep a few global skills in a docs repo.** Save `~/.claude/harness-scope/profiles/docs.json` as `{ "skills": { "allow": ["prose-translation", "anthropic-skills:docx"] } }` and select `docs` in the repo. Every other global, plugin and built-in skill drops out of the listing there.
3. **Hide coding rules and an MCP server's tools in a research repo.** Save `{ "instructions": { "deny": ["~/.claude/rules/common/testing.md"] }, "tools": { "deny": ["mcp__github__*"] } }` as a profile and select it. That rule file is not loaded, and the matching tools are refused when called.

## What each hook does

| Hook | What it changes |
|---|---|
| `classic.SessionStart` | Nothing in the session. On `/clear` and resume it forgets the loaded profile so the next request reads it again. |
| `session.start` | Registers the `/harness-scope` command. |
| `command.run` | Answers `/harness-scope` with what the profile turned off, and `/harness-scope names` with the names offered. Other commands pass through untouched. |
| `prompt.context` | Removes your own instruction files (kind `user`) that the profile turns off. Project, local, managed and memory files are never removed. |
| `prompt.attachment` | Removes turned-off skills from the skill listing and turned-off tools from the deferred tool list. Reminders from hooks and other plugins pass through untouched. If it cannot tell for sure where each skill's entry starts, it leaves the listing as it is and says so on screen. |
| `agent.offer` | Stops offering agent types the profile turns off. The repo's own agents are always offered. |
| `tool.describe` | Moves turned-off tools behind ToolSearch. |
| `tool.call` | Refuses calls to turned-off tools, and Skill calls to skills it removed from the listing, with the reason. |

With no `.claude/harness-scope.json`, or with a profile it cannot read, every hook passes everything through unchanged. A profile it cannot read is reported once on screen and in the status line.

## Data

The Mod reads the profile files in `~/.claude/harness-scope/profiles/`, the repo's `.claude/harness-scope.json`, and Claude Code's session usage (only to tell the repo's own skills apart). It reads no environment variables: it finds `~/.claude` from where the plugin is installed, or from the optional `configDir` setting. It writes nothing, sends nothing over the network, starts no processes and calls no model.

Usage, the profile format, measurements and limitations are in the README of the shimo4228/harness-scope repository on GitHub.
