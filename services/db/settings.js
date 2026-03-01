/**
 * Settings-lager — hämtar DB-lagrade inställningar
 *
 * Används av backend-tjänster (alerter, framtida PWA-generator etc.)
 * Cachas i minnet med TTL för att inte belasta DB.
 */

import pool from './connection.js';

const cache = new Map();
const CACHE_TTL = 60_000; // 1 minut

/**
 * Hämta alla inställningar för en kategori.
 * Returnerar { key: value } objekt.
 */
export async function getSettings(category) {
  const cacheKey = `cat:${category}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const [rows] = await pool.execute(
    'SELECT setting_key, setting_value FROM hub_settings WHERE category = ? ORDER BY sort_order',
    [category]
  );

  const result = {};
  for (const row of rows) {
    result[row.setting_key] = row.setting_value;
  }

  cache.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

/**
 * Hämta en enskild inställning.
 */
export async function getSetting(category, key) {
  const settings = await getSettings(category);
  return settings[key] ?? null;
}

/**
 * Invalidera cache för en kategori (anropas efter PUT).
 */
export function invalidateSettingsCache(category) {
  if (category) {
    cache.delete(`cat:${category}`);
  } else {
    cache.clear();
  }
}
