'use strict';

const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Constants ───────────────────────────────────────────────────────────────

const CHECKSTYLE_HEADER =
  '^\\Q/*\\E$\n' +
  '^\\Q * Copyright © \\E20\\d\\d\\Q Broadcom Inc. and/or its subsidiaries. All Rights Reserved.\\E$\n' +
  '^\\Q * Copyright \\E20\\d\\d\\-present\\Q the original author or authors.\\E$\n' +
  '^\\Q */\\E$\n' +
  '^$\n' +
  '^.*$\n';

const COPYRIGHT_LINES = [
  'Copyright © 2012 Broadcom Inc. and/or its subsidiaries. All Rights Reserved.',
  'Copyright 2012-present the original author or authors.',
];

const BLOCK_HEADER = '/*\n' + COPYRIGHT_LINES.map(l => ` * ${l}\n`).join('') + ' */';
const XML_HEADER   = '<!--\n' + COPYRIGHT_LINES.map(l => `  ${l}\n`).join('') + '-->';
const HASH_HEADER  = COPYRIGHT_LINES.map(l => `# ${l}`).join('\n');

const BLOCK_EXTS = new Set([
  '.java', '.js', '.mjs', '.ts', '.tsx', '.jsx',
  '.groovy', '.kt', '.kts', '.scala',
  '.c', '.cpp', '.cc', '.h', '.hpp', '.cs', '.go', '.swift',
]);
const XML_EXTS = new Set([
  '.xml', '.html', '.htm', '.xsl', '.xsd', '.wsdl',
  '.fxml', '.xhtml', '.svg', '.pom',
]);
const HASH_EXTS = new Set([
  '.py', '.sh', '.bash', '.zsh',
  '.yaml', '.yml', '.properties',
  '.rb', '.pl', '.tf', '.toml',
]);

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'target', 'build',
  '.gradle', '__pycache__', '.mvn', '.idea', '.settings',
]);

const APACHE_MARKER = 'Licensed under the Apache License';

// ── Checkstyle header update ─────────────────────────────────────────────────

/**
 * Updates every checkstyle-header.txt found under root with the Broadcom pattern.
 * Returns the number of files changed.
 */
function updateCheckstyleHeaders(root) {
  let changed = 0;
  walkDir(root, (filePath, fname) => {
    if (fname !== 'checkstyle-header.txt') return;
    try {
      const current = fs.readFileSync(filePath, 'utf-8');
      if (current === CHECKSTYLE_HEADER) {
        core.info(`  Already up to date: ${filePath}`);
        return;
      }
      fs.writeFileSync(filePath, CHECKSTYLE_HEADER, 'utf-8');
      core.info(`  Updated: ${filePath}`);
      changed++;
    } catch (e) {
      core.warning(`  Cannot process ${filePath}: ${e.message}`);
    }
  });
  core.info(`\nUpdated checkstyle headers in ${changed} file(s).`);
  return changed;
}

// ── License header replacement ───────────────────────────────────────────────

const BLOCK_RE    = new RegExp('/\\*.*?' + escapeRegex(APACHE_MARKER) + '.*?\\*/', 's');
const XML_RE      = new RegExp('<!--.*?' + escapeRegex(APACHE_MARKER) + '.*?-->', 's');
const XML_DECL_RE = /^<\?xml[^?]*\?>\s*\n?/;
const HASH_RE     = /(?:^[ \t]*#[^\n]*\n)+/gm;
const POM_LICENSES_RE = /([\t ]*)<licenses>.*?<\/licenses>/s;

/**
 * Replaces the Maven <licenses> block when it contains an Apache declaration.
 * Exported for unit testing.
 */
function replacePomLicenses(content) {
  const m = content.match(POM_LICENSES_RE);
  if (!m || !m[0].includes(APACHE_MARKER)) return content;

  const outer    = m[1];
  const inner    = outer + '\t';
  const comments = inner + '\t';
  const deep     = comments + '\t';
  const replacement =
    `${outer}<licenses>\n` +
    `${inner}<license>\n` +
    `${comments}<comments>\n` +
    `${deep}${COPYRIGHT_LINES[0]}\n` +
    `${deep}${COPYRIGHT_LINES[1]}\n` +
    `${comments}</comments>\n` +
    `${inner}</license>\n` +
    `${outer}</licenses>`;
  return content.slice(0, m.index) + replacement + content.slice(m.index + m[0].length);
}

/**
 * Replaces the Apache XML comment header while preserving the <?xml ?> declaration.
 * Exported for unit testing.
 */
function replaceXmlHeader(content) {
  let stripped = content.replace(XML_RE, '');
  stripped = stripped.replace(/\n{3,}/g, '\n\n');

  const declMatch = stripped.match(XML_DECL_RE);
  if (declMatch) {
    return stripped.slice(0, declMatch[0].length) + XML_HEADER + '\n' + stripped.slice(declMatch[0].length);
  }
  return XML_HEADER + '\n' + stripped;
}

/**
 * Replaces a hash-style Apache license header, preserving any shebang line.
 * Exported for unit testing.
 */
function replaceHashHeader(content) {
  let startOffset = 0;
  if (content.startsWith('#!')) {
    const nl = content.indexOf('\n');
    if (nl !== -1) startOffset = nl + 1;
  }

  const searchArea = content.slice(startOffset);
  HASH_RE.lastIndex = 0;
  let m;
  while ((m = HASH_RE.exec(searchArea)) !== null) {
    if (m[0].includes(APACHE_MARKER)) {
      const newArea = searchArea.slice(0, m.index) + HASH_HEADER + '\n' + searchArea.slice(m.index + m[0].length);
      return content.slice(0, startOffset) + newArea;
    }
  }
  return content;
}

/**
 * Processes a single file — replaces its Apache license header with the Broadcom one.
 * Returns true when the file was modified.
 * Exported for unit testing.
 */
function processLicenseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  let style;
  if (BLOCK_EXTS.has(ext)) {
    style = 'block';
  } else if (XML_EXTS.has(ext)) {
    style = 'xml';
  } else if (HASH_EXTS.has(ext)) {
    style = 'hash';
  } else {
    return false;
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    core.warning(`  Cannot read ${filePath}: ${e.message}`);
    return false;
  }

  let newContent = content;

  if (style === 'block') {
    if (!BLOCK_RE.test(content)) return false;
    newContent = content.replace(BLOCK_RE, BLOCK_HEADER);
  } else if (style === 'xml') {
    newContent = replacePomLicenses(newContent);
    if (XML_RE.test(newContent)) {
      newContent = replaceXmlHeader(newContent);
    }
    if (newContent === content) return false;
  } else {
    if (!content.includes(APACHE_MARKER)) return false;
    newContent = replaceHashHeader(content);
  }

  if (newContent === content) return false;

  fs.writeFileSync(filePath, newContent, 'utf-8');
  core.info(`  Updated: ${filePath}`);
  return true;
}

