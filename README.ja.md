# Panelize（百家）

<p align="center">
  <a href="README.md"><strong>English</strong></a> |
  <a href="README.zh-CN.md"><strong>简体中文</strong></a> |
  <a href="README.ja.md"><strong>日本語</strong></a>
</p>

<p align="center">
  <img src="assets/screenshots/promo-en.gif" alt="Panelize デモ：複数の AI に一度に質問して回答を並べて比較" width="800">
  <br>
  <a href="https://youtu.be/kCRXBVeXbrA">▶ 高画質の動画を見る</a> · <a href="https://panelize.dev">🌐 panelize.dev</a>
</p>

<p align="center">
  <strong>タブ切り替えをやめて、複数 AI の回答を1画面で比較。</strong>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/panelize/iokalaafkmjffolodkkgbbccmofbglii"><img src="https://img.shields.io/chrome-web-store/v/iokalaafkmjffolodkkgbbccmofbglii?label=Chrome%20Web%20Store&color=4285F4" alt="Chrome Web Store version"></a>
  <a href="https://chromewebstore.google.com/detail/panelize/iokalaafkmjffolodkkgbbccmofbglii"><img src="https://img.shields.io/chrome-web-store/users/iokalaafkmjffolodkkgbbccmofbglii?color=brightgreen" alt="Chrome Web Store users"></a>
  <a href="https://chromewebstore.google.com/detail/panelize/iokalaafkmjffolodkkgbbccmofbglii"><img src="https://img.shields.io/chrome-web-store/rating/iokalaafkmjffolodkkgbbccmofbglii" alt="Chrome Web Store rating"></a>
  <a href="https://github.com/Manho/Panelize/stargazers"><img src="https://img.shields.io/github/stars/Manho/Panelize?style=flat" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/Edge-supported-0078D7.svg" alt="Edge">
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/panelize/iokalaafkmjffolodkkgbbccmofbglii"><img src="https://img.shields.io/badge/Chrome%20%E3%81%AB%E7%84%A1%E6%96%99%E3%81%A7%E8%BF%BD%E5%8A%A0-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome に無料で追加"></a>
</p>

<p align="center">
  <sub>無料 · API キー不要 · ログイン済みの AI アカウントをそのまま利用</sub><br>
  <sub>Panelize が役に立ったら、GitHub で ⭐ を付けていただけると他の人にも届きやすくなります。</sub>
</p>

---

## Panelize とは？

Panelize（百家）は、1つのプロンプトを ChatGPT、Claude、Gemini、Grok、DeepSeek などの AI チャットに同時に送り、回答を1つのウィンドウで並べて表示する無料・オープンソースの Chrome / Edge 拡張機能です。各パネルは公式サイトをそのまま読み込み、普段のログインを使うため、API キーも追加のサブスクリプションも不要です。

同じプロンプトを複数の AI タブに貼り付けて比較する作業を、1つの画面にまとめる拡張機能です。

**1つの入力で、複数 AI の回答を同時に比較できます。**

<p align="center">
  <img src="assets/screenshots/main-panel.png" alt="Panelize Main Interface" width="800">
</p>

---

## 主な機能

### 1回の入力で同時送信

統一入力欄から ChatGPT / Claude / Gemini / Grok / Doubao / DeepSeek / Kimi / Qwen / Zhipu (China) / Z.ai (Global) / Yuanbao / MiMo / Meta AI / StepFun / Agnes / Hy AI Studio / Perplexity / Copilot / Wenxin / Google へ同時に送信できます。画像やドキュメント（PDF、Office、テキスト、コードファイル）を添付し、対応プロバイダーへ問題と一緒に送ることもできます。

### Panelize Link グローバル入力（macOS）

**Panelize Link** は任意の macOS メニューバークライアントです。どのアプリからでも `Option + Space`（デフォルト。`Control + Space` または `Command + Shift + Space` も選択可）でフローティング入力欄を開け、Enter を押すと現在の Panelize ウィンドウ内のすべての AI に既存の Send All フローで送信されます。入力欄には組み込みのプロンプトモード選択（初期値は「自動」）があり、選択中のモードが追加する内容をプレビューし、`/study` などのトリガーワードを `Tab` で補完できます。最近送信した3件の質問も候補として表示されます。詳しくは [Panelize Link のセットアップ](desktop/macos/README.md) を参照してください。

### 柔軟なレイアウト

