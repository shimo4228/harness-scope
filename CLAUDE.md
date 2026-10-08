# harness-scope

Claude Code の mod（`plugin/` が配布物の本体）。global の skill・agent・指示ファイル・ツールを、名前付きの profile で repo ごとに
絞る。README は人間向けの入口、設計の経緯は `rfcs/0001-prose-mod.md` と `docs/plans/`、計測は `docs/measurements/`。
変更の前に `.claude/verify.sh` を通す。

## Claude Code mod — 正式表記と仕様（as-of 2026-10-09、Claude Code 2.1.294）

モデルの知識のカットオフは mods の登場（2026-10-01）より前なので、mod について書く・判断する前にここと一次資料を読む。
記憶から仕様を断言しない。下の要点が古くなっていたら、一次資料を読み直してこの節を更新する。

### 表記

- **本文の表記は「Claude Code mod」/「mods」（小文字）。** 大文字は文頭だけ（「Mods are on by default」）。公式 docs と
  公式ブログがこの形で、「Claude Mods」は一度も使っていない
- **「Claude Mods」は CHANGELOG 2.1.287 の 1 行だけの名前**（"Added Claude Mods: plugins may now modify deeper behavior"）。
  README では検索語として冒頭の言い換えの中で 1 回だけ使う
- 「Claude Code Mod」（大文字の M）はどの公式表記とも一致しないので使わない
- GitHub での使われ方（2026-10-09 実測）: topic `claude-code-mod` 324 / `claude-code-mods` 137 / `claude-mods` 77。
  README・説明文の語句は "Claude Code mod" 1,350 / "Claude Code mods" 661 / "Claude Mods" 580（2026-09-25 以降に作成の repo）
- 日本語の文でも「mod」と書く（「Claude Code の mod」）。docs の機能名に寄せた「mods が既定で有効」は可
- harness-scope 自身は本文で一貫して「mod」と呼ぶ。「plugin」は plugin 一般・CLI のコマンド名・パスにだけ使う

### 仕様の要点

- **定義**: "A mod is a plugin that changes how Claude Code looks and behaves. It's made of JavaScript or TypeScript event
  handlers"（docs）。plugin の `hooks/hooks.json` が指す hooks module が `register(on)` を export し、`on(event, hook)` で
  イベントに関数を付ける。hook は観察・書き換え・代わりに答える、のどれか。外への作用（描画・コマンド・ファイル・プロセス・
  通信・モデル呼び出し）は mods API（`$.…`）を通してだけ行う
- **用語**: docs では「hook」は mod の handler を指し、settings ファイルの従来の hook は「settings hook」と呼ぶ
- **版**: terminal は Claude Code 2.1.287 以降、Desktop アプリは 2.1.286 以降。**既定で有効**。早期アクセス時の
  `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` は 2.1.287 以降無視される
- **入れ方**: mod は plugin として marketplace から入る。`claude plugin install <name>@<marketplace>`、または
  `claude plugin install <name> --marketplace <owner/repo>`（未追加の marketplace も先に追加される。2.1.275 以降）。
  開いているセッションには `/reload-plugins`
- **読み込まれたかの確認**: セッションで `/plugin` を開くと、タブの下の薄い行に `1 mod active · <name>` のように数と名前が出る。
  built-in の mod はこの行に出ない
- **入れる前の確認**: `claude plugin validate <dir>` が `hooks:`（扱うイベント）と `calls:`（頼む mods API）を一覧する。
  harness-scope は `calls:` が読み取り（`$.fs.exists`・`$.fs.read`・`$.session.*`）と `$.ui.log`・`$.command.register` だけ
- **信頼**: mod は利用者の権限で動き、sandbox されない（ファイルの読み書き、プロセス起動、通信、環境変数の読み取り、
  tool call の承認ができる）。docs は信頼できる作者と marketplace からだけ入れるよう警告している
- **止め方**: 1 つなら `/plugin` で plugin を disable / uninstall。全部を 1 セッションだけなら `--safe-mode`。全部を常になら
  `~/.claude/settings.json` の `"disableAllHooks": true`。`--bare` も入れた mod を止める。built-in の mod はこれらで止まらない
- **動く場所**: terminal と Desktop の Code タブでは hook が動き描画も出る。`claude -p` と Agent SDK、VS Code 拡張の chat では
  hook は動くが描画は出ない。Remote Control は手元のセッションで動く。Desktop の WSL セッションでは plugin ごと使えない
- **built-in の mod**: `/diff`（`cc-plugin-diff`）、AGENTS.md の読み込み（`cc-plugin-agents-md`）、mod を書く
  `plugin-authoring` skill、組織向けの `cc-plugin-sec-default`、既定で無効の `cc-plugin-you-should-know` など
- **書くとき**: built-in の `plugin-authoring` skill を読む。テストは session なしで走る（docs の Test a mod）

### 一次資料

- docs 概要: https://code.claude.com/docs/en/plugins/mods/overview （全ページの索引は https://code.claude.com/docs/llms.txt ）
- 詳細: `/docs/en/plugins/mods/reference`（イベント・API・制限）、`/events`、`/api`、`/interface`、`/create`、`/test`、
  `/troubleshoot`、`/admin`
- 公式ブログ: https://claude.com/blog/claude-code-mods （2026-10-01、題 "Customize Claude Code with mods in TypeScript"）
- CHANGELOG: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md （2.1.287 の項）
- built-in mod のソース: https://github.com/anthropics/claude-code/tree/main/mods 、サンプル:
  https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods

### 読み手役・判定器への注意

README の訪問者役や判定器に使うモデルも、カットオフが mods より前のことがある。その読み手が挙げる「mod が分からない」
「mod と plugin の違いが分からない」は、実際の訪問者の反応ではなく知識の欠けによる偽陽性として扱う。判定器には上の一次資料の
要点を渡してから判定させる。
