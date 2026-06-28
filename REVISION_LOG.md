# REVISION_LOG — urehan-reserve（取り置き予約・一般参加者向け Web）

レジさぽっ！（urehan）の「取り置き予約」機能の買い手側。サークルが公開したお品書きを
`/#/r/<slug>` で表示し、一般参加者がニックネーム＋品・個数を入力して取り置きを予約できる。
バックエンドは とれはんっ！／レジさぽっ！と共通の Supabase（migration `0019_reservations.sql`）。

> Rev 番号は本アプリで独立採番（urehan 本体／とれはんっ！の Rev とは無関係）。
> 1指示 = 1Rev = 1コミット ＋ 本ログ追記を徹底する。

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

### 未対応（別途・要ユーザー操作）
- **migration 0019 の本番適用**: `get_reservation_page` 等が未デプロイ（PGRST202 で確認済み）。
  `とれはんっ！/supabase/migrations/0019_reservations.sql` を Supabase SQL Editor で実行 →
  REST/RPC 再検証（upsert→get→create→list の一連＋別トークン list の token mismatch）が必要。
  適用後に本アプリの end-to-end（実 slug での予約→受取番号→レジさぽっ！一覧反映）を実機検証する。
- **GitHub Pages 公開**: リポジトリ作成・push・Pages 有効化は公開操作（WEB9＝許可制）。ユーザー確認後に実施。
