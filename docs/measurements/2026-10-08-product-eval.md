# プロダクト品質の eval ループ（2026-10-08、Claude Code 2.1.294）

RFC: [rfcs/0001-prose-mod.md](../../rfcs/0001-prose-mod.md)。branch `quality/product-eval`。依頼は「ギガテックが出したプロダクトと
並べても見劣りしない品質に引き上げ、Eval ループを回す」。物差しを先に作り、改善前の値を測ってから直した。

## 物差し

3 層。上ほど実機に近く、下ほど速い。

| 層 | 入口 | 何を見るか |
|---|---|---|
| 実機 eval | `python3 tools/eval/e2e.py [--plugin DIR]` | 本物の `claude -p`（haiku）を使い捨ての git repo で走らせ、probe（`tools/probe`）を外側に置いてモデルに届いた一覧を記録し、決定的な検査で採点する。著者の `~/.claude`（skill 90 件前後）はそのまま見える。install 済みの harness-scope は `--settings` の `enabledPlugins` で外し、configDir は `pluginConfigs` で fixture に向ける。1 周 約 2.5 分、`claude -p` 約 22 回 |
| 公式 eval | `tools/eval/plugin-eval.sh [DIR] -j 4` | `claude plugin eval`。5 ケース × 3 回 × 2 arm（plugin あり / no-plugin baseline）。run ごとに設定が隔離され、built-in の skill と agent だけが見える。runner はケースを plugin の下からしか読まず、evals を配布物に入れないため、一時ディレクトリに plugin/ と evals/ を並べて走らせる。1 周 24 秒、$0.03 |
| 単体 | `claude plugin test`（plugin/ と tests/ を一時ディレクトリに並べる） | hook の振る舞い、一覧の解析、文面 |

実機 eval の次元（検査の本文は `tools/eval/e2e.py`）:

- **a 効く** — 同梱 `writing`: skill は repo 自身のものだけ、agent は Explore と general-purpose だけ、コード用の 4 ツールが
  ToolSearch の一覧からも先頭からも消える、残った項目は byte 単位で同じ、受領書の off 件数が一覧から消えた件数と一致。
  OFF の skill を呼ぶと理由つきで断られる（plugin あり 3 回、なし 3 回）。指示ファイルを絶対 path で外せる
- **b 素通し** — selector 無し / JSON でない / 未知の profile / 壊れた profile / 名前以外を持つ selector の 5 ケースで、
  skill 一覧・deferred tool 名・提示された agent・指示ファイル・先頭に載るツールが no-plugin の run と同じ。selector 無し
  では画面に何も出ず、ほかは 1 回だけ「passing everything through」と出る。repo と設定ディレクトリのファイルが変わらない
- **c 初回体験** — 起動時の画面の行が 1 行・120 字以内・1 行に収まり plugin 名が二重にならない、受領書が profile と出所・
  repo 相対の selector・止め方・「何も書き込まない」を言う、プロンプト前の `/harness-scope` が 10 秒以内に「まだ組み立てて
  いない」と答える、selector の無い repo で `/harness-scope names` が skill・agent・tool の名前を出す
- **d 頑健さ** — 別名つきの行（`- hookify:writing-rules (hookify:writing-hookify-rules): …`）と、説明の中の
  `- name: text` 行（fixture plugin `tools/eval/fixtures/hsfx` の router。一覧が予算内に収まるよう `--setting-sources project`
  で走らせる）を誤読しない
- **s 配布物** — plugin/ の hooks が環境変数・ファイル書き込み・プロセス・通信を使わない、テスト・eval・URL を含まない

公式 eval のケース（`evals/`）: `hidden-skills`（OFF の skill がモデルの答える一覧に出ない）、`refused-skill`（呼ぶと
「turned off in this repo by the harness-scope profile "writing"」で断られ、モデルがそう報告する。llm grader つき）、
`pass-through`（selector 無しで built-in skill が見える）、`broken-selector`（壊れた selector で素通しし、そう言う）、
`receipt`（`/harness-scope` の受領書の文面）。

## ラウンドごとの値

実機 eval は「通った検査 / 検査数」。round 0 は HEAD（903b525）の plugin/ の写し。

| 次元 | round 0（改善前） | round 1 | round 2 | round 3（最終） |
|---|---|---|---|---|
| a 効く | 14/15 | 15/15 | 15/15 | 15/15 |
| b 素通し | 35/35 | 35/35 | 34/35 ※ | 34/35 ※ |
| c 初回体験 | 4/11（後で足した 1 検査を含めると 4/12） | 11/11 | 12/12 | 12/12 |
| d 頑健さ | 3/8 | 8/8 | 8/8 | 8/8 |
| s 配布物 | 6/6 | 6/6 | 6/6 | 6/6 |
| 公式 eval（合格ケース / score / 平均 Δ） | 4/5 / 0.80 / 0.40 | 5/5 / 1.00 / 0.60 | 5/5 / 1.00 / 0.60 | 5/5 / 1.00 / 0.60 |
| 単体テスト | 42 | 56 | 57 | 62 |

