import { createClient } from '@supabase/supabase-js';

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
  },
);
