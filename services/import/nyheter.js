/**
 * Nyheter JSON → MariaDB Import (med change detection)
 *
 * Läser scrapad nyhets-JSON och importerar till nyh_articles.
 * Använder hash-baserad change detection.
 *
 * Kör:
 *   node import/nyheter.js latest       → Senaste nyhets-filen
 *   node import/nyheter.js all          → Alla JSON-filer
 *   node import/nyheter.js <sökväg>     → Specifik fil
 */

import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import pool from '../db/connection.js';
import dotenv from 'dotenv';
dotenv.config();

const SERVICES_DIR = resolve(import.meta.dirname, '..');
const DATA_DIR = resolve(SERVICES_DIR, process.env.NYHETER_DATA_PATH || '../data/nyheter');

const NO_LOG = process.argv.includes('--no-log');

// --- Hashing ---

function hashArticle(article) {
  const fields = [
    article.rubrik || '',
    article.datum || '',
    String(article.visningar || 0),
    String(article.kommentarer || 0),
    article.författare || '',
    article.text || '',
    article.bild || '',
  ].join('|');
  return createHash('md5').update(fields).digest('hex');
}

// --- Datum-parsning ---

function parseDatum(raw) {
  if (!raw || raw.length !== 8) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

// --- Databasimport ---

async function importFile(filepath) {
  const filename = filepath.split(/[/\\]/).pop();
  console.log(`\n  Importerar: ${filename}`);

  const raw = readFileSync(filepath, 'utf-8');
  const articles = JSON.parse(raw);

  if (!Array.isArray(articles)) {
    console.log('  Ogiltig fil (inte en array) — hoppar över.');
    return { records: 0, changes: 0, skipped: 0 };
  }

  const conn = await pool.getConnection();
  let logId;

  if (!NO_LOG) {
    try {
      const [logResult] = await conn.execute(
        'INSERT INTO scrape_log (scraper, status, json_file, project) VALUES (?, ?, ?, ?)',
        ['nyheter', 'running', filename, 'nyheter']
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

    for (const a of articles) {
      const newsId = a.news_id || a.url?.match(/\/News\/(\d+)\//)?.[1];
      if (!newsId) continue;

      const datum = parseDatum(a.datum);
      const newHash = hashArticle(a);

      // Kolla om artikeln redan finns
      const [existing] = await conn.execute(
        'SELECT id, data_hash, visningar, kommentarer, rubrik FROM nyh_articles WHERE news_id = ?',
        [newsId]
      );

      if (existing.length > 0 && existing[0].data_hash === newHash) {
        totalSkipped++;
        continue;
      }

      // Change detection — logga ändringar i visningar/kommentarer
      if (existing.length > 0) {
        const fields = ['visningar', 'kommentarer', 'rubrik'];
        for (const field of fields) {
          const oldVal = String(existing[0][field] ?? '');
          const newVal = String(a[field === 'rubrik' ? 'rubrik' : field] ?? '');
          if (oldVal !== newVal) {
            await conn.execute(`
              INSERT INTO nyh_change_log (article_id, field_name, old_value, new_value, scrape_file)
              VALUES (?, ?, ?, ?, ?)
            `, [existing[0].id, field, oldVal, newVal, filename]);
            totalChanges++;
          }
        }
      }

      // Upsert artikel
      await conn.execute(`
        INSERT INTO nyh_articles (news_id, rubrik, datum, datum_raw, visningar, kommentarer,
                                  forfattare, url, bild, bild_url, text_content, data_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          rubrik = VALUES(rubrik),
          datum = COALESCE(VALUES(datum), datum),
          visningar = VALUES(visningar),
          kommentarer = VALUES(kommentarer),
          forfattare = COALESCE(NULLIF(VALUES(forfattare), ''), forfattare),
          bild = COALESCE(NULLIF(VALUES(bild), ''), bild),
          bild_url = COALESCE(NULLIF(VALUES(bild_url), ''), bild_url),
          text_content = COALESCE(NULLIF(VALUES(text_content), ''), text_content),
          data_hash = VALUES(data_hash)
      `, [newsId, a.rubrik, datum, a.datum || '', a.visningar || 0, a.kommentarer || 0,
          a.författare || '', a.url || '', a.bild || '', a.bildUrl || '',
          a.text || '', newHash]);

      totalRecords++;
    }

    if (logId) {
      await conn.execute(
        'UPDATE scrape_log SET status = ?, finished_at = NOW(), records = ? WHERE id = ?',
        ['success', totalRecords, logId]
      );
    }

    console.log(`  Resultat: ${articles.length} artiklar, ${totalRecords} uppdaterade, ${totalSkipped} oförändrade, ${totalChanges} ändringar`);
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

// --- Hitta filer ---

function findLatestFile() {
  const files = readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('nyheter'))
    .map(f => ({ name: f, mtime: statSync(join(DATA_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) throw new Error(`Inga nyhets-filer i ${DATA_DIR}`);
  return join(DATA_DIR, files[0].name);
}

function findAllFiles() {
  return readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('nyheter'))
    .sort()
    .map(f => join(DATA_DIR, f));
}

// --- CLI ---

const arg = process.argv[2];

console.log('==========================================');
console.log('  Nyheter – JSON → MariaDB Import');
console.log('  (med change detection)');
console.log('==========================================');

try {
  if (arg === 'latest') {
    const file = findLatestFile();
    console.log(`\n  Senaste fil: ${file.split(/[/\\]/).pop()}\n`);
    const result = await importFile(file);
    console.log(`\n  Totalt: ${result.records} uppdaterade, ${result.skipped} oförändrade, ${result.changes} ändringar`);
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
    console.log(`\n  Totalt: ${total.records} uppdaterade, ${total.skipped} oförändrade, ${total.changes} ändringar`);
  } else if (arg) {
    const filepath = resolve(arg);
    await importFile(filepath);
  } else {
    console.log('\nAnvändning:');
    console.log('  node import/nyheter.js latest       → Senaste filen');
    console.log('  node import/nyheter.js all           → Alla JSON-filer');
    console.log('  node import/nyheter.js <sökväg>     → Specifik fil');
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
