# REVISION_LOG — urehan-reserve（取り置き予約・一般参加者向け Web）

レジさぽっ！（urehan）の「取り置き予約」機能の買い手側。サークルが公開したお品書きを
`/#/r/<slug>` で表示し、一般参加者がニックネーム＋品・個数を入力して取り置きを予約できる。
バックエンドは とれはんっ！／レジさぽっ！と共通の Supabase（migration `0019_reservations.sql`）。

> 🔴 **Rev 番号の採番は Rev15 を境に変わっている**（2026-08-26 に git log で実測して判明）。
> - **Rev1〜Rev15**: 本アプリで独立採番していた（旧方針）。
> - **Rev84 以降**: **urehan 本体の Rev 番号をそのまま使う**。買い手ページの変更は
>   ほぼ必ず本体（サーバー／売り手アプリ）の変更と対になって出るため、番号を割ると
>   「どの本体 Rev と一緒に出たのか」が追えなくなる。
> - 独立採番へ戻さない＝**Rev16〜Rev83 は永久に欠番**。番号の穴を埋めようとしないこと。
>
> 1指示 = 1Rev = 1コミット ＋ 本ログ追記を徹底する。

---

## Rev9 — 予約送信エラーに品目名・上限詳細を表示（migration 0026 連携）（2026-07-01）

一般参加者（買い手）が「取り置きを予約する」を押した際、サーバー側で `item_limit_per_person_exceeded` / `item_max_qty_exceeded` が発火した時に **どの品目がどの上限に何点超えたか** を画面に明示する。

### 背景
- サーバーは migration 0024（本番適用 2026-07-01）で品目別限数を検査していたが、英字コードだけを返していた。
- Rev7 の onSubmit にはこれら新エラー種の分岐が **無く**、既定の「予約の送信に失敗しました。通信状況をご確認ください。」に落ちていた。
- 買い手側から見ると「限数バグが直っていない」ように見えた（実際はサーバー側で正しく弾かれていた）。
- migration 0026（本番適用 2026-07-01）でサーバーが日本語詳細文言を返すよう改修。本 Rev はそれを画面表示する。

### 変更（src/pages/ReservePage.tsx）
- `onSubmit` の catch 節：
  - `msg.includes('item_limit_per_person_exceeded')` → コロン以降の詳細文言をそのまま `setSubmitError` に渡す。旧サーバー用に汎用文言フォールバックも残す。
  - `msg.includes('item_max_qty_exceeded')` → 同上。
- 表示例：「「新刊小説A」はお一人様1点までです（既に1点予約済み、今回1点追加）」
- 「「アンソロジーZ」は頒布上限15点に達しました（既に15点予約済み、今回1点追加）」

### 動作確認
- `tsc -b && vite build` 通過（EXIT=0・新バンドル `index-BGd5dxLu.js` 446.36 kB）。
- サーバー側 REST 直叩き（`P0001 "page not found"`）で schema cache が 0026 版で生きていることを確認済み。
- 実存ページでの発火は本番 Pages デプロイ後にユーザー端末で再現テスト。

## Rev8 — 品目別限数/頒布上限の表示・ステッパー制限を追加（2026-07-01・記録追いつき）

migration 0024 の品目別 `limitPerPerson`/`maxQty` に対応する UI を追加。

### 変更（src/pages/ReservePage.tsx / src/lib/types.ts）
- `PageItem` 型に `limitPerPerson?: number | null` / `maxQty?: number | null` を追加（サーバー戻り値の追加フィールドに整合）。
- `itemMaxQty(it)` helper：品目ごとの上限（limitPerPerson＞0なら限数、それ以外は 99）を返す。
- `setItemQty` を上限クランプ付きに変更。
- ステッパーの「＋」ボタンに `disabled={n >= max}` を追加。
- 品目名下に `.item-limits`（`.limit-tag`）でタグ表示：
  - 「（お一人様N点まで）」（limitPerPerson＞0）
  - 「（頒布上限 N点）」（maxQty＞0）
- catch 節に `item_limit_per_person_exceeded` / `item_max_qty_exceeded` の汎用文言分岐を追加（Rev9 で詳細版に上書き）。

### 記録追いつき理由
- Rev8 のコミット時（`c063442`）に本 LOG へのエントリ追加を忘れていた。1指示=1Rev=1コミット＋本ログ追記のルールに反していたので Rev9 のコミット内でまとめて追いつく。

