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

統一入力欄から ChatGPT / Claude / Gemini / Grok / Doubao / DeepSeek / Kimi / Qwen / Zhipu (China) / Z.ai (Global) / Yuanbao / MiMo / Meta AI / StepFun / Agnes / Hy AI Studio / Perplexity / Copilot / Wenxin / Google へ同時に送信できます。

### Panelize Link グローバル入力（macOS）

**Panelize Link** は任意の macOS メニューバークライアントです。どのアプリからでも `Option + Space`（デフォルト。`Control + Space` または `Command + Shift + Space` も選択可）でフローティング入力欄を開け、Enter を押すと現在の Panelize ウィンドウ内のすべての AI に既存の Send All フローで送信されます。入力欄には組み込みのプロンプトモード選択（初期値は「自動」）があり、選択中のモードが追加する内容をプレビューし、`/study` などのトリガーワードを `Tab` で補完できます。詳しくは [Panelize Link のセットアップ](desktop/macos/README.md) を参照してください。

### 柔軟なレイアウト

49種類のレイアウトを用意し、最大30パネルに対応。素早い2モデル比較には1×2、多数のパネルには1×30または2×15が使えます。実際に開けるパネル数は、有効なプロバイダー数によって異なります。

<p align="center">
  <img src="assets/screenshots/select-layout.png" alt="Layout Selection" width="600">
</p>

### 初期設定ほぼ不要

API キー不要。通常どおり各 AI サービスにログインしていれば利用できます。

### Prompt Library

よく使うプロンプトを保存して再利用可能。`{topic}` などの変数にも対応。

### プライバシー重視

- 対応プロバイダーでワンクリックのプライバシーモード
- データはブラウザ内に保存
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

`chrome://extensions/shortcuts` で変更できます。

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
- 🌍 翻訳の改善
- 🔧 Pull Request

---

## License

MIT License。詳細は [LICENSE](LICENSE) を参照してください。
