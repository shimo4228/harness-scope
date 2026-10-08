"""End-to-end product eval for harness-scope against the installed Claude Code (real `claude -p`, no mocks).

Usage: python3 tools/eval/e2e.py [--plugin plugin] [--model haiku] [--json out.json] [--only a,b,...]

Each case builds a throwaway git repo, runs `claude -p` with the probe (tools/probe) loaded OUTSIDE the plugin under
test (the first --plugin-dir is the outer hook, so the probe records what the model receives), and grades the
recorded listings and the stream-json events with deterministic checks. The installed copy of harness-scope, if
any, is disabled with --settings so only the checkout under test runs. The user's own ~/.claude stays visible:
the eval measures the plugin in the environment it runs in, and pass-through cases compare against a no-plugin
run in that same environment.

Dimensions (docs/measurements/2026-10-08-product-eval.md):
  a effect       — off items leave the listings; calls to them are refused with the reason
  b pass-through — no selector / broken selector / unknown profile / broken profile change nothing, and say so
  c first-run    — one screen line on activation; /harness-scope answers what, from where, and how to undo
  d robustness   — aliased listing lines and "- name: text" bullets inside descriptions are not misread
  s static       — the shipped folder reads no env, writes no file, starts no process, opens no socket
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROBE = ROOT / "tools" / "probe"
FIXTURE_PLUGIN = Path(__file__).resolve().parent / "fixtures" / "hsfx"
INSTALLED_ID = "harness-scope@harness-scope"
CODE_TOOLS = ["EnterWorktree", "ExitWorktree", "LSP", "NotebookEdit"]
OWN_SKILLS = ["own-notes"]
SKILL_HEADER = "The following skills are available for use with the Skill tool:"
# Lines of the fixture router's description (tools/eval/fixtures/hsfx) that look like listing items but are not.
FIXTURE_BULLETS = {"- hsfx:helper: when the request needs the helper", "- note: keep the answer short"}


# ---------- running claude ----------


@dataclass
class Run:
    probe: list[dict]
    events: list[dict]
    seconds: float

    def attachment(self, kind: str) -> str | None:
        for r in self.probe:
            if r["kind"] == "attachment" and r["type"] == kind and r.get("agentId") is None:
                return r.get("text")
        return None

    def instruction_paths(self) -> list[str] | None:
        for r in self.probe:
            if r["kind"] == "context" and r["instructionFiles"] is not None:
                return [f["path"] for f in r["instructionFiles"]]
        return None

    def offered_agents(self) -> list[str]:
        return sorted({r["id"] for r in self.probe if r["kind"] == "agent" and r["isOffered"]})

    def upfront_tools(self) -> list[str]:
        # The probe leaves isDeferredOut out when no hook set it: the tool keeps its isDeferredIn.
        tools = [r for r in self.probe if r["kind"] == "tool"]
        return sorted({r["id"] for r in tools if not r.get("isDeferredOut", r["isDeferredIn"])})

    def screen_lines(self) -> list[str]:
        return [e["text"] for e in self.events if e.get("subtype") == "ui_log" and e.get("plugin") == "harness-scope"]

    def tool_errors(self) -> list[str]:
        out = []
        for e in self.events:
            if e.get("type") != "user":
                continue
            for c in e.get("message", {}).get("content", []):
                if isinstance(c, dict) and c.get("type") == "tool_result" and c.get("is_error"):
                    out.append(json.dumps(c.get("content"), ensure_ascii=False))
        return out

    def skill_calls(self) -> list[str]:
        return [str(r["input"].get("skill")) for r in self.probe if r["kind"] == "skill_call"]

    def final_text(self) -> str:
        texts = []
        for e in self.events:
            if e.get("type") == "assistant":
                for c in e["message"].get("content", []):
                    if c.get("type") == "text":
                        texts.append(c["text"])
        return texts[-1] if texts else ""


@dataclass
class Env:
    work: Path
    model: str
    plugin: Path
    cfg: Path = field(init=False)
    off: Path = field(init=False)
    on: Path = field(init=False)

    def __post_init__(self) -> None:
        self.cfg = self.work / "cfg"
        (self.cfg / "harness-scope" / "profiles").mkdir(parents=True)
        self.off = self.work / "off.json"
        self.off.write_text(json.dumps({"enabledPlugins": {INSTALLED_ID: False}}))
        self.on = self.work / "on.json"
        self.on.write_text(
            json.dumps(
                {
                    "enabledPlugins": {INSTALLED_ID: False},
                    "pluginConfigs": {"harness-scope": {"options": {"configDir": str(self.cfg)}}},
                }
            )
        )

    def profile(self, name: str, body: str) -> None:
        (self.cfg / "harness-scope" / "profiles" / f"{name}.json").write_text(body)

    def repo(self, name: str, selector: str | None) -> Path:
        r = self.work / name
        skill = r / ".claude" / "skills" / "own-notes"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("---\nname: own-notes\ndescription: Keep this repo's notes tidy.\n---\nBody\n")
        subprocess.run(["git", "init", "-q"], cwd=r, check=True)
        if selector is not None:
            (r / ".claude" / "harness-scope.json").write_text(selector)
        return r

    def run(self, repo: Path, *, plugin: bool, prompts: list[str], extra: tuple[str, ...] = ()) -> Run:
        probe_out = repo / ".." / f"{repo.name}-{time.monotonic_ns()}.jsonl"
        cmd = ["claude", "-p", "--model", self.model, "--output-format", "stream-json", "--verbose"]
        cmd += ["--settings", str(self.on if plugin else self.off), "--plugin-dir", str(PROBE)]
        if plugin:
            cmd += ["--plugin-dir", str(self.plugin)]
        cmd += ["--plugin-dir", str(FIXTURE_PLUGIN), *extra]
        if len(prompts) == 1:
            cmd.append(prompts[0])
            stdin = ""
        else:
            cmd += ["--input-format", "stream-json"]
            msgs = [{"type": "user", "message": {"role": "user", "content": p}} for p in prompts]
            stdin = "\n".join(json.dumps(m) for m in msgs) + "\n"
        env = {**os.environ, "PROSE_PROBE_OUT": str(probe_out)}
        t0 = time.monotonic()
        p = subprocess.run(cmd, cwd=repo, input=stdin, capture_output=True, text=True, env=env, timeout=300)
        seconds = time.monotonic() - t0
        events = [json.loads(line) for line in p.stdout.splitlines() if line.startswith("{")]
        probe = [json.loads(line) for line in probe_out.read_text().splitlines()] if probe_out.exists() else []
        return Run(probe, events, seconds)


# ---------- listing helpers (an independent reading of the format, not the plugin's) ----------


def listing_items(text: str | None, names: set[str]) -> dict[str, str]:
    """Split a skill listing into {name: entry}, taking only lines that start a known skill as item starts."""
    if not text or not text.startswith(SKILL_HEADER):
        return {}
    items: dict[str, str] = {}
    current: str | None = None
    for line in text.split("\n")[1:]:
        m = re.match(r"- (\S+)(?: \((\S+)\))?(?:: |$)", line)
        if m and m.group(1) in names and line not in FIXTURE_BULLETS:
            current = m.group(1)
            items[current] = line
            continue
        if current is not None:
            items[current] += "\n" + line
    return items


def all_skill_names(run: Run) -> set[str]:
    """Every name the baseline listing writes at the start of an item line (the fixture's bullets excepted)."""
    text = run.attachment("skill_listing") or ""
    pattern = r"^- (\S+)(?: \((\S+)\))?(?:: |$)"
    return {m.group(1) for line in text.split("\n") if line not in FIXTURE_BULLETS for m in [re.match(pattern, line)] if m}


def deferred_names(text: str | None) -> set[str]:
    return {line for line in (text or "").split("\n") if line and not re.search(r"\s", line)}


def tree_hash(path: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(path.rglob("*")):
        if ".git" in p.relative_to(path).parts or not p.is_file():
            continue
        h.update(str(p.relative_to(path)).encode())
        h.update(p.read_bytes())
    return h.hexdigest()


# ---------- grading ----------


@dataclass
class Case:
    dim: str
    name: str
    checks: list[tuple[str, bool, str]] = field(default_factory=list)

    def check(self, label: str, ok: bool, detail: str = "") -> None:
        self.checks.append((label, bool(ok), detail))

    @property
    def score(self) -> float:
        return sum(ok for _, ok, _ in self.checks) / len(self.checks) if self.checks else 0.0


def same_as_baseline(case: Case, run: Run, base: Run, unstable: frozenset[str] = frozenset()) -> None:
    case.check("skill listing unchanged", run.attachment("skill_listing") == base.attachment("skill_listing"))
    got, want = deferred_names(run.attachment("deferred_tools_delta")), deferred_names(base.attachment("deferred_tools_delta"))
    # claude.ai connectors (mcp__claude_ai_*) connect at varying times, so a whole connector's tools can come or go
    # between two runs (2026-10-08: Coursera's six tools in one pass-through run; two no-plugin runs differed too).
    moved = sorted(n for n in (got ^ want) - unstable if not n.startswith("mcp__claude_ai_"))
    case.check("deferred tool names unchanged (connector tools that come and go excepted)", not moved, ", ".join(moved))
    case.check("agents offered unchanged", run.offered_agents() == base.offered_agents())
    case.check("instruction files unchanged", run.instruction_paths() == base.instruction_paths())
    case.check("tools up front unchanged", run.upfront_tools() == base.upfront_tools())


def static_case() -> Case:
    case = Case("s", "shipped folder: no env, writes, processes or network")
    shipped = ROOT / "plugin"
    code = "\n".join(p.read_text() for p in (shipped / "hooks").glob("*.ts"))
    case.check("reads no environment variable", not re.search(r"\$\.env\.|process\.env", code))
    case.check("writes no file", not re.search(r"\$\.fs\.(write|append|remove|mkdir|rename)", code))
    case.check("starts no process", not re.search(r"\$\.(proc|process|shell|exec)\b|child_process", code))
    case.check("opens no network", not re.search(r"\$\.(net|http|fetch)\b|\bfetch\(", code))
    banned = [p.name for p in shipped.rglob("*") if p.name.endswith((".test.ts", ".test.tsx")) or p.name == "evals"]
    case.check("ships no tests or evals", not banned, ", ".join(banned))
    urls = re.findall(r"https?://\S+", "\n".join(p.read_text() for p in shipped.rglob("*.md")))
    urls += re.findall(r"https?://\S+", (shipped / ".claude-plugin" / "plugin.json").read_text())
    case.check("ships no URL", not urls, ", ".join(urls))
    return case


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plugin", default=str(ROOT / "plugin"))
    ap.add_argument("--model", default="haiku")
    ap.add_argument("--json")
    ap.add_argument("--only", default="")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()
    only = set(filter(None, args.only.split(",")))
    work = Path(tempfile.mkdtemp(prefix="hs-eval-"))
    env = Env(work, args.model, Path(args.plugin).resolve())
    cases: list[Case] = [static_case()]
    want = lambda key: not only or key in only  # noqa: E731

    version = subprocess.run(["claude", "--version"], capture_output=True, text=True).stdout.strip()
    base_repo = env.repo("base", None)
    base = env.run(base_repo, plugin=False, prompts=["Reply with the single word OK."])
    base2 = env.run(base_repo, plugin=False, prompts=["Reply with the single word OK."])
    stable = Case("x", "baseline is stable run to run (informational, not scored)")
    same_as_baseline(stable, base2, base)
    cases.append(stable)
    # claude.ai connectors finish connecting at different times, so their tools move in and out of the list.
    unstable = frozenset(
        deferred_names(base.attachment("deferred_tools_delta")) ^ deferred_names(base2.attachment("deferred_tools_delta"))
    )
    names = all_skill_names(base)
    base_items = listing_items(base.attachment("skill_listing"), names)

    # ---- b: pass-through ----
    env.profile("broken", '{"skills": ')
    passthrough = [
        ("no selector", None, False),
        ("selector is not JSON", '{"profile": ', True),
        ("selector names an unknown profile", '{"profile": "nosuch"}', True),
        ("selector names a broken profile", '{"profile": "broken"}', True),
        ("selector carries more than a name", '{"profile": "writing", "skills": {"deny": ["*"]}}', True),
    ]
    for i, (label, selector, should_say) in enumerate(passthrough):
        if not want(f"b{i + 1}"):
            continue
        repo = env.repo(f"b{i + 1}", selector)
        before = tree_hash(repo), tree_hash(env.cfg)
        run = env.run(repo, plugin=True, prompts=["Reply with the single word OK."])
        case = Case("b", label)
        same_as_baseline(case, run, base, unstable)
        lines = run.screen_lines()
        if should_say:
            case.check(
                "says once on screen that it passes through",
                len([x for x in lines if "passing everything through" in x]) == 1,
                " | ".join(lines),
            )
        else:
            case.check("stays silent", not lines, " | ".join(lines))
        case.check("writes nothing in the repo or the config dir", (tree_hash(repo), tree_hash(env.cfg)) == before)
        cases.append(case)

    # ---- a + c: the bundled writing profile ----
    if want("a1"):
        repo = env.repo("a1", '{"profile": "writing"}')
        before = tree_hash(repo), tree_hash(env.cfg)
        run = env.run(repo, plugin=True, prompts=["Reply with the single word OK.", "/harness-scope"])
        case = Case("a", "bundled writing profile")
        items = listing_items(run.attachment("skill_listing"), names)
        case.check("only the repo's own skills stay", sorted(items) == OWN_SKILLS, ", ".join(sorted(items)))
        case.check("kept entries are byte for byte", all(base_items.get(n) == items[n] for n in items))
        agents = run.offered_agents()
        case.check("only Explore and general-purpose agents", agents == ["Explore", "general-purpose"], str(agents))
        left = deferred_names(run.attachment("deferred_tools_delta"))
        case.check("code tools leave the ToolSearch list", not (left & set(CODE_TOOLS)), str(left & set(CODE_TOOLS)))
        case.check("code tools are not described up front", not (set(run.upfront_tools()) & set(CODE_TOOLS)))
        receipt = run.final_text()
        removed = len(base_items) - len(items)
        case.check(
            f"receipt counts every removed skill ({removed})",
            f"skills (allow): {removed} off" in receipt,
            receipt.split("\n")[1] if "\n" in receipt else receipt,
        )
        case.check("writes nothing", (tree_hash(repo), tree_hash(env.cfg)) == before)
        cases.append(case)

        first = Case("c", "first run: what is on, from where, how to undo")
        lines = run.screen_lines()
        first.check("one activation line on screen", len(lines) == 1, " | ".join(lines))
        first.check("activation line fits a terminal row (<= 120 chars)", all(len(x) <= 120 for x in lines), str(lines))
        # The terminal draws each screen line as one row and prefixes the plugin's name itself.
        first.check(
            "screen lines are one row each, without a doubled name",
            not [x for x in lines if "\n" in x or x.startswith("harness-scope:")],
            str(lines),
        )
        first.check("receipt names the profile and its source", '"writing"' in receipt and "bundled" in receipt)
        first.check("receipt shows the selector as a repo path", "selected by .claude/harness-scope.json" in receipt)
        first.check("receipt says how to turn it off", re.search(r"turn (this|it) off|delete", receipt, re.I) is not None)
        first.check("receipt says it writes nothing", re.search(r"writes no", receipt, re.I) is not None)
        cases.append(first)

    if want("c2"):
        repo = env.repo("c2", '{"profile": "writing"}')
        run = env.run(repo, plugin=True, prompts=["/harness-scope"])
        case = Case("c", "cold /harness-scope before any prompt")
        out = run.final_text() or "\n".join(run.screen_lines())
        case.check("answers within 10 s", run.seconds < 10, f"{run.seconds:.1f}s")
        case.check("says nothing is composed yet instead of 0 off", "not composed yet" in out, out[:200])
        cases.append(case)

    if want("c3"):
        repo = env.repo("c3", None)
        run = env.run(repo, plugin=True, prompts=["Reply with the single word OK.", "/harness-scope names"])
        case = Case("c", "names for writing a profile, in a repo with no selector")
        out = run.final_text()
        case.check("lists skill names", "own-notes" in out and "hsfx:helper" in out, out[:200])
        case.check("lists agent names", "general-purpose" in out, out[:200])
        case.check("lists tool names", "LSP" in out, out[:200])
        cases.append(case)

    # ---- a: refusal of an off skill (model-dependent; repeated) ----
    if want("a2"):
        target = "hsfx:helper"
        prompt = f'Call the Skill tool exactly once with skill "{target}". Then reply DONE.'
        with_runs = [env.run(env.repo(f"a2w{i}", '{"profile": "writing"}'), plugin=True, prompts=[prompt]) for i in range(3)]
        without = [env.run(env.repo(f"a2o{i}", '{"profile": "writing"}'), plugin=False, prompts=[prompt]) for i in range(3)]
        case = Case("a", f"calling an off skill ({target}) is refused with the reason (3 runs + 3 no-plugin)")
        attempts: list[bool] = []
        for i, r in enumerate(with_runs):
            called = target in r.skill_calls()
            refused = any("turned off" in e and "writing" in e for e in r.tool_errors())
            case.check(f"with plugin run {i + 1}: refused with reason (or not attempted)", refused or not called,
                       f"called={called}")
            attempts.append(called)
        for i, r in enumerate(without):
            case.check(
                f"no plugin run {i + 1}: not refused",
                not any("turned off" in e for e in r.tool_errors()),
            )
        case.name += f" — attempted in {sum(attempts)}/3 plugin runs"
        cases.append(case)

    # ---- a + d: user profiles against the real listing ----
    aliased = [n for n, entry in base_items.items() if re.match(r"- \S+ \(\S+\)", entry)]
    if want("d1") and aliased:
        name = aliased[0]
        order = list(base_items)
        before_it = order[order.index(name) - 1]
        env.profile("alias", json.dumps({"skills": {"deny": [before_it]}}))
        env.profile("alias2", json.dumps({"skills": {"allow": [name, "own-*"]}}))
        run = env.run(env.repo("d1", '{"profile": "alias"}'), plugin=True, prompts=["Reply with the single word OK."])
        run2 = env.run(env.repo("d1b", '{"profile": "alias2"}'), plugin=True, prompts=["Reply with the single word OK."])
        case = Case("d", f"aliased listing line ({name})")
        items = listing_items(run.attachment("skill_listing"), names)
        case.check(f"denying {before_it} removes only it", before_it not in items and name in items)
        case.check("the aliased entry stays byte for byte", items.get(name) == base_items[name])
        items2 = listing_items(run2.attachment("skill_listing"), names)
        case.check("allowing the aliased skill by its listed name keeps it", sorted(items2) == sorted([name, *OWN_SKILLS]))
        cases.append(case)

    if want("d2"):
        # Only project settings, so the listing stays under its budget and keeps the router's multi-line description.
        small = ("--setting-sources", "project")
        env.profile("bullets", json.dumps({"skills": {"deny": ["hsfx:helper"]}}))
        env.profile("bullets2", json.dumps({"skills": {"allow": ["hsfx:router", "own-*"]}}))
        ok = ["Reply with the single word OK."]
        sbase = env.run(env.repo("d2o", None), plugin=False, prompts=ok, extra=small)
        run = env.run(env.repo("d2", '{"profile": "bullets"}'), plugin=True, prompts=ok, extra=small)
        run2 = env.run(env.repo("d2b", '{"profile": "bullets2"}'), plugin=True, prompts=ok, extra=small)
        case = Case("d", '"- name: text" bullets inside a skill description')
        snames = all_skill_names(sbase)
        sitems = listing_items(sbase.attachment("skill_listing"), snames)
        items = listing_items(run.attachment("skill_listing"), snames)
        router = sitems.get("hsfx:router")
        case.check("fixture router is in the baseline listing with its bullets", router is not None and "\n- " in router)
        case.check("deny hsfx:helper: the real helper leaves", "hsfx:helper" not in items)
        case.check("deny hsfx:helper: router's description stays byte for byte", items.get("hsfx:router") == router)
        items2 = listing_items(run2.attachment("skill_listing"), snames)
        case.check("allow router: router stays byte for byte", items2.get("hsfx:router") == router)
        case.check("allow router: nothing else but own skills", sorted(items2) == sorted(["hsfx:router", *OWN_SKILLS]))
        cases.append(case)

    if want("a3"):
        user_files = [p for p in (base.instruction_paths() or []) if "/.claude/" in p and not p.startswith(str(work))]
        if user_files:
            target = user_files[-1]
            env.profile("instr", json.dumps({"instructions": {"deny": [target]}}))
            run = env.run(env.repo("a3", '{"profile": "instr"}'), plugin=True, prompts=["Reply with the single word OK."])
            case = Case("a", "an instruction file named by its absolute path is not loaded")
            paths = run.instruction_paths() or []
            case.check("the denied file is gone", target not in paths, target)
            case.check("every other file stays", [p for p in (base.instruction_paths() or []) if p != target] == paths)
            cases.append(case)

    # ---- report ----
    print(f"harness-scope e2e eval — {version}, model {args.model}, plugin {env.plugin}")
    dims: dict[str, list[Case]] = {}
    for c in cases:
        dims.setdefault(c.dim, []).append(c)
        print(f"\n[{c.dim}] {c.name}: {sum(ok for _, ok, _ in c.checks)}/{len(c.checks)}")
        for label, ok, detail in c.checks:
            print(f"  {'PASS' if ok else 'FAIL'} {label}" + (f"  — {detail[:300]}" if detail and not ok else ""))
    print("\nby dimension (checks passed / total):")
    for d, cs in sorted(dims.items()):
        if d == "x":
            continue
        passed = sum(ok for c in cs for _, ok, _ in c.checks)
        total = sum(len(c.checks) for c in cs)
        print(f"  {d}: {passed}/{total}")
    if args.json:
        Path(args.json).write_text(
            json.dumps(
                {
                    "claude": version,
                    "model": args.model,
                    "cases": [{"dim": c.dim, "name": c.name, "checks": c.checks} for c in cases],
                },
                ensure_ascii=False,
                indent=1,
            )
        )
    if not args.keep:
        shutil.rmtree(work, ignore_errors=True)
    else:
        print(f"kept {work}")
    return 0 if all(ok for c in cases if c.dim != "x" for _, ok, _ in c.checks) else 1


if __name__ == "__main__":
    sys.exit(main())
