# Clowder AI 日本語化

Clowder AI v0.14.1 の新版インターフェース向けの日本語化です。**設定 → テーマ → 言語** で日本語・英語・簡体字中国語を選べます。日本語版の Windows ビルドは、言語の保存値がない場合に日本語を表示します。

翻訳は `ja-*.json`、適用処理は `localize.cjs` にあります。上流の翻訳辞書に日本語を追加し、会話・ワークスペース・設定などの表示に利用します。辞書に未登録の文言は英語で表示されます。旧インターフェースや Electron のネイティブメニュー、プラグイン固有の画面には中国語や英語が残ります。

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
3. `ja-*.json` と必要な挿入位置を更新し、新しい版番号で `Build-Localized.ps1` を実行します。

辞書のキーは上流の英語表示文です。テンプレートの `{0}`、`{1}` は上流の式に対応するため、訳文でも順番を保ちます。同じ原文に異なる訳を登録すると検査が止まります。
