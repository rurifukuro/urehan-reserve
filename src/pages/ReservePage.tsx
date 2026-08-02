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
  const [submitting, setSubmitting] = useState(false);
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

  // Rev3: 受付が締め切られているか。手動締切(is_open=false)に加え、自動〆切(close_at)の定刻を過ぎていたら終了。
  //   サーバーも create_reservation で同条件を弾く（migration 0020）。ここは押す前に受付終了を見せる表示用ガード。
  const closed = !!page && (!page.is_open || (page.close_at != null && Date.now() >= page.close_at));

  const itemMaxQty = (it: PageItem): number => {
    const limit = it.limitPerPerson;
    return (limit != null && limit > 0) ? limit : 99;
  };

  const setItemQty = (key: string, next: number) => {
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
      const r = await createReservation(slug, nickname.trim(), installId, selected, requestId, password || undefined);
      saveLastReservation(slug, r, selected); // Rev12: 再訪時に受取番号を再表示できるように保存
      setOrderedItems(selected);
      setResult(r);
      setRestoredStale(false);
      // 次の申し込みは別の予約なので冪等キーを作り直す（失敗時は作り直さない＝再送で同じ値が飛ぶ）。
      setRequestId(newRequestId());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isTimeoutError(e)) {
        // 🔴 Rev84（班E 重要2＋重要3）: タイムアウトは「送れなかった」とは限らず、
        //   サーバー側では通っている可能性がある。冪等キーがあるので押し直しても二重にならない
        //   ＝**もう一度押してよい**ことを明示する（黙って失敗表示だけ出すと諦めて帰る）。
        setSubmitError('通信が混み合って応答がありません。もう一度「取り置きを予約する」を押してください（二重に予約されることはありません）。');
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
        setSubmitError('予約の送信に失敗しました。通信状況をご確認ください。');
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
                        disabled={n <= 0}
                      >
                        −
                      </button>
                      <span className="step-n">{n}</span>
                      <button
                        className="step-btn"
                        aria-label={`${it.name} を増やす`}
                        onClick={() => setItemQty(it.key, n + 1)}
                        disabled={n >= max}
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

            <label className="field">
              <span className="field-label">ニックネーム（任意）</span>
              <input
                className="input"
                type="text"
                value={nickname}
                maxLength={40}
                placeholder="例: とれはん太郎"
                onChange={(e) => setNickname(e.target.value)}
              />
            </label>
            <p className="muted small">
              ※ お名前・連絡先などは取得しません。受け渡しは当日の受取番号で行います。
            </p>

            {page.has_password && (
              <label className="field">
                <span className="field-label">パスワード</span>
                <input
                  className="input"
                  type="password"
                  value={password}
                  placeholder="パスワードを入力"
                  onChange={(e) => setPassword(e.target.value)}
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
