#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const INSTALLER_DIR = path.join(ROOT_DIR, 'installer');
const META_DIR = path.join(INSTALLER_DIR, '.sync-meta');
const STATE_FILE = path.join(META_DIR, 'state.json');
const LOG_FILE = path.join(META_DIR, 'sync.log');
const PID_FILE = path.join(META_DIR, 'watcher.pid');
const WATCHER_OUTPUT_FILE = path.join(META_DIR, 'watcher-output.log');
const WATCH_MODE = process.argv.includes('--watch');
const DAEMON_MODE = process.argv.includes('--daemon');
const STOP_MODE = process.argv.includes('--stop');
const STATUS_MODE = process.argv.includes('--status');
const FOREGROUND_WATCH_MODE = process.argv.includes('--foreground-watch');

const SOURCE_EXCLUDES = [
  '.git',
  'installer',
  'node_modules',
  '.gitignore',
];

function normalizeRel(relPath) {
  return String(relPath || '').split(path.sep).join('/');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readWatcherPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  const raw = String(fs.readFileSync(PID_FILE, 'utf8') || '').trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isPidRunning(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function cleanupWatcherPidFile() {
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
}

function writeWatcherPid() {
  ensureDir(META_DIR);
  fs.writeFileSync(PID_FILE, `${process.pid}\n`, 'utf8');
}

function isSourceExcluded(relPath) {
  const rel = normalizeRel(relPath);
  return SOURCE_EXCLUDES.some((item) => rel === item || rel.startsWith(item + '/'));
}

function isInternalInstallerPath(relPath) {
  const rel = normalizeRel(relPath);
  return rel === '.sync-meta' || rel.startsWith('.sync-meta/');
}

function walkFiles(baseDir, excludeFn) {
  const files = [];

  function visit(currentDir, currentRel) {
    if (!fs.existsSync(currentDir)) return;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = normalizeRel(path.join(currentRel, entry.name));
      if (excludeFn(rel, entry)) continue;

      const abs = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(abs, rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }

  visit(baseDir, '');
  return files.sort();
}

function hashFile(absPath) {
  const hash = crypto.createHash('sha1');
  hash.update(fs.readFileSync(absPath));
  return hash.digest('hex');
}

function buildSourceSnapshot() {
  const snapshot = {};
  const files = walkFiles(ROOT_DIR, (rel) => isSourceExcluded(rel));

  for (const rel of files) {
    const abs = path.join(ROOT_DIR, rel);
    const stat = fs.statSync(abs);
    snapshot[rel] = {
      hash: hashFile(abs),
      size: stat.size,
      mtimeMs: stat.mtimeMs
    };
  }

  return snapshot;
}

function listInstallerFiles() {
  return walkFiles(INSTALLER_DIR, (rel) => isInternalInstallerPath(rel));
}

function readPreviousState() {
  if (!fs.existsSync(STATE_FILE)) return {};

  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return raw && raw.files ? raw.files : {};
  } catch (error) {
    return {};
  }
}

function writeState(snapshot) {
  ensureDir(META_DIR);
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        files: snapshot
      },
      null,
      2
    ) + '\n',
    'utf8'
  );
}

function appendLog(entries) {
  if (!entries.length) return;

  ensureDir(META_DIR);
  const lines = entries.map((entry) => `${entry.timestamp} | ${entry.type} | ${entry.file}`).join('\n') + '\n';
  fs.appendFileSync(LOG_FILE, lines, 'utf8');
}

function removeEmptyInstallerDirs(dirPath) {
  if (!fs.existsSync(dirPath)) return;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const abs = path.join(dirPath, entry.name);
    const rel = normalizeRel(path.relative(INSTALLER_DIR, abs));
    if (isInternalInstallerPath(rel)) continue;

    removeEmptyInstallerDirs(abs);

    if (fs.existsSync(abs) && fs.readdirSync(abs).length === 0) {
      fs.rmdirSync(abs);
    }
  }
}

