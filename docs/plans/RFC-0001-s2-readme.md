# RFC-0001 s2: harness-scope の README を書く（引き継ぎ packet）

前のセッション（2026-10-03）は v0.1 の実装・review・実機確認まで終えた。context が溜まったので、README は新しいセッションで
書く。このファイルだけ読めば始められるように書いてある。

## やること

skill: readme-writer の **Rewrite モード**で `README.md`（英語）と `README.ja.md`（日本語）を新しく書く。
Step 1（入口の設計）と Step 6（著者通読）で著者の確認を取る。tagline 候補は Step 1 で skill: headline-craft から 3〜6 本。
公開（GitHub repo の作成・push・marketplace 登録・awesome list への PR）はしない — 著者の判断。

## 読む順

1. この packet
2. `rfcs/0001-prose-mod.md`（提案・先行例・限界）
3. `docs/plans/rfc-0001-r2-profile-allowlist.md`（承認済みの設計）と図解 `docs/plans/rfc-0001-r2-profile-allowlist.html`
4. `docs/measurements/2026-10-03-phase0.md`（数字の正本）
5. `hooks/register.ts`、`hooks/bundled.ts`、`hooks/profile.ts`（主張をコードと照合するため）

## 事実（README に載せうるもの。数字は as-of 2026-10-03、Claude Code 2.1.287）

- **何か**: Claude Code の Mod（plugin の hooks module）。global に置いた名前付き profile で、skill・agent・指示ファイル
  （CLAUDE.md / rules）・ツールを repo ごとに ON/OFF する。執筆 repo は profile の 1 例（同梱の `writing`）
- **使い方**: Mod を user scope に 1 回 install → `~/.claude/harness-scope/profiles/<name>.json` に profile（無ければ同梱の
  `writing`）→ repo に `.claude/harness-scope.json` = `{ "profile": "writing" }` → 新しい会話から効く。`/harness-scope` で
  外したものを画面に出す（モデルには返さない。`-p` のときだけ text）
- **profile の形**: カテゴリ `skills` / `agents` / `instructions` / `tools` ごとに `allow` か `deny` のどちらか 1 つ、glob 可。
  `instructions` の path は `~/` 可
- **守ること**: repo 自身の skill・agent（source `projectSettings`）、kind `project` / `local` / `managed` / `memory` の指示ファイル、
  hook と他 plugin の出力には触れない。profile の無い repo・壊れた profile・知らない形式は素通し。外部通信・プロセス起動・
  モデル呼び出しなし（使うのは fs の読み取りと `session.usage`）。repo 側のファイルは profile の名前しか書けない（clone した
  repo が利用者の rules を書き換えられない）。repo が profile を選んだときは画面に 1 行出る
- **実測**（執筆 repo、同梱 `writing`）: skill 一覧 101 件 26,551 字 → repo 自身の 7 件 1,623 字、agent 一覧 18,988 → 4,134 字、
  OFF の skill を Skill ツールで呼ぶと理由つきで断られる
- **skill を隠す効果**: 一覧は予算（context の 1%）いっぱいまで使われる。少し外しても字数はほぼ減らず、削られていた説明が
  戻る（3 件外して 821 字減、807 字戻る）。大半を外せば一覧自体が縮む。主な効果は「関係ない skill が見えなくなる」こと
- **ネイティブ設定との違い**: `skillOverrides`（user の skill を名前ごと）・`enabledPlugins`（plugin 丸ごと）・`claudeMdExcludes`・
  `permissions.deny` は repo ごとの denylist。allowlist と、plugin・built-in・同期 skill を 1 つずつ外す手段、repo 間で共有する
  名前付き profile は無い。ネイティブ設定は併用不要
- **先行例との違い**: claude-loadout（PyPI `ccloadout`）は起動前に挟むランチャーで、手元のモデルで MCP・plugin・skill を選ぶ。
  harness-scope はランチャー不要（どの起動の仕方でも効く）・決定的・agent と rules も扱う。bridle は設定を profile で切り替える
  設定マネージャー
- **既知の限界**: 見せるかどうかの制御で強制ではない（SKILL.md を直接読めば読める）/ `paths:` 付きの rule など後から付く指示
  ファイルは外れない / OFF のツールは ToolSearch の後ろに回して断る形で、ネイティブの deny のように完全には消えない（v0.2 で
  `permissions.deny` への同期コマンド）/ profile の変更は新しい会話か `/clear` から / built-in と同じ名前の user の agent を OFF に
  すると built-in にも戻らない / 説明文の中の `- Name: ...` のような行は別の skill と誤認しうる / 2.1.287 で確認、2.1.288 で再確認予定
- **名前**: plugin・marketplace とも `harness-scope`。公開時の repo は `shimo4228/harness-scope` の予定（未作成）

## 注意

- 主な読者は awesome-claude-code-mods から来る Claude Code 利用者。英語が主
- README に数字を置くなら as-of と環境を添える（環境で大きく変わる）
- 著者のほかの仕事への導線は readme-writer の規則どおり（公開済みで 200 を返すものだけ）
- `.claude/verify.sh` を通してから commit。README の変更に Plan 行: `Plan: docs/plans/RFC-0001-s2-readme.md`
- 前のセッションの claim は `handoff` で手放してある。始めるときに `claims.py claim RFC-0001` を積み直す
