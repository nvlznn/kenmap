import { clearCookie, cookie, env, PICK_ACCOUNT_COOKIE, readCookie, redirect, STATE_COOKIE } from '../_lib/session.js';

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

  const cookies = [cookie(STATE_COOKIE, state, 10 * 60)];
  // Right after a sign-out, let the user pick an account: GitHub otherwise
  // reuses whichever one it is signed in as, with no way to switch.
  if (readCookie(request, PICK_ACCOUNT_COOKIE)) {
    authorize.searchParams.set('prompt', 'select_account');
    cookies.push(clearCookie(PICK_ACCOUNT_COOKIE));
  }
  return redirect(authorize.href, { cookies });
}
