/**
 * Content Check — injektionsskanning av webbsidor
 *
 * Hamtar nyckelsidor via HTTP GET och skannar efter:
 *   - Injicerade externa scripts/iframes
 *   - Obfuskerad kod (eval+atob, document.write+unescape)
 *   - Misstankta omdirigeringar (meta refresh till extern doman)
 *   - Nya externa resurser som inte finns i baseline
 *
 * Forsta korningen skapar en baseline av tilllatna externa domaner.
 * Efterfoljande korningar larmar om nya externa resurser upptacks.
 */

import { createHash } from 'crypto';
import pool from '../../db/connection.js';

const TIMEOUT_MS = 15000;

// Monster som indikerar injektion — critical
const CRITICAL_PATTERNS = [
  {
    regex: /eval\s*\(\s*atob\s*\(/gi,
    name: 'eval(atob())',
    description: 'Obfuskerad kod — base64-kodad eval',
  },
  {
    regex: /eval\s*\(\s*String\.fromCharCode\s*\(/gi,
    name: 'eval(String.fromCharCode())',
    description: 'Obfuskerad kod — charcode-kodad eval',
  },
  {
    regex: /document\.write\s*\(\s*unescape\s*\(/gi,
    name: 'document.write(unescape())',
    description: 'Klassisk injektionsteknik',
  },
  {
    regex: /<iframe[^>]*(?:style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|width\s*:\s*0|height\s*:\s*0)[^"']*["']|width\s*=\s*["']?0|height\s*=\s*["']?0)[^>]*>/gi,
    name: 'Dold iframe',
    description: 'Osynlig iframe — typiskt for malware/phishing',
  },
];

// Monster som ar misstankta — warning
const WARNING_PATTERNS = [
  {
    regex: /<meta[^>]*http-equiv\s*=\s*["']refresh["'][^>]*url\s*=\s*["']?https?:\/\/(?!(?:www\.)?(?:portal\.backatorpif\.se|equicard\.se|stalladams\.se))[^"'\s>]+/gi,
    name: 'Meta refresh till extern doman',
    description: 'Omdirigering till okand extern sajt',
  },
];

/**
 * Extrahera alla externa script-domaner fran HTML
 */
function extractExternalScriptDomains(html, siteHostname) {
  const domains = new Set();
  const scriptRegex = /<script[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)["'?\s>]/gi;

  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const url = new URL(match[1]);
      // Hoppa over egna domaner
      if (url.hostname !== siteHostname && !url.hostname.endsWith('.' + siteHostname)) {
        domains.add(url.hostname);
      }
    } catch {
      // Ogiltigt URL — ignorera
    }
  }

  return [...domains].sort();
}

/**
 * Extrahera alla iframe-kallor fran HTML
 */
function extractIframeSources(html, siteHostname) {
  const sources = new Set();
  const iframeRegex = /<iframe[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)["'?\s>]/gi;

  let match;
  while ((match = iframeRegex.exec(html)) !== null) {
    try {
      const url = new URL(match[1]);
      if (url.hostname !== siteHostname && !url.hostname.endsWith('.' + siteHostname)) {
        sources.add(url.hostname);
      }
    } catch {
      // Ogiltigt URL — ignorera
    }
  }

  return [...sources].sort();
}

/**
 * Sök efter misstankt langa base64-strangar i script-taggar
 */
function findSuspiciousBase64(html) {
  const findings = [];
  const scriptContentRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;

  let match;
  while ((match = scriptContentRegex.exec(html)) !== null) {
    const content = match[1];
    // Leta efter base64-strangar langre an 200 tecken
    const b64Regex = /['"]([A-Za-z0-9+/=]{200,})['"]/g;
    let b64Match;
    while ((b64Match = b64Regex.exec(content)) !== null) {
      findings.push({
        length: b64Match[1].length,
        preview: b64Match[1].slice(0, 50) + '...',
      });
    }
  }

  return findings;
}

/**
 * Skanna en enskild sida
 */
async function scanPage(url, siteHostname, allowedDomains) {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'CompunaMonitor/1.0' },
  });

  if (!res.ok) {
    return { url, status: res.status, error: `HTTP ${res.status}`, findings: [] };
  }

  const html = await res.text();
  const findings = [];

  // 1. Kritiska monster
  for (const pattern of CRITICAL_PATTERNS) {
    const matches = html.match(pattern.regex);
    if (matches) {
      findings.push({
        severity: 'critical',
        pattern: pattern.name,
        description: pattern.description,
        count: matches.length,
      });
    }
  }

  // 2. Varningsmonster
  for (const pattern of WARNING_PATTERNS) {
    const matches = html.match(pattern.regex);
    if (matches) {
      findings.push({
        severity: 'warning',
        pattern: pattern.name,
        description: pattern.description,
        count: matches.length,
      });
    }
  }

  // 3. Misstankt langa base64-strangar
  const b64Findings = findSuspiciousBase64(html);
  if (b64Findings.length > 0) {
    findings.push({
      severity: 'warning',
      pattern: 'Lang base64-strang i script',
      description: `${b64Findings.length} misstankt langa base64-strangar hittade`,
      count: b64Findings.length,
      details: b64Findings,
    });
  }

  // 4. Externa script-domaner
  const scriptDomains = extractExternalScriptDomains(html, siteHostname);

  // 5. Iframe-kallor
  const iframeDomains = extractIframeSources(html, siteHostname);

  // Kolla nya domaner mot tilllatna
  const newScriptDomains = scriptDomains.filter(d => !allowedDomains.includes(d));
  const newIframeDomains = iframeDomains.filter(d => !allowedDomains.includes(d));

  if (newScriptDomains.length > 0) {
    findings.push({
      severity: 'critical',
      pattern: 'Okant externt script',
      description: `Nya externa script-domaner: ${newScriptDomains.join(', ')}`,
      count: newScriptDomains.length,
      domains: newScriptDomains,
    });
  }

  if (newIframeDomains.length > 0) {
    findings.push({
      severity: 'critical',
      pattern: 'Okand extern iframe',
      description: `Nya externa iframe-kallor: ${newIframeDomains.join(', ')}`,
      count: newIframeDomains.length,
      domains: newIframeDomains,
    });
  }

  return {
    url,
    status: res.status,
    findings,
    externalScripts: scriptDomains,
    externalIframes: iframeDomains,
  };
}

/**
 * Hamta baseline fran DB (tillatna externa domaner)
 */
async function getBaseline(siteId) {
  try {
    const [rows] = await pool.execute(
      "SELECT file_path, file_hash FROM mon_baselines WHERE site_id = ? AND file_path = '_content:external_resources'",
      [siteId]
    );

    if (rows.length === 0) return null;

    // file_hash innehaller SHA256 av sorterad domanlista
    // Hamta faktiska domaner fran allowed_domains i mon_sites
    const [siteRows] = await pool.execute(
      'SELECT content_allowed_domains FROM mon_sites WHERE id = ?',
      [siteId]
    );

    const allowed = siteRows[0]?.content_allowed_domains;
    if (!allowed) return [];

    return allowed.split('\n').map(d => d.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Spara baseline — lista over tillatna externa domaner
 */
async function saveBaseline(siteId, domains) {
  const sorted = [...domains].sort();
  const hash = createHash('sha256').update(sorted.join(',')).digest('hex');

  // Spara hash i mon_baselines
  await pool.execute(
    `INSERT INTO mon_baselines (site_id, file_path, file_hash, file_size)
     VALUES (?, '_content:external_resources', ?, ?)
     ON DUPLICATE KEY UPDATE file_hash = VALUES(file_hash), file_size = VALUES(file_size), captured_at = NOW()`,
    [siteId, hash, sorted.length]
  );

  // Spara domanlista i mon_sites
  await pool.execute(
    'UPDATE mon_sites SET content_allowed_domains = ? WHERE id = ?',
    [sorted.join('\n'), siteId]
  );

  return sorted;
}

/**
 * Huvudfunktion — kör content-check for en sajt
 */
export async function runContentCheck(site) {
  const hostname = new URL(site.url).hostname;

  try {
    // Hamta URL:er att scanna
    const urls = [site.url];
    if (site.content_urls) {
      const extra = site.content_urls.split('\n').map(u => u.trim()).filter(Boolean);
      urls.push(...extra);
    }

    // Hamta baseline (tillatna domaner)
    let allowedDomains = await getBaseline(site.id);
    const isFirstRun = allowedDomains === null;
    if (isFirstRun) allowedDomains = [];

    // Skanna alla sidor
    const results = [];
    for (const url of urls) {
      try {
        const result = await scanPage(url, hostname, allowedDomains);
        results.push(result);
      } catch (err) {
        results.push({ url, error: err.message, findings: [] });
      }
    }

    // Samla alla fynd
    const allFindings = results.flatMap(r => r.findings);
    const hasCritical = allFindings.some(f => f.severity === 'critical');
    const hasWarning = allFindings.some(f => f.severity === 'warning');

    // Samla alla externa domaner (for baseline)
    const allExternalDomains = new Set();
    for (const r of results) {
      (r.externalScripts || []).forEach(d => allExternalDomains.add(d));
      (r.externalIframes || []).forEach(d => allExternalDomains.add(d));
    }

    // Forsta korningen: spara baseline automatiskt
    if (isFirstRun && allExternalDomains.size > 0) {
      await saveBaseline(site.id, [...allExternalDomains]);
      console.log(`  [MONITOR] Content baseline sparad for ${site.id}: ${[...allExternalDomains].join(', ')}`);
    }

    // Bestam status
    let status = 'ok';
    if (hasCritical && !isFirstRun) status = 'critical';
    else if (hasWarning) status = 'warning';

    // Bygg meddelande
    let message = `Innehall: ${urls.length} sidor skannade`;
    if (isFirstRun) {
      message += ` — baseline skapad (${allExternalDomains.size} externa domaner)`;
    } else if (allFindings.length > 0) {
      message += ` — ${allFindings.length} fynd`;
      if (hasCritical) message += ' (KRITISKT)';
    } else {
      message += ' — inga fynd';
    }

    return {
      siteId: site.id,
      type: 'content',
      status,
      responseMs: null,
      statusCode: null,
      message,
      details: {
        pagesScanned: urls.length,
        findings: allFindings,
        externalDomains: [...allExternalDomains],
        baselineCreated: isFirstRun,
        pages: results.map(r => ({
          url: r.url,
          status: r.status || null,
          error: r.error || null,
          findingCount: r.findings.length,
        })),
      },
    };
  } catch (err) {
    return {
      siteId: site.id,
      type: 'content',
      status: 'error',
      responseMs: null,
      statusCode: null,
      message: `Content-check misslyckades: ${err.message}`,
      details: { error: err.message },
    };
  }
}

/**
 * Acceptera nuvarande externa resurser som ny baseline
 * Anropas fran dashboard/API for att uppdatera tillatna domaner
 */
export async function acceptContentBaseline(siteId) {
  const [rows] = await pool.execute('SELECT url, content_urls FROM mon_sites WHERE id = ?', [siteId]);
  if (rows.length === 0) throw new Error(`Sajt ${siteId} finns inte`);

  const site = rows[0];
  const hostname = new URL(site.url).hostname;

  // Hamta alla URL:er
  const urls = [site.url];
  if (site.content_urls) {
    const extra = site.content_urls.split('\n').map(u => u.trim()).filter(Boolean);
    urls.push(...extra);
  }

  // Skanna och samla externa domaner
  const allDomains = new Set();
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'CompunaMonitor/1.0' },
      });
      const html = await res.text();
      extractExternalScriptDomains(html, hostname).forEach(d => allDomains.add(d));
      extractIframeSources(html, hostname).forEach(d => allDomains.add(d));
    } catch {
      // Sida otillganglig — hoppa over
    }
  }

  const saved = await saveBaseline(siteId, [...allDomains]);
  return { siteId, domains: saved };
}
