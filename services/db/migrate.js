/**
 * Kör SQL-migrationer i ordning.
 * Håller koll på vilka som redan körts via en migrations-tabell.
 *
 * Kör: node db/migrate.js
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import pool from './connection.js';

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

async function migrate() {
  const conn = await pool.getConnection();

  try {
    // Skapa migrations-tabell om den inte finns
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Hämta redan körda migrationer
    const [applied] = await conn.execute('SELECT name FROM _migrations ORDER BY name');
    const appliedSet = new Set(applied.map(r => r.name));

    // Läs migrationsfiler i ordning
    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  ✓ ${file} (redan körd)`);
        continue;
      }

      console.log(`  → Kör ${file}...`);
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');

      // Kör varje statement separat (splitta på ;)
      // Ta bort rena kommentarsrader innan split
      const cleaned = sql.replace(/^--.*$/gm, '');
      const statements = cleaned
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (const stmt of statements) {
        await conn.execute(stmt);
      }

      await conn.execute('INSERT INTO _migrations (name) VALUES (?)', [file]);
      console.log(`  ✓ ${file} klar`);
      count++;
    }

    if (count === 0) {
      console.log('\n  Alla migrationer redan körda.');
    } else {
      console.log(`\n  ${count} migration(er) körda.`);
    }
  } finally {
    conn.release();
    await pool.end();
  }
}

console.log('==========================================');
console.log('  MinRidskola – Databasmigrering');
console.log('==========================================\n');

migrate()
  .then(() => {
    console.log('\n  Klart!');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n  FEL:', err.message);
    process.exit(1);
  });
