# RFC-0001 詳細設計: global harness の skill / rules / agent を repo ごとに ON/OFF する Mod

## 結論

- 作る。範囲を広げる: 「執筆用にコーディング前提を外す」から、「global の skill・rules・agent・ツールを、global に定義した
  名前付き profile で repo ごとに ON/OFF する。執筆はその profile の 1 つ」へ（著者の要望と選択、2026-10-03）
- 根拠: 執筆 repo に届く量の大半は利用者の global harness から来ている（前提の訂正）。repo 間で共有できる名前付きの
  ON/OFF はネイティブ設定に無く、本体への同じ要望は閉じられている。同じことをする公開 Mod も見つからなかった
- skill を repo ごとに置く運用は管理が割れる（著者の指摘）。定義は global に 1 か所、repo では名前を 1 行で選ぶだけにする
- v0.1 は system prompt の節に触らない（著者の選択）。system prompt のコーディング指示は出力スタイルに任せる
- 実装の前に Phase 0 で、ネイティブ設定の実際の効きと、指示ファイル・skill 一覧の経路を確かめる。設計が外れうる点が
  残っているため

## Context

[RFC-0001](../../rfcs/0001-prose-mod.md)（draft 2026-10-03）は、執筆用 repo でコーディング前提の文脈をモデルに渡さない
Mod を作り、Mods の既定有効化（v2.1.287）の直後に公開する提案。その Next action「詳細設計で Unresolved questions を順に
決める」をこのセッションで行った。途中で著者から、global harness の skill と rules を repo ごとに ON/OFF したいという要望が
出た。根拠は外部調査（search-first、2026-10-03）、前回の計測データの読み直し、手元の Claude Code 2.1.287 が書いた型定義、
設計の弱点の洗い出し（Plan agent、fresh context）。

## 前提の訂正（2026-10-03）

RFC の計測節は、モデルに届いた量を数え違えている。

| 種類 | RFC の数字 | 実際にモデルへ届いた量 |
|---|---|---|
| ツールの説明文 | 152 件 / 109,411 字 | 14 件 / 14,630 字。残る 138 件 94,781 字は ToolSearch の後ろにあり、届いたのは名前の一覧（`deferred_tools_delta`、5,918 字）だけ |
| system prompt | 名前付きの節 24（空でない 10）/ 5,029 字 | 本体の冒頭（`intro` `system` `doing_tasks` `actions` `tools` `tone`）は未計測。`prompt.section` は後半の session 側の節にしか発火しない |
| リマインダー類 | 12 種 / 94,459 字 | 数字は同じ。うち `instructions` 37,495 字（21 ファイル、うち 16 本は global harness の CLAUDE.md と rules）、`skill_listing` 26,342 字、`agent_listing_delta` 17,921 字 |

- `prompt.compose` の記録が 0 件だった理由: probe が入力の `e.sections` を読んでいた。2.1.287 の型では、節の一覧は
  `next(e)` の戻り値にある
- 届く量の大半は Claude Code のコーディング用の既定ではなく、利用者自身の harness（rules・skills・agents）から来ている
- 計測は `claude -p`（trait `print`）での 1 回。対話セッションでは構成が変わりうる

## 外部調査の要点（2026-10-03、search-first）

**既存の Mod**（範囲: awesome-claude-code-mods のうち見えた前半、aitmpl.com、Web 検索）— 同じことをするものは見つからなかった。

- `jev-skill-suggestion`（davila7/claude-code-templates、MIT）: `prompt.attachment` の `skill_listing` を allowlist で絞り、
  prompt ごとに外部モデルが 1 個を選んで添える。allowlist は userConfig（user 単位）で、repo ごとに切り替えられない
- `jev-rules`（EliaAlberti/jev-rules）: prompt ごとに外部モデルが rules を選ぶ。動的で API が要る。こちらは静的・決定的で
  API が要らない
- `context-report`（darkroomengineering/cc-settings）: 読み込まれた指示ファイル（tier・path・`@` import・大きさ）を表示する。
  外しはしない。確認コマンドの先行例
- 組み込みの `agents-md` Mod（anthropics/claude-code `mods/agents-md`）: `prompt.context` で指示ファイルを足し、managed-only
  モードでは user / project のファイルを外す。rules の OFF の手本になる
- `nklisch/claude-code-modes`: system prompt を丸ごと差し替えるランチャー。ツール説明・リマインダー・一覧には触れない