## Rev7 — 取り置き予約にパスワード保護・上限・警告強調・受取番号ディープリンク転送を追加（A-1/A-2/A-4/C-1）（2026-07-01・記録追いつき）

migration 0023 の password_hash / max_reservations 追加と、`get_reservation_page` の戻り値追加（has_password / max_reservations）に整合する買い手側 UI。

### 変更
- `src/lib/types.ts`：`ReservationPage` に `has_password: boolean` / `max_reservations: number | null` を追加。
- `src/pages/ReservePage.tsx`：
  - `page.has_password` の場合にパスワード入力欄を表示。空欄で送信すると `password_required` を分岐表示。誤入力は `password_mismatch` で「パスワードが正しくありません。」。
  - `reservation_limit_reached` を「予約が上限に達しました。」で分岐表示。
  - 受取番号の表示を強調＋警告ボックス（「スクリーンショット保存を強くおすすめします」）。
  - Rev5/6 のディープリンク（`torehan://reserve?slug=…&rno=<受取番号>`）に受取番号 `rno` を付与し、とれはんっ！側で照合できるように。
- `src/lib/api.ts`：`createReservation` に `password?` 引数追加、`p_password: password || null` を渡す（migration 0023 の 6-arg シグネチャに整合）。

### 記録追いつき理由
- Rev7 のコミット時（`929d69d`）に本 LOG へのエントリ追加を忘れていた。Rev8 と同時に Rev9 で追いつく。

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

---

## Rev10（2026-07-02）— 予約ページから「頒布上限」表示を除去（ユーザー指摘④）

### 背景
Rev8 で品目ごとに「（頒布上限 N点）」タグを表示していたが、在庫数を買い手に見せない方針の指摘を受け除去。
（「表示しないように」の指摘に対し Rev9 時点で残存していたものの是正）

### 変更
- `ReservePage.tsx`: `maxTag`（頒布上限 N点）の生成・表示を削除。「（お一人様N点まで）」の limitTag は維持。
- **ステッパーの上限制御（`itemMaxQty` による＋ボタン disabled）は機能として維持**＝表示だけを消し、
  上限超過の予約自体は従来どおり不可（サーバー側 RPC の上限チェックも Rev9 のまま）。

### 動作確認
- `npx tsc --noEmit` EXIT=0・`npm run build` 成功。
- GitHub Pages 再デプロイ（push → Actions）＋実 HTTP 検証は本 Rev コミット後に実施。

---

## Rev11（2026-07-02）— 予約完了画面のとれはんっ！連携リンクに予約品目 key を追加（ユーザー指摘⑤）

### 目的
「予約ページからとれはんっ！を開いてローカルリストに保存した際、自分が予約した物に最初から
欲しいチェックが入っているようにして欲しい」への対応（送信側）。

### 変更
- `ReservePage.tsx`:
  - `TorehanCta` に `reservedKeys`（買い手が実際に予約した品目の key 群 = `orderedItems.map(it => it.key)`）を追加。
  - ディープリンクを `torehan://reserve?slug=…&rno=…&items=key1,key2`（URL エンコード済みカンマ区切り）に拡張。
    key は urehan 側の品目識別子 `'p<productId>'` / `'b<bundleId>'`（英数字のみ＝カンマ安全）。
  - 予約 0 件（理論上ない）の場合は `items=` を付けない＝旧リンク互換。
- 受信側はとれはんっ！ Rev233（`parseReserveLink` で `items=` をパースし、一致品目を `is_checked: 1` で登録）。

### 動作確認
- `npx tsc --noEmit` EXIT=0・`npm run build` 成功。
- GitHub Pages 再デプロイ＋実 HTTP 検証は本 Rev コミット後に実施（Rev10 検証と合わせて実施）。

---

## Rev12（2026-07-02）— 受取番号の再表示（提案1）

### 目的
受取番号が「その場限りの表示」で、ページを閉じる・ブラウザが落ちると番号を確認できなくなっていた。
予約結果を端末（localStorage）へ保存し、同じ端末・ブラウザで再訪したときに完了画面を復元する。

### 変更
- `src/lib/lastReservation.ts`（新規）: slug 単位キー `urehan_reserve_last_v1:<slug>` に
  `{reservation_id, pickup_no, items, savedAt}` を保存/復元/削除。TTL 30日（同じ slug が別イベントへ
  再利用された場合の混同防止）。localStorage 不可（プライベートブラウズ等）でも例外を握って動作継続。
