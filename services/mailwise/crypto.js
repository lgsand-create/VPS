/**
 * Token-kryptering — AES-256-GCM för OAuth2-tokens
 *
 * Krypterar refresh_token och access_token innan de sparas i DB.
 * Nyckeln auto-genereras vid första användning och sparas i hub_settings.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { getSetting } from '../db/settings.js';
import pool from '../db/connection.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

let cachedKey = null;

/**
 * Hämta krypteringsnyckel (genererar automatiskt om den saknas)
 */
export async function getEncryptionKey() {
  if (cachedKey) return cachedKey;

  const stored = await getSetting('mailwise', 'encrypt_key');

  if (stored && stored !== '****') {
    cachedKey = Buffer.from(stored, 'hex');
    return cachedKey;
  }

  // Generera ny nyckel
  const newKey = randomBytes(32);
  const hex = newKey.toString('hex');

  // Kolla om raden redan finns (INSERT IGNORE)
  const [existing] = await pool.execute(
    `SELECT id FROM hub_settings WHERE category = 'mailwise' AND setting_key = 'encrypt_key'`
  );

  if (existing.length > 0) {
    await pool.execute(
      `UPDATE hub_settings SET setting_value = ? WHERE category = 'mailwise' AND setting_key = 'encrypt_key'`,
      [hex]
    );
  } else {
    await pool.execute(
      `INSERT INTO hub_settings (category, setting_key, setting_value, value_type, label, description, sort_order)
       VALUES ('mailwise', 'encrypt_key', ?, 'password', 'Krypteringsnyckel', 'AES-256-nyckel (autogenererad)', 99)`,
      [hex]
    );
  }

  cachedKey = newKey;
  console.log('  [MAILWISE] Krypteringsnyckel genererad');
  return cachedKey;
}

/**
 * Kryptera klartext → base64-sträng
 * Format: base64(iv[16] + authTag[16] + ciphertext)
 */
export function encrypt(plaintext, keyBuffer) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // iv + authTag + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Dekryptera base64-sträng → klartext
 */
export function decrypt(encryptedBase64, keyBuffer) {
  const combined = Buffer.from(encryptedBase64, 'base64');

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Kryptera token (convenience — hämtar nyckel automatiskt)
 */
export async function encryptToken(plaintext) {
  if (!plaintext) return null;
  const key = await getEncryptionKey();
  return encrypt(plaintext, key);
}

/**
 * Dekryptera token (convenience — hämtar nyckel automatiskt)
 */
export async function decryptToken(encryptedBase64) {
  if (!encryptedBase64) return null;
  const key = await getEncryptionKey();
  return decrypt(encryptedBase64, key);
}

/**
 * Rensa cachad nyckel (vid test eller nyckelrotation)
 */
export function clearKeyCache() {
  cachedKey = null;
}
