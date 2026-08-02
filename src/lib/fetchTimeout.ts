/** fetchTimeout.ts — 通信タイムアウト（ルール NET-TIMEOUT・買い手Web版）
 *
 *  🔴 Rev84（批判的チェック ラウンド16・班E 重要2／FIX-SPREAD）:
 *    本体アプリ側（`urehan/src/utils/fetchTimeout.ts` ＋ `services/sync/supabaseClient.ts`）には
 *    2026-07-31 に NET-TIMEOUT を入れたが、**買い手が使うこの Web には入れ忘れていた**。
 *    supabase-js は既定でタイムアウトを持たない＝応答が返るまで永久に待つ。
 *    圏外なら OS が即エラーを返すので気づけるが、危ないのは**繋がっているのに返ってこない**状態で、
 *    数千人が同じ基地局にぶら下がる即売会の会場回線ではこれが常態になる。
 *    このとき取り置きページは
 *      ・読み込み → `load === 'loading'` のまま**スピナーが永久に回る**
 *      ・送信 → `submitting` が下りず「送信中…」で固まる
 *    となり、買い手はブースの前で「予約できたのか分からない」まま放置される。
 *
 *  本体側との違い:
 *    この Web は Supabase Storage を使わない（お品書き画像は公開URLを <img> で読むだけで
 *    supabase-js を通らない）ため、パスごとに上限を変える必要が無く単一の上限でよい。
 *    値は本体の PostgREST/RPC と同じ 15 秒に揃える（同じ回線・同じ RPC を叩くので分ける理由が無い）。
 */

/** タイムアウト由来のエラーに付ける Error.name。判定はこの文字列で行う（instanceof に依存しない）。 */
export const TIMEOUT_ERROR_NAME = 'TimeoutError';

/** RPC の制限時間。本体アプリの REST_TIMEOUT_MS と同値。 */
export const RPC_TIMEOUT_MS = 15_000;

/** 制限時間を超えて応答が無かったことを表すエラー。
 *  ⚠ メッセージは**利用者に見せる文言ではない**（ERR-TYPED）。表示は呼び出し側が
 *    `isTimeoutError()` で判定して日本語文を出す。 */
export class TimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`TIMEOUT: no response within ${timeoutMs}ms`);
    this.name = TIMEOUT_ERROR_NAME;
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/** そのエラーが「タイムアウト」かどうか（オフライン・サーバーエラーと区別する）。
 *  supabase-js は throw されたエラーを `{ error: { message } }` に載せ替えて返すので、
 *  message の前方一致でも拾えるようにしておく。 */
export function isTimeoutError(e: unknown): boolean {
  if (e instanceof TimeoutError) return true;
  if (typeof e !== 'object' || e === null) return false;
  const o = e as { name?: unknown; message?: unknown };
  if (o.name === TIMEOUT_ERROR_NAME) return true;
  return typeof o.message === 'string' && o.message.startsWith('TIMEOUT:');
}

/** `fetch` の第1引数から URL 文字列を取り出す（string / URL / Request のどれで来ても拾う）。 */
function urlOfRequest(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url ?? '';
}

/** `fetch` と同じシグネチャで、制限時間つきの fetch を作る（supabase-js の `global.fetch` へ注入する用）。
 *
 *  - `AbortController` の signal を実際に fetch へ渡す＝タイムアウト後に裏で通信が生き続けない。
 *  - 制限時間を超えたときだけ TimeoutError に**置き換えて**投げる。
 *    fetch 自身が投げたエラー（オフライン等）はそのまま素通しする＝原因を握り潰さない。 */
export function timeoutFetch(ms: number = RPC_TIMEOUT_MS): typeof fetch {
  return (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
    const [input, init] = args;
    const ctrl = new AbortController();
    let timedOut = false;

    const external = init?.signal ?? null;
    const onExternalAbort = (): void => ctrl.abort();
    if (external) {
      if (external.aborted) ctrl.abort();
      else external.addEventListener('abort', onExternalAbort);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, ms);

    // urlOfRequest は将来パス別の上限を入れるときのフック（現状は単一上限なので参照だけ）。
    void urlOfRequest(input);

    return fetch(input, { ...(init ?? {}), signal: ctrl.signal })
      .catch((e: unknown) => {
        if (timedOut) throw new TimeoutError(ms);
        throw e;
      })
      .finally(() => {
        clearTimeout(timer);
        if (external) external.removeEventListener('abort', onExternalAbort);
      });
  };
}
