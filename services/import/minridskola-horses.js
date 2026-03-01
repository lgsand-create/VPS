/**
 * MinRidskola Hästindex — JSON → MariaDB Import
 *
 * Läser scrapad häst-JSON och upsertar till:
 *   - mrs_horses (utökad med alla fält)
 *   - mrs_horse_feed
 *   - mrs_horse_journals
 *   - mrs_horse_sick_leave
 *   - mrs_horse_shoeing
 *
 * Kör:
 *   node import/minridskola-horses.js latest    → Senaste hastar-filen
 *   node import/minridskola-horses.js <sökväg>  → Specifik fil
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import pool from '../db/connection.js';
import dotenv from 'dotenv';
dotenv.config();

const SERVICES_DIR = resolve(import.meta.dirname, '..');
const DATA_DIR = resolve(SERVICES_DIR, process.env.DATA_PATH || '../data/minridskola');

/**
 * Parsa datum-sträng, returnera giltig DATE eller null
 */
function parseDate(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  return str;
}

/**
 * Parsa numeriskt värde (med komma som decimal)
 */
function parseDecimal(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(',', '.'));
  return isNaN(n) ? null : n;
}

/**
 * Parsa år
 */
function parseYear(str) {
  if (!str) return null;
  const n = parseInt(str, 10);
  return (n > 1900 && n < 2100) ? n : null;
}

/**
 * Mappa "Ridhast"/"Ponny" från radioknapp till databasvärde
 */
function normalizeTyp(typ) {
  if (!typ) return null;
  if (typ.toLowerCase().includes('ponny')) return 'Ponny';
  if (typ.toLowerCase().includes('rid') || typ.toLowerCase().includes('häst')) return 'Ridhast';
  return typ;
}

/**
 * Normalisera ponnykategori (select-text → kort värde)
 */
function normalizePonnykategori(text) {
  if (!text || text === '---' || text === '-- Inget --') return null;
  return text.trim();
}

// --- Import ---

