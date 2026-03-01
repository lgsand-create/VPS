/**
 * MinRidskola JSON → MariaDB Import (med change detection)
 *
 * Läser scrapad JSON och normaliserar till databastabeller.
 * Använder hash-baserad change detection för att skippa oförändrad data
 * och loggar alla ändringar i mrs_change_log.
 *
 * Kör:
 *   node import/minridskola.js latest                    → Senaste narvaro-filen
 *   node import/minridskola.js ../data/minridskola/X.json → Specifik fil
 *   node import/minridskola.js all                       → Alla JSON-filer
 */

import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import pool from '../db/connection.js';
import dotenv from 'dotenv';
dotenv.config();

// Resolve relativt till services/-mappen (en nivå upp från import/)
const SERVICES_DIR = resolve(import.meta.dirname, '..');
const DATA_DIR = resolve(SERVICES_DIR, process.env.DATA_PATH || '../data/minridskola');

// --- Hashing ---

/**
 * Beräkna MD5-hash av deltagardata för ett tillfälle.
 * Sorterar deltagare på id för stabil hash oavsett ordning.
 */
function hashDeltagare(deltagare) {
  const sorted = [...deltagare]
    .filter(d => d.id)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(d => `${d.id}:${d.hast}:${d.avbokad}:${d.narvaro}`);
  return createHash('md5').update(sorted.join('|')).digest('hex');
}

// --- Format-detektion ---

function detectFormat(data) {
  if (Array.isArray(data)) return 'historik';
  if (data.dagar) return 'avprickning';
  if (data.tillfallen) return 'scrape';
  if (data.meta && data.kurser && !data.tillfallen) return 'summary';
  return 'unknown';
}

// --- Normalisera till gemensamt format ---

function normalize(data, format) {
  switch (format) {
    case 'scrape': return normalizeScrape(data);
    case 'avprickning': return normalizeAvprickning(data);
    case 'historik': return normalizeHistorik(data);
    case 'summary': return [];
    default: throw new Error(`Okänt format: ${format}`);
  }
}

function normalizeScrape(data) {
  return (data.tillfallen || []).map(t => ({
    lnummer: t.lnummer,
    kursnamn: t.kursnamn,
    dag: t.dag,
    tid: null,
    plats: null,
    ridlarare: null,
    vecka: t.vecka,
    datum: t.datum || null,
    deltagare: (t.deltagare || []).map(d => ({
      id: d.ryttareId || d.id || '',
      namn: d.namn,
      hast: d.hast,
      hastNummer: d.hastNummer || '',
      avbokad: d.avbokad || false,
      narvaro: d.narvaro || false,
    })),
  }));
}

function normalizeAvprickning(data) {
  const tillfallen = [];
  for (const dag of (data.dagar || [])) {
    for (const lek of (dag.lektioner || [])) {
      tillfallen.push({
        lnummer: lek.lnummer,
        kursnamn: lek.kursnamn,
        dag: dag.dag,
        tid: lek.tid,
        plats: lek.plats,
        ridlarare: lek.ridlarare,
        vecka: data.vecka || null,
        datum: lek.datum || null,
        deltagare: (lek.deltagare || []).map(d => ({
          id: d.id || '',
          namn: d.namn,
          hast: d.hast,
          hastNummer: d.hastNummer || '',
          avbokad: d.avbokad || false,
          narvaro: false,
        })),
      });
    }
  }
  return tillfallen;
}

function normalizeHistorik(data) {
  return data.map(t => ({
    lnummer: t.lnummer,
    kursnamn: t.kursnamn,
    dag: t.dag,
    tid: t.tid,
    plats: t.plats,
    ridlarare: t.ridlarare,
    vecka: t.vecka,
    datum: t.datum || null,
    deltagare: (t.deltagare || []).map(d => ({
      id: d.id || '',
      namn: d.namn,
      hast: d.hast,
      hastNummer: d.hastNummer || '',
      avbokad: d.avbokad || false,
      narvaro: d.narvaro || false,
    })),
  }));
}