function syncInstaller() {
  ensureDir(INSTALLER_DIR);

  const sourceSnapshot = buildSourceSnapshot();
  const previousSnapshot = readPreviousState();
  const installerFiles = new Set(listInstallerFiles());
  const entries = [];
  const timestamp = new Date().toISOString();

  for (const [rel, meta] of Object.entries(sourceSnapshot)) {
    const prev = previousSnapshot[rel];
    const sourceAbs = path.join(ROOT_DIR, rel);
    const installerAbs = path.join(INSTALLER_DIR, rel);
    const existsInInstaller = fs.existsSync(installerAbs);
    const changed = !prev || prev.hash !== meta.hash || !existsInInstaller;

    if (changed) {
      ensureDir(path.dirname(installerAbs));
      fs.copyFileSync(sourceAbs, installerAbs);
      entries.push({
        timestamp,
        type: prev ? 'modify' : 'add',
        file: rel
      });
    }

    installerFiles.delete(rel);
  }

  const filesToDelete = new Set();

  for (const rel of Object.keys(previousSnapshot)) {
    if (!sourceSnapshot[rel]) filesToDelete.add(rel);
  }

  for (const rel of installerFiles) {
    if (!isInternalInstallerPath(rel)) filesToDelete.add(rel);
  }

  for (const rel of Array.from(filesToDelete).sort()) {
    const installerAbs = path.join(INSTALLER_DIR, rel);
    if (!fs.existsSync(installerAbs)) continue;
    if (!fs.statSync(installerAbs).isFile()) continue;

    fs.unlinkSync(installerAbs);
    entries.push({
      timestamp,
      type: 'delete',
      file: rel
    });
  }

  removeEmptyInstallerDirs(INSTALLER_DIR);
  writeState(sourceSnapshot);
  appendLog(entries);

  return {
    added: entries.filter((entry) => entry.type === 'add').length,
    modified: entries.filter((entry) => entry.type === 'modify').length,
    deleted: entries.filter((entry) => entry.type === 'delete').length,
    entries
  };
}

function printSummary(result) {
  const total = result.entries.length;
  if (!total) {
    console.log('[sync-installer] No changes detected.');
    return;
  }

  console.log(
    `[sync-installer] Completed. add=${result.added} modify=${result.modified} delete=${result.deleted}`
  );

  for (const entry of result.entries) {
    console.log(`[sync-installer] ${entry.timestamp} | ${entry.type} | ${entry.file}`);
  }
}

function runSync() {
  try {
    const result = syncInstaller();
    printSummary(result);
  } catch (error) {
    console.error('[sync-installer] Failed:', error && error.message ? error.message : error);
    process.exitCode = 1;
  }
}

function stopWatcher() {
  const pid = readWatcherPid();
  if (!pid) {
    console.log('[sync-installer] Watcher is not running.');
    return;
  }

  if (!isPidRunning(pid)) {
    cleanupWatcherPidFile();
    console.log('[sync-installer] Removed stale watcher PID file.');
    return;
  }

  try {
    process.kill(pid);
    console.log(`[sync-installer] Stopped watcher PID ${pid}.`);
  } catch (error) {
    console.error('[sync-installer] Failed to stop watcher:', error && error.message ? error.message : error);
    process.exitCode = 1;
  }
}

function printWatcherStatus() {
  const pid = readWatcherPid();
  if (!pid) {
    console.log('[sync-installer] Watcher status: stopped');
    return;
  }

  if (!isPidRunning(pid)) {
    cleanupWatcherPidFile();
    console.log('[sync-installer] Watcher status: stopped (stale PID removed)');
    return;
  }

  console.log(`[sync-installer] Watcher status: running (PID ${pid})`);
}

function startWatcherDaemon() {
  const existingPid = readWatcherPid();
  if (existingPid && isPidRunning(existingPid)) {
    console.log(`[sync-installer] Watcher already running (PID ${existingPid}).`);
    return;
  }

  cleanupWatcherPidFile();
  ensureDir(META_DIR);
  const out = fs.openSync(WATCHER_OUTPUT_FILE, 'a');
  const err = fs.openSync(WATCHER_OUTPUT_FILE, 'a');
  const child = spawn(process.execPath, [__filename, '--watch', '--foreground-watch'], {
    cwd: ROOT_DIR,
    detached: true,
    stdio: ['ignore', out, err]
  });
  child.unref();
  console.log(`[sync-installer] Watcher daemon started (PID ${child.pid}).`);
}

function startWatchMode() {
  let timer = null;
  let isRunning = false;
  let pending = false;

  const scheduleSync = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (isRunning) {
        pending = true;
        return;
      }

      isRunning = true;
      try {
        const result = syncInstaller();
        printSummary(result);
      } catch (error) {
        console.error('[sync-installer] Failed:', error && error.message ? error.message : error);
      } finally {
        isRunning = false;
        if (pending) {
          pending = false;
          scheduleSync();
        }
      }
    }, 250);
  };

  writeWatcherPid();
  const cleanup = () => {
    try {
      const pid = readWatcherPid();
      if (pid === process.pid) cleanupWatcherPidFile();
    } catch (error) { }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGHUP', () => {
    cleanup();
    process.exit(0);
  });

  console.log('[sync-installer] Watch mode enabled.');
  runSync();

  fs.watch(ROOT_DIR, { recursive: true }, (eventType, filename) => {
    const rel = normalizeRel(filename || '');
    if (!rel || isSourceExcluded(rel)) return;
    console.log(`[sync-installer] Detected ${eventType}: ${rel}`);
    scheduleSync();
  });
}

if (STOP_MODE) {
  stopWatcher();
} else if (STATUS_MODE) {
  printWatcherStatus();
} else if (DAEMON_MODE) {
  startWatcherDaemon();
} else if (WATCH_MODE || FOREGROUND_WATCH_MODE) {
  startWatchMode();
} else {
  runSync();
}
