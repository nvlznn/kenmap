import { env, getSession, json } from './_lib/session.js';

/**
 * Who is signed in. Always 200, so the page reads one shape either way. The
 * app's slug comes along because the "connect a repository" link needs it,
 * and the page should not hard-code which GitHub App it belongs to.
 */
export async function GET(request) {
  const appSlug = env().GITHUB_APP_SLUG;
  const { session, setCookie } = await getSession(request);
  if (!session) return json({ signedIn: false, appSlug }, { cookies: [setCookie] });
  return json({ signedIn: true, login: session.login, avatar: session.avatar, appSlug }, { cookies: [setCookie] });
}
