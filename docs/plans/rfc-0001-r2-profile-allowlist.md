# RFC-0001 詳細設計 r2: profile 1 つで skill / agent / rules / ツールを repo ごとに ON/OFF する Mod

前の版: [distributed-purring-unicorn.md](distributed-purring-unicorn.md)（承認 2026-10-03。凍結記録として残す）。
図解: [rfc-0001-r2-profile-allowlist.html](rfc-0001-r2-profile-allowlist.html)

## 結論

- Mod を作る。中心は **allowlist**: 執筆 repo では「使う skill・agent だけを書き、それ以外は見せない」。あとから global
  に足した skill も、書くまで執筆 repo には入らない
- skill と agent は **出どころを問わず** 絞る（user・plugin・built-in・claude.ai から同期された skill）。ネイティブ設定は
  user の skill を名前ごとに、plugin を丸ごとにしか外せない
- rules とツールも **同じ profile で** 管理する（allow / deny）。ネイティブ設定と 2 か所に分けると、利用者は「なぜこれが
  OFF か」を 2 か所で調べることになる（著者の判断、2026-10-03）
- ツールをネイティブの `permissions.deny` に同期するコマンドは次の版（v0.2）

## 前の版からの変更と、その根拠（Phase 0 の途中結果、[計測の記録](../measurements/2026-10-03-phase0.md)）

| 前の版 | r2 | 根拠 |
|---|---|---|
| Mod はネイティブ設定で届かない残りを受け持つ。届く分は README で併用を案内 | profile 1 つで全部を管理する。ネイティブ設定は併用不要 | ネイティブ設定は project 単位でほぼ全部に効いた（`skillOverrides`・`enabledPlugins`・`claudeMdExcludes`・deny）。ただしどれも repo ごとの denylist で、allowlist と、plugin・built-in の skill を 1 つずつ外す手段は無い |
| skill を隠すと context が減る、が暗黙の前提 | 効果は「関係ない skill が見えず、使う skill の説明が削られずに載る」こと | skill 一覧は予算（context の 1%）いっぱいまで使われる。3 件消すと 821 字減り、名前だけに削られていた skill の説明が 807 字戻った（C0 → C2、1 組の観測） |
| skill の allow は、repo 自身の skill を見分けられる場合だけ | allow を使える | `session.usage({ breakdown: 'summary' })` の source で `projectSettings` の skill を見分けられた（C0 で 7 件）。agent は `agent.offer` の source で見分けられる |
| 計画を見直す条件: ネイティブに名前付きの ON/OFF か allowlist があれば再 plan | 該当しなかった | 見つかったのは repo ごとの denylist だけ |
| 既知の限界に cloud session | 外す | cloud session には global の harness 自体が届かない |
| system prompt は出力スタイルに任せる | 同じ | system prompt は短い版（trait `lean`）で、本体 `lean_body` は 1,603 字、節の合計 6,557 字 |

## 設計

### 使い方

1. Mod を user scope に 1 回 install する。profile を選んでいない repo では何もしない
2. 名前付き profile を global に置く: `~/.claude/<name>/profiles/<profile>.json`。Mod は例として `writing` を同梱する
3. repo には選ぶだけのファイルを置く: `.claude/<name>.json` に `{ "profile": "writing" }`（探す順は session の root、次に
   repo の root）。repo 側に中身は書けない（clone した repo が利用者の安全側の rules を黙って外せないように）
4. 会話の始まり（起動・`/clear`・resume）で profile を読み、その会話の間は固定する
5. `/<name>` で、外したもの・一致しなかった名前・見ていない attachment 種別を画面に出す（モデルには返さない）

### profile の形

```json
{
  "skills":       { "allow": ["writing-ecosystem", "prose-translation", "headline-craft", "anthropic-skills:docx"] },
  "agents":       { "allow": ["Explore", "general-purpose"] },
  "instructions": { "deny":  ["~/.claude/rules/common/testing.md", "~/.claude/rules/common/coding-style.md"] },
  "tools":        { "deny":  ["LSP", "NotebookEdit", "mcp__claude_ai_Slack__*"] }
}
```

- カテゴリごとに `allow`（これだけ残す）か `deny`（これだけ外す）のどちらか 1 つ。名前と path は glob 可
- repo 自身の部品（source `projectSettings` の skill・agent、kind `project` / `local` の指示ファイル）は profile に関係なく
  残る。kind `managed` の指示ファイルも残る

### 対象と event

| 対象 | event | 動作 |
|---|---|---|
| skill | `prompt.attachment`（type `skill_listing`） | 一覧から項目を外す。項目は「`- ` で始まる行から次の `- ` の直前まで」、名前は最初の `: ` まで（無ければ行末まで）。repo 自身の skill の判定は `session.usage` の source |
| skill | `tool.call`（`Skill`） | この会話で一覧から実際に外した名前だけを理由つきで断る。解析に失敗して素通しにしたら断らない。利用者の `/name` と agent の `skills:` preload は通る |
| agent | `agent.offer` | 外す型に `{ isOffered: false }`（一覧から外し、dispatch も断る）。source `projectSettings` は残す |
| rules・CLAUDE.md | `prompt.context` | `await next(e)` の `instructionFiles` から kind `user` のものを path の glob で外す。`@` で取り込まれた子孫も外す |
| ツール | `tool.describe` + `tool.call` + `prompt.attachment`（`deferred_tools_delta`） | `isDeferred: true` で ToolSearch の後ろへ回し、名前の一覧からも外し、呼ばれたら断る |
| 確認 | `command.run`（`/<name>`） | 画面（`$.ui.log`）に出す。`-p` のときだけ text |

### 不変条件（テストで固定する）

