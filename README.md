[English](README.md) | [日本語](README.ja.md)

# harness-scope

Claude Code showed my writing repo 101 skills. 94 didn't belong. This mod hides them with one line.

![Claude Code mod 2.1.287+](https://img.shields.io/badge/Claude%20Code%20mod-2.1.287%2B-D97757)
![version 0.1.3](https://img.shields.io/badge/version-0.1.3-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

**[Quick start](#quick-start)** · [How it works](#how-it-works) · [Profiles](#profiles) · [Limitations](#limitations)

<p align="center">
  <img src="assets/overview.svg" width="760" alt="You keep named profiles, such as writing, once in ~/.claude. A repo picks one with a one-line JSON file, and Claude then sees only the skills, agents, rules and tools that profile allows. The repo's own skills, agents and CLAUDE.md always stay.">
</p>

harness-scope is a Claude Code mod (a plugin whose code runs inside Claude Code, added in 2.1.287 as Claude Mods) that turns your global skills, agents, instruction files (CLAUDE.md and rules) and tools on or off per repo. You keep named profiles once in `~/.claude`. A repo picks one with a one-line file, and Claude sees only what that profile allows. The repo's own skills, agents and CLAUDE.md always stay.

It is for Claude Code users whose harness (the CLAUDE.md, rules, skills and agents under `~/.claude`, plus their plugins) follows them into repos where most of it does not belong. I built it to keep my coding setup out of my writing repo.

## What changes

Measured on 2026-10-03 in my writing repo with the bundled `writing` profile (Claude Code 2.1.287, `claude -p`):

| | Without harness-scope | With `writing` |
|---|---|---|
| Skill listing | 101 skills, 26,551 chars | the repo's own 7, 1,623 chars |
| Agent listing | 38 types, 18,988 chars | the repo's own 7 + Explore, general-purpose; 4,134 chars |
| Calling an off skill (`tdd`) | loads | refused, with the reason |

Your numbers depend on how many skills, plugins and MCP servers you have. To check yours, run `/context` in a repo and look at the skills it lists: if most of them have nothing to do with that repo, this is for you. If you have only a handful, you probably do not need it.

## Quick start

You need Claude Code 2.1.287 or later, where mods are on by default. No account or API key.

1. Install the mod once:

   ```bash
   claude plugin install harness-scope --marketplace shimo4228/harness-scope
   ```

   In a session, `/plugin` then names it on the line under the tabs, for example `1 mod active · harness-scope`.

2. In the repo, add `.claude/harness-scope.json`. The `writing` profile ships with the mod; to write your own, see [Profiles](#profiles).

   ```json
   { "profile": "writing" }
   ```

3. Start a new conversation in that repo, or run `/clear`. This line on screen means the profile is on:

   ```text
   harness-scope: profile "writing" from bundled profile "writing", selected by /home/me/essays/.claude/harness-scope.json
   ```

   If no line appears, or the line says it is passing everything through, nothing is turned off. A mod that did not load cannot print a warning, so the missing line is the signal.

After the first message, run `/harness-scope` to see what the profile turned off. From a test repo on Claude Code 2.1.294, without the first line (it repeats the line above) and with the name lists trimmed:

```text
skills (allow): 90 off — adr-writer, archify, authorship-strategy, …
agents (allow): 30 off — adr-reviewer, architect, claude, …
instructions: not in the profile
tools (deny): 4 off — EnterWorktree, ExitWorktree, LSP, NotebookEdit
```

It also lists patterns in your profile that matched nothing. The list stays on your screen and out of the conversation; only under `claude -p`, which has no screen, does it come back as the command's output.

To undo it in one repo, delete `.claude/harness-scope.json`; everywhere, run `claude plugin uninstall harness-scope@harness-scope`. The mod writes no files, so there is nothing else to clean up. Repos without the file are never changed.

## How it works

Before each request, Claude Code assembles what Claude will see: your instruction files, the skill listing, the agent types it may call and the tool list. As a mod, harness-scope hooks into that step and removes whatever the profile turns off. It adds no instructions of its own. The only thing it blocks is a call to a skill or tool it removed, and the refusal tells Claude which profile turned it off. If the profile cannot be read, it changes nothing and says so on screen. Each hook and what it changes is listed in [plugin/README.md](plugin/README.md).

## Profiles

A profile is a JSON file at `~/.claude/harness-scope/profiles/<name>.json`. Each category takes either `allow` (keep only these) or `deny` (turn off only these). Names and paths accept `*` and `?` globs. A category left out stays as it is.

```json
{
  "skills": { "allow": ["writing-ecosystem", "prose-translation", "anthropic-skills:docx"] },
  "agents": { "allow": ["Explore", "general-purpose"] },
  "instructions": { "deny": ["~/.claude/rules/common/testing.md"] },
  "tools": { "deny": ["LSP", "NotebookEdit", "mcp__claude_ai_Slack__*"] }
}
```

- `skills` and `agents` match names as they appear in Claude's listings, whatever their source: your own, a plugin's (`plugin:skill`), built-in, or synced from claude.ai.
- `instructions` matches paths of your own instruction files, and `~/` works. A file pulled in with `@` goes with the file that imported it.
- `tools` matches tool names, MCP tools included.

Three starting points:

- **Writing, only the repo's own skills:** the bundled `writing`. It also keeps the Explore and general-purpose agents and turns off LSP, NotebookEdit, EnterWorktree and ExitWorktree.
- **Docs, a few global skills:** `{ "skills": { "allow": ["prose-translation", "anthropic-skills:docx"] } }`
- **Research, no coding rules and no GitHub tools:** `{ "instructions": { "deny": ["~/.claude/rules/common/testing.md"] }, "tools": { "deny": ["mcp__github__*"] } }`

A file in `~/.claude/harness-scope/profiles/` with the same name as a bundled profile takes precedence. If you switch configurations with `CLAUDE_CONFIG_DIR`, profiles are read from that directory instead (`<dir>/harness-scope/profiles/`). The mod does not read the variable; it finds the directory from where it is installed. The repo file is looked up in the session's root directory first, then in the git repo's root.

## Why an allowlist

Claude Code shows every repo the same global harness. In my writing repo, the skill listing held 101 skills: the repo's own 7, and 94 from my global setup, plugins, built-ins and claude.ai, `tdd` among them.

The native settings can turn these off at project scope (checked on Claude Code 2.1.287 and 2.1.294). Each one is a denylist that names what to hide, written into each repo's `.claude/settings.json`:

```json
{
  "skillOverrides": { "tdd": "off", "adr-writer": "off", "…": "off" },
  "enabledPlugins": { "codex@openai-codex": false, "…": false },
  "permissions":    { "deny": ["Agent(Plan)", "LSP", "…"] }
}
```

With harness-scope, each repo holds `{ "profile": "writing" }` and the list lives once in the profile. What the native route lacks:

- **No allowlist.** A skill you add to `~/.claude` later appears in every repo until you deny it there too.
- **Plugins only as a whole.** `skillOverrides` turns off your own, built-in and claude.ai-synced skills one by one, but a plugin's skills go on or off only with the whole plugin, its agents included.
- **No shared sets.** Each repo's settings are copied by hand.

A harness-scope profile covers skills, agents, instruction files and tools together, so there is one place to look when something is off.

Turning off a few skills hardly shrinks the listing, because Claude Code fills it up to a budget and shortens descriptions to fit: on 2.1.287, turning off 3 skills took it only from 26,551 to 26,534 characters. An allowlist that turns off most of them shrinks it.

Other tools that narrow what Claude sees (as of 2026-10-03):

- **[claude-loadout](https://pypi.org/project/ccloadout/)** is a launcher in front of Claude Code; a local model picks MCP servers, plugins and skills per repo. harness-scope needs no launcher, decides by the rules written in the profile rather than by a model's pick, and also covers agents and rules.
- **[bridle](https://github.com/neiii/bridle)** is a config manager that switches whole Claude Code (and other agents') configurations by profile. harness-scope keeps one configuration and narrows it per repo.

## What it never touches

Whatever a profile says, harness-scope leaves these alone:

- The repo's own skills and agents, and every instruction file that is not yours: the repo's CLAUDE.md and rules, local and managed files, and auto memory.
- Reminders added by hooks or other plugins.
- Repos without `.claude/harness-scope.json`. A broken file or an unknown profile name changes nothing, and a line on screen says why.

The repo file can only name a profile. A cloned repo cannot define its own profile and use it to turn off your rules; it can only pick one of yours, and the line on screen tells you when it does.

A mod can do anything you can, so check what this one asks for before you install it: `claude plugin validate` on a clone's `plugin/` folder prints a `calls:` line, and for harness-scope it lists only reads (`$.fs.exists`, `$.fs.read`, `$.session.*`), the on-screen line (`$.ui.log`) and the `/harness-scope` command. It reads the profile, the repo file, and the list of skills Claude Code has loaded with where each came from (to tell the repo's own skills apart). It reads no environment variables: it finds `~/.claude` from where it is installed. It writes no files, makes no network requests, starts no processes and calls no model.

## Limitations

- It controls what Claude is shown, not what Claude can read. Claude can still open a skill's SKILL.md file directly.
- Instruction files attached later in a conversation (rules with `paths:`, CLAUDE.md files in subdirectories) are not turned off.
- A tool turned off here leaves Claude's main tool list and is refused when called, but Claude can still find its name by searching for tools (ToolSearch). A native `permissions.deny` entry removes it completely; a command to sync profiles into `permissions.deny` is planned for v0.2.
- Profile changes apply from a new conversation or `/clear`.
- If one of your own agents has the same name as a built-in one (such as Explore), turning it off hides the built-in as well.
- A line inside a skill description shaped like `- name: text` can be read as a separate skill.
- Checked on Claude Code 2.1.287 and 2.1.294. On 2.1.294 it loaded in 20 of 20 test runs (2026-10-08). On 2.1.287, 1 of 9 runs did not load it, with no error; that run filtered nothing. The cause is not confirmed.
- Listing formats can change between Claude Code releases. If the skill listing comes in a format it does not recognize, it passes through unchanged, so a break shows up as nothing being turned off, and `/harness-scope` says so.

## Design notes

The [proposal and prior art](rfcs/0001-prose-mod.md), the [design](docs/plans/rfc-0001-r2-profile-allowlist.md), and the measurements behind the numbers above ([2026-10-03 on 2.1.287](docs/measurements/2026-10-03-phase0.md), [2026-10-08 on 2.1.294](docs/measurements/2026-10-08-readme-checks.md)) are in Japanese.

To try the mod from a clone, start Claude Code with `claude --plugin-dir <path to the clone>/plugin`. Loaded that way, it cannot tell where `~/.claude` is, so only the bundled profiles work until you set the `configDir` field with `claude plugin configure harness-scope`.

To work on it: `npm ci`, then `.claude/verify.sh` (Biome, TypeScript, `claude plugin validate --strict`, `claude plugin test`, `npm audit`).

## More from the author

- **Give Claude Code a Second Harness** ([Dev.to](https://dev.to/shimo4228/give-claude-code-a-second-harness-27of) / [Zenn, Japanese](https://zenn.dev/shimo4228/articles/claude-code-claudemd-excludes)): swapping the whole harness for experiments. `CLAUDE_CONFIG_DIR` moves skills and agents but leaves CLAUDE.md and rules behind; `claudeMdExcludes` covers the rest.
- **[claude-harness](https://github.com/shimo4228/claude-harness)**: the personal harness (rules, skills, agents) that this mod narrows in my writing repo.
- **[akc-cycle](https://github.com/shimo4228/akc-cycle)**: the Agent Knowledge Cycle as one rules file plus a Claude Code plugin, another install target cut from the same harness.
- **[shimo4228](https://github.com/shimo4228/shimo4228)**: my other projects and writing.

## License

[MIT](LICENSE)

<details>
<summary>For tools and AI assistants</summary>

harness-scope is a Claude Code mod (a plugin with a hooks module, the extension type added in Claude Code 2.1.287 and listed in its changelog as Claude Mods), for Claude Code users with a large global setup, that turns global skills, agents, instruction files (CLAUDE.md and rules) and tools on or off per repository through named profiles.

**Why it exists.** Claude Code shows every repository the same global harness (`~/.claude` plus installed plugins). The native project settings (`skillOverrides`, `enabledPlugins`, `claudeMdExcludes`, `permissions.deny`) are per-repo denylists: there is no allowlist, a plugin's skills switch only with the whole plugin (own, built-in and claude.ai-synced skills can be turned off one by one with `skillOverrides`, checked on 2.1.294), and nothing is shared across repos. harness-scope adds allowlists and denylists in shared, named profiles, chosen per repo by a one-line file.

**Facts.**

- Name: harness-scope. Version 0.1.3. License MIT. Author: shimo4228.
- Form: a Claude Code mod (a plugin's hooks module) written in TypeScript, in `plugin/hooks/` (`register.ts`, `profile.ts`, `listing.ts`, `instructions.ts`, `bundled.ts`).
- Requires Claude Code 2.1.287 or later. Checked on 2.1.287 and 2.1.294. No account, API key, network access, child processes or model calls.
- Install: `claude plugin install harness-scope --marketplace shimo4228/harness-scope` (or `claude plugin marketplace add shimo4228/harness-scope`, then `claude plugin install harness-scope@harness-scope`).
- Selector: `.claude/harness-scope.json` in the repository, containing only `{ "profile": "<name>" }`. Looked up in the session root, then the git root.
- Profiles: `~/.claude/harness-scope/profiles/<name>.json`, with optional `skills`, `agents`, `instructions` and `tools`, each `{ "allow": [...] }` or `{ "deny": [...] }` with `*` / `?` globs. Bundled profile: `writing` (only the repo's own skills; agents Explore and general-purpose; tools LSP, NotebookEdit, EnterWorktree, ExitWorktree off).
- Hooks: `prompt.context` removes the user's own instruction files; `prompt.attachment` filters the skill listing and the deferred tool list; `agent.offer` withholds agent types; `tool.describe` defers tools; `tool.call` refuses turned-off tools and skills. `/harness-scope` reports what was turned off.
- Always kept: the repository's own skills, agents and instruction files, managed and local files, auto memory, and text added by hooks or other plugins. Without a selector, or with an unreadable profile, everything passes through.

**Example.** Measured 2026-10-03 on Claude Code 2.1.287 in the author's writing repository with the `writing` profile: the skill listing went from 101 skills (26,551 characters) to the repository's own 7 (1,623 characters); the agent listing from 38 types (18,988 characters) to 9 (4,134 characters); a Skill call to the turned-off `tdd` was refused with the reason.

**Links.** Proposal and prior art: [rfcs/0001-prose-mod.md](rfcs/0001-prose-mod.md). Design: [docs/plans/rfc-0001-r2-profile-allowlist.md](docs/plans/rfc-0001-r2-profile-allowlist.md). Measurements: [docs/measurements/2026-10-03-phase0.md](docs/measurements/2026-10-03-phase0.md) (2.1.287) and [docs/measurements/2026-10-08-readme-checks.md](docs/measurements/2026-10-08-readme-checks.md) (2.1.294: 20 of 20 loads, `skillOverrides` on built-in and synced skills). Plugin reference (hooks and data): [plugin/README.md](plugin/README.md).

</details>
