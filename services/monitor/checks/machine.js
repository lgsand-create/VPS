/**
 * Machine Check — systemhalsa via SSH eller lokalt
 *
 * Samlar CPU-load, RAM, disk, GPU och tjanstestatus i en enda
 * SSH-session (eller lokalt for VPS). Returnerar separata
 * check-resultat for ping, system och services.
 */

import { execFile } from 'child_process';
import { readFileSync } from 'fs';

/**
 * Kor alla checks for en maskin. Returnerar array av resultat.
 */
export async function runMachineChecks(machine) {
  const start = Date.now();
  const results = [];

  // 1. Ping (TCP connect till SSH-port)
  if (machine.check_ping && machine.collect_method !== 'local') {
    results.push(await runPingCheck(machine));
  }

  // 2. System + 3. Services — samla via en session
  if (machine.check_system || machine.check_services) {
    try {
      const raw = machine.collect_method === 'local'
        ? await collectLocal(machine)
        : await collectSsh(machine);

      if (machine.check_system) {
        results.push(buildSystemResult(machine, raw, Date.now() - start));
      }
      if (machine.check_services) {
        results.push(buildServicesResult(machine, raw, Date.now() - start));
      }
    } catch (err) {
      const ms = Date.now() - start;
      if (machine.check_system) {
        results.push({
          machineId: machine.id, type: 'system', status: 'error',
          responseMs: ms, message: `Datainsamling misslyckades: ${err.message}`,
          details: { error: err.message },
        });
      }
      if (machine.check_services) {
        results.push({
          machineId: machine.id, type: 'services', status: 'error',
          responseMs: ms, message: `Datainsamling misslyckades: ${err.message}`,
          details: { error: err.message },
        });
      }
    }
  }

  return results;
}

// ————————————————————————————————————————
// Ping (TCP connect)
// ————————————————————————————————————————

async function runPingCheck(machine) {
  const start = Date.now();
  const port = machine.ssh_port || 22;

  try {
    const { createConnection } = await import('net');

    await new Promise((resolve, reject) => {
      const sock = createConnection({ host: machine.host, port, timeout: 5000 });
      sock.on('connect', () => { sock.destroy(); resolve(); });
      sock.on('timeout', () => { sock.destroy(); reject(new Error('Timeout')); });
      sock.on('error', reject);
    });

    const ms = Date.now() - start;
    return {
      machineId: machine.id, type: 'ping', status: 'ok',
      responseMs: ms, message: `Ping OK (${ms}ms)`,
      details: { host: machine.host, port },
    };
  } catch (err) {
    return {
      machineId: machine.id, type: 'ping', status: 'critical',
      responseMs: Date.now() - start,
      message: `Maskin ej nåbar: ${err.message}`,
      details: { host: machine.host, port, error: err.message },
    };
  }
}

// ————————————————————————————————————————
// Lokal datainsamling (VPS)
// ————————————————————————————————————————

async function collectLocal(machine) {
  const diskPaths = parseDiskPaths(machine);
  const services = parseServices(machine);

  const [loadavg, memInfo, diskInfo, uptimeStr, ...serviceResults] = await Promise.all([
    execCommand('cat', ['/proc/loadavg']),
    execCommand('free', ['-m']),
    execCommand('df', ['-P', ...diskPaths]),
    execCommand('cat', ['/proc/uptime']),
    ...services.map(s => execCommand('systemctl', ['is-active', s]).catch(() => 'inactive')),
  ]);

  const nproc = await execCommand('nproc', []);

  // GPU (lokalt)
  let gpuRaw = null;
  if (machine.check_gpu) {
    try {
      gpuRaw = await execCommand('nvidia-smi', [
        '--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,name,power.draw',
        '--format=csv,noheader,nounits',
      ]);
    } catch { /* ingen GPU tillganglig */ }
  }

  return {
    loadavg: loadavg.trim(),
    mem: memInfo.trim(),
    disk: diskInfo.trim(),
    uptime: uptimeStr.trim(),
    cores: parseInt(nproc.trim(), 10) || 1,
    serviceChecks: Object.fromEntries(services.map((s, i) => [s, serviceResults[i].trim() === 'active'])),
    gpu: gpuRaw ? parseGpuOutput(gpuRaw.trim()) : null,
  };
}

function execCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

// ————————————————————————————————————————
// SSH-datainsamling
// ————————————————————————————————————————

async function collectSsh(machine) {
  const { Client } = await import('ssh2');
  const diskPaths = parseDiskPaths(machine);
  const services = parseServices(machine);
  const hasGpu = !!machine.check_gpu;

  // Bygg ett samlat shell-kommando
  const serviceChecks = services.length > 0
    ? services.map(s => `echo "SVC:${s}:$(systemctl is-active '${s}' 2>/dev/null || pgrep -x '${s}' >/dev/null 2>&1 && echo active || echo inactive)"`).join('; ')
    : 'echo "SVC:none:skip"';

  const cmdParts = [
    'cat /proc/loadavg',
    'echo "---SEPARATOR---"',
    'free -m',
    'echo "---SEPARATOR---"',
    `df -P ${diskPaths.join(' ')} 2>/dev/null`,
    'echo "---SEPARATOR---"',
    'cat /proc/uptime',
    'echo "---SEPARATOR---"',
    'nproc',
    'echo "---SEPARATOR---"',
    serviceChecks,
  ];

  // GPU-sektion (bara om maskinen har GPU)
  if (hasGpu) {
    cmdParts.push(
      'echo "---SEPARATOR---"',
      'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,name,power.draw --format=csv,noheader,nounits 2>/dev/null || echo "NO_GPU"',
    );
  }

  const cmd = cmdParts.join('; ');

  const sshKeyPath = machine.ssh_key_env ? process.env[machine.ssh_key_env] : null;
  const sshPassword = machine.ssh_password_env ? process.env[machine.ssh_password_env] : null;

  let privateKey = null;
  if (sshKeyPath) {
    try { privateKey = readFileSync(sshKeyPath, 'utf8'); } catch { /* fallback till losenord */ }
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timeout = setTimeout(() => { conn.end(); reject(new Error('SSH timeout (15s)')); }, 15000);

    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timeout); conn.end(); return reject(err); }

        let stdout = '';
        stream.on('data', (data) => { stdout += data; });
        stream.stderr.on('data', () => { /* ignorera stderr */ });
        stream.on('close', () => {
          clearTimeout(timeout);
          conn.end();

          try {
            const parts = stdout.split('---SEPARATOR---');
            const minParts = hasGpu ? 7 : 6;
            if (parts.length < minParts) {
              return reject(new Error('Ofullstandigt svar fran SSH'));
            }

            const serviceLines = parts[5].trim().split('\n').filter(l => l.startsWith('SVC:'));
            const serviceChecks = {};
            for (const line of serviceLines) {
              const [, name, status] = line.split(':');
              if (name && name !== 'none') {
                serviceChecks[name] = status === 'active';
              }
            }

            // GPU-parsning
            let gpu = null;
            if (hasGpu && parts[6]) {
              gpu = parseGpuOutput(parts[6].trim());
            }

            resolve({
              loadavg: parts[0].trim(),
              mem: parts[1].trim(),
              disk: parts[2].trim(),
              uptime: parts[3].trim(),
              cores: parseInt(parts[4].trim(), 10) || 1,
              serviceChecks,
              gpu,
            });
          } catch (parseErr) {
            reject(new Error(`Parsningsfel: ${parseErr.message}`));
          }
        });
      });
    });

    conn.on('error', (err) => { clearTimeout(timeout); reject(err); });

    const connectOpts = {
      host: machine.host,
      port: machine.ssh_port || 22,
      username: machine.ssh_user || 'root',
      readyTimeout: 10000,
    };
    if (privateKey) connectOpts.privateKey = privateKey;
    else if (sshPassword) connectOpts.password = sshPassword;

    conn.connect(connectOpts);
  });
}

// ————————————————————————————————————————
// GPU-parsning
// ————————————————————————————————————————

