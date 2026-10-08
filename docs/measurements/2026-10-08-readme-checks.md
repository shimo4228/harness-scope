# README 改稿時の確認（2026-10-08、Claude Code 2.1.294）

README の書き直しで載せる事実を、現行の版で確かめた記録。どれも著者の環境（global の skill・plugin・MCP を入れたまま）で、
`claude -p`、使い捨ての空ディレクトリで行った。導入済みの plugin は harness-scope 0.1.2（user scope）。0.1.2（cba7a2c）と 0.1.3（903b525 時点）の
`plugin/hooks/` に差分は無い（`git diff --stat cba7a2c 903b525 -- plugin/hooks` が空）ので、読み込みと絞り込みの結果は 0.1.3 にもそのまま当てはまる。

## 読み込み（20 回）

`.claude/harness-scope.json` に `{ "profile": "writing" }` を置いた空ディレクトリで `claude -p "/harness-scope"` を 20 回続けて実行し、
出力の 1 行目に `profile "writing"` が出るかを数えた。

- 20 回中 20 回で出た（読み込まれた）
- 2.1.287 で見た「9 回中 1 回（最初の run）読み込まれない」（[2026-10-03-phase0.md](2026-10-03-phase0.md) の末尾）は再現しなかった。
  2.1.287 の原因は未確認のまま

## `/harness-scope` の出力（README の Quick start に載せた例）

同じディレクトリで、stream-json 入力の 1 セッションに 2 通（`Reply with just: ok` → `/harness-scope`）を流した。
1 通目のあとなので一覧が組み立て済みで、2 通目の出力に外したものが並ぶ。

```text
harness-scope: profile "writing" from bundled profile "writing", selected by <dir>/.claude/harness-scope.json
skills (allow): 90 off — adr-writer, archify, authorship-strategy, …（90 件）
agents (allow): 30 off — adr-reviewer, architect, claude, …（30 件）
instructions: not in the profile
tools (deny): 4 off — EnterWorktree, ExitWorktree, LSP, NotebookEdit
```

- 空ディレクトリなので repo 自身の skill は 0 件。外れた 90 件は global・plugin・組み込み・claude.ai 同期の skill
- 2.1.294 でも skill の一覧の形式は Mod が読める形のまま（素通しの note は出なかった）

## ネイティブの `skillOverrides` で、組み込みと同期の skill を 1 つずつ外せるか

project の `.claude/settings.json` に次を置き、`claude -p "/context"` の skill 表を、置かない場合と比べた。

```json
{"skillOverrides":{"simplify":"off","anthropic-skills:pdf":"off","pdf":"off","eli5:eli5":"off","readme-writer":"off"}}
```

| skill | 出どころ（`/context` の表記） | 置かないとき | 置いたとき |
|---|---|---|---|
| readme-writer | User | 載る | 消えた |
| simplify | Built-in | 載る | 消えた |
| pdf | claude.ai sync | 載る | 消えた |
| eli5:eli5 | Plugin (eli5) | 載る | 残った |

- 2.1.294 では、`skillOverrides` で自分の skill・組み込み・claude.ai 同期の skill を名前ごとに外せる。plugin の skill は外れない
  （plugin ごとなら `enabledPlugins` で外せる。2.1.287 の結果は [2026-10-03-phase0.md](2026-10-03-phase0.md) の C2）
- 改稿前の README は「組み込みと claude.ai 同期の skill は 1 つずつ選べない」と書いていたが、計測の裏付けが無く、2.1.294 では
  当てはまらない。README を直した
- 同期 skill のキーは `pdf` と `anthropic-skills:pdf` の両方を置いたので、どちらが効いたかは切り分けていない

## 追記（2026-10-09）: quality/product-eval 取り込み後の出力

main（293086c 以降、plugin/ は quality/product-eval の 79ffbd6）の `plugin/` を `--plugin-dir` で読み込み、導入済みの 0.1.2 は
`--settings` の `enabledPlugins` で外して、同じ 2 通のセッション（3 通目に `/harness-scope names`）で取り直した。README の
Quick start の例はこの出力（名前の列は途中で切った）。

```text
harness-scope: profile "writing" (bundled), selected by .claude/harness-scope.json
skills (allow): 91 off — …（91 件）
agents (allow): 30 off — …（30 件）
agents kept: Explore, general-purpose
instructions: not in the profile
tools (deny): 4 off — EnterWorktree, ExitWorktree, LSP, NotebookEdit
To turn it off: delete .claude/harness-scope.json, then /clear. harness-scope writes no files.
```

- 91 件（前回 90 件）の差は `hookify:writing-rules`。別名つきの行の誤読が直り、外れるようになった
- `claude plugin validate plugin` の `calls:` に `$.ui.status (via showStatus)` が加わった（status line）
