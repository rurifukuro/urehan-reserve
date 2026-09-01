import { useCallback, useEffect, useMemo, useState } from 'react';
import { SiteFooter } from '../components/SiteFooter';
import { useParams } from 'react-router-dom';
import type { ReservationPage, ReservedItem, CreateReservationResult, PageItem } from '../lib/types';
import { getReservationPage, createReservation, cancelReservation } from '../lib/api';
import { getInstallIdState, newRequestId } from '../lib/installId';
import { isTimeoutError } from '../lib/fetchTimeout';
import { saveLastReservation, loadLastReservation, clearLastReservation } from '../lib/lastReservation';
import { yen } from '../lib/format';

type Load = 'loading' | 'loaded' | 'notfound' | 'error';

/** 備考の上限。🔴 サーバー側 migration 0113 の `left(coalesce(p_buyer_note,''), 200)` と同じ値。
 *  片方だけ変えると「入力できたのに黙って切られる」（＝買い手は伝えたつもりで伝わっていない）。 */
const NOTE_MAX_LEN = 200;

/** 🔴 Rev156: 備考欄の**出荷フラグ**。true にするまで入力欄を出さず、備考も送らない。
 *
 *  ── なぜ機能そのものを作ってから隠すのか ──────────────────────────────
 *  備考を**読んで売り手に見せる**のはレジさぽっ！アプリ側の予約管理画面
 *  （`urehan/src/components/ReservationManagerModal.tsx`・Rev151）であって、
 *  この Web ではない。ここは「買い手が書く場所」でしかない。
 *  つまり **Web を先に出すと、書かれた備考の行き先が無い**:
 *    - サーバー（0113）は受け取って保存する＝**エラーにならない**。
 *    - 旧版アプリは `buyer_note` を読まない＝売り手の画面には**何も出ない**。
 *    - 買い手には「送れた」ように見える＝**当日「備考に書いたのに」で揉める**。
 *  失敗が一切表に出ないので、こちらも買い手も気づく手掛かりが無い。
 *
 *  ── 2026-08-26 時点の実測（これが false である根拠）──────────────────
 *  レジさぽっ！ `app.json` の `version` は **1.0.6**。備考を読む Rev151 を含む版は
 *  **まだビルドすらされていない**（`git log -S'"version"' -- app.json` は Rev1 の1件だけ
 *  ＝一度も繰り上げていない）。**備考を読めるアプリは1台も存在しない**。
 *
 *  ── true にしてよい条件 ────────────────────────────────────────
 *  ① Rev151 を含む版（1.0.7 以降）が **iOS / Android の両ストアで配信中**であること。
 *  ② 配信開始から日が経ち、旧版が実質的に入れ替わっていること
 *     （ストア更新は強制ではない＝「配信した＝全員が新版」ではない）。
 *  ③ ①②を**実測で確かめる**（R74＝ストアの現在の状態は記憶に無い。ASC / Play を API で数える）。
 *  逆方向（アプリを先に出す）は無害＝新版アプリは `buyer_note` が null なら何も表示しないだけ。
 *
 *  ⚠ この定数を消して JSX を直に戻さないこと。戻すと上の順序制約が**コードから消える**。
 *
 *  ── 🔴 2026-09-01（Rev182）true 化 — ユーザー指示 ─────────────────────
 *  ユーザー指示 verbatim「**② 条件待ち（今は動かせない）⇒これは全て適用してしまう**」。
 *  上の解除条件①は**未達のまま開ける**（下の実測のとおり）＝これは見落としではなく決定である。
 *
 *  この日の実測（R74・ASC / Play を API で取得）:
 *    - iOS App Store … 配信中は **1.0.4**。`appStoreVersions` は 1.0.4 と 1.0 の2件だけ
 *      ＝**1.0.5〜1.0.7 は版そのものが存在しない**（TestFlight には 1.0.7 build 11 が居る）。
 *    - Google Play  … **production にリリース 0 件**（クローズドテスト中）。alpha に 1.0.7 / vc6。
 *  ＝**備考を読めるアプリは、この時点でもまだ 1 台も配信されていない**。
 *
 *  それでも開ける理由は、この Rev の直後に **1.0.8（Rev151/181 を含む）を両ストアへ出す**ため。
 *  Web を先に出しても、上に書いた失敗（買い手は送れたつもり／売り手には出ない）は
 *  **アプリが行き渡るまでの一時的なもの**で、順序を守って待つ場合との差は「その期間の長さ」だけ。
 *  ユーザーはこの実測を踏まえたうえで「全て適用」と判断した。
 *
 *  🔴 したがって**この期間だけは、上の docblock が警告している事象が実際に起こりうる**
 *  （買い手が備考を書き、旧版アプリの売り手には見えない）。当日トラブルの相談が来たら
 *  まずこの窓を疑うこと。窓が閉じるのは**両ストアで 1.0.8 の配信が始まり、旧版が入れ替わった時**。
 */
