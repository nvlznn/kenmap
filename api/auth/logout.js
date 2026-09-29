import { clearCookie, cookie, json, PICK_ACCOUNT_COOKIE, SESSION_COOKIE } from '../_lib/session.js';

/**
 * POST only, so a link or an image on another site cannot sign anyone out.
 * Signing out here does not sign anyone out of GitHub, so the next sign-in
 * would go straight back to the same account; the marker cookie makes that
 * next sign-in ask which account to use instead.
 */
export async function POST() {
  return json({ signedIn: false }, { cookies: [clearCookie(SESSION_COOKIE), cookie(PICK_ACCOUNT_COOKIE, '1', 24 * 60 * 60)] });
}