- `ReservePage.tsx`:
  - ページ読込成功時に `loadLastReservation(slug)` → あれば `result`/`orderedItems` を復元し完了画面を表示。
  - 予約成功時に `saveLastReservation(slug, r, selected)`。
  - キャンセル成功時に `clearLastReservation(slug)`（取り消した番号は再表示しない）。
  - 完了画面の合計を `orderedTotal`（確定内訳 `orderedItems` 由来）へ変更。従来は選択中 qty 由来の
    `total` を表示しており、復元表示では qty が空＝¥0 になってしまうため。
  - 注意文言を「同じ端末・ブラウザで開き直すと再表示できます／別端末に備えてスクショ推奨」へ更新
    （「この画面にしか表示されません」は Rev12 以降は不正確）。

### 動作確認
- `npx tsc --noEmit` EXIT=0・`npm run build` 成功。
- GitHub Pages 再デプロイ＋実 HTTP 検証（WEB5）を本 Rev コミット後に実施。

---

## Rev13（2026-07-02）— お品書き画像プレビュー＋拡大表示、ディープリンクに予約個数（記録追いつき）

※ 実装・コミット（`0220ff3`）は 2026-07-02 に完了していたが REVISION_LOG への記録が漏れていた。
Rev15 の記録ドリフト是正で追記（実体の変更なし・コミット内容から復元）。

### 変更
- `ReservePage.tsx`: 予約ページにお品書き画像ギャラリーを追加＋タップでライトボックス拡大表示。
  フォーム画面・完了画面の両方に配置。
- `TorehanCta` のディープリンクを `key:qty` 形式へ変更＝**予約した個数**まで とれはんっ！ 側へ転写。
  （Rev11 は key のみだったため、受信側が「1個」でしか登録できなかった）
- `src/index.css`: ギャラリー／ライトボックスのスタイル（+72行）。

---

## Rev14（2026-07-02）— お品書きギャラリーを中央配置（記録追いつき）

※ コミット `e7c0697`。Rev13 と同じく記録漏れを Rev15 で追記。

### 変更
- `src/index.css`: ギャラリーの並びを左寄せ→中央寄せへ（2行）。画像が1〜2枚のとき左に寄って
  見栄えが崩れていたため。

---

## Rev15（2026-07-31）— 公開ページ全画面に削除依頼の窓口（UGC-PATH / App Store 1.2(d)）

### 目的
レジさぽっ！本体の批判的チェック（Rev71 ラウンド5）で検出した **UGC-PATH 違反の Web 側** の是正。
この取り置き予約サイトは **アプリ未導入の第三者でも URL さえ知っていれば閲覧できる公開面** で、
サークル名・頒布物名・**お品書き画像**が載る。にもかかわらず、掲載された当事者（例: 自分の作品を
無断で載せられた人）が運営へ連絡する手段がページ上に一切無かった。
「連絡先はアプリ内の問い合わせにある」は **アプリを持っていない当事者には届かない**＝
App Store ガイドライン 1.2(d)（公開された連絡先）を公開ページ側で満たしていなかった。

### 変更
- `src/components/SiteFooter.tsx`（新規）: 削除・修正依頼の窓口を示す共通フッター。
  連絡先は `rurifukuro@gmail.com`（R17＝ストア掲載のサポート窓口と同一。窓口を分岐させない）。
  `mailto:` にしたのは、閲覧者がアプリ・アカウント無しで即座に連絡できる唯一の手段だから。
  対応方針（原則24時間以内に確認し不適切なものを削除）も明記。
- `src/pages/ReservePage.tsx`: インライン定義していたフッターを上記コンポーネントへ移し、
  **4分岐すべて**（予約フォーム／完了画面／`notfound`／`error`）に結線。
- `src/pages/HomePage.tsx`: カード末尾に結線。
- `src/index.css`: `.site-footer`（上マージン20px・上パディング12px・上境界線1px）。

### 横断展開（批判的チェック 大原則5）
着手時点では予約フォームと完了画面の2分岐にしか入っておらず、**「ページが見つかりません」に
着地した人＝まさに掲載を取り下げてほしかった人**が連絡先へ一切たどり着けなかった。
このサイトが返しうる画面を全列挙して5箇所すべてへ結線した。
新しい画面／ルートを足すときは `SiteFooter` への結線を**同じ Rev で**行うこと（コメントにも明記）。

