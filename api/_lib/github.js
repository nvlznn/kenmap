// GitHub calls made on behalf of a signed-in user. Everything goes through
// the user's own GitHub App token, so a user only ever sees the repos they
// installed the app on — GitHub enforces that, not this code.

export const API = 'https://api.github.com';
export const DATA_BRANCH = 'kenmap-data';

/** owner/name, each part in GitHub's own character set, and never "." or "..". */
export function validRepo(fullName) {
  if (typeof fullName !== 'string') return false;
  const match = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(fullName);
  return Boolean(match) && match[2] !== '.' && match[2] !== '..';
}

export function gh(token, path, { accept = 'application/vnd.github+json' } = {}) {
  return fetch(API + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kenmap',
    },
  });
}

/**
 * The report the skill publishes to the data branch. Read through the
 * contents API rather than raw.githubusercontent: it takes the user's token,
 * so private repos work, and it is not cached by branch name.
 * Returns null when the repo has no published report yet.
 */
export async function readReport(token, fullName) {
  const res = await gh(token, `/repos/${fullName}/contents/report.json?ref=${DATA_BRANCH}`,
    { accept: 'application/vnd.github.raw+json' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub said ${res.status} for ${fullName}`);
  return res.json();
}

/**
 * Exchanges an OAuth code, or a refresh token, for a user token. GitHub App
 * user tokens expire after eight hours unless the app turned expiry off, in
 * which case there is no expires_in and no refresh token.
 */
export async function requestToken(params, env) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'kenmap' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error || !body.access_token) {
    throw new Error(`token exchange failed: ${body.error_description || body.error || res.status}`);
  }
  return body;
}

/** The token part of a session, from GitHub's token response. */
export function tokenFields(body, now = Date.now()) {
  return {
    token: body.access_token,
    refresh: body.refresh_token ?? null,
    expiresAt: body.expires_in ? now + body.expires_in * 1000 : null,
  };
}

/** Pages through a list endpoint that wraps its items under `key`. */
export async function listAll(token, path, key) {
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const res = await gh(token, `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`GitHub said ${res.status} for ${path}`);
    const batch = (await res.json())[key] ?? [];
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}