- 素通し: profile を選んでいない repo、壊れた profile・存在しない profile 名、知らない event・attachment 種別・想定外の形式。
  カテゴリの中の知らない名前は、そのカテゴリの allow / deny に従う
- 出力は入力と profile の決定的な関数で、2 回かけても同じ。残した項目はバイト単位で元と同じ
- `origin.kind` が `hook` / `plugin` のリマインダー、`managed`・`project`・`local`・`memory` の指示ファイル、repo 自身の
  skill・agent には触れない
- 外部への通信・プロセスの起動・モデルの呼び出しをしない。読むのは profile と選択ファイルだけ

### 実装の形

- 解析と絞り込みは `$` を使わない純粋な関数として別ファイルに置く（`$` は import した関数に渡せない — validate が落とす）
- profile は `session.start` と `classic.SessionStart`（startup / clear / resume）で読み、各 hook は同じ読み込み結果を待つ

### 既知の限界（README に書く）

- 見せるかどうかの制御で、強制ではない（モデルが SKILL.md を直接 Read すれば読める）
- 後から付く指示ファイル（`paths:` 付きの rule、下位ディレクトリの CLAUDE.md。`nested_memory`）は外れない
- Mod で OFF にしたツールは、ネイティブの deny と違って完全には消えない（ToolSearch の後ろに回して断る）。完全に
  消したい場合は v0.2 の同期コマンドかネイティブの deny
- profile の変更は新しい会話か `/clear` から効く
- user の agent が built-in と同じ名前（例: Explore）だと、OFF にすると built-in にも戻らず消える

### v0.2: ツールをネイティブの deny に同期する

- `/<name> sync` を利用者が打ったときだけ、profile で OFF にしたツールを `.claude/settings.local.json` の `permissions.deny`
  に書く。書く前に差分を見せる。Mod が書いた行には印を付け、profile から外したら消せるようにする
- settings の permissions は権限の設定なので、セッションの裏では書かない。効くのは次のセッションから

### 範囲外

- system prompt の節（出力スタイルに任せる）
- MCP サーバーの instructions（`mcp_instructions_delta`）

## 段取り

種別は `feat`。実装はこのセッション（Opus、build-tier）。前の版の段取り 0（plan と RFC の commit）は済み。

| # | 内容 | 完了の判定 |
|---|---|---|
| 1 | この r2 と図解を commit（`docs(plan): rfc-0001-r2-profile-allowlist`）。RFC-0001 の Status に r2 へのリンクを足す | commit 済み |
| 2 | 著者が `.claude/verify.sh` を承認 → ゲート一式・probe・計測の記録を commit | verify が通る（`claude plugin test` はテストが無い間「眠っている」と報告） |
| 3 | Phase 0 の残り（下） | 計測の記録に追記 |
| 4 | TDD: 不変条件と各 event の変換を fixture で先に書く | テストが赤で落ちる |
| 5 | 実装（`hooks/register.ts`、純粋な関数の module、同梱の `profiles/writing.json`、`.claude-plugin/marketplace.json`） | verify が通る |
| 6 | Review: `/code-review`（effort `medium`）と `security-reviewer` を並列 | CRITICAL なし |
| 7 | 実機確認（Verification） | 期待どおりに外れ、残すものが残る |
| 8 | Doc Sync: README（skill: readme-writer）、RFC-0001 | readme-judge が Publishable |
| 9 | 公開の準備: awesome list の後半を再確認、2.1.288 以降でテストを回し直す | 著者に渡す |

### Phase 0 の残り（実装の前に答えを出す）

1. 指示ファイル: `instructionFiles` から 1 件外すと、`instructions` の本文からも消えるか（経路が 1 本か）
2. `session.usage` を hook の中で呼んだとき: 一覧が書き換え前か後か、自分を再帰的に呼ばないか、最初の一覧より前に取れるか。
   取れなければ repo の `.claude/skills/` を `fs` で読んで判定する
3. ライフサイクル: `/clear` と resume で `classic.SessionStart` が届くか、module の変数が残るか、一覧が丸ごと再送されるか
4. subagent（general-purpose・自作の agent・fork）に、絞った一覧と指示ファイルが届くか
5. built-in と synced の skill が `skill_listing` に同じ形式で載っているか（`skillOverrides` が効くかは README の比較表のために）

## Verification

- 機械ゲート: `.claude/verify.sh`（Biome / TypeScript 7 / `claude plugin validate --strict` / `claude plugin test` / `npm audit`）
- テスト: 素通し（選択ファイルが無い repo で全 event が `next` の結果と一致し、余計な `fs` 読み取りもしない）、決定性と冪等性、
  不変条件、壊れた入力、fixture の必須ケース（説明の無い項目、複数行の説明、`ns:name`、`dir:name`、2 回目の一覧、`@` import
  の連鎖、5 種類の kind、知らない種別）、ライフサイクル（clear・resume で読み直し、compact では読み直さない）、1,000 項目の一覧
- 実機: 執筆 repo で probe と Mod を一緒に読み込み、C0 と比べる。allow に書いた skill・agent だけが一覧に残る（repo 自身の
  ものも残る）、名前だけに削られていた説明が戻る、指定した指示ファイルとツールが外れる、確認コマンドの数字が probe と一致する
- 対話で 1 回: 残した skill が呼べる、OFF の skill を Skill tool で呼ぶと理由つきで断られる

## 人間に渡すもの

- `.claude/verify.sh` の承認（hash）
- 名前（repo 名も含めて。plugin 名は `claude-` で始められない）
- 執筆 repo の profile の中身と、選択ファイルの commit
- 公開: GitHub repo の作成と公開、marketplace への登録、awesome-claude-code-mods への PR
- `claude plugin eval` を回すかと、その費用の上限（回す場合は `--no-publish`）
