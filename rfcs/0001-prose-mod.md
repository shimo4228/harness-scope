---
state: draft 2026-10-03
review-when: Claude Code の Mods API（prompt.section / tool.describe / prompt.attachment）の event 名や戻り値が変わったとき。または、執筆向けに同じ範囲を扱う Mod が先に公開されたとき
---
## Summary

執筆用の repo で Claude Code を使うとき、コーディング前提のシステムプロンプトの節・ツールの説明文・リマインダーをモデルに渡さないようにする Mod を作り、Mods の正式提供（v2.1.287）直後のうちに公開して、awesome-list に載せる。

## Motivation

- 記事やエッセイを書く repo でも、Claude Code はコーディング用の文脈をそのままモデルに渡している。執筆には不要な指示がモデルの判断に混ざり、context も消費する
- 出力スタイル（`keep-coding-instructions: false`）で外せるのは、コーディング指示の節のまとまりだけ。残りの節・ツールの説明文・リマインダーには届かない
- Mods は v2.1.287 で既定有効になったばかり（2026-10-03 確認）。執筆向けの Mod は、確認した範囲ではまだ公開されていない（未検証。下の Unresolved questions）。先に出せば、著者の新しい導線になる

### 計測（2026-10-03、prose-probe）

書き換えずに記録だけする Mod（`probe/`）を、著者の執筆 repo で `claude -p` に 1 回読み込ませた。プロンプトは短い 1 文。

| 種類 | 件数 | 字数 |
|---|---|---|
| システムプロンプトの名前付き節（`prompt.section`） | 24（うち空でないもの 10） | 5,029 |
| ツールの説明文（`tool.describe`） | 152 | 109,411 |
| リマインダー類（`prompt.attachment`） | 12 種 | 94,459 |

- 節の中に、執筆では不要なコーディング前提の文がある。例: `communication` 節の「周りのコードに合わせてコードを書く」
- 流入の大半は節の外にある。ツールの説明文の上位は Monitor 6,581 字、SendMessage 4,259 字、Workflow 3,207 字など。リマインダーの上位は `instructions`（CLAUDE.md と rules）37,495 字、`skill_listing` 26,342 字、`agent_listing_delta` 17,921 字
- 数値はこの 1 回、この環境（MCP サーバーや skill の数）での値。環境ごとに大きく変わる

## Guide-level explanation

- 利用者は、執筆用の repo でだけこの Mod を有効にする。コーディング用の repo では読み込まない
- 有効にすると、モデルが受け取るのは「執筆に要る指示と道具」だけになる。外したもの・残したものは、Mod が一覧で示せるようにする

## Reference-level explanation

使える口（公式ドキュメント 2026-10-03 確認: code.claude.com/docs/en/plugins/mods/reference）:

- `prompt.section`: システムプロンプトの節ごとに `{ text }` で書き換え、`{ text: null }` で省く
- `tool.describe`: ツールの説明文を書き換える
- `prompt.attachment`: Claude Code が差し込むリマインダーを書き換える、または省く
- `skill.prompt`: skill を展開した本文を書き換える

制約:

- 配布は通常のプラグインと同じ（marketplace / `--plugin-dir`）
- repo ごとに有効にする方法は詳細設計で決める（候補: プロジェクト設定の `enabledPlugins`、`--plugin-dir`）
- 外してはいけないもの（安全・権限・環境情報など）の線引きが必要

## Drawbacks

- 内部の節 id（例: `communication`）やリマインダーの種別名は、Claude Code の版で変わりうる。追従のコストがかかる
- 外しすぎると、Claude Code の安全側の挙動（取り消しにくい操作の前の確認など）まで失う
- 記事の質は、著者が執筆にどう関わるかで決まる部分が大きい（著者のこれまでの観察、2026-10-03）。この Mod が変えるのは、モデルが受け取る文脈だけ

## Rationale and alternatives

- **出力スタイルだけ使う**: コーディング指示の節は外れる。ほかには届かない
- **`--system-prompt` で丸ごと差し替える**: 起動フラグが必要で、Claude Code の安全側の指示もまとめて消える
- **Mod を作る（この提案）**: 節・ツール・リマインダーを個別に扱え、配布もできる

## Prior art

- 書き換えを使う既存の Mod の例: `davila7/claude-code-templates` の `jev-skill-suggestion`（`skill_listing` を書き換える）
- Mods の一覧: `karanb192/awesome-claude-code-mods`

## Unresolved questions

- 執筆向けの Mod が既に公開されていないか（一覧と marketplace の再確認）
- `prompt.compose` の hook が記録を 1 件も残さなかった理由。節の外にある本体のシステムプロンプトがどこまで `prompt.section` で見えているか
- 何を外し、何を残すか（安全・権限・メモリ・環境情報の扱い）
- 外したあとに執筆の質が変わるかを、どう確かめるか
- 名前と公開先（単独 repo か、marketplace か）

## Future possibilities

- 執筆以外の用途（調査・ノート整理）向けのプリセット
- 外した量を表示するコマンド

## Status

draft 2026-10-03 — 提案と初回の計測まで。詳細設計は別セッションで行う。`probe/` は記録用の試作で、出力先のパスがまだ固定されている。

## Next action

- 詳細設計のセッションを開き、Unresolved questions を順に決める
- 実装の前に、skill: verify-bootstrap で `.claude/verify.sh` を作る
- 公開（GitHub repo の公開と awesome-list への投稿）は著者の確認を経て行う