const SHOW_BUYER_NOTE = true;

export function ReservePage() {
  const { slug = '' } = useParams();
  // 🔴 Rev84（班E 要確認8）: 端末IDを永続化できたかまで受け取る。できていない端末は
  //   リロード後に自分の取り置きを取り消せないので、その旨を完了画面で伝える（無反応にしない）。
  const [{ id: installId, persisted: idPersisted }] = useState(() => getInstallIdState());
  // 🔴 Rev84（班E 重要3）: 冪等キー。**成功するまで同じ値を使い回す**＝送信後に応答が
  //   電波で落ちて買い手が押し直しても、サーバー（0062）が既存行の受取番号を返すので二重予約にならない。
  const [requestId, setRequestId] = useState(() => newRequestId());

  const [load, setLoad] = useState<Load>('loading');
  const [page, setPage] = useState<ReservationPage | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [qty, setQty] = useState<Record<string, number>>({});
  const [nickname, setNickname] = useState('');
  /** 0113: 買い手からの備考（任意）。上限はサーバー（`create_reservation`）と同じ 200 文字。
   *  🔴 `maxLength` は入力の親切であって防御ではない（DevTools でも別クライアントでも外せる）
   *    ＝**切るのはサーバー側**。ここの数字はあくまで「切られる前に気づかせる」ためのもの。 */
  const [buyerNote, setBuyerNote] = useState('');
  /** 確定した備考（結果表示用）。`orderedItems` と同じ立て付け＝
   *  **入力中の値ではなく「送った値」**を控えとして見せる（送信後に入力欄を触られてもズレない）。 */
  const [orderedNote, setOrderedNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** 🔴 Rev88（批判的チェック ラウンド19・班O 重要 O-3／ASYNC-ORDER・MATCH-KEY）
   *
   *  「送ったかどうか分からない」状態。タイムアウトや原因不明の失敗は**サーバー側では通っている
   *  可能性がある**ので、`requestId`（冪等キー）をわざと作り直さずに再送させている。
   *  ところが旧実装は、その待ちの間も**数量・ニックネームを自由に編集できた**。
   *  1回目が実はサーバーに届いていた場合、押し直しても同じ冪等キーなので**新しい内容では作られず**、
   *  サーバーは1回目の予約をそのまま返す。画面はその戻り値ではなく手元の `selected` を
   *  「確定内訳」として保存・表示するため、**買い手の控えと売り手の一覧が食い違う**
   *  （買い手は3冊のつもり・売り手には2冊で並ぶ／当日その場で揉める・自動回復しない）。
   *  → 曖昧な失敗のあいだは内容を凍結する。サーバーが明確に拒否した失敗
   *    （パスワード違い・限数超過・締切・ページ無し＝**行は作られていない**）は凍結しない。 */
  const [contentLocked, setContentLocked] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateReservationResult | null>(null);
  const [orderedItems, setOrderedItems] = useState<ReservedItem[]>([]); // 確定した予約内容（結果表示用）
  const [cancelled, setCancelled] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [password, setPassword] = useState('');
  // 保存されていた受取番号が TTL 超過（＝別イベントで使い回された slug かもしれない）か。
  const [restoredStale, setRestoredStale] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoad('loading');
    getReservationPage(slug)
      .then((p) => {
        if (!alive) return;
        if (!p) { setLoad('notfound'); return; }
        setPage(p);
        // Rev12（提案1）: この端末で予約済みなら完了画面（受取番号）を復元する。
        //   「受取番号を控え忘れた」「ページを閉じてしまった」の救済。キャンセル成功時に消える。
        const saved = loadLastReservation(slug);
        if (saved) {
          setResult({ reservation_id: saved.reservation_id, pickup_no: saved.pickup_no });
          setOrderedItems(saved.items);
          setOrderedNote(saved.buyer_note ?? ''); // 0113: 無い版で保存された古い控えは空になるだけ
          setRestoredStale(!!saved.stale);
        }
        setLoad('loaded');
      })
      .catch(() => { if (alive) setLoad('error'); });
    return () => { alive = false; };
  }, [slug, reloadKey]);

  // 🔴 Rev84（班E 重要2）: 読み込み失敗からの復帰導線。タイムアウトを入れた以上、
  //   会場回線では「時間を置けば通る」失敗が普通に起きる＝再試行できないと行き止まりになる。
  const retryLoad = useCallback(() => setReloadKey((k) => k + 1), []);

  // 並び順は従来（レジさぽっ！本体）と同じく「セット（bundle）を上・単品（product）を下」。
  // 同種内は公開時の順序を維持する（安定ソート）。selected・完了画面の内訳もこの順に従う。
  const items = useMemo<PageItem[]>(() => {
    const raw = page?.items ?? [];
    // 防御: 同一 key の品目が重複していたら最初の1つだけ残す（売り手側の二重公開・絵文字重複などで
    //   同じセットが複数行に増えて見えるのを防ぐ）。key が無い古い形式は name で代替キーにする。
    const seen = new Set<string>();
    const deduped = raw.filter((it) => {
      const k = it.key || it.name;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const rank = (k: PageItem['kind']) => (k === 'bundle' ? 0 : 1);
    return [...deduped].sort((a, b) => rank(a.kind) - rank(b.kind));
  }, [page]);

  const selected: ReservedItem[] = useMemo(
    () =>
      items
        .map((it) => ({ key: it.key, name: it.name, price: it.price, qty: qty[it.key] ?? 0 }))
        .filter((it) => it.qty > 0),
    [items, qty],
  );
  const total = useMemo(() => selected.reduce((s, it) => s + it.price * it.qty, 0), [selected]);
  // 完了画面の合計は確定内訳（orderedItems）から出す。復元表示（Rev12）では qty 状態が空＝total は使えない。
  const orderedTotal = useMemo(() => orderedItems.reduce((s, it) => s + it.price * it.qty, 0), [orderedItems]);

  // Rev3: 受付が締め切られているか。サーバーも create_reservation で同条件を弾く（migration 0020）。
  //
  // 🔴 Rev88（ラウンド19・班O 注意 O-10／CLOCK-TRUST）: **買い手端末の時計で入口を閉じない。**
  //   旧実装は `Date.now() >= page.close_at` を `is_open` と同列に扱い、真になるとフォームごと
  //   消していた。`Date.now()` が指すのは**買い手のスマホの時計**で、ズレていれば
  //   〆切前なのに「締め切られています」しか出ない＝**正規の買い手が締切前に締め出され、
  //   本人には打つ手が無い**（会場で「予約できない」と言われても売り手側には何も起きていない）。
  //   時計が遅れている逆側は無害（送信できてサーバーが正しく弾く＝下の 'reservations closed'）。
  //   ＝**非対称なので、閉じる判断はサーバー由来の値だけで行う。**
  //   さらに `Date.now()` はレンダー時に1回評価されるだけで、開きっぱなしの画面は定刻を過ぎても
  //   再評価されない＝この式は元々「閉じ切る」役目を果たしていない（守れていない防御）。
  const closed = !!page && !page.is_open;
  // 端末時計では定刻を過ぎている＝**注意書きだけ**出す（送信そのものは止めない。可否はサーバーが決める）。
  const pastCloseAtByDeviceClock =
    !!page && page.is_open && page.close_at != null && Date.now() >= page.close_at;

  const itemMaxQty = (it: PageItem): number => {
    const limit = it.limitPerPerson;
    return (limit != null && limit > 0) ? limit : 99;
  };

  const setItemQty = (key: string, next: number) => {
    // Rev88（O-3）: 送信結果が不明なあいだは内容を動かさない（冪等キーを持ったまま中身だけ変わるのを防ぐ）。
    if (contentLocked) return;
    setSubmitError(null);
    const item = items.find((it) => it.key === key);
    const max = item ? itemMaxQty(item) : 99;
    setQty((prev) => ({ ...prev, [key]: Math.max(0, Math.min(max, next)) }));
  };

  const onSubmit = async () => {
    if (!page) return;
    if (selected.length === 0) { setSubmitError('予約する品物を1つ以上選んでください。'); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      // 🔴 Rev156: フラグが false のあいだは**送らない**。入力欄を隠すだけだと、
      //   state に残った値（将来 true→false と戻した場合や、開発中に触った場合）が
      //   そのままサーバーへ飛びうる＝「画面に無いのに保存されている」経路を作らない。
      const note = SHOW_BUYER_NOTE ? buyerNote.trim() : '';
      const r = await createReservation(
        slug, nickname.trim(), installId, selected, requestId, password || undefined, note || undefined,
      );
      saveLastReservation(slug, r, selected, note); // Rev12: 再訪時に受取番号を再表示できるように保存
      setOrderedItems(selected);
      setOrderedNote(note);
      setResult(r);
      setRestoredStale(false);
      // 次の申し込みは別の予約なので冪等キーを作り直す（失敗時は作り直さない＝再送で同じ値が飛ぶ）。
      setRequestId(newRequestId());
      setContentLocked(false); // Rev88（O-3）: 冪等キーを作り直した＝次は別の予約なので凍結を解く。
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 🔴 Rev88（O-3）: 「サーバーが明確に拒否した」失敗（＝予約行は作られていない）だけ内容の凍結を解く。
      //   このぶら下がりは**下の setSubmitError の分岐と1対1で対応させること**（分岐を足すならここも足す）。
      const serverRejected =
        msg.includes('password_required') || msg.includes('password_mismatch')
        || msg.includes('item_limit_per_person_exceeded') || msg.includes('item_max_qty_exceeded')
        || msg.includes('reservation_limit_reached') || msg.includes('reservations closed')
        || msg.includes('page not found');
      setContentLocked(!serverRejected);
      if (isTimeoutError(e)) {
        // 🔴 Rev84（班E 重要2＋重要3）: タイムアウトは「送れなかった」とは限らず、
        //   サーバー側では通っている可能性がある。冪等キーがあるので押し直しても二重にならない
        //   ＝**もう一度押してよい**ことを明示する（黙って失敗表示だけ出すと諦めて帰る）。
        setSubmitError('通信が混み合って応答がありません。もう一度「取り置きを予約する」を押してください（二重に予約されることはありません）。内容は変更できません（変更すると控えと売り手側の一覧が食い違うため）。');
      } else if (msg.includes('password_required') || msg.includes('password_mismatch')) {
        setSubmitError('パスワードが正しくありません。');
      } else if (msg.includes('item_limit_per_person_exceeded')) {
        // migration 0026: サーバーが「item_limit_per_person_exceeded: 「品名」はお一人様N点までです（既にX点予約済み、今回Y点追加）」の形で返す。
        // ": " 以降の日本語詳細をそのまま表示（品名・限数・既存量・追加量が入る）。旧サーバー用にフォールバック文言も残す。
        const detail = msg.replace(/^.*item_limit_per_person_exceeded:\s*/, '').trim();
        setSubmitError(detail && detail !== msg
          ? detail
          : '一部の品物が一人当たりの限数を超えています。');
      } else if (msg.includes('item_max_qty_exceeded')) {
        const detail = msg.replace(/^.*item_max_qty_exceeded:\s*/, '').trim();
        setSubmitError(detail && detail !== msg
          ? detail
          : '一部の品物が予約頒布上限に達しました。');
      } else if (msg.includes('reservation_limit_reached')) {
        setSubmitError('予約が上限に達しました。');
      } else if (msg.includes('reservations closed')) {
        setSubmitError('受付は締め切られました。');
      } else if (msg.includes('page not found')) {
        setSubmitError('ページが見つかりませんでした。');
      } else {
        // Rev88（O-3）: 原因不明＝サーバーに届いた可能性を否定できない。内容は凍結したまま押し直してもらう。
        setSubmitError('予約の送信に失敗しました。通信状況をご確認のうえ、もう一度「取り置きを予約する」を押してください（二重に予約されることはありません）。内容は変更できません。');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onCancel = async () => {
    if (!result) return;
    if (!window.confirm('この取り置きを取り消しますか？')) return;
    setCancelling(true);
    try {
      const ok = await cancelReservation(result.reservation_id, installId);
      if (ok) {
        clearLastReservation(slug); // Rev12: 取り消した予約の番号は再表示しない
        setCancelled(true);
      } else {
        window.alert('取り消せませんでした（すでに受取済みの可能性があります）。');
      }
    } catch (e) {
      // 🔴 Rev84（班E 重要2）: タイムアウトは再試行で通ることが多い。取り消し自体は
      //   status を cancelled にするだけで何度実行しても同じ結果＝押し直して安全。
      window.alert(
        isTimeoutError(e)
          ? '通信が混み合って応答がありません。少し待ってからもう一度お試しください。'
          : '取り消しに失敗しました。',
      );
    } finally {
      setCancelling(false);
    }
  };

  // ── 読み込み中／エラー ─────────────────────────────────
  if (load === 'loading') {
    return <Centered><div className="spinner" aria-label="読み込み中" /></Centered>;
  }
  if (load === 'notfound') {
    return (
      <Centered>
        <div className="card narrow">
          <div className="brand">🎫 取り置き予約</div>
          <p className="muted">このURLの取り置きページは見つかりませんでした。</p>
          <p className="muted small">URLが正しいかご確認ください。サークルが公開を取り下げた可能性もあります。</p>
          <SiteFooter />
        </div>
      </Centered>
    );
  }
  if (load === 'error' || !page) {
    return (
      <Centered>
        <div className="card narrow">
          <div className="brand">🎫 取り置き予約</div>
          <p className="muted">読み込みに失敗しました。通信状況をご確認のうえ、再度お試しください。</p>
          {/* 🔴 Rev84（班E 重要2）: 再試行導線。会場回線では「時間を置けば通る」失敗が普通に起きる。 */}
          <button className="btn-primary" onClick={retryLoad}>再読み込み</button>
          <SiteFooter />
        </div>
      </Centered>
    );
  }

  // ── 予約完了画面（受取番号） ───────────────────────────
  if (result) {
    return (
      <div className="page">
        <div className="card">
          <div className="brand">🎫 取り置き完了</div>
          {cancelled ? (
            <div className="cancelled-box">この取り置きは取り消されました。</div>
          ) : (
            <>
              <p className="muted small">当日、ブースでこの受取番号をお伝えください。</p>
              <div className="pickup">
                <span className="pickup-label">受取番号</span>
                <span className="pickup-no">{result.pickup_no}</span>
              </div>
              <CircleHeader page={page} />
              <OshinagakiGallery urls={page.oshinagaki_urls} />
              <ul className="summary">
                {orderedItems.map((it) => (
                  <li key={it.key}>
                    <span className="s-name">{it.name}</span>
                    <span className="s-qty">×{it.qty}</span>
                    <span className="s-price">{yen(it.price * it.qty)}</span>
                  </li>
                ))}
              </ul>
              <div className="total-row">
                <span>合計</span>
                <span className="total-amount">{yen(orderedTotal)}</span>
              </div>
              {/* 🔴 Rev83（V-6 / P-8・ユーザー決定 2026-08-02＝「当日はレジの現在価格で会計する」）:
                  取り置きは金額を固定しない＝サークル側が公開後に価格や税設定を変えれば、当日の
                  請求額はここの表示と変わる。仕様としてそう決めた以上、**買い手に先に伝えておく**
                  （黙って違う額を請求すると、その場で「話が違う」になる）。 */}
              <p className="muted small">※ 当日は会場での価格・税設定でお会計します。上の金額と変わる場合があります。</p>
              {/* 0113: 自分が送った備考の控え。サークル側の見え方と揃えるためではなく、
                  **買い手が「ちゃんと伝わったか」を確かめられるようにする**ため
                  （この画面以外に確認する手段が無い＝ログインも履歴も無い）。 */}
              {orderedNote ? (
                <>
                  <p className="muted small" style={{ marginBottom: 4 }}>お送りした備考</p>
                  <div className="mynote-box">{orderedNote}</div>
                </>
              ) : null}
              {page.note ? <div className="note-box">{page.note}</div> : null}
              {/* 🔴 Rev84（班E 注意6）: TTL 超過でも消さずに注記だけ添える（消すと復旧不能・注記は可逆）。 */}
              {restoredStale && (
                <p className="warn-box">
                  ⚠️ この受取番号は保存から時間が経っています。別のイベントのものかもしれませんので、
                  当日ブースでご確認ください。
                </p>
              )}
              <p className="warn-box">
                ⚠️ 同じ端末・ブラウザでこのページを開き直すと受取番号を再表示できます。
                別の端末で見る場合に備えて、スクリーンショットの保存もおすすめします。
              </p>
              {/* 🔴 Rev84（班E 要確認8）: 端末IDを保存できない環境（プライベートブラウズ等）は、
                  ページを開き直した時点で取り消しができなくなる。無反応にせず先に伝える。 */}
              {!idPersisted && (
                <p className="warn-box">
                  ⚠️ このブラウザでは予約情報を保存できません（プライベートブラウズ等）。
                  このページを閉じると受取番号の再表示と取り消しができなくなります。
                  必ずスクリーンショットを保存し、取り消しが必要な場合は当日ブースでお申し出ください。
                </p>
              )}

              {/* とれはんっ！連携（項目3）: 予約したサークルの頒布物を、買い手向けアプリ「とれはんっ！」の
                  自分のお品書きリストにそのまま登録できる導線。ディープリンク torehan://reserve?slug=… で起動し、
                  未インストールの場合の案内（ポータル）も併記する。 */}
              <TorehanCta slug={slug} rno={result.pickup_no} orderedItems={orderedItems} />

              <button className="btn-ghost" onClick={onCancel} disabled={cancelling}>
                {cancelling ? '取り消し中…' : 'この取り置きを取り消す'}
              </button>
            </>
          )}
          <SiteFooter />
        </div>
      </div>
    );
  }

  // ── 予約フォーム ───────────────────────────────────────
  return (
    <div className="page">
      <div className="card">
        <div className="brand">🎫 取り置き予約</div>
        <CircleHeader page={page} />
        <OshinagakiGallery urls={page.oshinagaki_urls} />

        {page.note ? <div className="note-box">{page.note}</div> : null}

        {/* Rev88（O-10）: 端末時計が定刻を過ぎているときの注意書き。**閉じない**＝送信はできる。 */}
        {pastCloseAtByDeviceClock && (
          <div className="note-box">
            受付終了の予定時刻を過ぎています。まだ予約できる場合もありますので、そのままお進みください
            （受け付けられないときは送信後にお知らせします）。
          </div>
        )}

        {closed ? (
          <div className="closed-box">現在、取り置きの受付は締め切られています。</div>
        ) : items.length === 0 ? (
          <p className="muted">公開されている品物がありません。</p>
        ) : (
          <>
            <ul className="items">
              {items.map((it) => {
                const n = qty[it.key] ?? 0;
                const max = itemMaxQty(it);
                const limitTag = it.limitPerPerson != null && it.limitPerPerson > 0
                  ? `（お一人様${it.limitPerPerson}点まで）` : null;
                // 頒布上限（maxQty）は表示しない（在庫数を買い手に見せない・Rev10）。ステッパーの上限制御は max で維持
                // 🔴 Rev86（ラウンド17・重要 I-4／migration 0064(B)）: maxQty は**サーバーからも来なくなった**
                //   （`get_reservation_page` が items から落とす）。表示しないだけでは DevTools から読めていた。
                //   `max`（= itemMaxQty）は limitPerPerson だけで決まるので、ここの挙動は変わらない。
                return (
                  <li key={it.key} className="item">
                    <div className="item-main">
                      <span className="item-name">{it.name}</span>
                      <span className="item-price">{yen(it.price)}</span>
                    </div>
                    {limitTag && (
                      <div className="item-limits">
                        <span className="limit-tag">{limitTag}</span>
                      </div>
                    )}
                    <div className="stepper">
                      <button
                        className="step-btn"
                        aria-label={`${it.name} を減らす`}
                        onClick={() => setItemQty(it.key, n - 1)}
                        disabled={n <= 0 || contentLocked}
                      >
                        −
                      </button>
                      <span className="step-n">{n}</span>
                      <button
                        className="step-btn"
                        aria-label={`${it.name} を増やす`}
                        onClick={() => setItemQty(it.key, n + 1)}
                        disabled={n >= max || contentLocked}
                      >
                        ＋
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="total-row">
              <span>合計</span>
              <span className="total-amount">{yen(total)}</span>
            </div>
            {/* 🔴 Rev83（V-6 / P-8）: 完了画面と同じ注記を**予約する前**にも出す。
                後から知らされるより、申し込む時点で分かっている方がトラブルにならない。 */}
            <p className="muted small">※ 当日は会場での価格・税設定でお会計します。上の金額と変わる場合があります。</p>

            {/* 🔴 Rev88（O-3）: 送信結果が不明なあいだは内容を触らせない。理由を書かないと「壊れている」と見える。 */}
            {contentLocked && (
              <p className="muted small">
                ※ 送信結果の確認中のため、内容は変更できません。そのまま「取り置きを予約する」を押し直してください
                （二重に予約されることはありません）。内容を変えたいときは、予約が確定してから取り消して取り直してください。
              </p>
            )}

            <label className="field">
              <span className="field-label">ニックネーム（任意）</span>
              <input
                className="input"
                type="text"
                value={nickname}
                maxLength={40}
                placeholder="例: とれはん太郎"
                onChange={(e) => setNickname(e.target.value)}
                disabled={contentLocked}
              />
            </label>
            <p className="muted small">
              ※ お名前・連絡先などは取得しません。受け渡しは当日の受取番号で行います。
            </p>

            {/* 0113: 買い手からの備考（任意）。サークル側（レジさぽっ！アプリ）の予約一覧に表示される。
                🔴 `disabled={contentLocked}` は Rev88（O-3）と同じ理由＝送信結果が不明な間に書き換えると、
                   冪等キーで返ってきた1回目の予約（＝古い備考）と手元の控えが食い違う。
                🔴 Rev156: `SHOW_BUYER_NOTE` が false のあいだは**欄ごと出さない**
                   （理由と解除条件は定義側の docblock）。 */}
            {SHOW_BUYER_NOTE && (
              <>
                <label className="field">
                  <span className="field-label">備考（任意）</span>
                  <textarea
                    className="input textarea"
                    value={buyerNote}
                    maxLength={NOTE_MAX_LEN}
                    rows={3}
                    placeholder="例: 15時ごろに伺います／お釣りのないようにお持ちします"
                    onChange={(e) => setBuyerNote(e.target.value)}
                    disabled={contentLocked}
                  />
                </label>
                <span className="field-count">{buyerNote.length} / {NOTE_MAX_LEN}</span>
                <p className="muted small">
                  ※ 受け渡しに関するご要望などがあればご記入ください。サークルの方に表示されます。
                  個人情報（お名前・連絡先・住所など）は書かないでください。
                </p>
              </>
            )}

            {page.has_password && (
              <label className="field">
                <span className="field-label">パスワード</span>
                <input
                  className="input"
                  type="password"
                  value={password}
                  placeholder="パスワードを入力"
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={contentLocked}
                />
              </label>
            )}

            {submitError ? <div className="error-box">{submitError}</div> : null}

            <button className="btn-primary" onClick={onSubmit} disabled={submitting}>
              {submitting ? '送信中…' : '取り置きを予約する'}
            </button>
          </>
        )}
        <SiteFooter />
      </div>
    </div>
  );
}

// とれはんっ！起動 CTA（項目3）。予約完了画面の下部に置く。
// ディープリンク（torehan://reserve?slug=…）は <a href> で開く＝モバイルのカスタムスキーム起動が最も確実。
// アプリ未導入の人向けに、ポータル（rurifukuro.github.io/torehan/）への案内リンクも併記する。
const TOREHAN_PORTAL = 'https://rurifukuro.github.io/torehan/';
function TorehanCta({ slug, rno, orderedItems }: { slug: string; rno: number; orderedItems: ReservedItem[] }) {
  // items= は key:qty のカンマ区切り（例: pA:2,bB:1）。とれはんっ！側で予約個数を反映する。
  const itemsParam = orderedItems.length > 0
    ? `&items=${encodeURIComponent(orderedItems.map((it) => `${it.key}:${it.qty}`).join(','))}`
    : '';
  const deepLink = `torehan://reserve?slug=${encodeURIComponent(slug)}&rno=${rno}${itemsParam}`;
  const [showFallback, setShowFallback] = useState(false);

  // <a href> によるカスタムスキーム遷移はそのまま走らせる（preventDefault しない＝モバイルで最も確実）。
  // アプリが起動すればブラウザはバックグラウンド（visibilityState='hidden'）になる。
  // 一定時間後もページが前面（'visible'）のままなら未起動の可能性が高いので、入手導線を出して
  // 「ボタンを押しても無反応で行き止まり」を防ぐ。起動できた人には誤って出さない（visible 判定で抑制）。
  const onTryOpen = () => {
    setShowFallback(false);
    window.setTimeout(() => {
      if (document.visibilityState === 'visible') setShowFallback(true);
    }, 1800);
  };

  return (
    <div className="torehan-cta">
      <div className="torehan-cta-title">📲 とれはんっ！に頒布物を登録</div>
      <p className="torehan-cta-text">
        「とれはんっ！」は買い手向けの無料お品書き管理アプリ。
        いま予約したこのサークルの頒布物を、そのままあなたのリストへ登録できます。
        当日の買い回り・予算管理・サークルの場所メモに便利です。
        <br />
        <span className="torehan-cta-note">※ アプリをインストール済みの方は下のボタンで開けます。</span>
      </p>
      <a className="btn-primary btn-as-link" href={deepLink} onClick={onTryOpen}>
        とれはんっ！で開く
      </a>
      {showFallback ? (
        <div className="torehan-cta-fallback">
          <p className="torehan-cta-fallback-text">
            アプリが開きませんでしたか？ まだインストールされていない場合は、こちらから入手できます。
          </p>
          <a className="btn-primary btn-as-link" href={TOREHAN_PORTAL} target="_blank" rel="noreferrer">
            とれはんっ！を入手する
          </a>
        </div>
      ) : null}
      <a className="torehan-install" href={TOREHAN_PORTAL} target="_blank" rel="noreferrer">
        アプリをお持ちでない方・「とれはんっ！」とは？ →
      </a>
    </div>
  );
}

function CircleHeader({ page }: { page: ReservationPage }) {
  const sub = [page.author_name, page.space].filter(Boolean).join(' ／ ');
  return (
    <div className="circle">
      <div className="circle-name">{page.circle_name || 'サークル'}</div>
      {sub ? <div className="circle-sub">{sub}</div> : null}
    </div>
  );
}

function OshinagakiGallery({ urls }: { urls: string[] }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  if (urls.length === 0) return null;
  return (
    <>
      <div className="oshi-gallery">
        {urls.map((url, i) => (
          <img key={i} src={url} alt={`お品書き ${i + 1}`} className="oshi-thumb" onClick={() => setLightboxIdx(i)} />
        ))}
      </div>
      {lightboxIdx !== null && (
        <div className="oshi-lightbox" onClick={() => setLightboxIdx(null)}>
          <button className="oshi-lightbox-close" onClick={() => setLightboxIdx(null)}>×</button>
          {urls.length > 1 && (
            <>
              <button
                className="oshi-lightbox-nav prev"
                onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx - 1 + urls.length) % urls.length); }}
              >‹</button>
              <button
                className="oshi-lightbox-nav next"
                onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx + 1) % urls.length); }}
              >›</button>
            </>
          )}
          <img src={urls[lightboxIdx]} alt={`お品書き ${lightboxIdx + 1}`} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="page center">{children}</div>;
}
