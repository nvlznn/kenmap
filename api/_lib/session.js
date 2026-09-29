// The session is the GitHub token itself, sealed with AES-GCM into an
// HttpOnly cookie. No database: the cookie is the only place it lives, the
// page's JavaScript can never read it, and a cookie that fails to decrypt
// (tampered, or sealed under an old secret) simply means "not signed in".

import { requestToken, tokenFields } from './github.js';

export const SESSION_COOKIE = 'kenmap_session';
export const STATE_COOKIE = 'kenmap_state';
/** Set on sign-out, so the next sign-in shows GitHub's account picker. */
export const PICK_ACCOUNT_COOKIE = 'kenmap_pick_account';
const SESSION_DAYS = 30;
/** Refresh a little before GitHub's own expiry, so a request never races it. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function env() {
  const missing = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_SLUG', 'SESSION_SECRET']
    .filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`missing environment variables: ${missing.join(', ')}`);
  return process.env;
}

async function key(secret) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const toBase64Url = (bytes) => Buffer.from(bytes).toString('base64url');
const fromBase64Url = (text) => new Uint8Array(Buffer.from(text, 'base64url'));

export async function seal(data, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), encoder.encode(JSON.stringify(data)));
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`;
}

export async function unseal(value, secret) {
  try {
    const [iv, body] = value.split('.');
    const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, await key(secret), fromBase64Url(body));
    return JSON.parse(decoder.decode(opened));
  } catch {
    return null;
  }
}

export function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return null;
}

export function cookie(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export const clearCookie = (name) => cookie(name, '', 0);

export async function sessionCookie(session, secret) {
  return cookie(SESSION_COOKIE, await seal(session, secret), SESSION_DAYS * 24 * 60 * 60);
}

/**
 * The signed-in user, or null. When the token is about to expire it is
 * refreshed here, and `setCookie` carries the new session back to the
 * browser; the caller must attach it to whatever it responds with.
 */
export async function getSession(request, { now = Date.now() } = {}) {
  const config = env();
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw) return { session: null, setCookie: null };
  const session = await unseal(raw, config.SESSION_SECRET);
  if (!session?.token) return { session: null, setCookie: clearCookie(SESSION_COOKIE) };
  if (!session.expiresAt || session.expiresAt - now > REFRESH_MARGIN_MS) return { session, setCookie: null };
  if (!session.refresh) return { session: null, setCookie: clearCookie(SESSION_COOKIE) };

  try {
    const body = await requestToken({ grant_type: 'refresh_token', refresh_token: session.refresh }, config);
    const renewed = { ...session, ...tokenFields(body, now) };
    return { session: renewed, setCookie: await sessionCookie(renewed, config.SESSION_SECRET) };
  } catch {
    // The refresh token itself expired or was revoked: sign in again.
    return { session: null, setCookie: clearCookie(SESSION_COOKIE) };
  }
}

export function json(data, { status = 200, cookies = [] } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' });
  for (const c of cookies.filter(Boolean)) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(data), { status, headers });
}

export function redirect(location, { cookies = [] } = {}) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies.filter(Boolean)) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}