// --- Change detection ---

/**
 * Jämför scrapad data med DB och returnera lista av ändringar.
 */
async function detectChanges(conn, instanceId, newDeltagare) {
  const changes = [];

  // Hämta befintliga mrs_enrollments
  const [existing] = await conn.execute(`
    SELECT e.rider_id, e.avbokad, e.narvaro, e.horse_id, h.namn AS hast
    FROM mrs_enrollments e
    LEFT JOIN mrs_horses h ON h.id = e.horse_id
    WHERE e.instance_id = ?
  `, [instanceId]);

  const existingMap = new Map(existing.map(e => [e.rider_id, e]));
  const newMap = new Map(newDeltagare.filter(d => d.id).map(d => [d.id, d]));

  // Kolla varje ny deltagare mot befintlig
  for (const [riderId, d] of newMap) {
    const old = existingMap.get(riderId);

    if (!old) {
      // Ny bokning
      changes.push({ rider_id: riderId, field: 'bokning', old_val: null, new_val: 'ny' });
      continue;
    }

    // Jämför avbokad
    const oldAvbokad = Boolean(old.avbokad);
    if (oldAvbokad !== d.avbokad) {
      changes.push({
        rider_id: riderId,
        field: 'avbokad',
        old_val: String(oldAvbokad),
        new_val: String(d.avbokad),
      });
    }

    // Jämför närvaro (bara om ny data har true — skippa false→false)
    const oldNarvaro = Boolean(old.narvaro);
    if (d.narvaro && !oldNarvaro) {
      changes.push({
        rider_id: riderId,
        field: 'narvaro',
        old_val: String(oldNarvaro),
        new_val: String(d.narvaro),
      });
    }

    // Jämför häst
    const oldHast = old.hast || '';
    const newHast = (!d.avbokad && d.hast !== 'AVBOKAD' && d.hast !== 'LÅST AVBOKNING') ? d.hast : '';
    if (oldHast && newHast && oldHast !== newHast) {
      changes.push({
        rider_id: riderId,
        field: 'hast',
        old_val: oldHast,
        new_val: newHast,
      });
    }
  }

  // Kolla borttagna deltagare (finns i DB men inte i ny data)
  for (const [riderId] of existingMap) {
    if (!newMap.has(riderId)) {
      changes.push({ rider_id: riderId, field: 'bokning', old_val: 'aktiv', new_val: 'borttagen' });
    }
  }

  return changes;
}

// --- Databasimport ---

