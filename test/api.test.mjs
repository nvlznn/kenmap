import assert from 'node:assert/strict';
import test from 'node:test';
import { validRepo } from '../api/_lib/github.js';
import { getSession, PICK_ACCOUNT_COOKIE, seal, SESSION_COOKIE, STATE_COOKIE, unseal } from '../api/_lib/session.js';
import { GET as callback } from '../api/auth/callback.js';
import { GET as login } from '../api/auth/login.js';
import { POST as logout } from '../api/auth/logout.js';
import { GET as me } from '../api/me.js';
import { GET as repos } from '../api/repos.js';
import { GET as report } from '../api/report.js';

const SECRET = 'test-secret-that-is-long-enough-to-matter';
Object.assign(process.env, {
  GITHUB_CLIENT_ID: 'Iv1.test', GITHUB_CLIENT_SECRET: 'shh', GITHUB_APP_SLUG: 'kenmap-test', SESSION_SECRET: SECRET,
});

const SITE = 'https://kenmap.example';
const request = (path, cookies = {}) => new Request(SITE + path, {
  headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') },
});
const setCookies = (res) => res.headers.getSetCookie();
const cookieValue = (res, name) => {
  const line = setCookies(res).find((c) => c.startsWith(`${name}=`));
  return line && decodeURIComponent(line.slice(name.length + 1).split(';')[0]);
};
const signedIn = async (session = {}) => ({
  [SESSION_COOKIE]: await seal({ token: 'ghu_live', refresh: 'ghr_1', expiresAt: null, login: 'ino', avatar: 'a.png', ...session }, SECRET),
});