**本体への要望**: repo ごとの skill の ON/OFF を求める issue が複数ある — anthropics/claude-code#37463（closed）、#43928
（not planned）、#39749（duplicate。名前付き preset の案）、#62174（not planned。「`enabledPlugins` は project 単位で効かない」
「plugin の skill を `skillOverrides` で off にしても説明文は context に残る」、2026-05）。

**ネイティブ設定でできること**（公式 docs、2026-10-03 取得。2.1.287 での実際の効きは Phase 0 で確かめる）:

| 対象 | ネイティブの手段 | 足りないところ |
|---|---|---|
| ツール | `permissions.deny` にツール名だけを書くと文脈から消える。project 単位、trust 不要 | 各 repo の settings に書き写す |
| MCP | `disableClaudeAiConnectors`（project で opt out 可）、deny `mcp__*` | 同上 |
| user / project の skill | `skillOverrides` を project で `off` / `name-only` | plugin の skill に効かない。名前ごとの denylist |
| plugin の skill / agent | `enabledPlugins` を false | project の false が user の true に勝つか未確認（#62174 は効かないと報告） |
| agent | deny `Agent(name)` で呼び出しを止める | 一覧から消えるかは docs に記述なし |
| rules / CLAUDE.md | `claudeMdExcludes`（絶対 path の glob）、rules の `paths:` | `~/.claude/rules` を外せるかは docs に記述なし。`paths:` のない rule は全 repo で読まれる |
| system prompt のコーディング指示 | custom の出力スタイル（`keep-coding-instructions` の既定 false）を project の `outputStyle` で選ぶ | 外れる範囲は docs の例示（変更範囲・コメント・検証）まで |

- どれも repo の settings ごとに書く denylist で、repo 間で共有する名前付きのまとまりは無い
- 他: `includeGitInstructions: false`（commit / PR の指示）と `autoMemoryEnabled: false` も project 単位で効く
- Team / Enterprise と managed settings の環境では組み込みの guard が載り、利用者の Mod は system prompt・managed の CLAUDE.md・
  managed の MCP を変えられない（v0.1 はどれにも触れない）
- 最新は 2.1.288（subagent が worktree で動くときの `tool.call` の不具合の修正、path 限定の rules が Write / Edit でも読まれる
  ようになった、など）。手元は 2.1.287

## Unresolved questions の決定

| RFC の問い | 決定 |
|---|---|
| 出力スタイルだけで十分ではないか | 十分ではない。出力スタイルが外すのは system prompt のコーディング指示だけで、量の大半（指示ファイル・skill / agent の一覧）には届かない。system prompt 側は出力スタイルに任せ、Mod は届かない側を受け持つ |
| 執筆向けの Mod が既に公開されていないか | この範囲では無い。awesome list の後半は、公開の前に raw README の全文検索で確かめる |
| `prompt.compose` が記録しなかった理由 | probe の不具合（`next(e)` の戻り値を読む）。節の全体は `prompt.compose` で、後半の節だけが `prompt.section` で見える |
| 何を外し、何を残すか | 外すものは利用者が profile で決める。Mod の不変条件で、managed の指示・repo 自身の部品・hook と他の plugin の出力は外さない。system prompt には v0.1 では触れない |
| 外したあとに執筆の質が変わるかをどう確かめるか | README の主張は「届く量が減る」までにする（決定的に測れる）。質は公開前に `claude plugin eval --ablation with-without --no-publish` を 1 回回し、差が見えたかだけを書く（n が小さいので弱い主張にとどめる） |
| 名前と公開先 | 範囲が広がったので repo 名から考え直す（著者に渡す）。plugin 名は `claude-` で始められない。repo を marketplace にする |

## 設計

### 使い方

1. Mod を user scope に 1 回 install する。どの repo でも読み込まれるが、profile を選んでいない repo では何もしない
   （project 単位の `enabledPlugins` に頼らない）
2. 名前付き profile を global に置く: `~/.claude/<name>/profiles/<profile>.json`（将来の本体機能と衝突しないよう Mod の
   名前で区切る）。Mod は例として `writing` を同梱する
3. repo には選ぶだけのファイルを置く: `.claude/<name>.json` に `{ "profile": "writing" }`。探す順は session の root、
   次に repo の root（worktree からでも main の選択が効く）
4. 会話の始まり（起動・`/clear`・resume）で profile を読み、その会話の間は固定する。`/<name>` で、この repo で外したもの・
   一致しなかった名前を確かめる

