# harness-scope

The Claude Code Mod itself: the folder Claude Code installs. It turns your global skills, agents, instruction files (CLAUDE.md and rules) and tools on or off per repo, using named profiles you keep in `~/.claude/harness-scope/profiles/`. A repo picks one profile with a one-line `.claude/harness-scope.json`; the repo's own skills, agents and CLAUDE.md always stay.

Usage, profile format, measurements and limitations are in the [repository README](https://github.com/shimo4228/harness-scope#readme).
