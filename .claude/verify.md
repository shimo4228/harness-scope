# verify — tool choices

Stack: one Claude Code mod (plugin hooks module) in TypeScript, no runtime dependencies. Dev tools are pinned in
`package.json` / `package-lock.json`; run `npm ci` before `.claude/verify.sh`.

## format + lint
tool: Biome ==2.5.15（`biome check --error-on-warnings`。import 順も含む）
選定日: 2026-10-03
理由: format と lint が 1 本の binary で、新規 repo に向く。oxlint は lint 単体で formatter（oxfmt）を別に足す必要がある
budget: `noExcessiveCognitiveComplexity` = 15 — corpus が無いので Biome の既定値。実装が入ったら分布を実測して置き直す。
  上げずに刈る（変更はこのファイルに日付つきの理由）
再調査トリガー: 12 ヶ月経過 / Biome の最終リリースが 12 ヶ月以上前 / oxfmt が 1.0 に到達

## type check
tool: TypeScript ==7.0.2（`tsc -p .`。`tsconfig.json` は Claude Code が書き出す `.claude-plugin/types/tsconfig.json` を継ぐ）
選定日: 2026-10-03
理由: 7.0 は 2026-07 に GA したネイティブ版。型の正本は Claude Code が自分の版用に書き出す d.ts（gitignore）。
  無ければ `claude --plugin-dir .` で 1 度読み込むと書き出される。無い間は verify が「眠っているゲート」として報告する
再調査トリガー: 12 ヶ月経過 / 7.x の programmatic API が安定し、型を使う lint を足せるようになった

## plugin validate
tool: `claude plugin validate --strict .`（Claude Code 同梱）
選定日: 2026-10-03
理由: manifest・hooks module・使う event と mods API の一覧を検査する公式の入口

## test
tool: `claude plugin test .`（Claude Code 同梱。`*.test.ts`、`claude-code/testing` の kit）
選定日: 2026-10-03
理由: 公式のテスト実行環境。event を発火して hook の結果を検査できる
既知の問題: 2.1.287 では runner が「mods が遠隔で無効」と誤報告して走らないことがある（同じ日に走った回もある。
  2.1.288 で修正、CHANGELOG）。そのときと、テストが 1 本も無いときは、verify は exit 2 で「眠っているゲート」と報告する
coverage: 測定手段は未確認（`claude plugin test` に coverage の出力があるかを 2.1.288 で確かめる）

## security
tool: Biome の security group（`noGlobalEval` など）+ harness の commit hook（secret scan）
選定日: 2026-10-03
理由: mod は fs の読み取りだけを使う設計で、外部通信・プロセス起動は `claude plugin validate` の calls 一覧で見える

## dependency
tool: `npm audit --audit-level=low`
選定日: 2026-10-03
理由: 依存は dev のみ（Biome、TypeScript）。runtime の依存は持たない

## CI
GitHub remote がまだ無いので未配線。repo を公開するときに `references/ci-verify.yml` の雛形で `.claude/verify.sh` を
無引数で走らせる job を足す
