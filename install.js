#!/usr/bin/env node
/**
 * First Install Wizard
 *
 * Menyiapkan paket aplikasi untuk instalasi pertama kali:
 * - deteksi environment lokal
 * - install dependency npm jika dibutuhkan
 * - generate konfigurasi domain + wrangler vars
 * - generate file env lokal
 * - generate seed data Google Sheets
 * - generate template Script Properties Apps Script
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const readline = require('readline');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const argSet = new Set(args);
const nonInteractive = argSet.has('--non-interactive') || argSet.has('--yes');
const skipNpmInstall = argSet.has('--skip-npm-install');
const targetDir = path.resolve(getArgValue('--target-dir') || process.cwd());
const outputDir = path.join(targetDir, '.setup-output');
const seedDir = path.join(outputDir, 'seed-data');

const DEFAULT_SITE_TAGLINE = 'Platform membership, katalog, dan affiliate siap deploy';
const DEFAULT_SHEETS = ['Settings', 'Users', 'Orders', 'Access_Rules', 'Pages'];

function getArgValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return '';
  return args[index + 1] || '';
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function fileExists(relPath) {
  return fs.existsSync(path.join(targetDir, relPath));
}

function readText(relPath) {
  return fs.readFileSync(path.join(targetDir, relPath), 'utf8');
}

function writeText(relPath, value) {
  const absPath = path.join(targetDir, relPath);
  ensureDir(path.dirname(absPath));
  fs.writeFileSync(absPath, value, 'utf8');
}

function csvEscape(value) {
  const text = String(value === null || value === undefined ? '' : value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}

function normalizeDomain(domain) {
  return String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function validateDomain(domain) {
  const value = normalizeDomain(domain);
  const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;
  if (!value) return { valid: false, error: 'Domain tidak boleh kosong.' };
  if (!domainRegex.test(value)) return { valid: false, error: `Format domain "${value}" tidak valid.` };
  return { valid: true, value };
}

function normalizeUrl(url) {
  return String(url || '').trim();
}

function isValidUrl(url, { allowEmpty = true } = {}) {
  const value = normalizeUrl(url);
  if (!value) return allowEmpty;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (error) {
    return false;
  }
}

function isValidEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizePhone(value) {
  return String(value || '').trim().replace(/[^\d+]/g, '');
}

function randomToken(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function hashPassword(value) {
  return 'sha256$' + crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function currentIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function runCommand(command, commandArgs, options = {}) {
  const execute = (binary, spawnArgs) => spawnSync(binary, spawnArgs, {
    cwd: options.cwd || targetDir,
    encoding: 'utf8',
    shell: false
  });
  let result = execute(command, commandArgs);
  if (
    result.error &&
    process.platform === 'win32' &&
    !/\.cmd$/i.test(command) &&
    ['npm', 'npx'].includes(command)
  ) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    const cmdLine = `${command}.cmd ${commandArgs.join(' ')}`.trim();
    result = execute(comspec, ['/d', '/s', '/c', cmdLine]);
  }

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error || null
  };
}

function detectCommand(command, versionArgs) {
  const result = runCommand(command, versionArgs);
  if (result.error) {
    return {
      available: false,
      version: '',
      detail: result.error.code || result.error.message || 'not found'
    };
  }
  return {
    available: result.ok,
    version: result.ok ? (result.stdout.split(/\r?\n/)[0] || '').trim() : '',
    detail: result.ok ? '' : (result.stderr || `exit:${result.status}`)
  };
}

function readSiteConfigSnapshot() {
  if (!fileExists('site.config.js')) return null;
  try {
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(readText('site.config.js'), sandbox);
    return sandbox.SITE_CONFIG || null;
  } catch (error) {
    return null;
  }
}

function readWranglerVarsSnapshot() {
  if (!fileExists('wrangler.jsonc')) return {};
  const content = readText('wrangler.jsonc');
  const vars = {};
  ['ALLOWED_ORIGINS', 'APP_GAS_URL', 'MOOTA_GAS_URL', 'MOOTA_TOKEN'].forEach((key) => {
    const match = content.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i'));
    vars[key] = match ? match[1] : '';
  });
  return vars;
}

function buildAllowedDomains(primaryDomain, extraDomains) {
  const ordered = [];
  const pushUnique = (value) => {
    const normalized = normalizeDomain(value);
    if (!normalized || ordered.includes(normalized)) return;
    ordered.push(normalized);
  };

  const baseDomain = normalizeDomain(primaryDomain).replace(/^www\./, '');
  pushUnique(baseDomain);
  pushUnique(`www.${baseDomain}`);

  extraDomains.forEach((domain) => {
    const normalized = normalizeDomain(domain);
    if (!normalized) return;
    const withoutWww = normalized.replace(/^www\./, '');
    pushUnique(withoutWww);
    pushUnique(`www.${withoutWww}`);
  });

  return ordered;
}

function buildAllowedSuffixes(domains) {
  const suffixes = [];
  domains.forEach((domain) => {
    const base = normalizeDomain(domain).replace(/^www\./, '');
    const suffix = base ? `.${base}` : '';
    if (suffix && !suffixes.includes(suffix)) suffixes.push(suffix);
  });
  return suffixes;
}

function generateSiteConfigFile(config) {
  return `/**
 * ============================================
 * SITE CONFIGURATION - Edit this file only!
 * ============================================
 *
 * Generated by install.js on ${new Date().toISOString()}.
 */
