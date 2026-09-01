'use strict';

const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Scope ────────────────────────────────────────────────────────────────────
//
// This action handles the part of the Apache 2.0 -> Broadcom license conversion
// that `spd migrate-license` (spring-io/spring-devkit) does NOT cover:
//
//   * XML-family comment headers (.xml, .html, .svg, ...) and the Maven
//     <licenses> block
//   * hash-style headers (.yml, .sh, .py, ...)
//   * block-comment headers in languages devkit ignores (.js, .ts, .c, .go, ...)
//
// Java/Kotlin/Groovy/Gradle sources, .properties files, LICENSE files,
// checkstyle-header.txt and .idea/copyright profiles are owned by devkit and are
// deliberately NOT touched here. See ./README.md.

// ── Constants ───────────────────────────────────────────────────────────────

const COPYRIGHT_LINES = [
  'Copyright © 2012 Broadcom Inc. and/or its subsidiaries. All Rights Reserved.',
  'Copyright 2012-present the original author or authors.',
];

const BLOCK_HEADER = '/*\n' + COPYRIGHT_LINES.map(l => ` * ${l}\n`).join('') + ' */';
const XML_HEADER   = '<!--\n' + COPYRIGHT_LINES.map(l => `  ${l}\n`).join('') + '-->';
const HASH_HEADER  = COPYRIGHT_LINES.map(l => `# ${l}`).join('\n');

// .java/.kt/.kts/.groovy are intentionally absent — devkit owns those, and .kts
// covers .gradle.kts.
const BLOCK_EXTS = new Set([
  '.js', '.mjs', '.ts', '.tsx', '.jsx',
  '.scala',
  '.c', '.cpp', '.cc', '.h', '.hpp', '.cs', '.go', '.swift',
]);
const XML_EXTS = new Set([
  '.xml', '.html', '.htm', '.xsl', '.xsd', '.wsdl',
  '.fxml', '.xhtml', '.svg', '.pom',
]);
// .properties is intentionally absent — devkit owns it.
const HASH_EXTS = new Set([
  '.py', '.sh', '.bash', '.zsh',
  '.yaml', '.yml',
  '.rb', '.pl', '.tf', '.toml',
]);

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'target', 'build',
  '.gradle', '__pycache__', '.mvn', '.idea', '.settings',
]);

const APACHE_MARKER = 'Licensed under the Apache License';

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

/**
 * In-place mode: the caller has already checked out the tree and takes care of
 * committing and pushing. Used by initialize-commercial-branch.yml, which runs
 * `spd migrate-license` over the same clone first.
 */
async function runInDirectory(directory) {
  core.info('=== Update License Headers ===');
  core.info(`Directory: ${directory}`);
  core.info('');

  if (!fs.existsSync(directory)) {
    throw new Error(`Directory '${directory}' does not exist.`);
  }

  core.info('Scanning for Apache License headers...');
  const changed = updateLicenseHeaders(directory);
  core.setOutput('files-changed', String(changed));
  core.info(`Left the working tree in place — the caller is responsible for committing.`);
}

/**
 * Standalone mode: clone the branch, rewrite headers, commit and push.
 */
async function runOnBranch({ repository, branch, token, commitMsg, gitName, gitEmail }) {
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

  core.info('Scanning for Apache License headers...');
  const changed = updateLicenseHeaders(repoDir);
  core.setOutput('files-changed', String(changed));

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
}

async function run() {
  try {
    const directory = core.getInput('directory');
    if (directory) {
      await runInDirectory(directory);
      return;
    }

    const repository = core.getInput('repository', { required: true });
    const branch     = core.getInput('branch', { required: true });
    const token      = core.getInput('token', { required: true });
    core.setSecret(token);

    await runOnBranch({
      repository,
      branch,
      token,
      commitMsg: core.getInput('commit-message') || 'Updating license headers',
      gitName:   core.getInput('git-user-name')  || 'Spring Builds',
      gitEmail:  core.getInput('git-user-email') || 'svc.spring-builds@broadcom.com',
    });
  } catch (err) {
    core.setFailed(`Action failed: ${err.message}`);
  }
}

module.exports = {
  processLicenseFile,
  updateLicenseHeaders,
  replacePomLicenses,
  replaceXmlHeader,
  replaceHashHeader,
  BLOCK_HEADER,
  XML_HEADER,
  HASH_HEADER,
};

if (require.main === module) {
  run();
}
