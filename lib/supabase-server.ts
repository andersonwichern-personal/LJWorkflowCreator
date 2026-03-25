import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client.
 * - Uses the secret service role key — NEVER expose this in the browser
 * - Bypasses Row Level Security (RLS) — full database access
 * - Use this only in Server Components, API Route Handlers, and server actions
 *
 * Example:
 *   const supabase = createSupabaseServerClient();
 *   const { data, error } = await supabase.from("quotes").select("*");
 */
export function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Copy .env.local.example → .env.local and fill in your Supabase credentials."
    );
  }

  return createClient(url, key, {
    auth: {
      // Disable auto session management — this is a server-only client
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
