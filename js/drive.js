// Google Drive sync.
//
// The whole notebook is one file, Fieldnotes/fieldnotes.json, in the user's Drive. The
// app asks only for the drive.file permission, so it can see the files it created and
// nothing else in Drive.
//
// Sign-in is Google's browser-only OAuth redirect: the page goes to accounts.google.com
// and comes back with a short-lived access token (about an hour) in the URL fragment.
// No server, no client secret. When the token runs out the app asks Google again with
// prompt=none, which returns straight away without any screen while the user is still
// signed in to Google. A full redirect is used instead of a popup because popups are
// unreliable in an iPhone home-screen app.
//
// Each sync reads the Drive copy, three-way merges it with this device's copy (see
// merge.js; the common ancestor is the copy from the last sync, kept in localStorage),
// adopts the result here if it changed, and writes it back if Drive is behind.

import * as S from './store.js';
import { merge3, same } from './merge.js';

const CLIENT_ID = '1092984219044-3e26kl0oje84j0p3f4utvorhughfut1o.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FILE = 'fieldnotes.json';
const FOLDER = 'Fieldnotes';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

const K = {
  token: 'fieldnotes.token',   // { token, exp }
  link: 'fieldnotes.drive',    // { fileId, email, last, silentFail }  present = sync is on
  base: 'fieldnotes.base',     // JSON of the document at the last successful sync
  oauth: 'fieldnotes.oauth',   // sessionStorage, during the redirect: { nonce, back, silent }
};

const AUTO_SIGNIN_AFTER = 20 * 3600e3;   // quietly re-sign-in on open if the last sync is older
const PULL_EVERY = 10 * 60e3;            // while open with a valid token
const PUSH_AFTER = 4e3;                  // after the last edit

const get = (k, store = localStorage) => { try { return JSON.parse(store.getItem(k)); } catch { return null; } };
const put = (k, v, store = localStorage) => { try { v == null ? store.removeItem(k) : store.setItem(k, JSON.stringify(v)); } catch {} };

export const sync = { state: 'off', error: '' };   // off | idle | busy | signin | error
const link = () => get(K.link);
const setLink = patch => put(K.link, { ...(link() || {}), ...patch });
export const connected = () => !!link();
export const lastSynced = () => link()?.last || null;

function token() {
  const t = get(K.token);
  return t && t.exp > Date.now() ? t.token : null;
}

function setState(state, error = '') {
  sync.state = state; sync.error = error;
  document.dispatchEvent(new CustomEvent('nb:sync'));
}

// ---- sign-in --------------------------------------------------------------------

const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

export function signIn({ silent = false, auto = false } = {}) {
  S.persistNow();
  const nonce = crypto.getRandomValues(new Uint32Array(2)).join('');
  put(K.oauth, { nonce, back: location.hash || '#/', silent, auto }, sessionStorage);
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri(), response_type: 'token',
    scope: SCOPE, include_granted_scopes: 'true', state: nonce,
  });
  if (silent) p.set('prompt', 'none');
  const email = link()?.email;
  if (email) p.set('login_hint', email);
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p);
}

// Call before the router reads location.hash. Returns a message for the user, if any.
export function takeRedirect() {
  const frag = location.hash.slice(1);
  if (!/(^|&)(access_token|error)=/.test(frag)) return null;
  const p = new URLSearchParams(frag);
  const pending = get(K.oauth, sessionStorage);
  put(K.oauth, null, sessionStorage);
  history.replaceState(null, '', location.pathname + location.search + (pending?.back || '#/'));
  if (!pending || p.get('state') !== pending.nonce) return null;

  if (p.get('access_token')) {
    const first = !connected();
    put(K.token, { token: p.get('access_token'), exp: Date.now() + (+p.get('expires_in') || 3600) * 1000 - 60e3 });
    setLink({ silentFail: null });
    return first ? 'connected' : null;
  }
  if (pending.silent) {          // signed out of Google, or a different account
    setLink({ silentFail: Date.now() });
    return pending.auto ? null : 'retry';   // the user tapped Sync: show Google's screen now
  }
  return p.get('error') === 'access_denied' ? 'denied' : 'failed';
}

export function disconnect() {
  const t = token();
  if (t) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }).catch(() => {});
  put(K.token, null); put(K.link, null); put(K.base, null);
  setState('off');
}

// ---- Drive calls ----------------------------------------------------------------

class AuthError extends Error {}

async function api(url, opts = {}) {
  const t = token();
  if (!t) throw new AuthError('signed out');
  const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  if (res.status === 401) { put(K.token, null); throw new AuthError('expired'); }
  return res;
}

async function jsonOrThrow(res, what) {
  if (res.ok) return res.json();
  let msg = res.status + '';
  try { msg = (await res.json()).error?.message || msg; } catch {}
  throw new Error(`${what}: ${msg}`);
}

