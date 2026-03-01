/**
 * Västtrafik API-klient — OAuth2 + Planera Resa v4
 *
 * Hanterar token-förnyelse, avgångshämtning, hållplatssökning
 * och in-memory-cache för att minimera API-anrop.
 */

import { getProject } from '../projects/index.js';
import { getSettings } from '../db/settings.js';

// --- Token-hantering ---

let token = null;     // { accessToken, expiresAt }

/**
 * Hämta giltig OAuth2-token (förnyar automatiskt)
 */
export async function getToken() {
  // Förnya om token saknas eller går ut inom 5 min
  if (token && token.expiresAt > Date.now() + 5 * 60_000) {
    return token.accessToken;
  }

  const settings = await getSettings('vasttrafik');
  const clientId = settings?.client_id;
  const clientSecret = settings?.client_secret;

  if (!clientId || !clientSecret) {
    throw new Error('Client ID/Secret saknas — konfigurera under Inställningar → Västtrafik');
  }

  const config = getProject('vasttrafik');
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(config.api.tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`  [VASTTRAFIK] Token ${res.status}: ${text}`);
    throw new Error(`Token-förfrågan misslyckades: ${res.status} ${text}`);
  }

  const data = await res.json();
  token = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };

  console.log('  [VASTTRAFIK] Ny OAuth2-token hämtad');
  return token.accessToken;
}

// --- Global rate-limit backoff ---

let rateLimitUntil = 0;  // Timestamp — inga API-anrop före detta

function isRateLimited() {
  return Date.now() < rateLimitUntil;
}

function setRateLimitCooldown() {
  rateLimitUntil = Date.now() + 2 * 60_000;  // 2 min cooldown
  console.warn('  [VASTTRAFIK] Rate limit — pausar alla anrop i 2 min');
}

// --- Response-cache ---

const cache = new Map();  // Map<stopAreaGid, { data, fetchedAt }>
const searchCache = new Map();  // Map<query, { data, fetchedAt }>
const journeyCache = new Map();  // Map<key, { data, fetchedAt }>
const SEARCH_TTL = 5 * 60_000;  // 5 min
const JOURNEY_TTL = 60_000;     // 60 s

/**
 * Hämta cachad avgångsdata (triggar INTE nytt API-anrop)
 */
export function getCachedDepartures(stopAreaGid) {
  const entry = cache.get(stopAreaGid);
  if (!entry) return null;

  const config = getProject('vasttrafik');
  const ttl = config.api.cacheTtlMs || 60_000;
  if (Date.now() - entry.fetchedAt > ttl * 2) return null; // Utdaterad

  return entry.data;
}

/**
 * Hämta hela cachen (för engine)
 */
export function getDepartureCache() {
  return cache;
}

// --- API-anrop ---

/**
 * Hämta avgångar för en hållplats (cache-first, uppdaterar cache)
 */
export async function fetchDepartures(stopAreaGid) {
  const config = getProject('vasttrafik');
  const ttl = config.api.cacheTtlMs || 60_000;

  // Cache-first: returnera direkt om datan är färsk
  const cached = cache.get(stopAreaGid);
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached.data;
  }

  // Avbryt om vi är i rate-limit-cooldown
  if (isRateLimited()) {
    return getCachedDepartures(stopAreaGid);
  }

  const accessToken = await getToken();
  const url = `${config.api.baseUrl}/stop-areas/${stopAreaGid}/departures?limit=20&timeSpanInMinutes=60`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (res.status === 429) {
    setRateLimitCooldown();
    return getCachedDepartures(stopAreaGid);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Departures-anrop misslyckades: ${res.status} ${text}`);
  }

  const data = await res.json();

  // Uppdatera cache
  cache.set(stopAreaGid, { data, fetchedAt: Date.now() });

  return data;
}

/**
 * Hämta journey details — alla hållplatser längs sträckan med tider
 */
export async function fetchJourneyDetails(stopAreaGid, detailsReference) {
  // Cache-first
  const cacheKey = `${stopAreaGid}:${detailsReference}`;
  const cached = journeyCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < JOURNEY_TTL) {
    return cached.data;
  }

  if (isRateLimited()) {
    if (cached) return cached.data;
    throw new Error('Rate limit — försök igen om en stund');
  }

  const config = getProject('vasttrafik');
  const accessToken = await getToken();

  const url = `${config.api.baseUrl}/stop-areas/${stopAreaGid}/departures/${encodeURIComponent(detailsReference)}/details?includes=servicejourneycalls`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (res.status === 429) {
    setRateLimitCooldown();
    if (cached) return cached.data;
    throw new Error('Rate limit — försök igen om en stund');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Journey details misslyckades: ${res.status} ${text}`);
  }

  const data = await res.json();
  journeyCache.set(cacheKey, { data, fetchedAt: Date.now() });
  return data;
}

/**
 * Sök hållplatser via namn (cachad 5 min)
 */
export async function searchStops(query) {
  const key = query.toLowerCase().trim();

  // Cache-first
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < SEARCH_TTL) {
    return cached.data;
  }

  if (isRateLimited()) {
    if (cached) return cached.data;
    return [];
  }

  const config = getProject('vasttrafik');
  const accessToken = await getToken();

  const url = `${config.api.baseUrl}/locations/by-text?q=${encodeURIComponent(query)}&limit=10&types=stoparea`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (res.status === 429) {
    setRateLimitCooldown();
    if (cached) return cached.data;
    return [];
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Sökning misslyckades: ${res.status} ${text}`);
  }

  const data = await res.json();
  const results = data.results || [];
  searchCache.set(key, { data: results, fetchedAt: Date.now() });

  // Begränsa search-cachens storlek
  if (searchCache.size > 100) {
    const oldest = searchCache.keys().next().value;
    searchCache.delete(oldest);
  }

  return results;
}

/**
 * Testa API-anslutningen (returnerar status)
 */
export async function testConnection() {
  try {
    const accessToken = await getToken();
    const config = getProject('vasttrafik');

    // Testa med en enkel sökning
    const res = await fetch(`${config.api.baseUrl}/locations/by-text?q=brunnsparken&limit=1`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    return {
      ok: res.ok,
      status: res.status,
      tokenValid: !!accessToken,
      message: res.ok ? 'API-anslutning fungerar' : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      tokenValid: false,
      message: err.message,
    };
  }
}