/**
 * Walks the directory tree and replaces Apache license headers in all source files.
 * Returns the number of files changed.
 */
function updateLicenseHeaders(root) {
  let changed = 0;
  walkDir(root, (filePath) => {
    if (processLicenseFile(filePath)) changed++;
  });
  core.info(`\nUpdated license headers in ${changed} file(s).`);
  return changed;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function walkDir(root, callback) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkDir(fullPath, callback);
    } else if (entry.isFile()) {
      callback(fullPath, entry.name);
    }
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function run() {
  try {
    const repository = core.getInput('repository', { required: true });
    const branch     = core.getInput('branch', { required: true });
    const token      = core.getInput('token', { required: true });
    const commitMsg  = core.getInput('commit-message') || 'Updating license headers';
    const gitName    = core.getInput('git-user-name')  || 'Spring Builds';
    const gitEmail   = core.getInput('git-user-email') || 'svc.spring-builds@broadcom.com';
    core.setSecret(token);

    core.info('=== Update License Headers ===');
    core.info(`Repository: ${repository}`);
    core.info(`Branch:     ${branch}`);
    core.info('');

    const repoDir = path.join(os.tmpdir(), '_license_repo');
    if (fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }

    await exec.exec('git', [
      'clone', '--single-branch', '--branch', branch,
      `https://x-access-token:${token}@github.com/${repository}.git`,
      repoDir,
    ]);

    await exec.exec('git', ['-C', repoDir, 'config', 'user.name', gitName]);
    await exec.exec('git', ['-C', repoDir, 'config', 'user.email', gitEmail]);

    // Step 1: Update checkstyle-header.txt files — committed separately
    core.info('Scanning for checkstyle-header.txt files...');
    updateCheckstyleHeaders(repoDir);

    await exec.exec('git', ['-C', repoDir, 'add', '.']);
    const checkstyleDiff = await exec.exec(
      'git', ['-C', repoDir, 'diff', '--cached', '--quiet'],
      { ignoreReturnCode: true }
    );
    if (checkstyleDiff !== 0) {
      await exec.exec('git', ['-C', repoDir, 'commit', '-m', 'Updating checkstyle header']);
      core.info('Checkstyle header committed.');
    } else {
      core.info('No checkstyle header changes to commit.');
    }

    // Step 2: Replace Apache License 2.0 headers across all source files
    core.info('Scanning for Apache License headers...');
    updateLicenseHeaders(repoDir);

    // Step 3: Replace LICENSE / LICENSE.txt with the Broadcom license file
    const licenseSrc = path.join(__dirname, '..', 'LICENSE.txt');
    for (const licenseFile of ['LICENSE', 'LICENSE.txt']) {
      const dest = path.join(repoDir, licenseFile);
      if (fs.existsSync(dest)) {
        core.info(`Replacing ${licenseFile} with Broadcom license...`);
        fs.copyFileSync(licenseSrc, dest);
      }
    }

    await exec.exec('git', ['-C', repoDir, 'add', '.']);

    const licenseDiff = await exec.exec(
      'git', ['-C', repoDir, 'diff', '--cached', '--quiet'],
      { ignoreReturnCode: true }
    );
    if (licenseDiff === 0) {
      core.info('No license changes to commit.');
      return;
    }

    await exec.exec('git', ['-C', repoDir, 'commit', '-m', commitMsg]);
    await exec.exec('git', ['-C', repoDir, 'push', 'origin', branch]);

    core.info('');
    core.info(`License updates committed to '${branch}'.`);
  } catch (err) {
    core.setFailed(`Action failed: ${err.message}`);
  }
}

module.exports = {
  updateCheckstyleHeaders,
  processLicenseFile,
  updateLicenseHeaders,
  replacePomLicenses,
  replaceXmlHeader,
  replaceHashHeader,
  CHECKSTYLE_HEADER,
  BLOCK_HEADER,
  XML_HEADER,
  HASH_HEADER,
};

if (require.main === module) {
  run();
}