### profile の形

```json
{
  "skills":       { "allow": ["writing-ecosystem", "prose-translation", "headline-craft"] },
  "agents":       { "deny":  ["pr-review-toolkit:*", "claude-security:*", "swift-reviewer"] },
  "instructions": { "deny":  ["~/.claude/rules/common/testing.md", "~/.claude/rules/common/coding-style.md"] },
  "tools":        { "deny":  ["LSP", "NotebookEdit", "mcp__claude_ai_Slack__*"] }
}
```

- カテゴリごとに `allow`（これだけ残す）か `deny`（これだけ外す）。名前と path は glob 可。allow なら、あとから global に
  足した skill は執筆 repo に入ってこない
- skill の allow は、repo 自身の skill を一覧の中で見分けられる場合だけ使える（一覧の本文には出どころが書かれていない。
  見分け方は Phase 0 で決める。見分けられなければ skill は deny だけにする）
- repo 側のファイルは名前で選ぶだけで、中身は書けない（著者の選択）。clone してきた repo が、利用者の安全側の rules を
  黙って外せないようにするため。選べるのは、利用者が自分で定義した profile と同梱の profile だけ

### 対象と event

| 対象 | event | 動作 |
|---|---|---|
| skill | `prompt.attachment`（type `skill_listing`） | 一覧から項目を外す。項目は「`- ` で始まる行から次の `- ` の直前まで」（説明が複数行のものがある）。名前は最初の `: ` まで、無ければ行末まで（`ns:name` や `dir:name` を `:` で切らない） |
| skill | `tool.call`（`Skill`） | この会話で一覧から実際に外した名前だけを、理由つきで deny する。一覧の解析に失敗して素通しにしたら deny もしない。利用者が `/name` と打つのと、agent の `skills:` preload は通る |
| agent | `agent.offer` | `{ isOffered: false }`（一覧から外し、dispatch も断る）。毎 turn 呼ばれうるので、読み込み済みの profile だけで判定する |
| rules・CLAUDE.md | `prompt.context` | `await next(e)` の結果の `instructionFiles` から、kind `user` のものを path の glob で外す。外したファイルが `@` で取り込んだもの（`parent` をたどった子孫）も外す。`instructionFiles` が無ければ素通し |
| ツール | `tool.describe` + `tool.call` + `prompt.attachment`（type `deferred_tools_delta`） | `isDeferred: true` で ToolSearch の後ろへ回し、名前の一覧からも外す。呼ばれたら理由つきで deny |
| 確認 | `command.run`（`/<name>`） | profile の場所、外した件数と字数、一致しなかった名前、この会話で一度も見ていない attachment 種別。画面（`$.ui.log`）に出し、モデルには返さない（返すと OFF の名前をモデルに教えてしまう）。`-p` のときだけ text で返す |

### 不変条件（テストで固定する）

- 素通しにするもの: profile を選んでいない repo、壊れた profile と存在しない profile 名、知らない event・attachment 種別・
  想定外の形式。カテゴリの中の知らない名前は、そのカテゴリの allow / deny に従う
- 出力は入力と profile の決定的な関数で、2 回かけても変わらない。残した項目はバイト単位で元と同じ（prompt cache を壊さない）
- `origin.kind` が `hook` / `plugin` のリマインダー、kind `managed` の指示ファイルには触れない
- repo 自身のもの（`.claude/` の skill・agent と、kind `project` / `local` の指示ファイル）は profile の対象外。allow に
  書き忘れても消えない。対象は global（user と plugin）の部品だけ。auto memory（kind `memory`）はネイティブの
  `autoMemoryEnabled` に任せて触れない
- 外部への通信・プロセスの起動・モデルの呼び出しはしない（使うのは `fs` の読み取りだけ。`claude plugin validate` の一覧で
  示せる）

### 実装の形

- 一覧の解析と絞り込みは、`$` を使わない純粋な関数として別ファイルに置く。`$` は import した関数に渡せないので、`$` を
  使う部分は hooks module に残す。テストも純粋な関数に対して書ける
- profile は `session.start` と `classic.SessionStart`（startup / clear / resume）で読み込み、各 hook は同じ読み込み結果を
  待つ。会話の途中での root の移動（worktree への移動など）は追わない

### 既知の限界（README に書く）

