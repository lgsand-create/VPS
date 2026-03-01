/**
 * Laget.se JSON → MariaDB Import (med change detection)
 *
 * Läser scrapad aktivitets-JSON och importerar till lag_-tabeller.
 * Använder hash-baserad change detection för att skippa oförändrad data
 * och loggar ändringar i lag_change_log.
 *
 * Kör:
 *   node import/laget.js latest           → Senaste aktivitets-filerna
 *   node import/laget.js all              → Alla JSON-filer
 *   node import/laget.js <sökväg>         → Specifik fil
 */

import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import pool from '../db/connection.js';
import dotenv from 'dotenv';
dotenv.config();

const SERVICES_DIR = resolve(import.meta.dirname, '..');
const DATA_DIR = resolve(SERVICES_DIR, process.env.LAGET_DATA_PATH || '../data/laget');

// --- Namnrensning (inlånade spelare) ---

/**
 * Rensar spelarnamn: "Erik Tomazic - BackatorpIFpf09" → { name: "Erik Tomazic", loanedFrom: "BackatorpIFpf09" }
 * Vanliga namn returneras oförändrade med loanedFrom = null.
 */
function cleanPlayerName(raw) {
  const match = raw.match(/^(.+?)\s*-\s*(Backatorp\S+)$/i);
  if (match) {
    return { name: match[1].trim(), loanedFrom: match[2] };
  }
  return { name: raw, loanedFrom: null };
}

// --- Hashing ---

function hashAttendance(deltagare, ledare) {
  const all = [
    ...deltagare.map(d => `d:${cleanPlayerName(d.name).name}:${d.status}`),
    ...ledare.map(l => `l:${cleanPlayerName(l.name).name}:${l.status}`),
  ].sort();
  return createHash('md5').update(all.join('|')).digest('hex');
}

// --- Change detection ---

async function detectChanges(conn, activityId, newDeltagare, newLedare, roll) {
  const changes = [];
  const members = roll === 'ledare' ? newLedare : newDeltagare;

  const [existing] = await conn.execute(`
    SELECT a.id, m.namn, a.status, a.kommentar
    FROM lag_attendance a
    JOIN lag_members m ON m.id = a.member_id
    WHERE a.activity_id = ? AND a.roll = ?
  `, [activityId, roll]);

  const existingMap = new Map(existing.map(e => [e.namn, e]));

  for (const m of members) {
    const { name } = cleanPlayerName(m.name);
    const old = existingMap.get(name);
    if (!old) {
      changes.push({ namn: name, field: 'ny', old_val: null, new_val: m.status });
    } else if (old.status !== m.status) {
      changes.push({ namn: name, field: 'status', old_val: old.status, new_val: m.status });
    }
  }

  return changes;
}

// --- Flaggor ---

const NO_LOG = process.argv.includes('--no-log');

// --- Databasimport ---

