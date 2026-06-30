# REVISION_LOG — urehan-reserve（取り置き予約・一般参加者向け Web）

レジさぽっ！（urehan）の「取り置き予約」機能の買い手側。サークルが公開したお品書きを
`/#/r/<slug>` で表示し、一般参加者がニックネーム＋品・個数を入力して取り置きを予約できる。
バックエンドは とれはんっ！／レジさぽっ！と共通の Supabase（migration `0019_reservations.sql`）。

> Rev 番号は本アプリで独立採番（urehan 本体／とれはんっ！の Rev とは無関係）。
> 1指示 = 1Rev = 1コミット ＋ 本ログ追記を徹底する。

---

## Rev6 — とれはんっ！起動ディープリンクの未起動フォールバックを追加（横断設計レビュー指摘D）（2026-06-30）

3アプリ横断の設計レビューで挙がった「ディープリンク導線が未インストール時に無反応で行き止まりになる」点を強化。
Rev5 の `torehan://reserve?slug=…` は `<a href>` でアプリ起動を試みるが、アプリ未導入だとカスタムスキームが
無反応になり、ユーザーが「押しても何も起きない」状態で詰まる懸念があった。

### 変更（ReservePage.tsx の TorehanCta）
- `<a href>` のネイティブ遷移はそのまま走らせる（`preventDefault` しない＝モバイルで最も確実）。`onClick` で起動を試み、
  **1.8秒後もページが前面（`document.visibilityState === 'visible'`）なら未起動の可能性が高い**と判定して、
  入手導線（ポータルへのボタン）を目立つカードで表示する。
  - アプリを起動できた人にはブラウザが hidden になるため**フォールバックは出ない**（誤爆抑制）。
- CTA 文に「インストール済みの方は下のボタンで開けます」の注記を追加。
- `src/index.css`：`.torehan-cta-note`／`.torehan-cta-fallback`／`.torehan-cta-fallback-text` を追加。

### 動作確認
- `tsc -b && vite build` 通過（EXIT=0・新バンドル `index-C4RPRmAS.js`）。
- ⚠ **デプロイ（GitHub Pages 再公開）は WEB9 承認後**。Rev6 を反映して公開する。

## Rev5 — 予約完了画面に「とれはんっ！」起動導線を追加（項目3）（2026-06-30）

取り置き完了後、予約したサークルの頒布物を買い手向けアプリ「とれはんっ！」の自分のお品書きリストへ
そのまま登録できる導線を追加。完了画面（受取番号の下・取消ボタンの上）に CTA カードを設置。

- `src/pages/ReservePage.tsx`: `TorehanCta`（新規・同ファイル内）を完了画面に追加。
  - 「とれはんっ！で開く」ボタン＝`<a href="torehan://reserve?slug=<slug>">`。モバイルのカスタムスキーム起動が
    `<a>` で最も確実。とれはんっ！側が slug を受けて `get_reservation_page` でこのサークル＋お品書きを取得し
    ローカル登録する想定（とれはんっ！本体の受信処理は別リポジトリで対応）。
  - アプリ未導入の人向けにポータル `https://rurifukuro.github.io/torehan/` への案内リンクを併記。
  - とれはんっ！の機能紹介文（無料お品書き管理／当日の買い回り・予算管理）も掲載。
- `src/index.css`: `.torehan-cta`/`.torehan-cta-title`/`.torehan-cta-text`/`.btn-as-link`/`.torehan-install` を追加。

### 動作確認
- `npx tsc -b` 通過（EXIT=0）。
- ⚠ **デプロイ（GitHub Pages 再公開）は未実施＝WEB9 で承認後にまとめて公開（Rev4＋Rev5 を1回で）。**

## Rev4 — 取り置きページの品目重複表示を防ぐ重複排除（項目2）（2026-06-30）

売り手側（レジさぽっ！ Rev21）でセット名の 🎁 二重付加を是正したのと対で、買い手ページにも
**key 基準の重複排除**を防御的に追加。二重公開・絵文字重複などで同じセットが複数行に増えて
見えるのを防ぐ（`it.key || it.name` を一意キーに先頭優先で残す）。

- `src/pages/ReservePage.tsx`: 表示用 `items` の安定ソート前に dedup を挿入。

### 動作確認
- `npx tsc --noEmit` 通過（エラーなし）。
- ⚠ **デプロイ（GitHub Pages 再公開）は未実施＝項目3（完了画面のとれはんっ！導線）も入れてから1回でまとめて承認依頼（WEB9）。**

## Rev3 — 自動〆切（close_at）超過時に「受付終了」を表示（2026-06-28）

売り手が設定した自動〆切（`close_at`・migration 0020）の定刻を過ぎたら、買い手の予約フォームを出さず
「受付は締め切られています」を表示する。**サーバーも `create_reservation` で同条件を弾く**ので二重の安全。
ここは押す前に受付終了を見せる**表示用ガード**（押してエラーになる前にUIで止める）。

- `types.ts`: `ReservationPage` に `close_at: number | null` を追加（get_reservation_page が返す列・0020）。
- `api.ts`: `close_at` を数値へ正規化（PostgREST が bigint を文字列で返す場合に備える・不正値は null）。
- `ReservePage.tsx`: `closed = !is_open || (close_at != null && now >= close_at)` を導入。手動締切と自動〆切超過を
  まとめて「受付締切」ボックス表示に分岐（従来は `!is_open` だけ判定していた）。

### 動作確認
- `npx tsc --noEmit -p tsconfig.app.json` 通過（EXIT=0）。
- ⚠ **デプロイ（GitHub Pages 再公開）は未実施＝ユーザー承認待ち（WEB9: Web公開は許可制）。**