### 動作確認
- `npm run build`（`tsc -b && vite build`）成功＝`✓ 69 modules transformed` /
  `dist/assets/index-XLcfs6rE.js 448.75 kB`。
- ローカル dev（`http://localhost:5174`）で実 HTTP 取得し、ホーム画面にフッター本文が
  レンダリングされることを確認（WEB5/7）。
- GitHub Pages への反映は本 Rev の push で GitHub Actions が自動デプロイ（WEB9＝ユーザー承認済み）。

### 記録ドリフト是正
本 Rev の着手時、`git log` の HEAD が Rev14 なのに REVISION_LOG の最終記録が Rev12 だった
（Rev13/Rev14 が未記録）。上記の通り2件を追記して 3点（git HEAD / REVISION_LOG / 実装）を一致させた。

---

## 記録追いつき（2026-08-26 実測）— Rev84 / Rev86 / Rev87 / Rev88

Rev151 の着手時に3点照合したところ、**git HEAD が Rev88 なのに本ログの最終記録は Rev15** だった。
＝Rev84 以降の4件が未記録のまま10日以上放置されていた（[[feedback_rev_record_drift_guard]] の実被弾と同型）。
本文の再構成は行わず、**コミットから読み取れる事実だけ**を後追いで残す（推測を書かない）。

| Rev | commit | 内容 |
|---|---|---|
| Rev84 | `246e00b` | 取り置き予約 Web の冪等キー・タイムアウト・保存失敗の可視化 |
| Rev86 | `e87db6f` | `PageItem` から `maxQty` を削除（サーバー側 0064(B) と対） |
| Rev87 | `25e9ecc` | 公開ページのお品書き画像 URL を表示の直前で origin 検証（本体 Rev87 ラウンド18 J-1） |
| Rev88 | `2271ac4` | 批判的チェック19ラウンド目: 冪等キーを持ったまま内容だけ変わるのを防ぐ／締切判定を端末時計で閉じない |

※ Rev85 に相当するコミットはこのリポジトリに無い（本体側だけの Rev）。
※ `b858567` は「レジさぽっ！Rev83」名義のコミット（当日は会場の価格・税設定で会計する旨の明記）。

---

## Rev151（2026-08-26）— 予約フォームに「備考（任意）」を足す

**ユーザー指示（verbatim・レジさぽっ！本体セッション）**:
「**取り置きページに取り置き予約をする人からの備考も記載できるようにし、アプリ側でもその備考を見れるようにする**」

本体側は urehan の Rev151。ここは**買い手が入力する側**。

### 出す順序（🔴 逆にすると予約が1件も通らなくなる）

`create_reservation` の引数が1つ増える＝**サーバー（migration 0113）を先に本番へ上げる**。
逆順にすると、新しい Web が旧サーバーへ 8 引数で投げて **PGRST202** で全滅する。
0113 は 2026-08-26 に適用済みで、`p_buyer_note` が **DEFAULT NULL** のため
**旧7引数の呼び出しも同じ関数で解決される**ことを PostgREST の無害プローブで実測している。

### 変更

| ファイル | 何をしたか |
|---|---|
| `src/lib/api.ts` | `createReservation` に `buyerNote?` を追加し `p_buyer_note` を送る。**空文字は送らず null**（サーバーも `nullif(btrim(...),'')` で寄せているが、`''` を送ると「備考あり（中身は空）」に見える経路が1つ増える） |
| `src/lib/lastReservation.ts` | `SavedReservation.buyer_note?`。復元時に**型が違えば黙って捨てる**（復元の失敗で受取番号ごと消さない） |
| `src/pages/ReservePage.tsx` | `NOTE_MAX_LEN = 200` の `<textarea>`＋文字数カウンタ、完了画面に「お送りした備考」 |
| `src/index.css` | `.textarea`（`font-family: inherit`＝既定の等幅を止める・縦だけリサイズ可）／`.field-count`／`.mynote-box` |

### 決めたことと理由

- **上限 200 はサーバーと Web の2箇所にある**。`NOTE_MAX_LEN` の JSDoc で 0113 の `left(...,200)` と
  同じ値であることを縛った。片方だけ変えると**「入力できたのに黙って切られる」**＝
  買い手は伝えたつもりで伝わっていない、という気づけない壊れ方をする。
  `maxLength` は親切であって防御ではない（別クライアントから外せる）＝**切るのはサーバー**。
