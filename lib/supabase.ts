import { createBrowserClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client.
 * - Uses the public anon key — safe to expose in the browser
 * - Respects Row Level Security (RLS) policies
 * - Use this in Client Components and client-side hooks
 *
 * Example:
 *   const supabase = createSupabaseBrowserClient();
 *   const { data, error } = await supabase.from("price_ranges").select("*");
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