- 見せるかどうかの制御で、強制ではない。モデルが SKILL.md を直接 Read すれば読める
- 後から付く指示ファイル（`paths:` 付きの rule、下位ディレクトリの CLAUDE.md。`nested_memory` で届く）は外れない
- 一覧の予算（context の 1%）で落ちた skill は、外して空きができても戻らない
- profile の変更は新しい会話か `/clear` から効く。global の profile が無い機械（cloud session など）では素通しになる
- user の agent が built-in と同じ名前（例: Explore）だと、OFF にしたとき built-in にも戻らず消える

### v0.1 の範囲外

- system prompt の節（出力スタイルに任せる。Phase 0 の計測で残りを見て、次の版で判断する）
- MCP サーバーの instructions（`mcp_instructions_delta`）。connector はネイティブの `disableClaudeAiConnectors` を案内する

## 段取り

種別は `feat`。実装はこのセッション（Opus、build-tier）で行う。

| # | 内容 | 完了の判定 |
|---|---|---|
| 0 | この plan を単独 commit（`docs(plan): <slug>`）。plan の承認をもって RFC-0001 を `accepted` とし、`claims.py claim RFC-0001` で着手を記録する。次の commit で RFC-0001 を更新: state を `in_progress`、`## Status` に plan へのリンク、範囲の変更、計測節の訂正、Unresolved questions の決定 | `git log` に 2 commit |
| 1 | skill: verify-bootstrap で `.claude/verify.sh` を作る（`claude plugin validate --strict`、`claude plugin test`、型検査、lint、secret scan）。承認を待つ間も Phase 0 の計測は進め、commit だけを待つ | 著者が verify.sh の hash を承認 |
| 2 | **Phase 0**（下）。probe を直して `tools/probe/` に置く | 計測の要約が `docs/measurements/` にあり、テスト用の fixture ができている。設計の変更点を plan に追記した |
| 3 | TDD: 不変条件と各 event の変換を、fixture を使ったテストで先に書く | テストが赤で落ちる |
| 4 | 実装: `.claude-plugin/plugin.json`、`hooks/hooks.json`、`hooks/register.ts`、純粋な関数の module（profile の照合・一覧の解析と絞り込み）、同梱の `profiles/writing.json`、`.claude-plugin/marketplace.json` | verify.sh が通る |
| 5 | Review: `/code-review`（effort `medium`）と `security-reviewer`（repo 側のファイルが、モデルに渡る指示を変えるため）を並列 | CRITICAL なし |
| 6 | 実機確認（Verification） | 期待どおりに外れ、残すものが残る |
| 7 | Doc Sync: README（skill: readme-writer。動作を確かめた版、ネイティブ設定との併用、既知の限界）、RFC-0001 の Status | readme-judge が Publishable |
| 8 | 公開の準備: awesome list の後半を raw README の全文検索で再確認、2.1.288 以降が手元に来たらテストと実機確認を回し直す、`claude plugin eval` を 1 回（任意） | 著者に渡す |

### Phase 0（実装の前に、設計が外れうる点を潰す）

**probe の修正**: 出力先を環境変数で受ける（今は個人の path が固定で、そのまま commit できない）。`prompt.compose` は
`await next(e)` の戻り値を読む。`tool.describe` の `isDeferred` と `provider`、`prompt.attachment` の `origin.kind` と
`agentId` を記録する。`prompt.context`（blocks と `instructionFiles` の path・kind・parent）、`agent.offer`（agent・source）、
`tool.call` の Skill の入力、`classic.SessionStart` の source を足す。記録は場面ごとの JSONL にする。

**条件**: 執筆 repo（`~/MyAI_Lab/zenn-content`）で、同じ短い prompt を `claude -p` で流す。構成の記録は決定的なので各 1 回
でよい。執筆 repo のファイルは変えない。

- C0: 今のまま
- C1: C0 + `keep-coding-instructions` なしの出力スタイル（probe に同梱し、`--settings` で選ぶ）
- C2: ネイティブ設定（`skillOverrides`、`enabledPlugins` の false、`claudeMdExcludes` に `~/.claude/rules` の path、deny
  `Agent(name)` と `Skill(name)` とツール名）を `--settings` で渡す。`--settings` は project の層と優先順位が違うので、
  効かなかったものと `enabledPlugins` は、scratchpad の使い捨て repo の `.claude/settings.json` で確かめ直す

**実装の前に答えを出すこと**（優先順。答えで設計が変わる）:

1. C2 のネイティブ設定が、一覧や本文から説明文まで消すか
2. 指示ファイルの経路: `prompt.context` が対話と `-p` で発火し、`instructionFiles` に 21 件が kind・parent 付きで来るか。
   1 件外すと `instructions` の本文から消えるか（経路が 1 本か）。resume で計算し直されるか
3. skill の出どころ: `$.session.usage({ breakdown: 'summary' })` の source で repo 自身の skill を見分けられるか（書き換え前の
   一覧か、費用、hook の中で呼んだときの再帰）。だめなら repo の `.claude/skills/` を `fs` で読んで見分ける。どちらも
   無理なら skill は deny だけにする
4. ライフサイクル: `classic.SessionStart` の各 source が Mod に届くか、`/clear` と resume で module の変数が残るか、一覧が
   丸ごと再送されるか差分か
5. subagent（general-purpose・自作の agent・fork）に、`instructions` と `skill_listing` が agentId 付きで hook を通って届くか

**実機確認（手順 6）で見ればよいこと**: `agent.offer` の頻度と source の実際の値、Skill tool の名前の揺れ（短い名前・
先頭の `/`）、ToolSearch が使えない構成での `isDeferred`、10 turn 以上と圧縮の後の prompt cache（`turn.step` の
cache_read）、`nested_memory` の形式、対話と `-p` の差。

**出力**: 要約表（公開できる形、path は `~/`）と、テスト用の fixture。fixture は構造を保って伏せる（`$HOME` を `~` に、
説明文は行の構造・`: ` の有無・長さを保ったダミーに）。Claude Code の版と取得日を入れる。生の記録は gitignore した
場所に置き、commit しない。前回の記録（`/private/tmp` 下）は消える前にそこへ移す。

**計画を見直す条件**: ネイティブ設定に、repo 間で共有できる名前付きの ON/OFF か、skill・agent・指示ファイルをまとめて
allowlist で絞る手段があると分かったら、実装に進まず再 plan する。個々のネイティブ設定が効く場合は、Mod では作り直さず
README で併用を案内する。

## Verification

- 機械ゲート: `.claude/verify.sh`（validate --strict / plugin test / 型検査 / lint）
- テストで固定すること:
  - 素通し: 選択ファイルが無い repo で、全 event が `next` の結果と完全に一致する。余計な `fs` 読み取りもしない（test kit
    では答えていない event が throw するので、読めば落ちる）
  - 決定性: 同じ入力で同じ結果、2 回かけても同じ、残した項目がバイト単位で同じ、一致 0 件の profile なら入力と同じ
  - 不変条件: managed の指示ファイル・repo 自身の部品・hook と plugin 由来のリマインダーは残る。Skill の deny は一覧から
    外した名前だけに効く
  - 壊れた入力: JSON が壊れた profile、存在しない profile 名、想定外の形式 → 素通し。通知は 1 回だけ
  - fixture の必須ケース: 説明の無い項目、複数行の説明、`ns:name`、`dir:name`、2 回目の一覧、`@` import の連鎖、
    5 種類の kind、知らない種別
  - ライフサイクル: `classic.SessionStart` の clear と resume で読み直し、compact では読み直さない
  - 1,000 項目の一覧でも hook の時間制限に十分収まる
- 実機: 執筆 repo で probe と Mod を一緒に読み込み、C0 と比べる。`skill_listing` が profile のとおりに減る、指示ファイルが
  減る、agent の一覧が減る、指定したツールが deferred になり呼び出しが断られる、確認コマンドの数字が probe と一致する
- 対話で 1 回: 残した skill（例 `writing-ecosystem`）が呼べる、OFF の skill を Skill tool で呼ぶと理由つきで断られる

## 人間に渡すもの

- `.claude/verify.sh` の承認（hash）
- 名前（範囲が広がったので repo 名も含めて。plugin 名は `claude-` で始められない）
- 執筆 repo に置く profile の中身（どの skill・rules・agent・ツールを外すか）。執筆 repo に置く選択ファイルの commit
- 使い捨て repo を使う場合の、初回の trust の確認（mod は trust 前のディレクトリでは読み込まれない）
- Phase 0 で対話が要る場面（resume・`/clear`・subagent）を `-p` で再現できなかったときの、1 回の手動操作
- 公開: GitHub repo の作成と公開、marketplace への登録、awesome-claude-code-mods への PR
- `claude plugin eval` を回すかと、その費用の上限（回す場合は `--no-publish` で結果を claude.ai に出さない）