公式 eval の Δ はケースごとに、効くケース（hidden-skills・refused-skill・receipt）が +1.00、素通しのケース（pass-through・
broken-selector）が 0（plugin を入れても何も壊さない）。round 0 の不合格は receipt（0/3）。

※ round 2・3 の b の 1 件は、素通しの run で deferred tool 名が baseline と違った。round 3 で差分を出すと claude.ai の Coursera
connector の 6 ツールが丸ごと出入りしていた。素通しの経路（profile が on でないとき）は deferred 一覧を `next(e)` の結果の
まま返すので、Mod 由来ではなく connector の接続タイミングと判断した（round 0・1 では no-plugin の baseline 同士も違っていた）。
以後の e2e は `mcp__claude_ai_*` の出入りを素通しの比較から外す。

round 0 で落ちた検査:

- a: 受領書の off 件数が 1 少ない（89 vs 90）。別名つきの `hookify:writing-rules` が直前の skill の説明として読まれ、数にも
  名前にも出なかった
- c: 起動時の行が 200 字超（selector が絶対 path）、受領書に止め方・「書き込まない」が無い、`/harness-scope names` が無い
- d: 別名つきの行を直前の skill と一緒に消す・残す（3 検査とも不合格）。説明の中の `- hsfx:helper: …` を skill とみなして
  router の説明を削る

## ラウンドの間で直したもの

- **round 0 → 1**: skill の境目を `session.usage` の名前と順序で決める（下の実測）。別名つきの行を 1 項目として読み、
  一覧の名前・括弧内の名前のどちらでも一致させる。status line（`$.ui.status`）、`/harness-scope names`、受領書の止め方の行と
  allow の `kept:` 行、repo 相対の selector、`configDir` が `.claude` で終わらないときに `~/.claude/…` と偽って短縮しない
- **round 1 → 2**: tmux で対話画面を見ると、複数行の `ui.log` は改行が `�` になって 1 行に潰れ（round 0 から）、Claude Code
  が plugin 名を前置するので `harness-scope: harness-scope: …` と二重になっていた。受領書を 1 行ずつ出し、自前の接頭辞を
  外した。c に「1 行に収まり plugin 名が二重にならない」検査を足した
- **round 2 → 3**: `/code-review`（medium）の指摘のうち正しさに効くもの — `/clear` で off に戻ったとき status line を消す、
  skill 名を一覧ごとに読み直す（会話の途中で増えた skill を知らない名前として前の項目に吸わせない）、同期 skill を usage の
  名前（`docx`）でも一致・拒否する、後の一覧を素通しにしたら前の拒否を解く、`names` が会話中のすべての一覧を集める、
  未知の引数に使い方を返す

## 実測した事実（2.1.294）

- skill 一覧と `deferred_tools_delta` の形式は 2.1.287 と同じ。`- name` / `- name: 説明` / `- name (別名): 説明`
- `session.usage` の `skillFrontmatter` は一覧と同じ順に並ぶ（著者の環境 90 件、`--setting-sources project` の 15 件の両方で
  全件が単調に対応）。一覧の名前は、usage の名前・括弧内の別名・plugin 接頭辞を外した名前（同期 skill）のどれかに一致する
- 一覧が予算を超えると、一部の skill は説明が落ちて `- name` だけになる（著者の環境で 35 件）。予算内なら複数行の説明は
  そのまま出て、説明の中に `- other: text` の行が現れうる
- `--plugin-dir` を 2 つ渡すと、先に渡した plugin の hook が外側になる。probe を先に置くと絞り込み後が見える
- Mods は `claude plugin eval` の run でも読み込まれる（hidden-skills の Δ +1.00）。scaffold は case ディレクトリの中の
  ファイル（`scaffold_script: scaffold.sh`）で、`--scaffold` が要る。regex grader は JavaScript の正規表現（`flags: i`）
- `$.ui.status` は入力欄の下に `⚠ harness-scope: <text>` と出る

## 測っていないもの

- marketplace からの install にかかる時間（install は利用者の設定を書き換えるので回さなかった）。代わりに、`claude -p
  "/harness-scope"` の冷えた起動が 4.3 秒、起動時の 1 行が最初の画面に出ることを確かめた
- 読み込まれない回の頻度（README の「2.1.287 で 9 回中 1 回」）は狙って測っていない。読み込みが結果に現れる run
  （selector のある実機 eval 15 run と公式 eval 12 run、各 4 ラウンドで計 108 run）では、読み込まれなかった回は無かった。
  status line で気づけるようにしたのが今回の対策
- `.claude/verify.sh` は tests/ を plugin の外に置いてから plugin test を「テスト 0 件」として眠らせたまま。一時ディレクトリで
  走らせる patch（`.notes/verify-tests-outside-plugin.patch`）は承認 hash が要るので当てていない。今回の単体テストは同じ手順を
  手で走らせた