async function importFile(filepath) {
  const filename = filepath.split(/[/\\]/).pop();
  console.log(`\n  Importerar: ${filename}`);

  const raw = readFileSync(filepath, 'utf-8');
  const data = JSON.parse(raw);
  const format = detectFormat(data);
  console.log(`  Format: ${format}`);

  if (format === 'unknown') {
    console.log('  Okänt format — hoppar över.');
    return { records: 0, changes: 0, skipped: 0 };
  }

  const conn = await pool.getConnection();
  let logId;
  try {
    const [logResult] = await conn.execute(
      'INSERT INTO scrape_log (scraper, status, json_file, project) VALUES (?, ?, ?, ?)',
      [format, 'running', filename, 'minridskola']
    );
    logId = logResult.insertId;
  } catch {
    console.log('  (Kunde inte logga — kör npm run migrate först)');
  }

  try {
    // Importera kursregister
    if (data.kurser) await importCourses(conn, data.kurser);
    if (data.ryttare) await importRiders(conn, data.ryttare);

    const tillfallen = normalize(data, format);

    if (tillfallen.length === 0 && format !== 'summary') {
      console.log('  Inga tillfällen att importera.');
    }

    let totalEnrollments = 0;
    let totalChanges = 0;
    let totalSkipped = 0;

    for (const t of tillfallen) {
      // Upsert kurs
      if (t.lnummer && t.kursnamn) {
        await conn.execute(`
          INSERT INTO mrs_courses (lnummer, kursnamn, dag, tid, plats, ridlarare)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            kursnamn = IF(VALUES(kursnamn) != '', VALUES(kursnamn), kursnamn),
            dag = IF(VALUES(dag) != '', VALUES(dag), dag),
            tid = COALESCE(NULLIF(VALUES(tid), ''), tid),
            plats = COALESCE(NULLIF(VALUES(plats), ''), plats),
            ridlarare = COALESCE(NULLIF(VALUES(ridlarare), ''), ridlarare)
        `, [t.lnummer, t.kursnamn, t.dag || '', t.tid || '', t.plats || '', t.ridlarare || '']);
      }

      let datum = null;
      if (t.datum && /^\d{4}-\d{2}-\d{2}$/.test(t.datum)) datum = t.datum;

      if (!t.vecka) continue;

      // Upsert course_instance
      await conn.execute(`
        INSERT INTO mrs_course_instances (lnummer, vecka, datum)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          datum = COALESCE(VALUES(datum), datum)
      `, [t.lnummer, t.vecka, datum]);

      // Hämta instance
      const [instances] = await conn.execute(
        'SELECT id, data_hash FROM mrs_course_instances WHERE lnummer = ? AND vecka = ?',
        [t.lnummer, t.vecka]
      );
      if (instances.length === 0) continue;
      const instanceId = instances[0].id;
      const existingHash = instances[0].data_hash;

      // Beräkna hash av ny data
      const newHash = hashDeltagare(t.deltagare);

      // Hash-jämförelse: skippa om oförändrad
      if (existingHash && existingHash === newHash) {
        totalSkipped++;
        continue;
      }

      // Data har ändrats (eller är ny) — kör change detection
      if (existingHash) {
        // Befintlig data finns — detektera vad som ändrats
        const changes = await detectChanges(conn, instanceId, t.deltagare);
        for (const ch of changes) {
          await conn.execute(`
            INSERT INTO mrs_change_log (instance_id, rider_id, field_name, old_value, new_value, scrape_file)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [instanceId, ch.rider_id, ch.field, ch.old_val, ch.new_val, filename]);
        }
        totalChanges += changes.length;
        if (changes.length > 0) {
          console.log(`    ${t.lnummer} ${t.vecka}: ${changes.length} ändringar`);
        }
      }

      // Importera/uppdatera deltagare
      for (const d of t.deltagare) {
        if (!d.id) continue;

        await conn.execute(`
          INSERT INTO mrs_riders (id, namn) VALUES (?, ?)
          ON DUPLICATE KEY UPDATE namn = IF(VALUES(namn) != '', VALUES(namn), namn)
        `, [d.id, d.namn]);

        let horseId = null;
        if (d.hast && !d.avbokad && d.hast !== 'AVBOKAD' && d.hast !== 'LÅST AVBOKNING') {
          if (d.hastNummer) {
            // Matcha via hnummer (exakt, från hästindexet)
            const [byHnr] = await conn.execute('SELECT id FROM mrs_horses WHERE hnummer = ?', [d.hastNummer]);
            if (byHnr.length > 0) {
              horseId = byHnr[0].id;
            } else {
              // Häst finns inte ännu — skapa med hnummer + namn
              await conn.execute(
                'INSERT IGNORE INTO mrs_horses (namn, hnummer) VALUES (?, ?)',
                [d.hast, d.hastNummer]
              );
              const [created] = await conn.execute('SELECT id FROM mrs_horses WHERE hnummer = ?', [d.hastNummer]);
              if (created.length > 0) horseId = created[0].id;
            }
          } else {
            // Fallback: matcha via namn (äldre data utan hastNummer)
            await conn.execute('INSERT IGNORE INTO mrs_horses (namn) VALUES (?)', [d.hast]);
            const [horses] = await conn.execute('SELECT id FROM mrs_horses WHERE namn = ?', [d.hast]);
            if (horses.length > 0) horseId = horses[0].id;
          }
        }

        await conn.execute(`
          INSERT INTO mrs_enrollments (instance_id, rider_id, horse_id, avbokad, narvaro)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            horse_id = COALESCE(VALUES(horse_id), horse_id),
            avbokad = VALUES(avbokad),
            narvaro = IF(VALUES(narvaro), VALUES(narvaro), narvaro)
        `, [instanceId, d.id, horseId, d.avbokad, d.narvaro]);

        totalEnrollments++;
      }

      // Spara ny hash
      await conn.execute(
        'UPDATE mrs_course_instances SET data_hash = ? WHERE id = ?',
        [newHash, instanceId]
      );
    }

    // Uppdatera logg
    if (logId) {
      await conn.execute(
        'UPDATE scrape_log SET status = ?, finished_at = NOW(), records = ? WHERE id = ?',
        ['success', totalEnrollments, logId]
      );
    }

    console.log(`  Resultat: ${tillfallen.length} tillfällen, ${totalEnrollments} uppdaterade, ${totalSkipped} oförändrade, ${totalChanges} ändringar loggade`);
    return { records: totalEnrollments, changes: totalChanges, skipped: totalSkipped };

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

async function importCourses(conn, kurser) {
  for (const k of kurser) {
    await conn.execute(`
      INSERT INTO mrs_courses (lnummer, kursnamn, dag, tid, plats, ridlarare)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        kursnamn = IF(VALUES(kursnamn) != '', VALUES(kursnamn), kursnamn),
        dag = IF(VALUES(dag) != '', VALUES(dag), dag),
        tid = COALESCE(NULLIF(VALUES(tid), ''), tid),
        plats = COALESCE(NULLIF(VALUES(plats), ''), plats),
        ridlarare = COALESCE(NULLIF(VALUES(ridlarare), ''), ridlarare)
    `, [k.lnummer, k.kursnamn, k.dag || '', k.tid || '', k.plats || '', k.ridlarare || '']);
  }
  console.log(`  Kurser: ${kurser.length} upserted`);
}

async function importRiders(conn, ryttare) {
  for (const r of ryttare) {
    await conn.execute(`
      INSERT INTO mrs_riders (id, namn) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE namn = IF(VALUES(namn) != '', VALUES(namn), namn)
    `, [r.id, r.namn]);
  }
  console.log(`  Ryttare: ${ryttare.length} upserted`);
}

// --- Hitta filer ---

function findLatestFile(pattern = 'narvaro') {
  const files = readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && f.includes(pattern))
    .map(f => ({ name: f, mtime: statSync(join(DATA_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) throw new Error(`Inga ${pattern}-filer i ${DATA_DIR}`);
  return join(DATA_DIR, files[0].name);
}

function findAllFiles() {
  return readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => join(DATA_DIR, f));
}

// --- CLI ---

const arg = process.argv[2];

console.log('==========================================');
console.log('  MinRidskola – JSON → MariaDB Import');
console.log('  (med change detection)');
console.log('==========================================');

try {
  if (arg === 'latest') {
    const file = findLatestFile();
    await importFile(file);
  } else if (arg === 'all') {
    const files = findAllFiles();
    console.log(`\n  Hittade ${files.length} filer att importera\n`);
    let total = { records: 0, changes: 0, skipped: 0 };
    for (const file of files) {
      try {
        const result = await importFile(file);
        total.records += result.records;
        total.changes += result.changes;
        total.skipped += result.skipped;
      } catch (err) {
        console.error(`  FEL vid ${file}: ${err.message}`);
      }
    }
    console.log(`\n  Totalt: ${total.records} bokningar, ${total.skipped} oförändrade, ${total.changes} ändringar`);
  } else if (arg) {
    const filepath = resolve(arg);
    await importFile(filepath);
  } else {
    console.log('\nAnvändning:');
    console.log('  node import/minridskola.js latest          → Senaste narvaro-filen');
    console.log('  node import/minridskola.js all              → Alla JSON-filer');
    console.log('  node import/minridskola.js <sökväg>        → Specifik fil');
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