## Rev2 — 公開お品書きの並び順を「セット上・単品下」に統一（2026-06-28）

レジさぽっ！本体 Rev6 と同じ並びへ揃えた。`ReservePage` で表示用 `items` を安定ソートする
（`kind === 'bundle'`＝セットを上・`'product'`＝単品を下、同種内は公開時の順序を維持）。
予約フォーム・完了画面の内訳もこの順に従う（`selected` は表示順から生成されるため）。

### 動作確認
- `npm run build`（tsc -b && vite build）通過（EXIT=0）。
- preview（ライブ DB）で格納順 [単品A, セットX, 単品B, セットY] のページを開き、
  表示が [セットX, セットY, 単品A, 単品B] になることを確認。検証データは後始末済み。

### 公開（2026-06-28・ユーザー承認済み）
- GitHub リポジトリ `rurifukuro/urehan-reserve`（public）を作成し `main` を push。
- GitHub Pages を「GitHub Actions」ソースで有効化 → `Deploy to GitHub Pages` ワークフロー成功。
- 公開URL **https://rurifukuro.github.io/urehan-reserve/** が HTTP 200（title「取り置き予約」、
  アセットは `/urehan-reserve/` 配下）。レジさぽっ！本体が生成する買い手URL
  `…/urehan-reserve/#/r/<slug>` の **404 が解消**。
- 検証用テストページ `__sort_test__` を本番 SQL Editor から削除（後始末完了。REST で rows=0 確認）。

---

## Rev1 — 取り置き予約 Web アプリ 初期実装＋ベースライン（2026-06-28）

concafe-yoyaku の Vite 雛形（React19 + TS strict + HashRouter + GitHub Actions Pages デプロイ）を
土台に、買い手向け取り置きページを新規実装した。

### 画面
- `/#/r/:slug` … 取り置きページ。`get_reservation_page` でお品書き（単品＋セット）を表示 →
  個数ステッパー → ニックネーム（任意）→「取り置きを予約する」で `create_reservation` を呼び、
  **受取番号**を発行・大表示。完了画面から本人キャンセル（`cancel_reservation`）も可能。
  受付締切（is_open=false）・品物0件・ページ未存在・通信失敗の各状態を出し分け。
- `/` … slug 無しの案内（個別URLからアクセスする旨）。

### 構成
- `src/lib/supabase.ts` … 共通 Supabase（anon/publishable・公開安全値）。Auth セッション無し。
- `src/lib/api.ts` … 3 RPC（get_reservation_page / create_reservation / cancel_reservation）の口。
  集合返し RPC の戻りは配列＝先頭行を取る。合計はサーバー再計算（クライアント値を信用しない）。
- `src/lib/installId.ts` … 本人キャンセル照合用の端末ID（localStorage・個人特定しない）。
- `src/lib/types.ts` / `src/lib/format.ts` … 型と金額表示。
- `src/pages/ReservePage.tsx` / `HomePage.tsx`、`src/index.css`（モバイルファースト）。
- `.github/workflows/deploy.yml` … `main` push で Pages へ（`VITE_BASE_PATH=/urehan-reserve/`）。
  CI で `.env` を再生成（anon キーは公開安全値）。`VITE_SUPABASE_URL` も注入。

### 動作確認
- `npm run build`（tsc -b && vite build）通過（EXIT=0）。
- preview（dev server）で実画面確認:
  - `/` 案内ページ描画 OK。
  - `/#/r/<未適用slug>` … migration 0019 未適用のため `get_reservation_page` が PGRST202 →
    「読み込みに失敗しました」エラーカードを正しく表示（ルーティング＋RPC配線＋例外処理を確認）。
  - 一時デモモック（確認後に撤去済み・痕跡なしを grep 検証）で、フォーム（ステッパー／合計の
    リアクティブ更新 ¥3,600／ニックネーム入力）と完了画面（受取番号・内訳・合計¥6,200・取消）の
    描画をモバイル幅で確認。コンソールエラー無し。

### 適用・検証ログ（2026-06-28 追記）
- **migration 0019 本番適用 完了**: `とれはんっ！/supabase/migrations/0019_reservations.sql` を
  Supabase SQL Editor（プロジェクト vuazrgebojcnyjcnhpuq / PRODUCTION）で実行＝Success。
  非破壊（新規テーブル2＋RPC6＋RLS の追加のみ。既存 とれはんっ！ 資産は無変更）。
- **REST/RPC 再検証 合格**: anon キー経由で upsert→get→create→list の一連、別トークン list の
  token mismatch（HTTP 400）拒否、テーブル直アクセス（HTTP 401 permission denied）を確認。
  `get_reservation_page` は `owner_token_hash` を返さない（秘密非漏洩）ことも確認。
- **Web 買い手 end-to-end 合格**: preview（ライブ DB）で実 slug `__e2e_demo__` を開き、
  UI から数量入力→合計 ¥2,900 のリアクティブ更新→予約→**受取番号「1」**発行、を確認。
  売り手側 `list_reservations` に nickname/内訳/合計/pending が反映。検証データは後始末済み。
- **残（要ユーザー操作）**:
  - レジさぽっ！アプリ（Rev11）UI 側からの「公開」「取り置き一覧」表示は実機での最終確認が未了
    （RPC 配線自体は上記で実証済み・アプリは tsc 通過）。
  - **GitHub Pages 公開**: 2026-06-28 ユーザー承認のうえ実施済み（Rev2「公開」節を参照）。公開URL は HTTP 200・404 解消済み。
