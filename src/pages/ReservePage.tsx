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
    const rank = (k: PageItem['kind']) => (k === 'bundle' ? 0 : 1);
    return [...raw].sort((a, b) => rank(a.kind) - rank(b.kind));
  }, [page]);

  const selected: ReservedItem[] = useMemo(
    () =>
      items
        .map((it) => ({ key: it.key, name: it.name, price: it.price, qty: qty[it.key] ?? 0 }))
        .filter((it) => it.qty > 0),
    [items, qty],
  );
  const total = useMemo(() => selected.reduce((s, it) => s + it.price * it.qty, 0), [selected]);

  const setItemQty = (key: string, next: number) => {
    setSubmitError(null);
    setQty((prev) => ({ ...prev, [key]: Math.max(0, Math.min(99, next)) }));
  };

  const onSubmit = async () => {
    if (!page) return;
    if (selected.length === 0) { setSubmitError('予約する品物を1つ以上選んでください。'); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await createReservation(slug, nickname.trim(), installId, selected);
      setOrderedItems(selected);
      setResult(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // サーバー側で締切後に押された等のメッセージを買い手向けに翻訳。
      if (msg.includes('reservations closed')) {
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
              <p className="muted small">
                ※ この番号はこの端末に保存されません。スクリーンショットの保存をおすすめします。
              </p>
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

        {!page.is_open ? (
          <div className="closed-box">現在、取り置きの受付は締め切られています。</div>
        ) : items.length === 0 ? (
          <p className="muted">公開されている品物がありません。</p>
        ) : (
          <>
            <ul className="items">
              {items.map((it) => {
                const n = qty[it.key] ?? 0;
                return (
                  <li key={it.key} className="item">
                    <div className="item-main">
                      <span className="item-name">{it.name}</span>
                      <span className="item-price">{yen(it.price)}</span>
                    </div>
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
