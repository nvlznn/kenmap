import { readReport, validRepo } from './_lib/github.js';
import { getSession, json } from './_lib/session.js';

/**
 * One repo's report, read with the signed-in user's token so private repos
 * work. Signed-out visitors get a 401 and the page reads public repos
 * straight from GitHub instead, so a README badge link works without an
 * account.
 */
export async function GET(request) {
  const repo = new URL(request.url).searchParams.get('repo');
  if (!validRepo(repo)) return json({ error: 'repo must look like owner/name' }, { status: 400 });
  const { session, setCookie } = await getSession(request);
  if (!session) return json({ error: 'sign in first' }, { status: 401, cookies: [setCookie] });

  try {
    const report = await readReport(session.token, repo);
    if (!report) {
      return json({ error: `no published report in ${repo} — run /comprehend there, then publish` },
        { status: 404, cookies: [setCookie] });
    }
    return json({ ...report, repo }, { cookies: [setCookie] });
  } catch (err) {
    return json({ error: err.message }, { status: 502, cookies: [setCookie] });
  }
}
