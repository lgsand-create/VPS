// Dashboard-autentisering — enkel sessionsbaserad inloggning
//
// Skyddar /api/system/* med cookie-baserade sessioner.
// Inga extra beroenden — använder Node.js inbyggda crypto.

import { randomBytes, timingSafeEqual } from 'crypto';

const sessions = new Map();
const SESSION_COOKIE = 'hub_session';
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 timmar

// Rensa utgångna sessioner varje timme
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.created > SESSION_TTL) sessions.delete(token);
  }
}, 60 * 60 * 1000);

// Parsa cookies från header (undviker cookie-parser-beroende)
function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return cookies;
}

// Timing-safe string comparison (skyddar mot timing-attacker)
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Kontrollera om request har giltig session
function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token || !sessions.has(token)) return false;
  const session = sessions.get(token);
  if (Date.now() - session.created > SESSION_TTL) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// Middleware: kräv inloggning (returnerar 401 om ej inloggad)
export function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'Ej inloggad' });
}

// POST /api/auth/login
export function login(req, res) {
  const { username, password } = req.body || {};
  const expectedUser = process.env.DASHBOARD_USER;
  const expectedPass = process.env.DASHBOARD_PASSWORD;

  if (!expectedUser || !expectedPass) {
    return res.status(503).json({
      error: 'Dashboard-inloggning ej konfigurerad (DASHBOARD_USER/DASHBOARD_PASSWORD saknas i .env)',
    });
  }

  if (!safeEqual(username || '', expectedUser) || !safeEqual(password || '', expectedPass)) {
    return res.status(401).json({ error: 'Fel användarnamn eller lösenord' });
  }

  const token = randomBytes(32).toString('hex');
  sessions.set(token, { created: Date.now(), user: username });

  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}`
  );
  res.json({ ok: true, user: username });
}

// POST /api/auth/logout
export function logout(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);

  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
  res.json({ ok: true });
}

// GET /api/auth/status
export function authStatus(req, res) {
  if (isAuthenticated(req)) {
    const cookies = parseCookies(req.headers.cookie);
    const session = sessions.get(cookies[SESSION_COOKIE]);
    return res.json({ authenticated: true, user: session.user });
  }
  res.json({ authenticated: false });
}
