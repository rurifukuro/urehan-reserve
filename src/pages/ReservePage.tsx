import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ReservationPage, ReservedItem, CreateReservationResult, PageItem } from '../lib/types';
import { getReservationPage, createReservation, cancelReservation } from '../lib/api';
import { getInstallId } from '../lib/installId';
import { yen } from '../lib/format';

type Load = 'loading' | 'loaded' | 'notfound' | 'error';

export function ReservePage() {
  const { slug = '' } = useParams();
  const [installId] = useState(() => getInstallId());

  const [load, setLoad] = useState<Load>('loading');
  const [page, setPage] = useState<ReservationPage | null>(null);

  const [qty, setQty] = useState<Record<string, number>>({});
  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateReservationResult | null>(null);
  const [orderedItems, setOrderedItems] = useState<ReservedItem[]>([]); // 確定した予約内容（結果表示用）
  const [cancelled, setCancelled] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [password, setPassword] = useState('');

  useEffect(() => {
    let alive = true;
    setLoad('loading');
    getReservationPage(slug)
      .then((p) => {
        if (!alive) return;
        if (!p) { setLoad('notfound'); return; }
        setPage(p);
        setLoad('loaded');
      })
      .catch(() => { if (alive) setLoad('error'); });
    return () => { alive = false; };
  }, [slug]);

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
      const r = await createReservation(slug, nickname.trim(), installId, selected, password || undefined);
      setOrderedItems(selected);
      setResult(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('password_required') || msg.includes('password_mismatch')) {
        setSubmitError('パスワードが正しくありません。');
      } else if (msg.includes('item_limit_per_person_exceeded')) {
        setSubmitError('一部の品物が一人当たりの限数を超えています。');
      } else if (msg.includes('item_max_qty_exceeded')) {
        setSubmitError('一部の品物が予約頒布上限に達しました。');
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
      if (ok) setCancelled(true);
      else window.alert('取り消せませんでした（すでに受取済みの可能性があります）。');
    } catch {
      window.alert('取り消しに失敗しました。');
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
                <span className="total-amount">{yen(total)}</span>
              </div>
              {page.note ? <div className="note-box">{page.note}</div> : null}
              <p className="warn-box">
                ⚠️ 受取番号はこの画面にしか表示されません。スクリーンショットの保存を強くおすすめします。
              </p>

              {/* とれはんっ！連携（項目3）: 予約したサークルの頒布物を、買い手向けアプリ「とれはんっ！」の
                  自分のお品書きリストにそのまま登録できる導線。ディープリンク torehan://reserve?slug=… で起動し、
                  未インストールの場合の案内（ポータル）も併記する。 */}
              <TorehanCta slug={slug} rno={result.pickup_no} />

              <button className="btn-ghost" onClick={onCancel} disabled={cancelling}>
                {cancelling ? '取り消し中…' : 'この取り置きを取り消す'}
              </button>
            </>
          )}
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
                const maxTag = it.maxQty != null && it.maxQty > 0
                  ? `（頒布上限 ${it.maxQty}点）` : null;
                return (
                  <li key={it.key} className="item">
                    <div className="item-main">
                      <span className="item-name">{it.name}</span>
                      <span className="item-price">{yen(it.price)}</span>
                    </div>
                    {(limitTag || maxTag) && (
                      <div className="item-limits">
                        {limitTag && <span className="limit-tag">{limitTag}</span>}
                        {maxTag && <span className="limit-tag">{maxTag}</span>}
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
      </div>
    </div>
  );
}

// とれはんっ！起動 CTA（項目3）。予約完了画面の下部に置く。
// ディープリンク（torehan://reserve?slug=…）は <a href> で開く＝モバイルのカスタムスキーム起動が最も確実。
// アプリ未導入の人向けに、ポータル（rurifukuro.github.io/torehan/）への案内リンクも併記する。
const TOREHAN_PORTAL = 'https://rurifukuro.github.io/torehan/';
function TorehanCta({ slug, rno }: { slug: string; rno: number }) {
  const deepLink = `torehan://reserve?slug=${encodeURIComponent(slug)}&rno=${rno}`;
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

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="page center">{children}</div>;
}
