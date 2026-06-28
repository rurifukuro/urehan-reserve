# REVISION_LOG — urehan-reserve（取り置き予約・一般参加者向け Web）

レジさぽっ！（urehan）の「取り置き予約」機能の買い手側。サークルが公開したお品書きを
`/#/r/<slug>` で表示し、一般参加者がニックネーム＋品・個数を入力して取り置きを予約できる。
バックエンドは とれはんっ！／レジさぽっ！と共通の Supabase（migration `0019_reservations.sql`）。

> Rev 番号は本アプリで独立採番（urehan 本体／とれはんっ！の Rev とは無関係）。
> 1指示 = 1Rev = 1コミット ＋ 本ログ追記を徹底する。

---

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
