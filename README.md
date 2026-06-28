# urehan-reserve — 取り置き予約（一般参加者向け Web）

レジさぽっ！（urehan）で登録したお品書きを公開し、**一般参加者がブラウザから取り置き予約**できる
公開 Web アプリ。サークル本人（売り手）側のアプリが `reservation_pages` に publish したページを、
このサイトが `/#/r/<slug>` で表示する。

- スタック: Vite + React 19 + TypeScript（strict）+ react-router-dom（HashRouter）。
- バックエンド: とれはんっ！／レジさぽっ！と**共通の Supabase**（プロジェクト `vuazrgebojcnyjcnhpuq`）。
  すべて security definer RPC 経由（migration `0019_reservations.sql`）。テーブル直アクセスは RLS で拒否。
- 取得する個人情報は**ニックネームのみ**（連絡先は取らない）。受け渡しは当日の**受取番号**で行う。

## 画面

- `/#/r/<slug>` … 取り置きページ。お品書き（単品＋セット）を表示 → 個数を選ぶ → ニックネーム（任意）→
  「取り置きを予約する」で `create_reservation` を呼び、**受取番号**を発行・表示する。
- `/` … slug 無しの案内ページ（個別URLからアクセスする旨）。

## 使う RPC（0019）

| RPC | 用途 |
| --- | --- |
| `get_reservation_page(p_slug)` | お品書きページの取得（owner_token_hash は返らない） |
| `create_reservation(p_slug, p_nickname, p_installation_id, p_items, p_now)` | 予約作成＋受取番号採番（合計はサーバー再計算） |
| `cancel_reservation(p_reservation_id, p_installation_id, p_now)` | 本人キャンセル（installation_id 照合・受取済みは不可） |

## ローカル開発

```bash
npm install
cp .env.example .env   # URL と anon(publishable) キーを記入（公開安全値）
npm run dev
```

`http://localhost:5173/#/r/<slug>` を開く（`<slug>` はレジさぽっ！で公開したページの slug）。
※ 動作には migration `0019_reservations.sql` が本番 Supabase に適用済みである必要がある。

## デプロイ（GitHub Pages）

- `.github/workflows/deploy.yml` が `main` への push で Pages へデプロイ（`VITE_BASE_PATH=/urehan-reserve/`）。
- 公開 URL: `https://rurifukuro.github.io/urehan-reserve/`（レジさぽっ！の `src/config/reservation.ts` と一致）。
- anon(publishable) キーは RLS 前提の公開安全値。**service_role は置かない**。
