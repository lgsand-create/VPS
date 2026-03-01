/**
 * Integrity Check — filintegritets-kontroll via SSH/SFTP
 *
 * Ansluter till hostingservern via ssh2, laddar ner kritiska filer,
 * hashar dem lokalt med SHA-256, och jamfor mot baselines i DB.
 *
 * Filintegritet gors ALLTID fran VPS:en — sajten rapporterar aldrig sina egna filer.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import pool from '../../db/connection.js';

// Fallback om sajten inte har egna filer konfigurerade
const DEFAULT_CRITICAL_FILES = [
  'index.php',
  '.htaccess',
];

function getCriticalFiles(site) {
  if (site.integrity_files) {
    return site.integrity_files.split('\n').map(f => f.trim()).filter(Boolean);
  }
  return DEFAULT_CRITICAL_FILES;
}

/**
 * Resolva SSH/SFTP-credentials för en sajt.
 * Stödjer två auth-metoder: SSH-nyckel (Loopia m.fl.) och lösenord (one.com m.fl.)
 */
function resolveSshCredentials(site) {
  const sshUser = site.ssh_user || process.env[site.ssh_user_env];
  const sshKeyPath = site.ssh_key_path || process.env[site.ssh_key_env];
  const sshPassword = site.ssh_password || (site.ssh_password_env ? process.env[site.ssh_password_env] : null);

  let privateKey = null;
  if (sshKeyPath) {
    try {
      privateKey = readFileSync(sshKeyPath, 'utf8');
    } catch {
      // Nyckel kunde inte läsas — faller igenom till lösenord om tillgängligt
    }
  }

  return { sshUser, privateKey, sshPassword };
}

export async function runIntegrityCheck(site) {
  // Kräver SSH-konfiguration — antingen nyckel eller lösenord
  const hasKeyConfig = site.ssh_user_env || site.ssh_user;
  const hasPasswordConfig = site.ssh_password_env;
  if (!site.ssh_host || (!hasKeyConfig && !hasPasswordConfig)) {
    return {
      siteId: site.id,
      type: 'integrity',
      status: 'error',
      responseMs: null,
      statusCode: null,
      message: 'SSH ej konfigurerat for denna sajt',
      details: { reason: 'missing_ssh_config' },
    };
  }

  const { sshUser, privateKey, sshPassword } = resolveSshCredentials(site);

  if (!sshUser) {
    return {
      siteId: site.id,
      type: 'integrity',
      status: 'error',
      responseMs: null,
      statusCode: null,
      message: 'SSH-användarnamn saknas — fyll i under Sajtinställningar',
      details: { missingFields: ['ssh_user'] },
    };
  }

  if (!privateKey && !sshPassword) {
    return {
      siteId: site.id,
      type: 'integrity',
      status: 'error',
      responseMs: null,
      statusCode: null,
      message: 'SSH-credentials saknas — fyll i nyckelsökväg eller lösenord i sajtinställningar',
      details: { missingFields: ['ssh_key_path / ssh_password_env'] },
    };
  }

  const start = Date.now();

  try {
    // Lazy-import ssh2 (installeras separat)
    const { Client } = await import('ssh2');

    const changes = [];
    const checked = [];

    const connectOpts = { host: site.ssh_host, port: site.ssh_port || 22, username: sshUser };
    if (privateKey) {
      connectOpts.privateKey = privateKey;
    } else {
      connectOpts.password = sshPassword;
    }

    const files = await readFilesViaSftp({
      ...connectOpts,
      webroot: site.webroot || '.',
      files: getCriticalFiles(site),
      Client,
    });

    // Hamta baselines fran DB
    const [baselines] = await pool.execute(
      'SELECT file_path, file_hash FROM mon_baselines WHERE site_id = ?',
      [site.id]
    );
    const baselineMap = new Map(baselines.map(b => [b.file_path, b.file_hash]));

    for (const { path, content, error } of files) {
      if (error) {
        // Filen finns inte — inte nödvandigtvis ett problem
        checked.push({ path, status: 'missing', error });
        continue;
      }

      const hash = createHash('sha256').update(content).digest('hex');
      const existingHash = baselineMap.get(path);

      if (existingHash && existingHash !== hash) {
        changes.push({
          path,
          oldHash: existingHash,
          newHash: hash,
          size: content.length,
        });
      }

      checked.push({ path, hash, size: content.length, changed: existingHash && existingHash !== hash });
    }

    const ms = Date.now() - start;

    return {
      siteId: site.id,
      type: 'integrity',
      status: changes.length > 0 ? 'critical' : 'ok',
      responseMs: ms,
      statusCode: null,
      message: changes.length > 0
        ? `${changes.length} filandring(ar) upptackta!`
        : `${checked.filter(f => !f.error).length} filer kontrollerade — inga andringar`,
      details: { changes, checked },
    };
  } catch (err) {
    return {
      siteId: site.id,
      type: 'integrity',
      status: 'error',
      responseMs: Date.now() - start,
      statusCode: null,
      message: `SSH-anslutning misslyckades: ${err.message}`,
      details: { error: err.message },
    };
  }
}

/**
 * Lasa filer via SFTP
 */
function readFilesViaSftp({ host, port, username, privateKey, password, webroot, files, Client }) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const results = [];

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        let pending = files.length;
        if (pending === 0) {
          conn.end();
          return resolve(results);
        }

        for (const file of files) {
          const remotePath = `${webroot}/${file}`;

          sftp.readFile(remotePath, (err, buffer) => {
            if (err) {
              results.push({ path: file, content: null, error: err.message });
            } else {
              results.push({ path: file, content: buffer, error: null });
            }

            pending--;
            if (pending === 0) {
              conn.end();
              resolve(results);
            }
          });
        }
      });
    });

    conn.on('error', reject);

    const connectOpts = { host, port, username, readyTimeout: 15000 };
    if (privateKey) {
      connectOpts.privateKey = privateKey;
    } else if (password) {
      connectOpts.password = password;
    }
    conn.connect(connectOpts);
  });
}

/**
 * Uppdatera baselines for en sajt (anropas via API-route)
 */
export async function updateBaselines(site) {
  const { sshUser, privateKey, sshPassword } = resolveSshCredentials(site);

  if (!sshUser) {
    throw new Error('SSH-användarnamn saknas — fyll i under Sajtinställningar');
  }
  if (!privateKey && !sshPassword) {
    throw new Error('SSH-credentials saknas — fyll i nyckelsökväg eller lösenord i sajtinställningar');
  }

  const { Client } = await import('ssh2');

  const connectOpts = { host: site.ssh_host, port: site.ssh_port || 22, username: sshUser };
  if (privateKey) {
    connectOpts.privateKey = privateKey;
  } else {
    connectOpts.password = sshPassword;
  }

  const files = await readFilesViaSftp({
    ...connectOpts,
    webroot: site.webroot || '.',
    files: DEFAULT_CRITICAL_FILES,
    Client,
  });

  const results = [];

  for (const { path, content, error } of files) {
    if (error) {
      results.push({ path, error });
      continue;
    }

    const hash = createHash('sha256').update(content).digest('hex');

    await pool.execute(
      `INSERT INTO mon_baselines (site_id, file_path, file_hash, file_size)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE file_hash = VALUES(file_hash), file_size = VALUES(file_size), captured_at = NOW()`,
      [site.id, path, hash, content.length]
    );

    results.push({ path, hash, size: content.length });
  }

  return results;
}
