import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(import.meta.dirname, '../../data');

export function saveJson(category, name, data, options = {}) {
  const { timestamp = true } = options;

  const dir = join(DATA_DIR, category);
  mkdirSync(dir, { recursive: true });

  const date = timestamp ? `_${new Date().toISOString().slice(0, 10)}` : '';
  const filename = `${name}${date}.json`;
  const filepath = join(dir, filename);

  writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`✅ Sparade ${Array.isArray(data) ? data.length + ' poster' : 'data'} → ${filepath}`);

  return filepath;
}

export function saveCsv(category, name, rows) {
  if (!rows.length) {
    console.warn('⚠️  Inga rader att spara');
    return null;
  }

  const dir = join(DATA_DIR, category);
  mkdirSync(dir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const filepath = join(dir, `${name}_${date}.csv`);

  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(';'),
    ...rows.map((row) =>
      headers.map((h) => {
        const val = row[h] ?? '';
        return typeof val === 'string' && (val.includes(';') || val.includes('\n'))
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(';')
    ),
  ];

  writeFileSync(filepath, csvLines.join('\n'), 'utf-8');
  console.log(`✅ Sparade ${rows.length} rader → ${filepath}`);

  return filepath;
}