49種類のレイアウトを用意し、最大30パネルに対応。素早い2モデル比較には1×2、多数のパネルには1×30または2×15が使えます。実際に開けるパネル数は、有効なプロバイダー数によって異なります。1つのパネルをウィンドウ全体に拡大したり、サイズと位置を記憶するポップアップウィンドウに切り替えたり、ワイドモードで各パネルを1.5倍の幅にして横スクロールすることもできます。

<p align="center">
  <img src="assets/screenshots/select-layout.png" alt="Layout Selection" width="600">
</p>

### 初期設定ほぼ不要

API キー不要。通常どおり各 AI サービスにログインしていれば利用できます。

### Prompt Library

よく使うプロンプトを保存して再利用可能。`{topic}` などの変数にも対応。

### プロンプトモード

入力欄でモードを選ぶと、AI に送る内容へ短い指示を追加できます。デフォルトの**自動**モードでは、質問にトリガーワードが含まれるときだけそのモードが今回の送信に適用されます（例: `/study`（学習）、`/brief`（簡潔）、`/challenge`（チャレンジ）、`/brainstorm`（ブレインストーム）、`/think`（深い思考））。追加内容のゴーストプレビューが表示され、`Tab` でトリガーワードを補完できます。モードは Prompt Library の通常のプロンプトなので、本文やトリガーワードの編集、削除、追加ができます。**デフォルト**では何も追加されません。

### AI まとめ

現在の質問への回答を1つの概要にまとめます。結論、各 AI の一致点、独自の洞察、そして並べて表示される相違点が含まれ、各要点には出典が付き、出典チップをクリックすると元の回答の該当箇所へ移動します。必要なときに手動で実行するか、回答の80%が完了した時点で自動実行できます。設定で OpenAI 互換の API（Base URL、モデル、API キー）を構成してください。AI パネル自体に API キーは不要です。

### 回答統計とブラインドモード

**回答統計**は、送信から最初の文字、そして回答完了までの時間を計測し、採用状況とスコアを集計します。タスクカテゴリで絞り込み、カテゴリごとの最適モデルも表示します。最も速い3つの回答にはトップバーのチップに金・銀・銅の王冠が付きます。**ブラインドモード**は AI 名を隠し、ページの見た目を揃え、パネル順をシャッフルするので、ブランドの先入観なしに回答を評価できます。

### 比較スナップショットの共有

現在の表示またはすべてのパネルを1枚の画像にして、コピーまたはダウンロードできます。スナップショットは端末内で撮影・合成され、外部へ送信されません。

### 最近の質問と要約キャッシュ

入力内容が最近送信した質問の先頭と一致すると、入力欄の上に直近3件が表示され、選ぶと送信せずに入力できます。同じ質問の AI まとめは3日間再利用され、「再要約」で強制更新できます。

### プライバシー重視

- 対応プロバイダーでワンクリックの一時チャット（プライバシーモード）
- 設定、履歴、スナップショットはブラウザ内に保存され、送信した内容だけが利用する AI サイトへ届きます
- トラッキングなし、分析なし
- オープンソース

---

## 対応 AI プロバイダー

- ChatGPT
- Claude
- Gemini
- Grok
- Doubao
- DeepSeek
- Kimi
- Qwen（中国版）
- Qwen（グローバル版）
- Zhipu (China)
- Z.ai (Global)
- Yuanbao
- MiMo
- Meta AI
- StepFun
- Agnes
- Hy AI Studio
- Perplexity
- Copilot
- Wenxin
- Google

Perplexity、Copilot、Wenxin は任意のプロバイダーです。設定で有効にして、各サイトへのアクセスを許可してください。3サービスのログイン後の入力欄と送信コントロールは実際のページで確認しました。Perplexity と Copilot は Cloudflare 検証と Microsoft サインインのため、埋め込みでの送信は未検証です。Wenxin の埋め込み、テキスト入力、Send All と Enter による送信は 2026-10-28 に実環境で確認しました。この3サービスの画像添付は無効です。

<p align="center">
  <img src="assets/screenshots/settings.png" alt="Settings & Providers" width="700">
</p>

---

## インストール

### Chrome Web Store（推奨）

