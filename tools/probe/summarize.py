"""Summarize a prose-probe JSONL run (RFC-0001 Phase 0). Usage: python3 summarize.py <run.jsonl>"""

import collections
import json
import sys

rows = [json.loads(line) for line in open(sys.argv[1]) if line.strip()]
by = collections.defaultdict(list)
for r in rows:
    by[r["kind"]].append(r)

print("kinds:", {k: len(v) for k, v in by.items()})
for c in by["compose"][:1]:
    print("\n== compose traits", c["traits"], "outputStyle", c["outputStyle"])
    for s in c["sections"]:
        print(f"  {s['id']:32} {s['scope']:8} {s['chars']:6}")
    print("  total", sum(s["chars"] for s in c["sections"]))
print("compose renders:", len(by["compose"]))
for c in by["context"]:
    print("\n== context blocks", c["blocks"])
    files = c["instructionFiles"]
    print("  instructionFiles:", None if files is None else len(files))
    for f in files or []:
        print(f"    {f['kind']:8} {f['chars']:6} {f['path']}" + (f" <- {f['parent']}" if f.get("parent") else ""))
att = collections.defaultdict(lambda: [0, 0, set(), set()])
for a in by["attachment"]:
    v = att[a["type"]]
    v[0] += 1
    v[1] += a["chars"]
    v[2].add(a["origin"])
    v[3].add(a.get("agentId"))
print("\n== attachments (type n chars origins agentIds)")
for k, v in sorted(att.items(), key=lambda kv: -kv[1][1]):
    print(f"  {k:28} {v[0]:3} {v[1]:7} {sorted(v[2])} {sorted(map(str, v[3]))}")
tools = by["tool"]
sent = [t for t in tools if not t["isDeferredIn"]]
print(f"\n== tools {len(tools)} total {sum(t['chars'] for t in tools)}; up front {len(sent)} {sum(t['chars'] for t in sent)}")
agents = by["agent"]
src = collections.Counter(a["source"] for a in agents)
print(f"== agent.offer calls {len(agents)}, unique {len({a['id'] for a in agents})}, sources {dict(src)}")
for u in by["usage"]:
    ctx = u["context"]
    print("\n== usage keys", list(ctx.keys()))
    bd = ctx.get("breakdown") or {}
    print("  breakdown keys", list(bd.keys()))
    sk = bd.get("skills") or {}
    print("  skills total/included", sk.get("totalSkills"), sk.get("includedSkills"), "tokens", sk.get("tokens"))
    print("  sources", collections.Counter(s.get("source") for s in sk.get("skillFrontmatter", [])))
print("session_start:", [r["source"] for r in by["session_start"]])
