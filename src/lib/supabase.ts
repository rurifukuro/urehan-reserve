import { createClient } from '@supabase/supabase-js';
import { timeoutFetch } from './fetchTimeout';

// URL / anon(publishable) キーは公開安全値（RLS 前提）。未設定でも画面は出すが RPC は失敗する。
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const hasSupabaseConfig = !!(supabaseUrl && supabaseAnonKey);

if (!hasSupabaseConfig) {
  console.error(
    '[urehan-reserve] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定です。' +
      '.env.example をコピーして .env を作成してください。',
  );
}

// 匿名モデル＝Auth セッションを持たない（取り置きページは slug + RPC だけで成立する）。
export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder',
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // 🔴 Rev84（ラウンド16・班E 重要2／NET-TIMEOUT）: supabase-js は既定でタイムアウトを持たない。
    //   会場回線の「繋がっているのに返ってこない」状態で、読み込みスピナーと「送信中…」が
    //   永久に固まる。ここに1回差し込めば、この Web の全 RPC が制限時間つきになる
    //   （呼び出し側ごとの書き漏れが原理的に起きない）。本体アプリ側と同じ設計。
    global: { fetch: timeoutFetch() },
  },
);
