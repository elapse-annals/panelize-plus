# Panelize Plus（百家）

<p align="center">
  <a href="README.md"><strong>English</strong></a> |
  <a href="README.zh-CN.md"><strong>简体中文</strong></a> |
  <a href="README.ja.md"><strong>日本語</strong></a>
</p>

> **Panelize Plus（百家）** は [Manho](https://github.com/Manho) による [Panelize](https://github.com/Manho/Panelize) の個人向け派生版（MIT ライセンス）で、Ben が [elapse-annals/panelize-plus](https://github.com/elapse-annals/panelize-plus) で保守しています。元プロジェクトの考え方 — 1回の入力ですべての AI へ、各パネルは公式サイト、普段のアカウントのまま — を保ち、AI まとめ、回答統計、プロンプトモード、macOS メニューバークライアントなどを追加しています。上流の Panelize は元のプロジェクトです（[上流の Panelize](#上流の-panelize)）。

<p align="center">
  <img src="assets/screenshots/promo-en.gif" alt="Panelize Plus デモ：複数の AI に一度に質問して回答を並べて比較" width="800">
</p>

<p align="center">
  <strong>タブ切り替えをやめて、複数 AI の回答を1画面で比較。</strong>
</p>

<p align="center">
  <a href="https://github.com/elapse-annals/panelize-plus/releases/latest"><img src="https://img.shields.io/github/v/release/elapse-annals/panelize-plus?label=release" alt="Panelize Plus リリース"></a>
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/Chrome%20%2F%20Edge-unpacked-4285F4.svg" alt="Chrome / Edge">
  <a href="https://github.com/Manho/Panelize/stargazers"><img src="https://img.shields.io/github/stars/Manho/Panelize?style=flat" alt="上流 Panelize の GitHub stars"></a>
</p>

<p align="center">
  <a href="#インストール"><img src="https://img.shields.io/badge/%E3%82%BD%E3%83%BC%E3%82%B9%E3%81%8B%E3%82%89%20Panelize%20Plus%20%E3%82%92%E8%AA%AD%E3%81%BF%E8%BE%BC%E3%82%80-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="ソースから Panelize Plus を読み込む"></a>
</p>

<p align="center">
  <sub>無料 · API キー不要 · ログイン済みの AI アカウントをそのまま利用</sub><br>
  <sub>Panelize Plus は <a href="https://github.com/Manho/Panelize">Panelize</a> の派生版です。元プロジェクトへの ⭐ も歓迎です。</sub>
</p>

---

## Panelize Plus とは？

Panelize Plus（百家）は、1つのプロンプトを ChatGPT、Claude、Gemini、Grok、DeepSeek などの AI チャットに同時に送り、回答を1つのウィンドウで並べて表示する無料・オープンソースの Chrome / Edge 拡張機能です。各パネルは公式サイトをそのまま読み込み、普段のログインを使うため、API キーも追加のサブスクリプションも不要です。

同じプロンプトを複数の AI タブに貼り付けて比較する作業を、1つの画面にまとめる拡張機能です。

**1つの入力で、複数 AI の回答を同時に比較できます。**

<p align="center">
  <img src="assets/screenshots/main-panel.png" alt="Panelize Plus Main Interface" width="800">
</p>

---

## Panelize Plus の変更点

Panelize Plus は上流 Panelize **v2.0.1**（2026-10-23）から独立した履歴（`2.1.0` → `2.75.1`）で続いています。上流と比べて、このフォークは次を追加しています。

| 分野 | 変更内容 |
| --- | --- |
| **AI まとめ** | 同じ質問への回答を結論・一致点・独自の洞察・並列表示の相違点にまとめ、各要点の出典チップから元の回答の該当箇所へ移動できます。ストリーミング表示、質問ごとに3日間のキャッシュ、回答の70%完了時の自動実行に対応し、任意の OpenAI 互換 API を使用します。 |
| **回答統計とブラインドモード** | 回答ごとに最初の文字と完了までの時間、採用状況、プロバイダーのスコアを記録し、タスクカテゴリで絞り込み、カテゴリ別の最適モデルを表示します。直近30日を重視し、最も速い3つの回答に金・銀・銅の王冠を付けます。ブラインドモードは AI 名を隠し、ページの見た目を揃え、パネル順をシャッフルします。 |
| **プロンプトモード** | モードはトリガーワードを持つ Prompt Library の項目です。**自動**は送信ごとに適用し、ゴーストプレビューと `Tab` 補完に対応します。深い思考モードと、敵対的レビューを行うチャレンジモードを追加。プロンプトは中国語（表示用）と英語（送信用）の2版を保持できます。 |
| **入力欄とパネル** | 画像・ドキュメント添付、送信前の準備完了ゲート、最近の質問候補、AI ごとの状態チップ、クリックで該当パネルへ移動、パネル容量とレイアウトの自動調整、ポップアップの位置・サイズ記憶、ワイドモード、スワイプ時の端フィードバック。 |
| **Panelize Link（macOS）** | 任意のメニューバークライアント。グローバルショートカット（既定は `Option + Space`）でフローティング入力欄を開き、プロンプトモード選択、`Tab` 補完、最近の質問に対応します。既存の Send All フローで送信し、Native Messaging ブリッジは既定で無効、設定から有効にできます。 |
| **プロバイダー** | StepFun、Agnes、Perplexity、Copilot、Wenxin を追加（後の3つは任意）。請求形態のマーカー（レート制限を含む）や各サイトの操作修正も追加しています。 |
| **ブランドと言語** | **Panelize Plus（百家）** に改名し、パッケージ名と「About」のクレジットを更新。インターフェースは簡体中文と英語（既定は中文）に絞り、他の8言語パックを削除しました。 |
| **既定設定** | 新規インストールは保守者のエクスポート設定（有効なプロバイダーと順序、起動パネル、既定の「深い思考」モード、設定済みの AI まとめエンドポイント）で始まります。API キーは端末内にのみ保存されます。 |

変更の全量は [CHANGELOG.md](CHANGELOG.md) にあります。上流の新機能と修正は `upstream` リモート経由で `master` にマージします（[上流の Panelize](#上流の-panelize)）。

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

現在の質問への回答を1つの概要にまとめます。結論、各 AI の一致点、独自の洞察、そして並べて表示される相違点が含まれ、各要点には出典が付き、出典チップをクリックすると元の回答の該当箇所へ移動します。必要なときに手動で実行するか、回答の70%が完了した時点で自動実行できます。設定で OpenAI 互換の API（Base URL、モデル、API キー）を構成してください。AI パネル自体に API キーは不要です。

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

Panelize Plus は Chrome Web Store で公開していません。このリポジトリから読み込んでください。（元の Panelize はストアで公開されています。詳しくは[上流の Panelize](#上流の-panelize)を参照。）

### ソースから読み込む（推奨）

1. このリポジトリを clone またはダウンロード
2. `chrome://extensions/`（または `edge://extensions/`）を開く
3. デベロッパーモードを有効化
4. 「パッケージ化されていない拡張機能を読み込む」でプロジェクトフォルダを選択
5. `Cmd/Ctrl + Shift + E` で Panelize Plus を開く

> **Edge でも利用可能：** 同じ展開済みフォルダを読み込めます。

<details>
<summary><strong>Chrome Web Store から元の Panelize をインストール</strong></summary>

Manho による元の [Panelize](https://github.com/Manho/Panelize) は [Chrome Web Store](https://chromewebstore.google.com/detail/panelize/iokalaafkmjffolodkkgbbccmofbglii) で公開されています。インストールされるのは上流の機能で、上記の Panelize Plus の変更は含まれません。

</details>

### Panelize Link グローバルショートカット（任意・macOS）

macOS 13 以降、Chrome または Edge が起動していること、Panelize Plus 2.66.0 以降が必要です。初期状態では無効です。クライアントをインストールした後、「設定 → グローバル入力（macOS）」で有効にしてください。既存の Send All フローを再利用し、別の AI 送信経路は追加しません。インストール、使い方、トラブルシューティングは [Panelize Link のドキュメント](desktop/macos/README.md) を参照してください。

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
| Panelize Plus を開く | `Cmd/Ctrl + Shift + E` |
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
→ Panelize Plus をインストールし、`Cmd/Ctrl + Shift + E` で開いてプロバイダーとレイアウトを選び、プロンプトを入力して **Send All** をクリックします。回答はそれぞれのパネルに表示されます。

**無料ですか？API キーは必要ですか？**
→ 無料で、MIT ライセンスです。API キーは不要です。各パネルは公式サイトそのもので、普段のアカウントでログインして使います。ChatGPT Plus や Claude Pro などの有料プランもそのまま使えます。

**Panelize Plus と Panelize の違いは？**
→ Panelize Plus は Manho の Panelize の派生版です。公式サイトを並べるパネル体験を保ち、AI まとめ、より詳しい回答統計、プロンプトモード、macOS の Panelize Link クライアントなどを追加しています。詳しくは [Panelize Plus の変更点](#panelize-plus-の変更点) を参照してください。上流の Panelize は元のプロジェクトとして続いています。

**ChatHub や ChatALL との違いは？**
→ ChatHub や ChatALL は複数のモデルを1つのチャット画面にまとめます。Panelize Plus は各社の公式サイトをそのまま表示するので、プラン、モデル選択、チャット履歴は各アカウントに残ります。

## トラブルシューティング

**ログイン画面が表示される場合**
→ 先に通常タブで対象サービスへログインし、Panelize Plus を再読み込みしてください。

**ショートカットが動作しない場合**
→ `chrome://extensions/shortcuts` で競合を確認してください。

**サポートが必要な場合**
→ [Issue を作成](https://github.com/elapse-annals/panelize-plus/issues)

---

## コントリビューション

開発時の入口、モジュール構成、スクリプトの読み込み順序とテスト方法は[アーキテクチャガイド（中国語）](ARCHITECTURE.md)を参照してください。

コントリビューション歓迎です。

- 🐛 Panelize Plus の不具合はこのリポジトリへ報告
- 💡 機能提案
- 🔧 Pull Request

元のプロジェクトにも当てはまる修正は [Manho/Panelize](https://github.com/Manho/Panelize/issues) へお願いします。

---

## 上流の Panelize

Panelize Plus は Manho による [Panelize](https://github.com/Manho/Panelize) の派生作品で、MIT License の下で利用しています。上流の Panelize は元のプロジェクトであり、そのコミュニティ、Chrome Web Store リリース、[panelize.dev](https://panelize.dev) のドキュメントの場所です。

派生関係とクレジットは [NOTICE.md](NOTICE.md) に記録しています。このリポジトリは `upstream` git リモートを保持し、上流の変更を `master` にマージします。

```bash
git fetch upstream
git merge upstream/master
```

Panelize Plus 固有の変更は独立したコミット履歴に保たれ、上流と区別できます。

---

## License

MIT License。詳細は [LICENSE](LICENSE) を参照してください。Panelize Plus は Manho の Panelize の派生版です（[NOTICE.md](NOTICE.md)）。