1. [Chrome Web Store ページ](https://chromewebstore.google.com/detail/panelize/iokalaafkmjffolodkkgbbccmofbglii) を開く
2. **Add to Chrome** をクリック
3. インストール後、`Cmd/Ctrl + Shift + E` で Panelize を開く

> **Edge でも利用可能：** Chrome Web Store からそのままインストールできます。

<details>
<summary><strong>手動インストール（開発者向け）</strong></summary>

1. このリポジトリのソースコードをダウンロード
2. `chrome://extensions/`（または `edge://extensions/`）を開く
3. デベロッパーモードを有効化
4. 「パッケージ化されていない拡張機能を読み込む」でフォルダを選択

</details>

### Panelize Link グローバルショートカット（任意・macOS）

macOS 13 以降、Chrome または Edge が起動していること、Panelize 2.66.0 以降が必要です。初期状態では無効です。クライアントをインストールした後、「設定 → グローバル入力（macOS）」で有効にしてください。既存の Send All フローを再利用し、別の AI 送信経路は追加しません。インストール、使い方、トラブルシューティングは [Panelize Link のドキュメント](desktop/macos/README.md) を参照してください。

---

## クイックスタート

1. **各 AI サービスへログイン**（通常のブラウザタブで事前ログイン）
2. **`Cmd/Ctrl + Shift + E` を押す**
3. **レイアウトを選ぶ**
4. **入力して送信**（全パネルへ同時反映）

---

## キーボードショートカット

| 操作 | ショートカット |
|------|----------------|
| Panelize を開く | `Cmd/Ctrl + Shift + E` |
| Prompt Library を開く | `Cmd/Ctrl + Shift + L` |
| すべての AI に送信 | `Enter` または `Cmd/Ctrl + Enter` |
| 改行 | `Shift + Enter` |
| 送信せず入力欄だけ埋める | `Cmd/Ctrl + Shift + Enter` |
| すべてのパネルで新しい会話 | `Cmd/Ctrl + Alt + N` |
| 入力欄へフォーカス | `Cmd/Ctrl + Alt + K` |
| 高速／バランス／深い推論ティア | `Cmd/Ctrl + Alt + 1 / 2 / 3` |
| ワイドモード切り替え | `Cmd/Ctrl + Alt + W` |
| ブラインドモード切り替え | `Cmd/Ctrl + Alt + X` |
| 回答統計／回答ログ | `Cmd/Ctrl + Alt + S` / `Cmd/Ctrl + Alt + R` |
| 比較スナップショットを共有 | `Cmd/Ctrl + Alt + P` |
| パネル1–9へジャンプ | `Ctrl + Shift + 1 – 9` |

下部バーのキーボードボタンで実際の割り当てを確認し、ページ内ショートカットを変更・解除できます。AI パネルの入力欄内でも利用できます。ブラウザレベルのショートカットは `chrome://extensions/shortcuts` で変更できます。macOS の `Alt` は `Option` に対応します。

下部バーでは手動順と人気順を切り替えられます。人気順はこの端末の回答統計スコアで AI を並べ、それ以外は手動順を保ちます。ティアボタンは開いているすべての AI をまとめて切り替え、「デフォルト」では各サイト自身の設定を保ちます。ティア横の設定ボタンで実際のモードとパネルごとの結果を確認でき、失敗したパネルだけを再試行できます。各プロバイダーのモード、デフォルトの対応、アカウント制限は [プロバイダーティア表](PROVIDER_MODES.md) を参照してください。

---

## よくある質問

**ChatGPT、Claude、Gemini に同じ質問を一度にするには？**
→ Panelize をインストールし、`Cmd/Ctrl + Shift + E` で開いてプロバイダーとレイアウトを選び、プロンプトを入力して **Send All** をクリックします。回答はそれぞれのパネルに表示されます。

**無料ですか？API キーは必要ですか？**
→ 無料で、MIT ライセンスです。API キーは不要です。各パネルは公式サイトそのもので、普段のアカウントでログインして使います。ChatGPT Plus や Claude Pro などの有料プランもそのまま使えます。

**ChatHub や ChatALL との違いは？**
→ ChatHub や ChatALL は複数のモデルを1つのチャット画面にまとめます。Panelize は各社の公式サイトをそのまま表示するので、プラン、モデル選択、チャット履歴は各アカウントに残ります。

## トラブルシューティング

**ログイン画面が表示される場合**
→ 先に通常タブで対象サービスへログインし、Panelize を再読み込みしてください。

**ショートカットが動作しない場合**
→ `chrome://extensions/shortcuts` で競合を確認してください。

**サポートが必要な場合**
→ [Issue を作成](https://github.com/Manho/Panelize/issues)

---

## コントリビューション

コントリビューション歓迎です。

- 🐛 バグ報告
- 💡 機能提案
- 🔧 Pull Request

---

## License

MIT License。詳細は [LICENSE](LICENSE) を参照してください。
