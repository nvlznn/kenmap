import { clearCookie, json, SESSION_COOKIE } from '../_lib/session.js';

/** POST only, so a link or an image on another site cannot sign anyone out. */
export async function POST() {
  return json({ signedIn: false }, { cookies: [clearCookie(SESSION_COOKIE)] });
}
