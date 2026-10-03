---
state: in_progress 2026-10-03
review-when: Claude Code の Mods API（prompt.attachment / prompt.context / agent.offer / tool.describe / tool.call）の event 名や戻り値が変わったとき。Claude Code 本体が、repo 間で共有できる skill・rules・agent の ON/OFF（名前付き preset など）をネイティブに持ったとき。同じ範囲を扱う Mod が先に公開されたとき
---
## Summary

global の harness（`~/.claude` の CLAUDE.md と rules、user と plugin の skill・agent、ツール）を、global に定義した名前付き
profile で repo ごとに ON/OFF する Claude Code の Mod を作り、Mods の正式提供（v2.1.287）直後のうちに公開して、awesome-list
に載せる。執筆用の repo からコーディング前提の文脈を外すのは、その profile の 1 つ（`writing`）として扱う。

## Motivation

- 記事やエッセイを書く repo でも、Claude Code は global の harness をそのままモデルに渡している。執筆には不要な指示が
  モデルの判断に混ざり、context も消費する
- 届いている量の大半は、Claude Code のコーディング用の既定ではなく、利用者自身の harness（rules・skills・agents）から
  来ている（下の計測）
- skill を repo ごとに置く運用は管理が割れる（著者の指摘、2026-10-03）。global に 1 か所で持ち、repo では選ぶだけにしたい
- ネイティブ設定（`skillOverrides`・`claudeMdExcludes`・`permissions.deny` など）は repo の settings ごとに書く denylist で、
  repo 間で共有する名前付きのまとまりが無い。本体への同じ要望（anthropics/claude-code#37463、#43928、#39749、#62174）は
  閉じられている
- 出力スタイル（`keep-coding-instructions: false`）で外せるのは、system prompt のコーディング指示だけ
- Mods は v2.1.287 で既定有効になったばかり（2026-10-03 確認）。同じことをする公開 Mod は、確認した範囲では見つからな
  かった。先に出せば、著者の新しい導線になる

### 計測（2026-10-03、prose-probe）

書き換えずに記録だけする Mod（`probe/`）を、著者の執筆 repo で `claude -p` に 1 回読み込ませた。プロンプトは短い 1 文。

| 種類 | Mod が見た量 | モデルに届いた量 |
|---|---|---|
| システムプロンプトの名前付き節（`prompt.section`） | 24（うち空でないもの 10）/ 5,029 字 | 同じ。本体の冒頭（`intro`・`doing_tasks` など）は `prompt.section` に出ず、未計測 |
| ツールの説明文（`tool.describe`） | 152 件 / 109,411 字 | 14 件 / 14,630 字。残る 138 件は ToolSearch の後ろにあり、名前の一覧（5,918 字）だけが届いた |
| リマインダー類（`prompt.attachment`） | 12 種 / 94,459 字 | 同じ |

- リマインダーの上位は `instructions`（CLAUDE.md と rules、21 ファイル）37,495 字、`skill_listing` 26,342 字、
  `agent_listing_delta` 17,921 字。`instructions` のうち 16 ファイルは global の harness
- 初版（2026-10-03）は、ToolSearch の後ろにあるツールの説明文も届いた量として数えていた。訂正は詳細設計（下の Status）で
  行った
- 数値はこの 1 回、この環境（MCP サーバーや skill の数）での値。環境ごとに大きく変わる

## Guide-level explanation

- 利用者は Mod を 1 回 install し、global に名前付き profile（例 `writing`）を置く。repo には `{ "profile": "writing" }` の
  1 行だけを置く
- profile を選んだ repo では、profile で OFF にした skill・agent・rules・ツールがモデルに渡らない。選んでいない repo では
  何も変わらない
- 外したものと、profile に書いたのに一致しなかった名前は、確認コマンドで見られる

## Reference-level explanation

使う口（2.1.287 が書いた型定義、2026-10-03 確認）:

- `prompt.attachment`（`skill_listing`・`deferred_tools_delta`）: 一覧から項目を外す
- `prompt.context`: `instructionFiles` から user の指示ファイルを外す（組み込みの `agents-md` Mod と同じ口）
- `agent.offer`: subagent の型を一覧から外し、dispatch も断る
- `tool.describe`: `isDeferred: true` でツールを ToolSearch の後ろへ回す
- `tool.call`: OFF にした skill・ツールの呼び出しを理由つきで断る

制約:

- 配布は通常のプラグインと同じ（marketplace / `--plugin-dir`）。plugin 名は `claude-` で始められない
- repo 側のファイルは profile の名前を選ぶだけ。clone した repo が、利用者の安全側の rules を黙って外せないようにする
- managed の指示、repo 自身の skill・agent・指示ファイル、hook と他の plugin の出力は外さない
- system prompt の節には v0.1 では触れない（出力スタイルに任せる）

event ごとの動作・不変条件・テストは plan（下の Status）が持つ。

## Drawbacks

- リマインダーの種別名や一覧の本文の形式は、Claude Code の版で変わりうる。追従のコストがかかる。知らない形式は素通しに
  するので、壊れたときは黙って効かなくなる側に倒れる
- 見せるかどうかの制御で、強制ではない。モデルが SKILL.md を直接読めば読める
- 後から付く指示ファイル（`paths:` 付きの rule、下位ディレクトリの CLAUDE.md）は外れない
- 記事の質は、著者が執筆にどう関わるかで決まる部分が大きい（著者のこれまでの観察、2026-10-03）。この Mod が変えるのは、
  モデルが受け取る文脈だけ

## Rationale and alternatives

- **出力スタイルだけ使う**: system prompt のコーディング指示は外れる。指示ファイルと一覧には届かない
- **ネイティブ設定を repo ごとに書く**（`skillOverrides`・`claudeMdExcludes`・`permissions.deny`・`enabledPlugins`）:
  repo ごとの denylist になり、あとから global に足した skill は執筆 repo にも入る。plugin の skill には `skillOverrides` が
  効かない。個々の設定は README で併用を案内する
- **skill を repo ごとに置く**（symlink やコピー）: 管理が割れる
- **`--system-prompt` で丸ごと差し替える**: 起動フラグが必要で、Claude Code の安全側の指示もまとめて消える
- **Mod を作る（この提案）**: global に 1 か所で定義し、repo では名前で選ぶ。allowlist も書ける

## Prior art

- `davila7/claude-code-templates` の `jev-skill-suggestion`: `skill_listing` を allowlist で絞る。allowlist は user 単位
- `EliaAlberti/jev-rules`: prompt ごとに外部モデルが rules を選ぶ（動的で、API が要る）
- 組み込みの `agents-md` Mod: `prompt.context` で指示ファイルを足し、外す
- `darkroomengineering/cc-settings` の `context-report`: 読み込まれた指示ファイルを表示する
- Mods の一覧: `karanb192/awesome-claude-code-mods`

## Unresolved questions

詳細設計（2026-10-03）で、初版の問いのうち次を決めた。決定と根拠は plan にある:
出力スタイルだけで足りるか（足りない）、執筆向けの Mod が既にあるか（確認した範囲では無い）、`prompt.compose` が記録を
残さなかった理由（probe の不具合）、何を外し何を残すか、質が変わるかの確かめ方。

残る問い:

- ネイティブ設定（`skillOverrides`・`claudeMdExcludes`・project の `enabledPlugins`・deny `Agent(name)`）が、2.1.287 で
  実際にどこまで効くか（Phase 0）
- 指示ファイルがどの経路でモデルに届くか。subagent にも効くか（Phase 0）
- skill の一覧の中で、repo 自身の skill を見分けられるか。見分けられなければ skill は deny だけにする（Phase 0）
- 名前と公開先（範囲が広がったので repo 名から考え直す）

## Future possibilities

- system prompt の節も profile で扱う（Phase 0 の計測で残りを見てから）
- MCP サーバーの instructions
- 調査・ノート整理向けの profile

## Status

- draft 2026-10-03 — 提案と初回の計測まで
- accepted 2026-10-03 — 詳細設計を承認し、範囲を repo ごとの ON/OFF に広げた。Plan:
  [docs/plans/distributed-purring-unicorn.md](../docs/plans/distributed-purring-unicorn.md)
- in_progress 2026-10-03 — Phase 0（計測）と verify-bootstrap から着手
- 2026-10-03 — Phase 0 の途中結果を受けて plan を改訂（allowlist を中心に、rules とツールも同じ profile で扱う）。Plan:
  [docs/plans/rfc-0001-r2-profile-allowlist.md](../docs/plans/rfc-0001-r2-profile-allowlist.md)、計測:
  [docs/measurements/2026-10-03-phase0.md](../docs/measurements/2026-10-03-phase0.md)

## Next action

- Phase 0: probe を直し、ネイティブ設定の効きと、指示ファイル・skill 一覧の経路を確かめる
- skill: verify-bootstrap で `.claude/verify.sh` を作る
- 公開（GitHub repo の公開と awesome-list への投稿）は著者の確認を経て行う