- **`disabled={contentLocked}`**（Rev88 O-3 と同じ理由）。送信結果が不明な間に備考を書き換えると、
  冪等キーで返ってくる1回目の予約（＝古い備考）と手元の控えが食い違う。
- **控えは「入力中の値」ではなく「送った値」**（`orderedNote`／`orderedItems` と同じ立て付け）。
- **完了画面に控えを出す**のは、買い手には**この画面以外に確認する手段が無い**から
  （ログインも履歴も無い＝「ちゃんと伝わったか」を確かめられるのはここだけ）。
- **注意書きに「個人情報は書かないでください」を入れた**。連絡先を取らない設計なのに
  備考へ電話番号を書かれると、**取らないと明記したデータが実際には届いてしまう**。
- `.mynote-box` は**無彩色**（サークルからのお知らせ `.note-box` はアンバー）＝
  「自分が書いたもの」と「相手からのお知らせ」を色で分ける。
  `overflow-wrap: anywhere` で、空白の無い200字がカードから溢れないようにした。

### 動作確認

- `npm run build`（`tsc -b && vite build`）＝**EXIT=0**（70 modules / `dist/assets/index-B_fC81qw.js` 453.86 kB）
- ⏳ **GitHub Pages への再デプロイは未実施**（WEB9＝Web 公開は許可制）。
  **これを出すまで備考欄は買い手に届かない**（アプリ側は先に出ても「備考なし」に倒れるだけで無害）。

---

## Rev156（2026-08-26）— GitHub Pages へ再デプロイ（Rev83〜Rev88 を本番へ）＋備考欄は出荷フラグで伏せる

### 指示（verbatim）

> まずすべて回答してまとめて自走して欲しい

判断ゲート【A3】への回答＝**「今すぐ再デプロイする」**。

### 着手して分かったこと（実測）

**① 本番は6コミット遅れていた。** `git rev-list --left-right --count origin/main...main` = `0 6`。
つまり公開中の `https://rurifukuro.github.io/urehan-reserve/` は **Rev83 より前**の状態で、
次の5件が**一度も本番に出ていない**:

| Rev | 内容 | 出ていないことの意味 |
|---|---|---|
| Rev83 | 当日は会場の価格・税設定で会計する旨を明記 | 買い手が「表示額で買える」と思ったまま当日を迎える |
| Rev84 | 冪等キー・タイムアウト・保存失敗の可視化 | 電波が切れた時に**二重予約**が起こりうる／失敗が無反応 |
| Rev86 | `PageItem` から `maxQty` を削除（サーバー 0064(B) と対） | サーバーが返さなくなった値を本番の Web はまだ見ている |
| Rev87 | お品書き画像 URL を表示直前に origin 検証 | 公開ページに**別ドメインの画像を差し込める**穴が空いたまま |
| Rev88 | 冪等キーを持ったまま内容だけ変わるのを防ぐ／締切判定を端末時計で閉じない | 買い手の控えと売り手の一覧が食い違う／端末時計をずらすと締切を越えられる |

＝**再デプロイは急ぐべきだった**（A3 の回答は正しい）。

**② ただし Rev151（備考欄）だけは、今出すと壊れる。**
備考を**読んで売り手に見せる**のはレジさぽっ！アプリ側（`ReservationManagerModal.tsx`・Rev151）で、
この Web ではない。旧版アプリは `buyer_note` を読まないので:

- サーバー（0113）は受け取って保存する＝**エラーは出ない**
- 売り手の画面には**何も出ない**
- 買い手には「送れた」ように見える

＝**失敗が誰の目にも触れない**まま、当日「備考に書いたのに」で揉める。

実測: レジさぽっ！ `app.json` の `version` は **1.0.6**。`git log -S'"version"' -- app.json` は
**Rev1 の1件だけ**＝一度も繰り上げていない。**備考を読める版（1.0.7 以降）はまだビルドすらされていない**
＝備考を読めるアプリは**1台も存在しない**。

### 是正

`src/pages/ReservePage.tsx` に**出荷フラグ `SHOW_BUYER_NOTE`（既定 false）**を置いた。

