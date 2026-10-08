[English](README.md) | [日本語](README.ja.md)

# harness-scope

Claude Code は私の執筆 repo に skill を 101 件見せていた。94 件は要らなかった。この mod なら 1 行で隠せる。

![Claude Code mod 2.1.287+](https://img.shields.io/badge/Claude%20Code%20mod-2.1.287%2B-D97757)
![version 0.1.3](https://img.shields.io/badge/version-0.1.3-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

**[はじめかた](#はじめかた)** · [しくみ](#しくみ) · [プロファイル](#プロファイル) · [制限](#制限)

<p align="center">
  <img src="assets/overview.ja.svg" width="760" alt="writing のような名前付きのプロファイルを ~/.claude に置きます。repo は 1 行の JSON でプロファイルを 1 つ選び、Claude にはそのプロファイルが許す skill・agent・rules・ツールだけが見えます。repo 自身の skill・agent・CLAUDE.md は常に残ります。">
</p>

harness-scope は、グローバルの skill・agent・指示ファイル（CLAUDE.md と rules）・ツールを repo ごとに ON/OFF する Claude Code の mod（Claude Code の中でコードが動く plugin。2.1.287 で Claude Mods として登場）です。名前付きのプロファイルを `~/.claude` に一度置き、repo は 1 行のファイルでそのうち 1 つを選びます。Claude に見えるのは、そのプロファイルが許したものだけです。repo 自身の skill・agent・CLAUDE.md は常に残ります。

対象は、ハーネス（`~/.claude` の CLAUDE.md・rules・skill・agent と、入れている plugin の一式）が、大半が要らない repo にまで付いてくる Claude Code 利用者です。私はコーディング用の設定を執筆 repo から外すために作りました。

## 何が変わるか

2026-10-03 に、私の執筆 repo に同梱の `writing` を当てて測りました（Claude Code 2.1.287、`claude -p`）。

| | harness-scope なし | `writing` あり |
|---|---|---|
| skill の一覧 | 101 件、26,551 字 | repo 自身の 7 件、1,623 字 |
| agent の一覧 | 38 種類、18,988 字 | repo 自身の 7 種類 + Explore・general-purpose、4,134 字 |
| OFF の skill（`tdd`）を呼ぶ | 読み込まれる | 理由つきで断られる |

この数字は、入れている skill・plugin・MCP サーバーの数で変わります。自分に要るかは、repo で `/context` を打ち、並んだ skill を見れば分かります。大半がその repo と関係無いなら、この mod の出番です。skill が数件しか無いなら、たぶん要りません。

## はじめかた

mods が既定で有効な Claude Code 2.1.287 以降が必要です。アカウントや API キーは要りません。

1. mod を一度だけ入れます。

   ```bash
   claude plugin install harness-scope --marketplace shimo4228/harness-scope
   ```

   セッションで `/plugin` を開くと、タブの下の行に `1 mod active · harness-scope` のように名前が出ます。

2. repo に `.claude/harness-scope.json` を置きます。`writing` プロファイルは mod に同梱されています。自分で書くときは [プロファイル](#プロファイル) を見てください。

   ```json
   { "profile": "writing" }
   ```

3. その repo で新しい会話を始めるか、`/clear` を打ちます。画面に次の 1 行が出れば、プロファイルが効いています。

   ```text
   harness-scope: profile "writing" from bundled profile "writing", selected by /home/me/essays/.claude/harness-scope.json
   ```

   行が出ないとき、または行が `passing everything through`（全部をそのまま通す）と言っているときは、何も外れていません。読み込まれなかった mod は警告を出せないので、行が出ないこと自体が合図です。

最初のメッセージのあとに `/harness-scope` を打つと、プロファイルが外したものが出ます。Claude Code 2.1.294 の試験用 repo での出力です（上の行と同じ 1 行目を省き、名前の列は途中で切っています）。

```text
skills (allow): 90 off — adr-writer, archify, authorship-strategy, …
agents (allow): 30 off — adr-reviewer, architect, claude, …
instructions: not in the profile
tools (deny): 4 off — EnterWorktree, ExitWorktree, LSP, NotebookEdit
```

プロファイルの中で何にも一致しなかったパターンも出ます。この一覧は画面に出るだけで、会話には入りません。画面の無い `claude -p` のときだけ、コマンドの出力として返ります。

1 つの repo で元に戻すには `.claude/harness-scope.json` を消します。すべてで止めるには `claude plugin uninstall harness-scope@harness-scope` を打ちます。mod はファイルを書かないので、ほかに片付けるものはありません。このファイルの無い repo は何も変わりません。

## しくみ

Claude Code は依頼のたびに、Claude に見せるもの（指示ファイル、skill の一覧、呼べる agent の種類、ツールの一覧）を組み立てます。harness-scope は mod としてこの段に入り、プロファイルが OFF にしたものを取り除きます。自分から指示を足すことはありません。止めるのは、取り除いた skill やツールの呼び出しだけで、断るときはどのプロファイルが OFF にしたかを Claude に伝えます。プロファイルが読めないときは何も変えず、理由を画面に出します。各 hook が何を変えるかは [plugin/README.md](plugin/README.md)（英語）にあります。

## プロファイル

プロファイルは `~/.claude/harness-scope/profiles/<name>.json` に置く JSON ファイルです。カテゴリごとに `allow`（これだけ残す）か `deny`（これだけ外す）のどちらか 1 つを書きます。名前とパスには `*` と `?` の glob が使えます。書かなかったカテゴリはそのまま残ります。

```json
{
  "skills": { "allow": ["writing-ecosystem", "prose-translation", "anthropic-skills:docx"] },
  "agents": { "allow": ["Explore", "general-purpose"] },
  "instructions": { "deny": ["~/.claude/rules/common/testing.md"] },
  "tools": { "deny": ["LSP", "NotebookEdit", "mcp__claude_ai_Slack__*"] }
}
```

- `skills` と `agents` は、Claude の一覧に載っている名前で照合します。自分のもの、plugin のもの（`plugin:skill`）、組み込み、claude.ai から同期されたもの、どれでも同じです。
- `instructions` は自分の指示ファイルのパスで照合し、`~/` が使えます。`@` で取り込まれたファイルは、取り込んだ側と一緒に外れます。
- `tools` はツール名で照合します。MCP のツールも含みます。

書き始めの例です。

- **執筆で、repo 自身の skill だけ:** 同梱の `writing`。Explore・general-purpose の 2 つの agent も残し、LSP・NotebookEdit・EnterWorktree・ExitWorktree を外します。
- **ドキュメントで、グローバルの skill を少しだけ:** `{ "skills": { "allow": ["prose-translation", "anthropic-skills:docx"] } }`
- **研究で、コーディングの rule と GitHub のツールを外す:** `{ "instructions": { "deny": ["~/.claude/rules/common/testing.md"] }, "tools": { "deny": ["mcp__github__*"] } }`

`~/.claude/harness-scope/profiles/` に同梱と同じ名前のファイルがあれば、そちらが優先されます。`CLAUDE_CONFIG_DIR` で設定を切り替えているときは、プロファイルもそのディレクトリ（`<dir>/harness-scope/profiles/`）から読みます。mod はこの変数を読まず、自分のインストール先からディレクトリを割り出します。repo 側のファイルは、まずセッションの root、次に git repo の root で探します。

## なぜ許可リストか

Claude Code は、どの repo にも同じグローバルのハーネスを見せます。私の執筆 repo では skill の一覧に 101 件が並んでいました。repo 自身のものは 7 件で、残る 94 件はグローバルの設定・plugin・組み込み・claude.ai から来たもので、`tdd` もその中にありました。

ネイティブの設定でも project 単位で外せます（Claude Code 2.1.287 と 2.1.294 で確認）。ただ、どれも隠すものを名前で並べる拒否リストで、repo ごとの `.claude/settings.json` に書きます。

```json
{
  "skillOverrides": { "tdd": "off", "adr-writer": "off", "…": "off" },
  "enabledPlugins": { "codex@openai-codex": false, "…": false },
  "permissions":    { "deny": ["Agent(Plan)", "LSP", "…"] }
}
```

harness-scope なら、各 repo には `{ "profile": "writing" }` だけを置き、並べる中身はプロファイルに一度だけ書きます。ネイティブの設定で足りないのは、次の点です。

- **許可リストが無い。** あとから `~/.claude` に足した skill は、各 repo の拒否リストに足すまで、どの repo にも出ます。
- **plugin は丸ごとでしか外せない。** `skillOverrides` は、自分の skill・組み込み・claude.ai から同期された skill を 1 つずつ外せます。plugin の skill だけは、plugin ごと、その agent も一緒にしか ON/OFF できません。
- **repo 間で共有するまとまりが無い。** 各 repo の settings に手で書き写すことになります。

harness-scope のプロファイルは skill・agent・指示ファイル・ツールをまとめて扱うので、何かが OFF になっている理由を探す場所も 1 か所です。

少し外しただけでは、一覧はほとんど縮みません。Claude Code は skill の一覧を予算いっぱいまで使い、収まるように説明を短くするからです。2.1.287 では、3 件外しても一覧は 26,551 字から 26,534 字にしか減りませんでした。許可リストで大半を外せば、一覧そのものが縮みます。

目的の近いほかのツールとの違いです（2026-10-03 時点）。

- **[claude-loadout](https://pypi.org/project/ccloadout/)** は Claude Code の前に挟むランチャーで、手元のモデルが repo ごとに MCP サーバー・plugin・skill を選びます。harness-scope はランチャーが要らず、モデルに選ばせずにプロファイルに書いた決まりで絞り、agent と rules も扱います。
- **[bridle](https://github.com/neiii/bridle)** は Claude Code（とほかのエージェント）の設定をプロファイルで丸ごと切り替える設定マネージャーです。harness-scope は設定を 1 つのまま、repo ごとに絞ります。

## 触れないもの

プロファイルに何を書いても、次のものには触れません。

- repo 自身の skill と agent、そして自分のもの以外の指示ファイル（repo の CLAUDE.md と rules、local と managed のファイル、auto memory）。
- hook やほかの plugin が足したリマインダー。
- `.claude/harness-scope.json` の無い repo。ファイルが壊れているときや、知らないプロファイル名のときも何も変えず、理由を画面に 1 行出します。

repo 側のファイルに書けるのはプロファイルの名前だけです。clone した repo が独自のプロファイルを定義して利用者の rules を外すことはできず、できるのは利用者のプロファイルから 1 つ選ぶことだけです。選んだときは画面の 1 行で分かります。

mod は利用者にできることを何でもできるので、入れる前に何を頼むかを確かめてください。clone した repo の `plugin/` に `claude plugin validate` を打つと `calls:` の行が出ます。harness-scope の場合は、読み取り（`$.fs.exists`・`$.fs.read`・`$.session.*`）、画面の 1 行（`$.ui.log`）、`/harness-scope` コマンドの登録だけです。読むのは、プロファイル、repo 側のファイル、そして repo 自身の skill を見分けるために Claude Code から受け取る「読み込まれた skill とそれぞれの出どころ」の一覧です。環境変数は読まず、`~/.claude` の場所は mod のインストール先から割り出します。ファイルの書き込み、外部への通信、プロセスの起動、モデルの呼び出しはしません。

## 制限

- 制御するのは Claude に見せるものまでで、読めるかどうかではありません。Claude が skill の SKILL.md を直接開けば読めます。
- 会話の途中から付く指示ファイル（`paths:` 付きの rule、下位ディレクトリの CLAUDE.md）は外れません。
- ここで OFF にしたツールは Claude の主なツール一覧から外れ、呼ばれると断られますが、Claude がツールを検索すれば（ToolSearch）名前は見つかります。完全に消すのはネイティブの `permissions.deny` です。プロファイルを `permissions.deny` へ同期するコマンドを v0.2 で予定しています。
- プロファイルの変更は、新しい会話か `/clear` から効きます。
- 自分の agent が組み込みと同じ名前（Explore など）だと、OFF にしたとき組み込みのほうも見えなくなります。
- skill の説明の中に `- name: text` の形の行があると、別の skill と読まれることがあります。
- 確認したのは Claude Code 2.1.287 と 2.1.294 です。2.1.294 では試験の 20 回中 20 回で読み込まれました（2026-10-08）。2.1.287 では 9 回中 1 回で読み込まれず、エラーも出ないまま、その回は何も外れませんでした。原因はまだ確かめていません。
- 一覧の形式は Claude Code の版で変わりえます。skill の一覧が見覚えの無い形式なら、そのまま通すので、壊れたときは「何も外れない」という形で現れ、そのことを `/harness-scope` が伝えます。

## 設計の資料

[提案と先行例](rfcs/0001-prose-mod.md)、[設計](docs/plans/rfc-0001-r2-profile-allowlist.md)、上の数字の元になった計測（[2026-10-03、2.1.287](docs/measurements/2026-10-03-phase0.md)、[2026-10-08、2.1.294](docs/measurements/2026-10-08-readme-checks.md)）があります。

clone から試すときは `claude --plugin-dir <clone のパス>/plugin` で起動します。この読み込み方では mod が `~/.claude` の場所を知れないので、`claude plugin configure harness-scope` で `configDir` を設定するまでは同梱のプロファイルだけが使えます。

mod に手を入れるときは `npm ci` のあと `.claude/verify.sh`（Biome、TypeScript、`claude plugin validate --strict`、`claude plugin test`、`npm audit`）を通します。

## 著者のほかの仕事

- **Claude Codeに2つ目のハーネスを持たせる**（[Zenn](https://zenn.dev/shimo4228/articles/claude-code-claudemd-excludes) / [Dev.to、英語](https://dev.to/shimo4228/give-claude-code-a-second-harness-27of)）: 実験用にハーネスを丸ごと持ち替える方法です。`CLAUDE_CONFIG_DIR` で skill と agent は入れ替わりますが CLAUDE.md と rules は残り、残りは `claudeMdExcludes` で外せることが分かります。
- **[claude-harness](https://github.com/shimo4228/claude-harness)**: この mod が執筆 repo で絞っている、私自身のハーネス（rules・skill・agent）です。
- **[akc-cycle](https://github.com/shimo4228/akc-cycle)**: Agent Knowledge Cycle を rules ファイル 1 枚と Claude Code の plugin で入れる repo です。同じハーネスから切り出した、もう一つの導入先です。
- **[shimo4228](https://github.com/shimo4228/shimo4228)**: 私のほかのプロジェクトと文章の一覧です。

## ライセンス

[MIT](LICENSE)

<details>
<summary>ツールと AI アシスタント向けの資料</summary>

harness-scope は、グローバルの設定が大きい Claude Code 利用者に向けて、グローバルの skill・agent・指示ファイル（CLAUDE.md と rules）・ツールを、名前付きのプロファイルで repo ごとに ON/OFF する Claude Code の mod（hooks module を持つ plugin。Claude Code 2.1.287 で入った拡張の形で、changelog での名前は Claude Mods）です。

**なぜあるか。** Claude Code は、どの repo にも同じグローバルのハーネス（`~/.claude` と入れている plugin）を見せます。project 単位のネイティブ設定（`skillOverrides`・`enabledPlugins`・`claudeMdExcludes`・`permissions.deny`）は repo ごとの拒否リストです。許可リストが無く、plugin の skill は plugin ごとにしか切り替えられず（自分の skill・組み込み・claude.ai 同期の skill は `skillOverrides` で 1 つずつ外せる。2.1.294 で確認）、repo 間で共有もできません。harness-scope は、共有できる名前付きのプロファイルに許可リストと拒否リストを置き、repo は 1 行のファイルでそれを選びます。

**事実。**

- 名前: harness-scope。version 0.1.3。ライセンス MIT。作者: shimo4228。
- 形: TypeScript で書いた Claude Code の mod（plugin の hooks module）。`plugin/hooks/`（`register.ts`・`profile.ts`・`listing.ts`・`instructions.ts`・`bundled.ts`）。
- Claude Code 2.1.287 以降が必要。2.1.287 と 2.1.294 で確認。アカウント、API キー、外部への通信、子プロセス、モデルの呼び出しは使わない。
- 導入: `claude plugin install harness-scope --marketplace shimo4228/harness-scope`（または `claude plugin marketplace add shimo4228/harness-scope` のあと `claude plugin install harness-scope@harness-scope`）。
- 選択ファイル: repo の `.claude/harness-scope.json`。中身は `{ "profile": "<name>" }` だけ。セッションの root、次に git の root で探す。
- プロファイル: `~/.claude/harness-scope/profiles/<name>.json`。`skills`・`agents`・`instructions`・`tools` は任意で、それぞれ `{ "allow": [...] }` か `{ "deny": [...] }`、`*` / `?` の glob が使える。同梱のプロファイルは `writing`（repo 自身の skill だけ。agent は Explore と general-purpose。ツールは LSP・NotebookEdit・EnterWorktree・ExitWorktree を外す）。
- hook: `prompt.context` が利用者自身の指示ファイルを外し、`prompt.attachment` が skill の一覧と deferred tool の一覧を絞り、`agent.offer` が agent の種類を出さず、`tool.describe` がツールを後ろへ回し、`tool.call` が OFF のツールと skill の呼び出しを断る。`/harness-scope` は外したものを報告する。
- 常に残すもの: repo 自身の skill・agent・指示ファイル、managed と local のファイル、auto memory、hook やほかの plugin が足した文。選択ファイルが無いときや、プロファイルが読めないときは全部をそのまま通す。

**例。** 2026-10-03 に Claude Code 2.1.287 で、作者の執筆 repo に `writing` を当てて測りました。skill の一覧は 101 件（26,551 字）から repo 自身の 7 件（1,623 字）に、agent の一覧は 38 種類（18,988 字）から 9 種類（4,134 字）になり、OFF の `tdd` を Skill で呼ぶと理由つきで断られました。

**リンク。** 提案と先行例: [rfcs/0001-prose-mod.md](rfcs/0001-prose-mod.md)。設計: [docs/plans/rfc-0001-r2-profile-allowlist.md](docs/plans/rfc-0001-r2-profile-allowlist.md)。計測: [docs/measurements/2026-10-03-phase0.md](docs/measurements/2026-10-03-phase0.md)（2.1.287）と [docs/measurements/2026-10-08-readme-checks.md](docs/measurements/2026-10-08-readme-checks.md)（2.1.294。20 回中 20 回の読み込み、組み込みと同期の skill への `skillOverrides`）。plugin の参照（hook とデータ、英語）: [plugin/README.md](plugin/README.md)。

</details>