async function find(q) {
  const u = `${API}/files?` + new URLSearchParams({ q: q + ' and trashed=false', orderBy: 'modifiedTime desc',
    fields: 'files(id)', pageSize: '1', spaces: 'drive' });
  return (await jsonOrThrow(await api(u), 'Drive search')).files[0]?.id || null;
}

async function readFile(id) {
  const res = await api(`${API}/files/${id}?alt=media`);
  if (res.status === 404) return undefined;     // deleted or trashed in Drive
  if (!res.ok) await jsonOrThrow(res, 'Drive read');
  return res.json();
}

async function createFile(body) {
  const folder = await find(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder'`)
    || (await jsonOrThrow(await api(`${API}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
    }), 'Drive folder')).id;
  const b = 'fieldnotes' + Date.now();
  const multipart = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
    + JSON.stringify({ name: FILE, parents: [folder], mimeType: 'application/json' })
    + `\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
  const res = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: multipart });
  return (await jsonOrThrow(res, 'Drive create')).id;
}

async function writeFile(id, body) {
  await jsonOrThrow(await api(`${UPLOAD}/files/${id}?uploadType=media&fields=id`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }), 'Drive save');
}

async function learnEmail() {
  try {
    const r = await jsonOrThrow(await api(`${API}/about?fields=user(emailAddress)`), 'about');
    if (r.user?.emailAddress) setLink({ email: r.user.emailAddress });
  } catch {}
}

// ---- sync -----------------------------------------------------------------------

let running = null, again = false, pushTimer = null;

// Redrawing while someone types would drop their cursor, so remote changes wait for that.
const typing = () => document.activeElement?.matches?.('input, textarea, [contenteditable="true"]');

export function syncNow() {
  if (running) { again = true; return running; }
  running = run().finally(() => {
    running = null;
    if (again) { again = false; syncNow(); }
  });
  return running;
}

async function run() {
  if (!connected()) return setState('off');
  if (!token()) return setState('signin');
  setState('busy');
  try {
    let id = link().fileId || await find(`name='${FILE}'`);
    let remote = id ? await readFile(id) : undefined;
    if (remote === undefined && id) { id = await find(`name='${FILE}'`); remote = id ? await readFile(id) : undefined; }
    if (remote !== undefined && !Array.isArray(remote?.collections)) throw new Error(`${FILE} in Drive isn't a notebook`);

    const baseText = localStorage.getItem(K.base);
    const base = baseText ? JSON.parse(baseText) : null;
    if (remote && !same(remote, base) && typing()) { setState('idle'); return schedule(8e3); }

    // From here to adopt() nothing awaits, so no keystroke can land in between.
    const local = S.data();
    let merged;
    if (!remote) merged = local;
    else if (!base) merged = local.pristine ? remote : merge3({}, local, remote);   // first sync on this device
    else merged = merge3(base, local, remote);
    merged = JSON.parse(JSON.stringify(merged));
    delete merged.pristine;
    const body = JSON.stringify(merged);

    if (!same(merged, local)) S.adopt(merged);
    if (!id) id = await createFile(body);
    else if (!same(merged, remote)) await writeFile(id, body);

    localStorage.setItem(K.base, body);
    setLink({ fileId: id, last: Date.now() });
    if (!link().email) learnEmail();
    setState('idle');
  } catch (e) {
    if (e instanceof AuthError) setState('signin');
    else { console.warn('Sync failed', e); setState('error', e.message || String(e)); }
  }
}

function schedule(ms) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { if (token()) syncNow(); }, ms);
}

// Wire up timers and events. Returns after kicking off the first sync (not awaiting it).
export function start() {
  document.addEventListener('nb:edited', () => { if (connected()) schedule(PUSH_AFTER); });
  document.addEventListener('visibilitychange', () => {
    if (!connected() || !token()) return;
    if (document.hidden) { if (S.status.dirty || pushTimer) syncNow(); }
    else if (Date.now() - (lastSynced() || 0) > 60e3) syncNow();
  });
  setInterval(() => { if (!document.hidden && connected() && token()) syncNow(); }, PULL_EVERY);

  if (!connected()) return setState('off');
  if (token()) return void syncNow();
  const l = link();
  const stale = Date.now() - (l.last || 0) > AUTO_SIGNIN_AFTER;
  const recentlyFailed = l.silentFail && Date.now() - l.silentFail < AUTO_SIGNIN_AFTER;
  if (stale && !recentlyFailed && navigator.onLine) return signIn({ silent: true, auto: true });
  setState('signin');
}

// Gear menu "Sync now": quiet re-sign-in first, a full Google screen if that already failed.
export function syncOrSignIn() {
  if (token()) return syncNow();
  const l = link() || {};
  signIn({ silent: !!l.email && !(l.silentFail && Date.now() - l.silentFail < AUTO_SIGNIN_AFTER) });
}