- 入力欄の JSX をフラグで囲む＝**欄ごと出さない**
- `onSubmit` の `const note` もフラグを見る＝**画面に無いのに送られる経路を作らない**
  （欄を隠すだけだと、state に残った値が飛びうる）
- 定義側の docblock に **①なぜ隠すのか ②今 false である根拠（上の実測） ③true にしてよい条件**を書いた

**なぜコミットを分けて `Rev88` までを push する方式を採らなかったか**: それだと
「次に何も考えず `git push` したら備考欄が本番に出る」＝**サイレントな事故**になる。
フラグなら出すのに `false → true` という明示的な行為が要る。

**逆順（アプリを先に出す）は無害**＝新版アプリは `buyer_note` が null なら何も表示しないだけ。
だから順序は **アプリ 1.0.7 配信 → 浸透 → このフラグを true → Web 再デプロイ** で固定する。

⚠ Rev151 節の末尾に「これを出すまで備考欄は買い手に届かない」と書いてあるのは**事実だが、
早く出す理由にはならない**（届かないのは Web が無いからではなく、**読む側のアプリがまだ無い**から）。
歴史の記録なのでその行は書き換えず、ここに読み方を残す。

### 変更ファイル

- `src/pages/ReservePage.tsx` … `SHOW_BUYER_NOTE` 新設・入力欄と送信をフラグ配下へ
- `src/lib/api.ts` … `createReservation` のデプロイ順序コメント（Rev151 で書きかけていた分をコミット）
- `REVISION_LOG.md` … 本節

### 動作確認

- `npm run build`（`tsc -b && vite build`）＝**EXIT=0**
- 本番反映は `.github/workflows/deploy.yml`（`main` への push でトリガ）

### 次にやること

- ⏳ **`SHOW_BUYER_NOTE` を true にするのは 1.0.7 が両ストアで配信され浸透してから**。
  条件は定義側の docblock が正（R74＝その時点で ASC / Play を API で数える）。
  忘れないようメモリ `project_urehan_reserve_next_fixes.md` の残TODO にも1件だけ起票した（W24-D）。

---

## Rev182（2026-09-01）— 備考欄を本番で開ける（`SHOW_BUYER_NOTE` を true）

### 指示

ユーザー指示 verbatim「**② 条件待ち（今は動かせない）⇒これは全て適用してしまう**」。
Rev156 で伏せた出荷フラグを開ける、という決定。

### 🔴 解除条件①は未達のまま開けている（見落としではない）

Rev156 の docblock が定めた解除条件は「**Rev151 を含む版（1.0.7 以降）が iOS / Android の
両ストアで配信中**であること」。この日の実測（R74・ASC / Play を API で取得）は次のとおりで、
条件は**明確に未達**である。

| 面 | 実測 |
|---|---|
| iOS App Store | 配信中は **1.0.4**。`appStoreVersions` は 1.0.4 と 1.0 の2件だけ＝**1.0.5〜1.0.7 は版そのものが無い** |
| iOS TestFlight | 1.0.7 build 11（VALID・2026-08-30） |
| Google Play production | **リリース 0 件**（クローズドテスト中） |
| Google Play alpha | 1.0.7 / versionCode 6 / completed |

＝**備考を読めるアプリは、この時点でまだ 1 台も配信されていない**。
この実測を添えたうえでユーザーが「全て適用」と判断したので、指示どおり開けた。

**開けてよいと判断した根拠**は、この Rev の直後にアプリ側 **1.0.8**（備考を読む Rev151 と
Rev181 を含む）を両ストアへ出す作業が続くこと。Rev156 が警告した失敗
（買い手は送れたつもり／旧版アプリの売り手には見えない）は**消えたのではなく、
アプリが行き渡るまでの窓として残っている**。窓が閉じるのは 1.0.8 の配信が始まり旧版が入れ替わった時。

### 変更ファイル

- `src/pages/ReservePage.tsx` … `SHOW_BUYER_NOTE` を `false` → `true`。
  **Rev156 の「false である根拠」は消さずに残し、その下へ 2026-09-01 の実測と決定を追記**した
  （消すと、次に false へ戻したくなった時に何を天秤にかけた決定だったのか分からなくなる）。
- `REVISION_LOG.md` … 本節

### 動作確認

- `npm run build`（`tsc -b && vite build`）＝**EXIT=0**
- 本番反映は `.github/workflows/deploy.yml`（`main` への push でトリガ）
