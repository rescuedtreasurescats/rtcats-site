// Cloudflare Pages middleware. Configure these as encrypted Pages secrets:
// SITE_GATE_API_URL, SITE_GATE_TOKEN, SITE_SESSION_SECRET.
const COOKIE = 'rtcats_site_session';
const SESSION_SECONDS = 14 * 24 * 60 * 60;
const encoder = new TextEncoder();

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (!env.SITE_GATE_API_URL || !env.SITE_GATE_TOKEN || !env.SITE_SESSION_SECRET) return unavailable();

  const identity = await readCookie(request.headers.get('Cookie') || '', env.SITE_SESSION_SECRET);
  const state = await backend(env, { action: 'status', ...identity });
  if (!state || state.error || typeof state.required !== 'boolean') return unavailable();
  const allowed = !state.required || (identity && state.allowed === true);

  if (url.pathname === '/_emergency') {
    if (!allowed) return unauthorized();
    return new Response(JSON.stringify({ name: state.emergencyName, phone: state.emergencyPhone }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' }
    });
  }
  if (url.pathname === '/_logout') {
    return new Response(null, { status: 303, headers: {
      Location: '/', 'Cache-Control': 'no-store',
      'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
    } });
  }
  if (url.pathname === '/_request_code' && request.method === 'POST' && state.required) {
    const form = await request.formData().catch(() => null);
    const email = String(form?.get('email') || '').trim().toLowerCase().slice(0, 254);
    const destination = safeDestination(form?.get('next'));
    if (!validEmail(email)) return loginPage('Enter a valid email address.', destination);
    const result = await backend(env, { action: 'requestCode', email,
      ip: request.headers.get('CF-Connecting-IP') || 'unknown' });
    if (!result || result.error) return unavailable();
    return codePage(email, destination, '');
  }
  if (url.pathname === '/_verify_code' && request.method === 'POST' && state.required) {
    const form = await request.formData().catch(() => null);
    const email = String(form?.get('email') || '').trim().toLowerCase().slice(0, 254);
    const code = String(form?.get('code') || '').trim();
    const destination = safeDestination(form?.get('next'));
    if (!validEmail(email) || !/^\d{8}$/.test(code)) return codePage(email, destination, 'Check the eight-digit code.');
    const result = await backend(env, { action: 'verifyCode', email, code });
    if (!result || result.error) return unavailable();
    if (!result.valid) return codePage(email, destination, 'Code expired or incorrect. Request a new one if needed.');
    const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const payload = base64url(JSON.stringify({ email: result.email, volunteerId: result.volunteerId, expires }));
    const signature = await sign(payload, env.SITE_SESSION_SECRET);
    return new Response(null, { status: 303, headers: {
      Location: destination, 'Cache-Control': 'no-store',
      'Set-Cookie': `${COOKIE}=${payload}.${signature}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`
    } });
  }
  if (!allowed) {
    if (request.method !== 'GET' || !request.headers.get('Accept')?.includes('text/html')) return unauthorized();
    return loginPage('', safeDestination(url.pathname + url.search));
  }
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function backend(env, body) {
  try {
    const response = await fetch(env.SITE_GATE_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, token: env.SITE_GATE_TOKEN }),
      redirect: 'follow', signal: AbortSignal.timeout(10000)
    });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
async function readCookie(header, secret) {
  const value = header.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!value || value.length > 1024) return null;
  const parts = value.split('.');
  if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1])) return null;
  const expected = await sign(parts[0], secret);
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= expected.charCodeAt(i) ^ parts[1].charCodeAt(i);
  if (difference) return null;
  try {
    const parsed = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    if (!validEmail(parsed.email) || typeof parsed.volunteerId !== 'string' ||
        !/^[\w-]{1,64}$/.test(parsed.volunteerId) ||
        !Number.isInteger(parsed.expires) || parsed.expires <= Date.now() / 1000) return null;
    return { email: parsed.email, volunteerId: parsed.volunteerId };
  } catch { return null; }
}
function base64url(value) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function safeDestination(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') &&
    !value.startsWith('/_') && value.length < 2048 ? value : '/';
}
function unavailable() {
  return new Response('The volunteer site is temporarily unavailable. Please try again shortly.', {
    status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
function unauthorized() {
  return new Response('Sign in to view this page.', { status: 401, headers: { 'Cache-Control': 'no-store' } });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function page(content) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Volunteer access · RTCats</title><style>
    *{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;background:#f4f7f7;color:#1e293b;font:16px/1.5 system-ui,sans-serif;padding:1rem}
    main{width:min(100%,26rem);background:white;padding:2rem;border-radius:1rem;box-shadow:0 12px 32px #163b3d22}
    h1{font-size:1.5rem;margin:0 0 .5rem}p{margin:.5rem 0 1.25rem}label{display:block;font-weight:600;margin-bottom:.4rem}
    input,button{width:100%;font:inherit;border-radius:.6rem;padding:.8rem}input{border:1px solid #94a3b8}button{border:0;background:#087d80;color:white;font-weight:700;margin-top:1rem;cursor:pointer}
    .error{color:#a11515;font-weight:600}a{color:#087d80}
    </style></head><body><main><h1>RTCats volunteer access</h1>${content}</main></body></html>`, {
    status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
function loginPage(message, destination) {
  return page(`<p>Enter the email address on your volunteer record. We will email you a sign-in code.</p>
    ${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ''}
    <form action="/_request_code" method="post"><input type="hidden" name="next" value="${escapeHtml(destination)}">
    <label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required autofocus>
    <button type="submit">Email me a code</button></form>`);
}
function codePage(email, destination, message) {
  return page(`<p>If that address is active on the volunteer roster, a code is on its way. It expires in 10 minutes.</p>
    ${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ''}
    <form action="/_verify_code" method="post"><input type="hidden" name="next" value="${escapeHtml(destination)}">
    <input type="hidden" name="email" value="${escapeHtml(email)}">
    <label for="code">Eight-digit code</label><input id="code" name="code" inputmode="numeric" pattern="[0-9]{8}" autocomplete="one-time-code" required autofocus>
    <button type="submit">Sign in</button></form>
    <p><a href="/">Use a different email address</a></p>`);
}
