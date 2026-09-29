import { gh, requestToken, tokenFields } from '../_lib/github.js';
import { clearCookie, env, readCookie, redirect, sessionCookie, STATE_COOKIE } from '../_lib/session.js';

/** GitHub sends the browser back here with a code; trade it for a session. */
export async function GET(request, { now = Date.now() } = {}) {
  const config = env();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = readCookie(request, STATE_COOKIE);
  const clearState = clearCookie(STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) {
    return redirect('/?error=login', { cookies: [clearState] });
  }

  try {
    const tokens = tokenFields(await requestToken({ code, redirect_uri: `${url.origin}/api/auth/callback` }, config), now);
    const res = await gh(tokens.token, '/user');
    if (!res.ok) throw new Error(`GitHub said ${res.status} for /user`);
    const user = await res.json();
    const session = { ...tokens, login: user.login, avatar: user.avatar_url };
    return redirect('/', { cookies: [clearState, await sessionCookie(session, config.SESSION_SECRET)] });
  } catch {
    return redirect('/?error=login', { cookies: [clearState] });
  }
}