/** Replaces fetch with a router over "METHOD path" keys; unknown calls fail the test. */
function mockGitHub(t, routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const { pathname, search } = new URL(url);
    const key = `${init.method ?? 'GET'} ${pathname}${search}`;
    calls.push({ key, init });
    const route = Object.entries(routes).find(([pattern]) => key.startsWith(pattern));
    if (!route) throw new Error(`unexpected fetch: ${key}`);
    const [status, body] = typeof route[1] === 'function' ? route[1](init) : route[1];
    return new Response(body === null ? null : JSON.stringify(body), { status });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

const sampleReport = (overrides = {}) => ({
  name: 'habits', total: 0.5, anyScored: true, generatedAt: '2026-09-30T00:00:00Z',
  modules: [{ id: 'ui', scored: true }, { id: 'data', scored: false }], ...overrides,
});

test('a sealed session opens again, and a cookie changed by one character does not', async () => {
  const sealed = await seal({ token: 'ghu_x', login: 'ino' }, SECRET);
  assert.deepEqual(await unseal(sealed, SECRET), { token: 'ghu_x', login: 'ino' });
  const flipped = sealed.slice(0, -2) + (sealed.at(-2) === 'A' ? 'B' : 'A') + sealed.at(-1);
  assert.equal(await unseal(flipped, SECRET), null);
  assert.equal(await unseal(sealed, 'a different secret'), null);
  assert.equal(await unseal('garbage', SECRET), null);
});

test('a tampered session cookie counts as signed out, and is cleared', async () => {
  const cookies = await signedIn();
  cookies[SESSION_COOKIE] = cookies[SESSION_COOKIE].replace(/.$/, (c) => (c === 'x' ? 'y' : 'x'));
  const { session, setCookie } = await getSession(request('/api/me', cookies));
  assert.equal(session, null);
  assert.match(setCookie, /^kenmap_session=; .*Max-Age=0/);
});

test('sign-in sends the browser to GitHub with a state it also remembers in a cookie', async () => {
  const res = await login(request('/api/auth/login'));
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('location'));
  assert.equal(to.origin + to.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(to.searchParams.get('client_id'), 'Iv1.test');
  assert.equal(to.searchParams.get('redirect_uri'), `${SITE}/api/auth/callback`);
  assert.equal(to.searchParams.get('state'), cookieValue(res, STATE_COOKIE));
  assert.match(setCookies(res)[0], /HttpOnly; Secure; SameSite=Lax/);
});

test('after signing out, the next sign-in asks GitHub to show its account picker, once', async () => {
  const out = await logout();
  assert.equal(cookieValue(out, SESSION_COOKIE), '', 'the session is cleared');
  assert.equal(cookieValue(out, PICK_ACCOUNT_COOKIE), '1');

  const next = await login(request('/api/auth/login', { [PICK_ACCOUNT_COOKIE]: '1' }));
  assert.equal(new URL(next.headers.get('location')).searchParams.get('prompt'), 'select_account');
  assert.equal(cookieValue(next, PICK_ACCOUNT_COOKIE), '', 'the marker is used up');

  const plain = await login(request('/api/auth/login'));
  assert.equal(new URL(plain.headers.get('location')).searchParams.get('prompt'), null,
    'an ordinary sign-in goes straight through');
});

test('a callback whose state does not match the cookie is refused before GitHub is asked anything', async (t) => {
  const calls = mockGitHub(t, {});
  const res = await callback(request('/api/auth/callback?code=c&state=forged', { [STATE_COOKIE]: 'real' }));
  assert.equal(res.headers.get('location'), '/?error=login');
  assert.equal(cookieValue(res, SESSION_COOKIE), undefined, 'no session is set');
  assert.equal(calls.length, 0);
});

test('a good callback trades the code for a session that holds the token, never shown to the page', async (t) => {
  mockGitHub(t, {
    'POST /login/oauth/access_token': [200, { access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800 }],
    'GET /user': [200, { login: 'ino', avatar_url: 'https://avatars/ino.png' }],
  });
  const now = Date.parse('2026-09-30T00:00:00Z');
  const res = await callback(request('/api/auth/callback?code=c&state=s', { [STATE_COOKIE]: 's' }), { now });
  assert.equal(res.headers.get('location'), '/');
  const session = await unseal(cookieValue(res, SESSION_COOKIE), SECRET);
  assert.deepEqual(session, {
    token: 'ghu_new', refresh: 'ghr_new', expiresAt: now + 28800 * 1000, login: 'ino', avatar: 'https://avatars/ino.png',
  });
  assert.match(cookieValue(res, STATE_COOKIE), /^$/, 'the one-time state is cleared');
});

test('a token about to expire is refreshed, and the new session goes back in the cookie', async (t) => {
  const calls = mockGitHub(t, {
    'POST /login/oauth/access_token': [200, { access_token: 'ghu_fresh', refresh_token: 'ghr_2', expires_in: 28800 }],
  });
  const now = Date.now();
  const cookies = await signedIn({ token: 'ghu_old', expiresAt: now + 60 * 1000 });
  const { session, setCookie } = await getSession(request('/api/me', cookies), { now });
  assert.equal(session.token, 'ghu_fresh');
  assert.equal(session.login, 'ino', 'who you are survives the refresh');
  assert.equal(JSON.parse(calls[0].init.body).refresh_token, 'ghr_1');
  assert.ok(setCookie.startsWith(`${SESSION_COOKIE}=`));
});

test('when the refresh token is dead too, the user is simply signed out', async (t) => {
  mockGitHub(t, { 'POST /login/oauth/access_token': [200, { error: 'bad_refresh_token' }] });
  const now = Date.now();
  const { session, setCookie } = await getSession(request('/api/me', await signedIn({ expiresAt: now - 1 })), { now });
  assert.equal(session, null);
  assert.match(setCookie, /Max-Age=0/);
});

test('/api/me tells the page who is signed in and which app to install', async () => {
  const out = await (await me(request('/api/me'))).json();
  assert.deepEqual(out, { signedIn: false, appSlug: 'kenmap-test' });
  const inside = await (await me(request('/api/me', await signedIn()))).json();
  assert.deepEqual(inside, { signedIn: true, login: 'ino', avatar: 'a.png', appSlug: 'kenmap-test' });
});

test('/api/repos lists every repo the app is installed on, with scores where a report was published', async (t) => {
  mockGitHub(t, {
    'GET /user/installations/1/repositories': [200, { repositories: [
      { full_name: 'ino/habits', private: false }, { full_name: 'ino/secret', private: true }] }],
    'GET /user/installations/2/repositories': [200, { repositories: [{ full_name: 'org/app', private: true }] }],
    'GET /user/installations': [200, { installations: [
      { id: 1, account: { login: 'ino' }, html_url: 'https://github.com/settings/installations/1' },
      { id: 2, account: { login: 'org' }, html_url: 'https://github.com/organizations/org/settings/installations/2' }] }],
    'GET /repos/ino/habits/contents/report.json?ref=kenmap-data': [200, sampleReport()],
    'GET /repos/org/app/contents/report.json?ref=kenmap-data': [200, sampleReport({ anyScored: false, total: 0 })],
    'GET /repos/ino/secret/contents/report.json?ref=kenmap-data': [404, { message: 'Not Found' }],
  });
  const res = await repos(request('/api/repos', await signedIn()));
  const body = await res.json();
  assert.deepEqual(body.repos, [
    { fullName: 'ino/habits', private: false, hasData: true, total: 0.5, scoredModules: 1, modules: 2, generatedAt: '2026-09-30T00:00:00Z' },
    { fullName: 'org/app', private: true, hasData: true, total: null, scoredModules: 1, modules: 2, generatedAt: '2026-09-30T00:00:00Z' },
    { fullName: 'ino/secret', private: true, hasData: false },
  ]);
  assert.deepEqual(body.installations.map((i) => i.account), ['ino', 'org']);
});

test('/api/repos needs a session', async () => {
  assert.equal((await repos(request('/api/repos'))).status, 401);
});

test('/api/report reads with the user token, so a private repo works', async (t) => {
  const calls = mockGitHub(t, { 'GET /repos/ino/secret/contents/report.json?ref=kenmap-data': [200, sampleReport()] });
  const res = await report(request('/api/report?repo=ino/secret', await signedIn()));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).repo, 'ino/secret');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ghu_live');
});

test('/api/report refuses anything that is not owner/name before touching GitHub', async (t) => {
  const calls = mockGitHub(t, {});
  const cookies = await signedIn();
  for (const bad of ['ino', 'ino/habits/extra', 'ino/..', '../etc', 'ino/habits?ref=main', '']) {
    const res = await report(request(`/api/report?repo=${encodeURIComponent(bad)}`, cookies));
    assert.equal(res.status, 400, bad);
  }
  assert.equal(calls.length, 0);
  assert.ok(validRepo('nokyhq/habits') && validRepo('a-b/c.d_e'));
});

test('/api/report says so when a repo has never been published', async (t) => {
  mockGitHub(t, { 'GET /repos/ino/new/contents/report.json?ref=kenmap-data': [404, { message: 'Not Found' }] });
  const res = await report(request('/api/report?repo=ino/new', await signedIn()));
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /no published report/);
});
