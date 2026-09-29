import { cookie, env, redirect, STATE_COOKIE } from '../_lib/session.js';

/**
 * Sends the browser to GitHub to sign in. The random state rides along in a
 * short-lived cookie, so the callback can tell a sign-in this browser started
 * from one somebody else started and tricked it into finishing.
 */
export async function GET(request) {
  const config = env();
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
  const origin = new URL(request.url).origin;
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', config.GITHUB_CLIENT_ID);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('redirect_uri', `${origin}/api/auth/callback`);
  return redirect(authorize.href, { cookies: [cookie(STATE_COOKIE, state, 10 * 60)] });
}