async function importFile(filepath) {
  const filename = filepath.split(/[/\\]/).pop();
  console.log(`\n  Importerar: ${filename}`);

  const raw = readFileSync(filepath, 'utf-8');
  const data = JSON.parse(raw);

  if (!data.hastar || !Array.isArray(data.hastar)) {
    console.log('  Inget hastar-array — hoppar över.');
    return { records: 0 };
  }

  const conn = await pool.getConnection();
  let logId;

  try {
    const [logResult] = await conn.execute(
      'INSERT INTO scrape_log (scraper, status, json_file, project) VALUES (?, ?, ?, ?)',
      ['hastar', 'running', filename, 'minridskola']
    );
    logId = logResult.insertId;
  } catch {
    console.log('  (Kunde inte logga — kör npm run migrate först)');
  }

  let imported = 0;
  let errors = 0;

  try {
    for (const h of data.hastar) {
      if (h._error) {
        errors++;
        continue;
      }

      try {
        await importHorse(conn, h);
        imported++;
      } catch (err) {
        console.log(`    FEL (${h.hnummer}) ${h.namn}: ${err.message}`);
        errors++;
      }
    }

    if (logId) {
      await conn.execute(
        'UPDATE scrape_log SET status = ?, finished_at = NOW(), records = ? WHERE id = ?',
        ['success', imported, logId]
      );
    }

    console.log(`  Resultat: ${imported} hästar importerade, ${errors} fel`);
    return { records: imported };

  } catch (err) {
    if (logId) {
      await conn.execute(
        'UPDATE scrape_log SET status = ?, finished_at = NOW(), error_message = ? WHERE id = ?',
        ['failed', err.message, logId]
      ).catch(() => {});
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function importHorse(conn, h) {
  const hnummer = h.hnummer;
  const namn = h.namn || '';

  // Upsert mrs_horses — matcha på hnummer (unikt), eller namn (unikt)
  // Kolla om hästen redan finns via hnummer
  const [existing] = await conn.execute(
    'SELECT id FROM mrs_horses WHERE hnummer = ?',
    [hnummer]
  );

  let horseId;

  if (existing.length > 0) {
    horseId = existing[0].id;
    // Uppdatera alla fält
    await conn.execute(`
      UPDATE mrs_horses SET
        namn = ?, typ = ?, kon = ?, fodelsear = ?, ras = ?,
        mankhojd = ?, ponnykategori = ?, farg = ?, tecken = ?,
        harstamning = ?, uppfodare = ?, agare = ?,
        bortrest = ?, privathast = ?, lektionshast = ?,
        stall = ?, stallplats_nr = ?, inkopsdatum = ?, avford_datum = ?
      WHERE id = ?
    `, [
      namn, normalizeTyp(h.typ), h.kon || null, parseYear(h.fodelsear), h.ras || null,
      parseDecimal(h.mankhojd), normalizePonnykategori(h.ponnykategori), h.farg || null, h.tecken || null,
      h.harstamning || null, h.uppfodare || null, h.agare || null,
      h.bortrest || false, h.privathast || false, h.lektionshast || false,
      h.stall || null, h.stallplatsNr || null, parseDate(h.inkopsdatum), parseDate(h.avfordDatum),
      horseId,
    ]);
  } else {
    // Kolla om hästen finns via namn (från närvaroimporter)
    const [byName] = await conn.execute(
      'SELECT id FROM mrs_horses WHERE namn = ?',
      [namn]
    );

    if (byName.length > 0) {
      horseId = byName[0].id;
      // Sätt hnummer + uppdatera alla fält
      await conn.execute(`
        UPDATE mrs_horses SET
          hnummer = ?, typ = ?, kon = ?, fodelsear = ?, ras = ?,
          mankhojd = ?, ponnykategori = ?, farg = ?, tecken = ?,
          harstamning = ?, uppfodare = ?, agare = ?,
          bortrest = ?, privathast = ?, lektionshast = ?,
          stall = ?, stallplats_nr = ?, inkopsdatum = ?, avford_datum = ?
        WHERE id = ?
      `, [
        hnummer, normalizeTyp(h.typ), h.kon || null, parseYear(h.fodelsear), h.ras || null,
        parseDecimal(h.mankhojd), normalizePonnykategori(h.ponnykategori), h.farg || null, h.tecken || null,
        h.harstamning || null, h.uppfodare || null, h.agare || null,
        h.bortrest || false, h.privathast || false, h.lektionshast || false,
        h.stall || null, h.stallplatsNr || null, parseDate(h.inkopsdatum), parseDate(h.avfordDatum),
        horseId,
      ]);
    } else {
      // Ny häst
      const [result] = await conn.execute(`
        INSERT INTO mrs_horses (hnummer, namn, typ, kon, fodelsear, ras,
          mankhojd, ponnykategori, farg, tecken,
          harstamning, uppfodare, agare,
          bortrest, privathast, lektionshast,
          stall, stallplats_nr, inkopsdatum, avford_datum)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        hnummer, namn, normalizeTyp(h.typ), h.kon || null, parseYear(h.fodelsear), h.ras || null,
        parseDecimal(h.mankhojd), normalizePonnykategori(h.ponnykategori), h.farg || null, h.tecken || null,
        h.harstamning || null, h.uppfodare || null, h.agare || null,
        h.bortrest || false, h.privathast || false, h.lektionshast || false,
        h.stall || null, h.stallplatsNr || null, parseDate(h.inkopsdatum), parseDate(h.avfordDatum),
      ]);
      horseId = result.insertId;
    }
  }

  // --- Foder (replace — konfigurationsdata) ---
  if (h.foder && h.foder.length > 0) {
    // Rensa befintliga foderader och sätt in nya
    await conn.execute('DELETE FROM mrs_horse_feed WHERE horse_id = ?', [horseId]);
    for (const f of h.foder) {
      await conn.execute(`
        INSERT INTO mrs_horse_feed (horse_id, rad_nr, fodersort, fodring_1, fodring_2, fodring_3, fodring_4, fodring_5)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        horseId, f.radNr, f.fodersort,
        f.fodringar[0] || '', f.fodringar[1] || '', f.fodringar[2] || '',
        f.fodringar[3] || '', f.fodringar[4] || '',
      ]);
    }
  }

  // --- Journaler (upsert — tidsseriedata) ---
  if (h.journaler && h.journaler.length > 0) {
    for (const j of h.journaler) {
      const datum = parseDate(j.datum);
      if (!datum) continue;
      await conn.execute(`
        INSERT IGNORE INTO mrs_horse_journals (horse_id, typ, datum, till_datum, beskrivning)
        VALUES (?, ?, ?, ?, ?)
      `, [
        horseId, j.typ, datum, parseDate(j.tillDatum), j.beskrivning || null,
      ]);
    }
  }

  // --- Sjukskrivningar (upsert) ---
  if (h.sjukskrivningar && h.sjukskrivningar.length > 0) {
    for (const s of h.sjukskrivningar) {
      const datumFrom = parseDate(s.datumFrom);
      if (!datumFrom) continue;
      await conn.execute(`
        INSERT INTO mrs_horse_sick_leave (horse_id, datum_from, datum_to, orsak)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          datum_to = COALESCE(VALUES(datum_to), datum_to),
          orsak = COALESCE(VALUES(orsak), orsak)
      `, [
        horseId, datumFrom, parseDate(s.datumTo), s.orsak || null,
      ]);
    }
  }

  // --- Skoningar (upsert) ---
  if (h.skoningar && h.skoningar.length > 0) {
    for (const sk of h.skoningar) {
      const datum = parseDate(sk.datum);
      if (!datum) continue;
      await conn.execute(`
        INSERT INTO mrs_horse_shoeing (horse_id, datum, notering)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          notering = COALESCE(NULLIF(VALUES(notering), ''), notering)
      `, [
        horseId, datum, sk.notering || null,
      ]);
    }
  }
}

// --- Hitta filer ---

function findLatestFile() {
  const files = readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('hastar'))
    .map(f => ({ name: f, mtime: statSync(join(DATA_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) throw new Error(`Inga hastar-filer i ${DATA_DIR}`);
  return join(DATA_DIR, files[0].name);
}

// --- CLI ---

const arg = process.argv[2];

console.log('==========================================');
console.log('  MinRidskola Hästindex — JSON → MariaDB');
console.log('==========================================');

try {
  if (arg === 'latest') {
    const file = findLatestFile();
    await importFile(file);
  } else if (arg) {
    const filepath = resolve(arg);
    await importFile(filepath);
  } else {
    console.log('\nAnvändning:');
    console.log('  node import/minridskola-horses.js latest    → Senaste hastar-filen');
    console.log('  node import/minridskola-horses.js <sökväg>  → Specifik fil');
  }
} catch (err) {
  console.error('\nFEL:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}

console.log('\n==========================================');
console.log('  Klart!');
console.log('==========================================');

export { importFile, findLatestFile };
