import { listAll, readReport } from './_lib/github.js';
import { getSession, json } from './_lib/session.js';

/** One row of the repo list: enough to show a score without the whole report. */
export function summarize(repo, report) {
  const base = { fullName: repo.full_name, private: repo.private };
  if (!report) return { ...base, hasData: false };
  return {
    ...base,
    hasData: true,
    total: report.anyScored ? report.total : null,
    scoredModules: report.modules.filter((m) => m.scored).length,
    modules: report.modules.length,
    generatedAt: report.generatedAt ?? null,
  };
}

/**
 * The repos this user connected, which is to say the repos the GitHub App is
 * installed on and this user can see. That list lives on GitHub, so there is
 * nothing to store here. Each repo's score is read from its data branch.
 */
export async function GET(request) {
  const { session, setCookie } = await getSession(request);
  if (!session) return json({ error: 'sign in first' }, { status: 401, cookies: [setCookie] });

  try {
    const installations = await listAll(session.token, '/user/installations', 'installations');
    const lists = await Promise.all(installations.map((i) =>
      listAll(session.token, `/user/installations/${i.id}/repositories`, 'repositories')));
    const unique = new Map(lists.flat().map((r) => [r.full_name, r]));
    const repos = await Promise.all([...unique.values()].map(async (repo) => {
      try {
        return summarize(repo, await readReport(session.token, repo.full_name));
      } catch {
        return { ...summarize(repo, null), unreadable: true };
      }
    }));
    repos.sort((a, b) => Number(b.hasData) - Number(a.hasData) || a.fullName.localeCompare(b.fullName));
    return json({
      repos,
      installations: installations.map((i) => ({ account: i.account?.login, manage: i.html_url })),
    }, { cookies: [setCookie] });
  } catch (err) {
    return json({ error: err.message }, { status: 502, cookies: [setCookie] });
  }
}