function parseGpuOutput(raw) {
  if (!raw || raw === 'NO_GPU') return null;

  try {
    // Format: "45, 5120, 16384, 55, NVIDIA GeForce RTX 5060 Ti, 85.50"
    const parts = raw.split(',').map(s => s.trim());
    if (parts.length < 5) return null;

    const utilPct = parseInt(parts[0], 10) || 0;
    const vramUsedMb = parseInt(parts[1], 10) || 0;
    const vramTotalMb = parseInt(parts[2], 10) || 0;
    const tempC = parseInt(parts[3], 10) || 0;
    const name = parts[4] || 'Okand GPU';
    const powerW = parseFloat(parts[5]) || 0;
    const vramPct = vramTotalMb > 0 ? Math.round((vramUsedMb / vramTotalMb) * 100) : 0;

    return { utilPct, vramUsedMb, vramTotalMb, vramPct, tempC, powerW, name };
  } catch {
    return null;
  }
}

// ————————————————————————————————————————
// Resultatbyggare
// ————————————————————————————————————————

function buildSystemResult(machine, raw, responseMs) {
  // CPU — parsa /proc/loadavg
  const loadParts = raw.loadavg.split(' ');
  const load1 = parseFloat(loadParts[0]) || 0;
  const load5 = parseFloat(loadParts[1]) || 0;
  const load15 = parseFloat(loadParts[2]) || 0;
  const cores = raw.cores;
  const cpuPct = Math.min(Math.round((load1 / cores) * 100), 100);

  // RAM — parsa free -m
  const memLine = raw.mem.split('\n').find(l => l.startsWith('Mem:'));
  let ramTotal = 0, ramUsed = 0, ramAvailable = 0, ramPct = 0;
  if (memLine) {
    const memParts = memLine.split(/\s+/);
    ramTotal = parseInt(memParts[1], 10) || 0;
    ramUsed = parseInt(memParts[2], 10) || 0;
    ramAvailable = parseInt(memParts[6], 10) || ramTotal - ramUsed;
    ramPct = ramTotal > 0 ? Math.round(((ramTotal - ramAvailable) / ramTotal) * 100) : 0;
  }

  // Disk — parsa df -P
  const diskLines = raw.disk.split('\n').filter(l => l && !l.startsWith('Filesystem'));
  const mounts = diskLines.map(line => {
    const parts = line.split(/\s+/);
    const totalKb = parseInt(parts[1], 10) || 0;
    const usedKb = parseInt(parts[2], 10) || 0;
    const pct = parseInt(parts[4], 10) || 0;
    return {
      path: parts[5] || '/',
      pct,
      usedGb: +(usedKb / 1048576).toFixed(1),
      totalGb: +(totalKb / 1048576).toFixed(1),
    };
  });
  const worstDisk = mounts.reduce((a, b) => (b.pct > a.pct ? b : a), { pct: 0 });

  // Uptime — parsa /proc/uptime
  const uptimeSecs = parseFloat(raw.uptime.split(' ')[0]) || 0;
  const uptimeDays = Math.floor(uptimeSecs / 86400);

  // Bestam overall status
  const thresholds = {
    cpuWarn: machine.threshold_cpu_warn || 90,
    cpuCrit: machine.threshold_cpu_crit || 95,
    ramWarn: machine.threshold_ram_warn || 85,
    ramCrit: machine.threshold_ram_crit || 95,
    diskWarn: machine.threshold_disk_warn || 80,
    diskCrit: machine.threshold_disk_crit || 90,
    gpuWarn: machine.threshold_gpu_warn || 85,
    gpuCrit: machine.threshold_gpu_crit || 95,
    vramWarn: machine.threshold_vram_warn || 80,
    vramCrit: machine.threshold_vram_crit || 90,
    gpuTempWarn: machine.threshold_gpu_temp_warn || 80,
    gpuTempCrit: machine.threshold_gpu_temp_crit || 90,
  };

  let status = 'ok';
  const warnings = [];

  if (cpuPct >= thresholds.cpuCrit) { status = 'critical'; warnings.push(`CPU ${cpuPct}%`); }
  else if (cpuPct >= thresholds.cpuWarn) { status = maxStatus(status, 'warning'); warnings.push(`CPU ${cpuPct}%`); }

  if (ramPct >= thresholds.ramCrit) { status = 'critical'; warnings.push(`RAM ${ramPct}%`); }
  else if (ramPct >= thresholds.ramWarn) { status = maxStatus(status, 'warning'); warnings.push(`RAM ${ramPct}%`); }

  if (worstDisk.pct >= thresholds.diskCrit) { status = 'critical'; warnings.push(`Disk ${worstDisk.path} ${worstDisk.pct}%`); }
  else if (worstDisk.pct >= thresholds.diskWarn) { status = maxStatus(status, 'warning'); warnings.push(`Disk ${worstDisk.path} ${worstDisk.pct}%`); }

  // GPU-trosklar
  const gpu = raw.gpu || null;
  if (gpu) {
    if (gpu.utilPct >= thresholds.gpuCrit) { status = 'critical'; warnings.push(`GPU ${gpu.utilPct}%`); }
    else if (gpu.utilPct >= thresholds.gpuWarn) { status = maxStatus(status, 'warning'); warnings.push(`GPU ${gpu.utilPct}%`); }

    if (gpu.vramPct >= thresholds.vramCrit) { status = 'critical'; warnings.push(`VRAM ${gpu.vramPct}%`); }
    else if (gpu.vramPct >= thresholds.vramWarn) { status = maxStatus(status, 'warning'); warnings.push(`VRAM ${gpu.vramPct}%`); }

    if (gpu.tempC >= thresholds.gpuTempCrit) { status = 'critical'; warnings.push(`GPU temp ${gpu.tempC}°C`); }
    else if (gpu.tempC >= thresholds.gpuTempWarn) { status = maxStatus(status, 'warning'); warnings.push(`GPU temp ${gpu.tempC}°C`); }
  }

  // Bygg meddelande
  let message;
  if (status === 'ok') {
    const parts = [`CPU ${cpuPct}%`, `RAM ${ramPct}%`, `Disk ${worstDisk.pct}%`];
    if (gpu) parts.push(`GPU ${gpu.utilPct}%`);
    message = `${parts.join(', ')} — uptime ${uptimeDays}d`;
  } else {
    message = warnings.join(', ');
  }

  const details = {
    cpu: { load1, load5, load15, cores, pct: cpuPct },
    ram: { totalMb: ramTotal, usedMb: ramUsed, availableMb: ramAvailable, pct: ramPct },
    disk: { mounts, worstPct: worstDisk.pct },
    uptime: { seconds: uptimeSecs, days: uptimeDays },
  };

  if (gpu) {
    details.gpu = gpu;
  }

  return {
    machineId: machine.id,
    type: 'system',
    status,
    responseMs,
    message,
    details,
  };
}

