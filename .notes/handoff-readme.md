# README に載せる事実（product-quality branch → README 側 session、2026-10-08）

product 側（branch `quality/product-eval`）で変えた・確かめたことのうち、README.md / README.ja.md に反映すべきもの。
計測の正本は [docs/measurements/2026-10-08-product-eval.md](../docs/measurements/2026-10-08-product-eval.md)。
文面は README 側で書く。ここは事実だけ。

## 新しい挙動（version は未 bump。release は人間）

- **status line**: profile を選んだ repo では、入力欄の下に `harness-scope: profile "writing" on` が常に出る
  （`$.ui.status`）。読めない profile では `harness-scope: passing everything through (see /harness-scope)`。
  selector の無い repo では何も出ない。→ README の Limitations「1/9 回読み込まれなかった」「break shows up as
  nothing being turned off」に対し、**selector のある repo で status line が無ければ Mod が読み込まれていない**、
  と気づける合図になった
- **起動時の 1 行**が短くなった: `harness-scope: profile "writing" (bundled) on, selected by .claude/harness-scope.json —
  /harness-scope for details`（selector は repo からの相対 path。以前は絶対 path で 200 字超）
- **`/harness-scope names`**: その会話で提示された skill・agent・tool の名前を、profile に書く形で一覧する。
  selector の無い repo でも使える（profile を書く前に名前を調べる用途）。プロンプトを 1 回送った後に使う
- **`/harness-scope` の受領書**の最後の行: `To turn it off: delete .claude/harness-scope.json, then /clear.
  harness-scope writes no files.` allow の profile では `skills kept: …` / `agents kept: …` も出る。
  一致しなかったパターンは `skills patterns that matched nothing: …`
- 端末では受領書が 1 行ずつ出る（以前は複数行を 1 行の画面ログで出しており、端末で改行が `�` になって潰れていた）
- 一覧の形式が想定外、または skill の境目が一意に決まらないとき、素通しに加えて**画面に 1 行**と status line で知らせる
  （以前は `/harness-scope` を打たないと分からなかった）

## 直した不具合（README の Limitations から外せるもの）

- `A line inside a skill description shaped like - name: text can be read as a separate skill.` → 直した。
  skill の境目を `session.usage` の名前と順序（一覧と同じ順と 2.1.294 で実測）で決める。説明の中の行が本物の skill
  名と同じで、どちらが本物か順序でも決まらないときだけ、一覧を素通しにして画面で知らせる
- **別名つきの行** `- hookify:writing-rules (hookify:writing-hookify-rules): …` を直前の skill の説明と誤読していた
  （その skill は profile で指定しても効かず、受領書にも出なかった）→ 直した。一覧に出る名前でも括弧内の名前でも一致する

## 確認した版

- **Claude Code 2.1.294** で、実機 eval（`tools/eval/e2e.py`、`claude -p` を本物の環境で 20 回前後）と公式の
  `claude plugin eval`（5 ケース × 3 回 × with / without plugin の 2 arm）を回した。一覧の形式（skill・deferred tools）は
  2.1.287 と同じだった。数値は計測記録の表
- `--plugin-dir` を 2 つ渡すと、先に渡した plugin の hook が外側になる（probe を先に置くと絞り込み後が見える）。README
  に載せる必要は無いが、計測の再現に要る

## 載せる候補の事実（取り外し・巻き戻し・書き込み）

- 取り外し: `claude plugin uninstall harness-scope`（`claude plugin --help` で確認）。一時停止は `claude plugin disable harness-scope`
- repo で止める: `.claude/harness-scope.json` を消して `/clear`
- 何も書き込まない: 配布フォルダ（plugin/）の hooks は `$.fs.write` 等・環境変数・プロセス起動・通信を使わない（eval の
  static ケースで検査）。実機 eval では、各 run の前後で fixture repo と設定ディレクトリのファイルが変わらないことを確かめた

## README 側で直す候補（product 側の判断、採否は README 側）

- Limitations の「a command to sync profiles into it is planned for v0.2」→ architect の判定は「保留（DEFER）」。
  「profile の `tools.deny` を `permissions.deny` に写せば完全に消える」と書き換える案（約束を守ること自体は理由にしない）
- 同梱 profile は `writing` のまま（architect: minimal / coding は追加しない）。plugin の skill と agent を全部外す例として
  `{ "skills": { "deny": ["*:*"] }, "agents": { "deny": ["*:*"] } }` を README の例に足す案（`*:*` は claude.ai から
  同期した `anthropic-skills:docx` などにも一致する点を添える）
- 「Checked on Claude Code 2.1.287 only」→ 2.1.294 で確認済み、に更新
