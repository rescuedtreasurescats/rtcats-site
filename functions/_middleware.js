// Cloudflare Pages middleware: every page and asset passes this gate.
// Configure SITE_GATE_API_URL, SITE_GATE_TOKEN, and SITE_SESSION_SECRET as
// encrypted Cloudflare Pages production/preview secrets before deployment.

const COOKIE = 'rtcats_site_session';
const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (!env.SITE_GATE_API_URL || !env.SITE_GATE_TOKEN || !env.SITE_SESSION_SECRET) {
    return unavailable();
  }

  if (url.pathname === '/_unlock' && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    if (!form) return loginPage(false, 'Please try again.', '/');
    const pin = String(form.get('pin') || '').slice(0, 128);
    const destination = safeDestination(url.searchParams.get('next'));
    const result = await backend(env, {
      action: 'verify', pin,
      ip: request.headers.get('CF-Connecting-IP') || 'unknown'
    });
    if (!result) return unavailable();
    if (result.error === 'too_many_attempts') {
      return loginPage(true, 'Too many attempts. Please wait 15 minutes.', destination);
    }
    if (result.error) return unavailable();
    if (!result.valid) return loginPage(true, 'That PIN did not match. Please try again.', destination);
    const headers = new Headers({ Location: destination, 'Cache-Control': 'no-store' });
    if (result.required) {
      const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
      const payload = `${result.version}.${expires}`;
      const signature = await sign(payload, env.SITE_SESSION_SECRET);
      headers.set('Set-Cookie', `${COOKIE}=${payload}.${signature}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`);
    }
    return new Response(null, { status: 303, headers });
  }

  const state = await backend(env, { action: 'status' });
  if (!state || state.error || typeof state.required !== 'boolean' || !state.version) {
    return unavailable();
  }
  const authorized = !state.required ||
    await validCookie(request.headers.get('Cookie') || '', state.version, env.SITE_SESSION_SECRET);

  if (url.pathname === '/_emergency') {
    if (!authorized) return new Response('Unauthorized', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    return new Response(JSON.stringify({ name: state.emergencyName, phone: state.emergencyPhone }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' }
    });
  }

  if (!authorized) {
    if (request.method !== 'GET' || !request.headers.get('Accept')?.includes('text/html')) {
      return new Response('Unauthorized', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    return loginPage(true, '', safeDestination(url.pathname + url.search));
  }
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function backend(env, body) {
  try {
    const response = await fetch(env.SITE_GATE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, token: env.SITE_GATE_TOKEN }),
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function sign(text, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function validCookie(header, version, secret) {
  const encoded = header.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`));
  if (!encoded) return false;
  const parts = encoded.slice(COOKIE.length + 1).split('.');
  if (parts.length !== 3 || parts[0] !== version) return false;
  const expiry = Number(parts[1]);
  if (!Number.isInteger(expiry) || expiry <= Date.now() / 1000) return false;
  const expected = await sign(`${parts[0]}.${parts[1]}`, secret);
  return parts[2] === expected;
}

function safeDestination(value) {
  return value && value.startsWith('/') && !value.startsWith('//') &&
    !value.startsWith('/_unlock') && value.length < 2048 ? value : '/';
}

function unavailable() {
  return new Response('The volunteer site is temporarily unavailable. Please try again shortly.', {
    status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function loginPage(required, message, destination) {
  const action = `/_unlock?next=${encodeURIComponent(destination)}`;
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Volunteer access · RTCats</title><style>
    *{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;background:#f4f7f7;color:#1e293b;font:16px/1.5 system-ui,sans-serif;padding:1rem}
    main{width:min(100%,26rem);background:white;padding:2rem;border-radius:1rem;box-shadow:0 12px 32px #163b3d22}
    h1{font-size:1.5rem;margin:0 0 .5rem}p{margin:.5rem 0 1.25rem}label{display:block;font-weight:600;margin-bottom:.4rem}
    input,button{width:100%;font:inherit;border-radius:.6rem;padding:.8rem}input{border:1px solid #94a3b8}button{border:0;background:#087d80;color:white;font-weight:700;margin-top:1rem;cursor:pointer}
    .error{color:#a11515;font-weight:600}a{color:#087d80}
    </style></head><body><main><h1>RTCats volunteer access</h1><p>Enter the volunteer PIN to continue.</p>
    ${message ? `<p class="error" role="alert">${message}</p>` : ''}
    <form action="${action}" method="post"><label for="pin">Volunteer PIN</label><input id="pin" name="pin" type="password" autocomplete="off" required autofocus><button type="submit">Continue</button></form>
    </main></body></html>`;
  return new Response(body, { status: required ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