function buildServicesResult(machine, raw, responseMs) {
  const checks = raw.serviceChecks;
  const services = Object.entries(checks);
  const down = services.filter(([, ok]) => !ok).map(([name]) => name);

  if (services.length === 0) {
    return {
      machineId: machine.id, type: 'services', status: 'ok',
      responseMs, message: 'Inga tjanster konfigurerade',
      details: { services: {}, down: [] },
    };
  }

  const status = down.length > 0 ? 'critical' : 'ok';
  const message = down.length > 0
    ? `${down.length} tjanst${down.length > 1 ? 'er' : ''} nere: ${down.join(', ')}`
    : `${services.length} tjanst${services.length > 1 ? 'er' : ''} OK`;

  return {
    machineId: machine.id,
    type: 'services',
    status,
    responseMs,
    message,
    details: { services: checks, down },
  };
}

// ————————————————————————————————————————
// Hjalpar
// ————————————————————————————————————————

function parseDiskPaths(machine) {
  if (!machine.disk_paths) return ['/'];
  try { return JSON.parse(machine.disk_paths); } catch { /* */ }
  return machine.disk_paths.split('\n').map(s => s.trim()).filter(Boolean);
}

function parseServices(machine) {
  if (!machine.services) return [];
  try { return JSON.parse(machine.services); } catch { /* */ }
  return machine.services.split('\n').map(s => s.trim()).filter(Boolean);
}

function maxStatus(current, next) {
  const rank = { ok: 0, warning: 1, critical: 2, error: 3 };
  return rank[next] > rank[current] ? next : current;
}