async function importFile(filepath) {
  const filename = filepath.split(/[/\\]/).pop();
  console.log(`\n  Importerar: ${filename}`);

  const raw = readFileSync(filepath, 'utf-8');
  const data = JSON.parse(raw);

  if (!data.aktiviteter || !data.lagSlug) {
    console.log('  Ogiltig fil (saknar aktiviteter/lagSlug) — hoppar över.');
    return { records: 0, changes: 0, skipped: 0 };
  }

  const teamId = Object.entries(TEAM_MAP).find(([, slug]) => slug === data.lagSlug)?.[0];
  if (!teamId) {
    console.log(`  Okänd lagslug: ${data.lagSlug} — hoppar över.`);
    return { records: 0, changes: 0, skipped: 0 };
  }

  const conn = await pool.getConnection();
  let logId;
  if (!NO_LOG) {
    try {
      const [logResult] = await conn.execute(
        'INSERT INTO scrape_log (scraper, status, json_file, project) VALUES (?, ?, ?, ?)',
        ['laget', 'running', filename, 'laget']
      );
      logId = logResult.insertId;
    } catch {
      console.log('  (Kunde inte logga — kör npm run migrate först)');
    }
  }

  try {
    let totalRecords = 0;
    let totalChanges = 0;
    let totalSkipped = 0;

    for (const a of data.aktiviteter) {
      if (!a.eventId) continue;

      // Upsert aktivitet
      const datum = a.datum && /^\d{4}-\d{2}-\d{2}$/.test(a.datum) ? a.datum : null;
      const datumTill = a.datum_till && /^\d{4}-\d{2}-\d{2}$/.test(a.datum_till) ? a.datum_till : null;
      await conn.execute(`
        INSERT INTO lag_activities (event_id, team_id, datum, datum_till, starttid, sluttid, heldag, typ, plats, lok_aktivitet, genomford, raw_date_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          datum = COALESCE(VALUES(datum), datum),
          datum_till = VALUES(datum_till),
          starttid = COALESCE(VALUES(starttid), starttid),
          sluttid = COALESCE(VALUES(sluttid), sluttid),
          heldag = VALUES(heldag),
          typ = COALESCE(NULLIF(VALUES(typ), ''), typ),
          plats = COALESCE(NULLIF(VALUES(plats), ''), plats),
          lok_aktivitet = VALUES(lok_aktivitet),
          genomford = VALUES(genomford)
      `, [a.eventId, teamId, datum, datumTill, a.starttid || '', a.sluttid || '',
          a.heldag || false,
          a.typ || '', a.plats || '', a.lokAktivitet, a.genomford || false,
          a.datum || '']);

      // Hämta activity_id
      const [activities] = await conn.execute(
        'SELECT id, data_hash FROM lag_activities WHERE event_id = ? AND team_id = ?',
        [a.eventId, teamId]
      );
      if (activities.length === 0) continue;
      const activityId = activities[0].id;
      const existingHash = activities[0].data_hash;

      const deltagare = a.deltagare || [];
      const ledare = a.ledare || [];
      const newHash = hashAttendance(deltagare, ledare);

      // Hash-jämförelse: skippa om oförändrad
      if (existingHash && existingHash === newHash) {
        totalSkipped++;
        continue;
      }

      // Change detection om befintlig data finns
      if (existingHash) {
        for (const roll of ['deltagare', 'ledare']) {
          const changes = await detectChanges(conn, activityId, deltagare, ledare, roll);
          for (const ch of changes) {
            const memberId = await ensureMember(conn, ch.namn);  // redan rent namn
            await conn.execute(`
              INSERT INTO lag_change_log (activity_id, member_id, field_name, old_value, new_value, scrape_file)
              VALUES (?, ?, ?, ?, ?, ?)
            `, [activityId, memberId, ch.field, ch.old_val, ch.new_val, filename]);
          }
          totalChanges += changes.length;
        }
      }

      // Importera deltagare
      for (const d of deltagare) {
        if (!d.name) continue;
        const { name, loanedFrom } = cleanPlayerName(d.name);
        const memberId = await ensureMember(conn, name);
        await conn.execute(`
          INSERT INTO lag_attendance (activity_id, member_id, roll, status, kommentar, inlanad_fran)
          VALUES (?, ?, 'deltagare', ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            status = VALUES(status),
            kommentar = VALUES(kommentar),
            inlanad_fran = VALUES(inlanad_fran)
        `, [activityId, memberId, d.status, d.comment || '', loanedFrom]);
        totalRecords++;
      }

      // Importera ledare
      for (const l of ledare) {
        if (!l.name) continue;
        const { name, loanedFrom } = cleanPlayerName(l.name);
        const memberId = await ensureMember(conn, name);
        await conn.execute(`
          INSERT INTO lag_attendance (activity_id, member_id, roll, status, kommentar, inlanad_fran)
          VALUES (?, ?, 'ledare', ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            status = VALUES(status),
            kommentar = VALUES(kommentar),
            inlanad_fran = VALUES(inlanad_fran)
        `, [activityId, memberId, l.status, l.comment || '', loanedFrom]);
        totalRecords++;
      }

      // Spara ny hash
      await conn.execute(
        'UPDATE lag_activities SET data_hash = ? WHERE id = ?',
        [newHash, activityId]
      );
    }

    // Uppdatera logg
    if (logId) {
      await conn.execute(
        'UPDATE scrape_log SET status = ?, finished_at = NOW(), records = ? WHERE id = ?',
        ['success', totalRecords, logId]
      );
    }

    console.log(`  ${teamId}: ${data.aktiviteter.length} aktiviteter, ${totalRecords} närvaroposter, ${totalSkipped} oförändrade, ${totalChanges} ändringar`);
    return { records: totalRecords, changes: totalChanges, skipped: totalSkipped };

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

async function ensureMember(conn, namn) {
  await conn.execute(
    'INSERT IGNORE INTO lag_members (namn) VALUES (?)',
    [namn]
  );
  const [rows] = await conn.execute(
    'SELECT id FROM lag_members WHERE namn = ?',
    [namn]
  );
  return rows[0].id;
}

// --- Lag-slug-mappning (för att hitta team_id från lagSlug i JSON) ---

const TEAM_MAP = {
  alag:   'BackatorpIF-Fotboll-HerrAlag',
  u17:    'BackatorpIF-Fotboll-U17Herr',
  p12:    'BackatorpIFP12Fotboll',
  p13:    'BackatorpIFPF13',
  p14:    'BackatorpIFPF14',
  p15:    'BackatorpIFPF15',
  p16:    'BackatorpIF-Fotboll-FP-16Fotboll',
  p17:    'BackatorpIF-Fotboll-P17',
  p18:    'BackatorpIF-Fotboll-P-2018',
  p19:    'BackatorpIF-Fotboll-FotbollP2019',
  p20:    'BackatorpIF-Fotboll-P2020',
  uflick: 'BackatorpIF-U-flickor-Fotboll',
  f1112:  'BackatorpIF-Knattelag-Fotboll',
  f1314:  'BackatorpF1314',
  f1516:  'BackatorpIF-Fotboll-F15-16',
  f17:    'BackatorpIF-Fotboll-F-17',
  f18:    'BackatorpIF-Fotboll-F-2018',
  f19:    'BackatorpIF-Fotboll-FotbollF2019',
  f20:    'BackatorpIF-Fotboll-F-2020',
};

// --- Hitta filer ---

function findLatestFiles() {
  const files = readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('aktiviteter-'))
    .map(f => ({ name: f, mtime: statSync(join(DATA_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) throw new Error(`Inga aktivitets-filer i ${DATA_DIR}`);

  // Returnera senaste fil per lag (baserat på filnamn: aktiviteter-{teamKey}_datum.json)
  const latestPerTeam = new Map();
  for (const f of files) {
    const teamKey = f.name.match(/aktiviteter-([^_]+)_/)?.[1];
    if (teamKey && !latestPerTeam.has(teamKey)) {
      latestPerTeam.set(teamKey, join(DATA_DIR, f.name));
    }
  }
  return [...latestPerTeam.values()];
}

function findAllFiles() {
  return readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('aktiviteter-'))
    .sort()
    .map(f => join(DATA_DIR, f));
}

// --- CLI ---

const arg = process.argv[2];

console.log('==========================================');
console.log('  Laget.se – JSON → MariaDB Import');
console.log('  (med change detection)');
console.log('==========================================');

try {
  if (arg === 'latest') {
    const files = findLatestFiles();
    console.log(`\n  Hittade ${files.length} senaste filer\n`);
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
    console.log(`\n  Totalt: ${total.records} närvaroposter, ${total.skipped} oförändrade, ${total.changes} ändringar`);
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
    console.log(`\n  Totalt: ${total.records} närvaroposter, ${total.skipped} oförändrade, ${total.changes} ändringar`);
  } else if (arg) {
    const filepath = resolve(arg);
    await importFile(filepath);
  } else {
    console.log('\nAnvändning:');
    console.log('  node import/laget.js latest       → Senaste filerna (en per lag)');
    console.log('  node import/laget.js all           → Alla JSON-filer');
    console.log('  node import/laget.js <sökväg>     → Specifik fil');
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

export { importFile, findLatestFiles };