var SITE_CONFIG = {
    PRIMARY_DOMAIN: '${config.primaryDomain}',
    APP_BASE_URL: '${config.appBaseUrl}',
    ALLOWED_DOMAINS: [
${config.allowedDomains.map((domain) => `        '${domain}'`).join(',\n')}
    ],
    ALLOWED_SUBDOMAIN_SUFFIXES: [
${config.allowedSuffixes.map((suffix) => `        '${suffix}'`).join(',\n')}
    ],
    ALLOW_PAGES_DEV: true,
    ALLOW_LOCALHOST: true
};
`;
}

function upsertJsoncVar(content, key, value) {
  const escaped = String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const pattern = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`);
  if (pattern.test(content)) {
    return content.replace(pattern, `$1"${escaped}"`);
  }
  if (/"vars"\s*:\s*\{/.test(content)) {
    return content.replace(/("vars"\s*:\s*\{)/, `$1\n    "${key}": "${escaped}",`);
  }
  return content;
}

function updateWranglerConfig(config) {
  if (!fileExists('wrangler.jsonc')) return;
  let content = readText('wrangler.jsonc');
  content = upsertJsoncVar(content, 'ALLOWED_ORIGINS', config.allowedOrigins);
  content = upsertJsoncVar(content, 'APP_GAS_URL', config.appGasUrl);
  content = upsertJsoncVar(content, 'MOOTA_GAS_URL', config.mootaGasUrl);
  content = upsertJsoncVar(content, 'MOOTA_TOKEN', config.mootaToken);
  writeText('wrangler.jsonc', content);
}

function generateEnvExample() {
  return `# First Install Wizard reference file
# Copy this file to .env.local and fill the actual values.

PRIMARY_DOMAIN=example.com
APP_BASE_URL=https://example.com
ALLOWED_DOMAINS=example.com,www.example.com
APP_GAS_URL=https://script.google.com/macros/s/REPLACE_ME/exec
MOOTA_GAS_URL=https://example.com/webhook/moota
MOOTA_TOKEN=replace-me
ADMIN_API_TOKEN=replace-me
SPREADSHEET_ID=replace-me
SPREADSHEET_NAME=Cepat Top Database
SITE_NAME=Cepat Top
SITE_TAGLINE=${DEFAULT_SITE_TAGLINE}
CONTACT_EMAIL=admin@example.com
WA_ADMIN=6281234567890
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=ChangeMe123!
ADMIN_NAME=Administrator
`;
}

function generateEnvLocal(config) {
  return `PRIMARY_DOMAIN=${config.primaryDomain}
APP_BASE_URL=${config.appBaseUrl}
ALLOWED_DOMAINS=${config.allowedDomains.join(',')}
APP_GAS_URL=${config.appGasUrl}
MOOTA_GAS_URL=${config.mootaGasUrl}
MOOTA_TOKEN=${config.mootaToken}
ADMIN_API_TOKEN=${config.adminApiToken}
SPREADSHEET_ID=${config.spreadsheetId}
SPREADSHEET_NAME=${config.spreadsheetName}
SITE_NAME=${config.siteName}
SITE_TAGLINE=${config.siteTagline}
CONTACT_EMAIL=${config.contactEmail}
WA_ADMIN=${config.waAdmin}
ADMIN_EMAIL=${config.adminEmail}
ADMIN_PASSWORD=${config.adminPassword}
ADMIN_NAME=${config.adminName}
`;
}

function createSeedFiles(config) {
  ensureDir(seedDir);

  const settingsRows = [
    ['key', 'value'],
    ['site_name', config.siteName],
    ['site_tagline', config.siteTagline],
    ['contact_email', config.contactEmail],
    ['wa_admin', config.waAdmin],
    ['site_logo', ''],
    ['site_favicon', ''],
    ['bank_name', ''],
    ['bank_norek', ''],
    ['bank_atas_nama', ''],
    ['fonnte_token', ''],
    ['ik_public_key', ''],
    ['ik_endpoint', ''],
    ['cf_zone_id', ''],
    ['cf_api_token', ''],
    ['moota_gas_url', config.mootaGsaUrlForSheet]
  ];

  const usersRows = [
    ['user_id', 'email', 'password', 'nama_lengkap', 'role', 'status', 'tanggal_bergabung', 'expired_at'],
    ['ADMIN', config.adminEmail, hashPassword(config.adminPassword), config.adminName, 'admin', 'Active', currentIsoDate(), '-']
  ];

  const ordersRows = [
    ['invoice', 'email', 'nama', 'wa', 'id_produk', 'nama_produk', 'tagihan', 'status', 'tanggal', 'affiliate', 'komisi']
  ];

  const accessRulesRows = [
    ['id_produk', 'title', 'desc', 'url', 'harga', 'status', 'lp_url', 'image_url', 'pixel_id', 'pixel_token', 'pixel_test_code', 'commission']
  ];

  const pagesRows = [
    ['id', 'slug', 'title', 'content', 'status', 'created_at', 'owner_id', 'meta_pixel_id', 'meta_pixel_token', 'meta_pixel_test_event', 'theme_mode']
  ];

  const affiliatePixelsRows = [
    ['user_id', 'product_id', 'pixel_id', 'pixel_token', 'pixel_test_code']
  ];

  const files = {
    'Settings.csv': settingsRows,
    'Users.csv': usersRows,
    'Orders.csv': ordersRows,
    'Access_Rules.csv': accessRulesRows,
    'Pages.csv': pagesRows,
    'Affiliate_Pixels.csv': affiliatePixelsRows
  };

  Object.entries(files).forEach(([filename, rows]) => {
    fs.writeFileSync(path.join(seedDir, filename), rowsToCsv(rows), 'utf8');
  });
}

function createSetupOutputs(config, detection) {
  ensureDir(outputDir);

  const databaseConnection = {
    driver: 'google-sheets-apps-script',
    spreadsheetId: config.spreadsheetId,
    spreadsheetName: config.spreadsheetName,
    appsScriptWebAppUrl: config.appGasUrl,
    requiredSheets: DEFAULT_SHEETS,
    generatedAt: new Date().toISOString()
  };

  const appDefaults = {
    site: {
      primaryDomain: config.primaryDomain,
      appBaseUrl: config.appBaseUrl,
      siteName: config.siteName,
      siteTagline: config.siteTagline,
      contactEmail: config.contactEmail,
      waAdmin: config.waAdmin
    },
    cloudflare: {
      allowedOrigins: config.allowedOrigins,
      appGasUrl: config.appGasUrl,
      mootaGasUrl: config.mootaGsaUrlForSheet,
      mootaToken: config.mootaToken
    },
    adminBootstrap: {
      email: config.adminEmail,
      name: config.adminName,
      password_hash: hashPassword(config.adminPassword)
    }
  };

  const scriptProperties = {
    APP_SCRIPT_URL: config.appGasUrl,
    ADMIN_API_TOKEN: config.adminApiToken,
    moota_token: config.mootaToken,
    ik_private_key: '',
    DEBUG_MODE: 'false'
  };

  const summaryLines = [
    '# First Install Summary',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## Environment Detection',
    `- OS: ${detection.os}`,
    `- Architecture: ${detection.arch}`,
    `- Node.js: ${detection.node}`,
    `- npm: ${detection.npm.available ? detection.npm.version : 'not found'}`,
    `- git: ${detection.git.available ? detection.git.version : 'not found'}`,
    `- wrangler config: ${detection.hasWranglerConfig ? 'found' : 'missing'}`,
    '',
    '## Applied Configuration',
    `- PRIMARY_DOMAIN: ${config.primaryDomain}`,
    `- APP_BASE_URL: ${config.appBaseUrl}`,
    `- APP_GAS_URL: ${config.appGasUrl}`,
    `- MOOTA_GAS_URL: ${config.mootaGsaUrlForSheet}`,
    `- SPREADSHEET_ID: ${config.spreadsheetId || '(belum diisi)'}`,
    `- SPREADSHEET_NAME: ${config.spreadsheetName || '(belum diisi)'}`,
    `- ADMIN_EMAIL: ${config.adminEmail}`,
    '',
    '## Generated Files',
    '- site.config.js',
    '- wrangler.jsonc',
    '- .env.local',
    '- .setup-output/database.connection.json',
    '- .setup-output/default-app-config.json',
    '- .setup-output/apps-script-properties.json',
    '- .setup-output/seed-data/*.csv',
    '',
    '## Next Steps',
    '1. Buat atau buka Google Spreadsheet target.',
    '2. Import CSV dari .setup-output/seed-data ke sheet dengan nama yang sama.',
    '3. Paste appscript.js ke Google Apps Script yang terhubung dengan spreadsheet tersebut.',
    '4. Isi Script Properties dari file .setup-output/apps-script-properties.json.',
    '5. Deploy Apps Script sebagai Web App lalu pastikan APP_GAS_URL sudah benar.',
    '6. Deploy Cloudflare Worker / Pages dengan wrangler.jsonc yang sudah terisi.',
    '7. Jalankan node validate-config.js untuk final check.'
  ];

  fs.writeFileSync(path.join(outputDir, 'database.connection.json'), JSON.stringify(databaseConnection, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outputDir, 'default-app-config.json'), JSON.stringify(appDefaults, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outputDir, 'apps-script-properties.json'), JSON.stringify(scriptProperties, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outputDir, 'INSTALL_SUMMARY.md'), summaryLines.join('\n') + '\n', 'utf8');
}

function detectEnvironment() {
  return {
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    node: process.version,
    npm: detectCommand('npm', ['--version']),
    git: detectCommand('git', ['--version']),
    npx: detectCommand('npx', ['--version']),
    hasWranglerConfig: fileExists('wrangler.jsonc'),
    hasPackageJson: fileExists('package.json'),
    cwd: targetDir
  };
}

function installNpmDependencies(detection) {
  if (skipNpmInstall) {
    return { skipped: true, reason: '--skip-npm-install digunakan' };
  }
  if (!detection.hasPackageJson) {
    return { skipped: true, reason: 'package.json tidak ditemukan' };
  }

  let pkg = {};
  try {
    pkg = JSON.parse(readText('package.json'));
  } catch (error) {
    return { skipped: true, reason: 'package.json tidak valid' };
  }

  const depCount = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
  if (depCount === 0) {
    return { skipped: true, reason: 'tidak ada dependency npm yang perlu diinstall' };
  }
  if (!detection.npm.available) {
    throw new Error('npm tidak ditemukan. Silakan install Node.js lengkap terlebih dahulu.');
  }

  const result = runCommand('npm', ['install']);
  if (!result.ok) {
    throw new Error(`npm install gagal: ${result.stderr || result.stdout || 'unknown error'}`);
  }
  return { skipped: false, reason: '', detail: result.stdout };
}

function parseCommaList(value) {
  return String(value || '')
    .split(',')
    .map((item) => normalizeDomain(item))
    .filter(Boolean);
}

function deriveDefaults() {
  const siteConfig = readSiteConfigSnapshot() || {};
  const wranglerVars = readWranglerVarsSnapshot();
  const primaryDomain = normalizeDomain(process.env.INSTALLER_PRIMARY_DOMAIN || siteConfig.PRIMARY_DOMAIN || 'example.com');
  const baseDomain = primaryDomain.replace(/^www\./, '');
  const allowedDomains = Array.isArray(siteConfig.ALLOWED_DOMAINS) ? siteConfig.ALLOWED_DOMAINS : [];
  const extraDomains = allowedDomains
    .map((domain) => normalizeDomain(domain))
    .filter((domain) => domain && domain !== baseDomain && domain !== `www.${baseDomain}`);

  return {
    primaryDomain: baseDomain,
    extraDomains: parseCommaList(process.env.INSTALLER_EXTRA_DOMAINS || extraDomains.join(',')),
    appGasUrl: normalizeUrl(process.env.INSTALLER_APP_GAS_URL || wranglerVars.APP_GAS_URL || ''),
    mootaGasUrl: normalizeUrl(process.env.INSTALLER_MOOTA_GAS_URL || wranglerVars.MOOTA_GAS_URL || wranglerVars.APP_GAS_URL || ''),
    mootaToken: String(process.env.INSTALLER_MOOTA_TOKEN || wranglerVars.MOOTA_TOKEN || '').trim(),
    adminApiToken: String(process.env.INSTALLER_ADMIN_API_TOKEN || '').trim(),
    spreadsheetId: String(process.env.INSTALLER_SPREADSHEET_ID || '').trim(),
    spreadsheetName: String(process.env.INSTALLER_SPREADSHEET_NAME || 'Cepat Top Database').trim(),
    siteName: String(process.env.INSTALLER_SITE_NAME || siteConfig.PRIMARY_DOMAIN || 'Cepat Top').trim(),
    siteTagline: String(process.env.INSTALLER_SITE_TAGLINE || DEFAULT_SITE_TAGLINE).trim(),
    contactEmail: String(process.env.INSTALLER_CONTACT_EMAIL || `admin@${baseDomain}`).trim().toLowerCase(),
    waAdmin: normalizePhone(process.env.INSTALLER_WA_ADMIN || ''),
    adminEmail: String(process.env.INSTALLER_ADMIN_EMAIL || `admin@${baseDomain}`).trim().toLowerCase(),
    adminPassword: String(process.env.INSTALLER_ADMIN_PASSWORD || '').trim(),
    adminName: String(process.env.INSTALLER_ADMIN_NAME || 'Administrator').trim()
  };
}

function createQuestionInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function ask(rl, promptText) {
  return new Promise((resolve) => rl.question(promptText, resolve));
}

async function collectConfigInteractively(defaults) {
  const rl = createQuestionInterface();
  try {
    const primaryInput = await ask(rl, `Domain utama [${defaults.primaryDomain}]: `);
    const extraInput = await ask(rl, `Domain tambahan (pisahkan koma) [${defaults.extraDomains.join(',')}]: `);
    const siteNameInput = await ask(rl, `Nama situs [${defaults.siteName}]: `);
    const siteTaglineInput = await ask(rl, `Tagline situs [${defaults.siteTagline}]: `);
    const appGasUrlInput = await ask(rl, `APP_GAS_URL [${defaults.appGasUrl}]: `);
    const mootaGasUrlInput = await ask(rl, `MOOTA_GAS_URL [${defaults.mootaGasUrl || defaults.appGasUrl}]: `);
    const spreadsheetIdInput = await ask(rl, `Spreadsheet ID [${defaults.spreadsheetId}]: `);
    const spreadsheetNameInput = await ask(rl, `Nama Spreadsheet [${defaults.spreadsheetName}]: `);
    const contactEmailInput = await ask(rl, `Email kontak [${defaults.contactEmail}]: `);
    const waAdminInput = await ask(rl, `Nomor WhatsApp admin [${defaults.waAdmin}]: `);
    const adminEmailInput = await ask(rl, `Email admin awal [${defaults.adminEmail}]: `);
    const adminNameInput = await ask(rl, `Nama admin awal [${defaults.adminName}]: `);
    const adminPasswordInput = await ask(rl, `Password admin awal [${defaults.adminPassword || 'akan digenerate otomatis'}]: `);
    const mootaTokenInput = await ask(rl, `MOOTA_TOKEN [${defaults.mootaToken || 'akan digenerate otomatis'}]: `);
    const adminApiTokenInput = await ask(rl, `ADMIN_API_TOKEN [${defaults.adminApiToken || 'akan digenerate otomatis'}]: `);

    return {
      primaryDomain: primaryInput || defaults.primaryDomain,
      extraDomains: parseCommaList(extraInput || defaults.extraDomains.join(',')),
      siteName: siteNameInput || defaults.siteName,
      siteTagline: siteTaglineInput || defaults.siteTagline,
      appGasUrl: appGasUrlInput || defaults.appGasUrl,
      mootaGasUrl: mootaGasUrlInput || defaults.mootaGasUrl || defaults.appGasUrl,
      spreadsheetId: spreadsheetIdInput || defaults.spreadsheetId,
      spreadsheetName: spreadsheetNameInput || defaults.spreadsheetName,
      contactEmail: contactEmailInput || defaults.contactEmail,
      waAdmin: waAdminInput || defaults.waAdmin,
      adminEmail: adminEmailInput || defaults.adminEmail,
      adminName: adminNameInput || defaults.adminName,
      adminPassword: adminPasswordInput || defaults.adminPassword,
      mootaToken: mootaTokenInput || defaults.mootaToken,
      adminApiToken: adminApiTokenInput || defaults.adminApiToken
    };
  } finally {
    rl.close();
  }
}

function collectConfigNonInteractive(defaults) {
  return {
    primaryDomain: defaults.primaryDomain,
    extraDomains: defaults.extraDomains,
    siteName: defaults.siteName,
    siteTagline: defaults.siteTagline,
    appGasUrl: defaults.appGasUrl,
    mootaGasUrl: defaults.mootaGasUrl || defaults.appGasUrl,
    spreadsheetId: defaults.spreadsheetId,
    spreadsheetName: defaults.spreadsheetName,
    contactEmail: defaults.contactEmail,
    waAdmin: defaults.waAdmin,
    adminEmail: defaults.adminEmail,
    adminName: defaults.adminName,
    adminPassword: defaults.adminPassword,
    mootaToken: defaults.mootaToken,
    adminApiToken: defaults.adminApiToken
  };
}

function finalizeConfig(partial) {
  const domainValidation = validateDomain(partial.primaryDomain);
  if (!domainValidation.valid) throw new Error(domainValidation.error);

  const primaryDomain = domainValidation.value.replace(/^www\./, '');
  const extraDomains = Array.isArray(partial.extraDomains) ? partial.extraDomains : parseCommaList(partial.extraDomains);
  const allowedDomains = buildAllowedDomains(primaryDomain, extraDomains);
  const allowedSuffixes = buildAllowedSuffixes(allowedDomains);
  const appBaseUrl = `https://${primaryDomain}`;
  const appGasUrl = normalizeUrl(partial.appGasUrl);
  const mootaGasUrl = normalizeUrl(partial.mootaGasUrl || partial.appGasUrl);

  if (appGasUrl && !isValidUrl(appGasUrl, { allowEmpty: false })) {
    throw new Error('APP_GAS_URL tidak valid. Gunakan URL http(s) yang lengkap.');
  }
  if (mootaGasUrl && !isValidUrl(mootaGasUrl, { allowEmpty: false })) {
    throw new Error('MOOTA_GAS_URL tidak valid. Gunakan URL http(s) yang lengkap.');
  }

  const adminEmail = String(partial.adminEmail || '').trim().toLowerCase();
  const contactEmail = String(partial.contactEmail || '').trim().toLowerCase();
  if (!isValidEmail(adminEmail)) throw new Error('Email admin awal tidak valid.');
  if (!isValidEmail(contactEmail)) throw new Error('Email kontak tidak valid.');

  const adminPassword = String(partial.adminPassword || '').trim() || randomToken(16);
  const mootaToken = String(partial.mootaToken || '').trim() || randomToken(24);
  const adminApiToken = String(partial.adminApiToken || '').trim() || randomToken(32);

  return {
    primaryDomain,
    allowedDomains,
    allowedSuffixes,
    allowedOrigins: allowedDomains.map((domain) => `https://${domain}`).join(','),
    appBaseUrl,
    appGasUrl,
    mootaGasUrl,
    mootaGsaUrlForSheet: mootaGasUrl,
    mootaToken,
    adminApiToken,
    spreadsheetId: String(partial.spreadsheetId || '').trim(),
    spreadsheetName: String(partial.spreadsheetName || 'Cepat Top Database').trim(),
    siteName: String(partial.siteName || primaryDomain).trim(),
    siteTagline: String(partial.siteTagline || DEFAULT_SITE_TAGLINE).trim(),
    contactEmail,
    waAdmin: normalizePhone(partial.waAdmin || ''),
    adminEmail,
    adminPassword,
    adminName: String(partial.adminName || 'Administrator').trim()
  };
}

function printEnvironmentSummary(detection) {
  console.log('');
  console.log('[install] Environment detection');
  console.log(`[install] Target dir : ${detection.cwd}`);
  console.log(`[install] OS         : ${detection.os}`);
  console.log(`[install] Arch       : ${detection.arch}`);
  console.log(`[install] Node       : ${detection.node}`);
  console.log(`[install] npm        : ${detection.npm.available ? detection.npm.version : 'not found'}`);
  console.log(`[install] git        : ${detection.git.available ? detection.git.version : 'not found'}`);
  console.log(`[install] package    : ${detection.hasPackageJson ? 'found' : 'missing'}`);
  console.log(`[install] wrangler   : ${detection.hasWranglerConfig ? 'wrangler.jsonc found' : 'wrangler.jsonc missing'}`);
  console.log('');
}

function printResultSummary(config, npmInstallResult) {
  console.log('');
  console.log('[install] Setup completed');
  console.log(`[install] PRIMARY_DOMAIN   : ${config.primaryDomain}`);
  console.log(`[install] APP_BASE_URL     : ${config.appBaseUrl}`);
  console.log(`[install] APP_GAS_URL      : ${config.appGasUrl || '(placeholder belum diisi)'}`);
  console.log(`[install] MOOTA_GAS_URL    : ${config.mootaGsaUrlForSheet || '(placeholder belum diisi)'}`);
  console.log(`[install] SPREADSHEET_ID   : ${config.spreadsheetId || '(belum diisi)'}`);
  console.log(`[install] Admin email      : ${config.adminEmail}`);
  console.log(`[install] npm install      : ${npmInstallResult.skipped ? `skip - ${npmInstallResult.reason}` : 'done'}`);
  console.log('[install] Output files     : .env.local, site.config.js, wrangler.jsonc, .setup-output/*');
  console.log('');
}

async function main() {
  const detection = detectEnvironment();
  printEnvironmentSummary(detection);

  if (!detection.npm.available && !skipNpmInstall && detection.hasPackageJson) {
    throw new Error('npm tidak tersedia di sistem ini. Install Node.js + npm terlebih dahulu.');
  }

  const defaults = deriveDefaults();
  const partialConfig = nonInteractive
    ? collectConfigNonInteractive(defaults)
    : await collectConfigInteractively(defaults);

  const config = finalizeConfig(partialConfig);
  const npmInstallResult = installNpmDependencies(detection);

  writeText('.env.example', generateEnvExample());
  writeText('.env.local', generateEnvLocal(config));
  writeText('site.config.js', generateSiteConfigFile(config));
  updateWranglerConfig(config);
  createSeedFiles(config);
  createSetupOutputs(config, detection);

  printResultSummary(config, npmInstallResult);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('');
    console.error('[install] Failed:', error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  normalizeDomain,
  validateDomain,
  buildAllowedDomains,
  buildAllowedSuffixes,
  generateSiteConfigFile,
  generateEnvExample,
  generateEnvLocal,
  finalizeConfig
};
