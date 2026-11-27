# Clowder AI 日本語化

Clowder AI v0.14.1 の新版インターフェース向けの日本語化です。**設定 → テーマ → 言語** で日本語・英語・簡体字中国語を選べます。日本語版の Windows ビルドでは、保存された画面と言語の選択がない場合に新版インターフェースが日本語で開きます。

翻訳は `ja-*.json`、適用処理は `localize.cjs` にあります。上流の翻訳辞書に日本語を追加し、会話・ワークスペース・設定などの表示に利用します。辞書に未登録の文言は英語で表示されます。旧インターフェースや Electron のネイティブメニュー、プラグイン固有の画面には中国語や英語が残ります。

上流で中国語が直接書かれている設定画面（スキル・MCP・プラグイン・システム・通知など）は、`zh-literals.cjs` が `zh-targets.json` に並べたファイルの中国語を `zj("中文", "日本語")` に置き換えます。訳は中国語をキーにした `zhja-*.json` にあります。新版インターフェースで日本語を選んだときだけ日本語になり、クラシック画面と中国語・英語のときは元の中国語のままです。比較・switch・オブジェクトのキー・型として使われている文字列は動作を変えないよう置き換えません。モジュール直下のオブジェクトのプロパティは getter にして表示時に言語を判定しますが、それ以外のモジュール直下の値（配列の要素など）は、言語を切り替えた後にページを再読み込みすると反映されます。

API や共有パッケージからデータとして届く中国語（システム設定の項目名・説明・既定値、スキルの分類名）は、`zhja-data*.json` に入れた訳を `zjd()` が表示時に引きます（生成先は `components/shell/zh-ja-data.ts`）。MCP・スキル・プラグインそれぞれの説明文は提供元の文章なので、そのまま表示します。

適用は `packages/web`（`src`、`public/fonts`）と `packages/shared/src`（作業ツリーのお知らせの文言）を変更します。

日本語表示には同梱の Noto Sans JP を使用します。フォントと SIL Open Font License 1.1 は `assets/fonts/` にあり、ビルド時に一緒に配布されます。[Google Fonts の取得元リビジョン](https://github.com/google/fonts/tree/66a36c8c94b1a5d992ee4e7f392fccfe4945767c/ofl/notosansjp)

## Windows ビルド

PowerShell 7、Node.js 24、上流の `packageManager` に対応する pnpm を用意します。インストーラーの生成には Inno Setup も必要です。

フォークを初めて取得する場合は次のコマンドを実行します。

```powershell
git clone --branch localize/ja https://github.com/migimaru/clowder-ai.git
Set-Location .\clowder-ai
git remote add upstream https://github.com/zts212653/clowder-ai.git
git fetch upstream tag v0.14.1
npm install --prefix .\localization
pwsh -NoProfile -File .\localization\Build-Localized.ps1 -SourceDir . -Version 0.14.1
```

`localization` と `clowder-ai` を同じ親フォルダーに置く場合は、その親から実行し `-SourceDir .\clowder-ai` を指定できます。

スクリプトは `v0.14.1` から別の作業ツリーを作成し、訳を適用してビルド専用のローカルコミットに記録します。成果物はソースリポジトリと同階層の `clowder-builds\ja-0.14.1-日時\dist` に出力されます。`-SkipInstaller` を指定すると、Inno Setup を使わずポータブル版の ZIP を生成します。`-Ref` で別のタグまたはコミットを指定できます。`-AlreadyApplied` は、訳を適用済みでソース変更をコミットしたビルド用作業ツリーから再実行する場合に使います。

## 上流更新に追従する

1. 上流の新しいタグを取得し、新しい作業ツリーにチェックアウトします。
2. `localize.cjs source <作業ツリー> --check` を実行します。`unmatchedTranslations` に出る文言は、その版で原文や配置が変わっていないか確認します。言語選択などの挿入位置が変わった場合、適用前にエラーで止まります。
3. `node localize.cjs inventory-zh <作業ツリー>` で、`zh-targets.json` のファイルにある未訳の中国語の一覧（出現箇所つき）を出し、`zhja-*.json` に追加します。対象ファイルが上流で消えた場合は適用前にエラーで止まります。
4. API の設定一覧（`packages/api/src/config/env-registry*`）やスキルの分類名が変わった場合は、`zhja-data*.json` を更新します。
5. `ja-*.json` / `zhja-*.json` と必要な挿入位置を更新し、新しい版番号で `Build-Localized.ps1` を実行します。

`ja-*.json` のキーは上流の英語表示文、`zhja-*.json` のキーは上流の中国語表示文です。テンプレートの `{0}`、`{1}` は上流の式に対応するため、訳文でも順番を保ちます。同じ原文に異なる訳を登録すると検査が止まります。
