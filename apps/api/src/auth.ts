export const SB = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
/** Supabase mode needs all three vars; otherwise the API runs in single-user dev mode (userId "local"). */
export const supabaseEnabled = !!(SB && ANON && SVC);
export type AuthUser = { userId: string; jwt: string };
const cache = new Map<string, { at: number; u: AuthUser }>();
/** Verifies a Supabase access token against GoTrue (60s cache). Returns null if invalid. */
export async function authenticate(token?: string): Promise<AuthUser | null> {
  if (!supabaseEnabled) return { userId: 'local', jwt: '' };
  if (!token) return null;
  const hit = cache.get(token); if (hit && Date.now() - hit.at < 60_000) return hit.u;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON!, Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!r?.ok) return null;
  const u = { userId: ((await r.json()) as any).id as string, jwt: token };
  if (cache.size > 1000) cache.clear(); cache.set(token, { at: Date.now(), u }); return u;
}
