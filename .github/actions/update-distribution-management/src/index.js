'use strict';

const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Constants ────────────────────────────────────────────────────────────────

const DIST_RELEASE = {
  tag:  'repository',
  id:   'spring-commercial-release',
  name: 'Spring Commercial Release Repository',
  url:  'https://usw1.packages.broadcom.com/artifactory/spring-enterprise-maven-prod-local',
};

const DIST_SNAPSHOT = {
  tag:  'snapshotRepository',
  id:   'spring-commercial-snapshot',
  name: 'Spring Commercial Snapshot Repository',
  url:  'https://usw1.packages.broadcom.com/artifactory/spring-enterprise-maven-dev-local',
};

const COMMERCIAL_MARKER  = 'spring-commercial';
const CENTRAL_PLUGIN_ID  = 'central-publishing-maven-plugin';

const XML_EXTS  = new Set(['.xml', '.pom']);
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'target', 'build',
  '.gradle', '__pycache__', '.mvn', '.idea',
]);

// ── distributionManagement replacement ───────────────────────────────────────

/**
 * Builds a <repository> or <snapshotRepository> XML element.
 * Exported for unit testing.
 */
function buildDistEntry(repo, indent) {
  const tag = repo.tag;
  const i1  = indent + '\t';
  const i2  = i1 + '\t';
  return (
    `${i1}<${tag}>\n` +
    `${i2}<id>${repo.id}</id>\n` +
    `${i2}<name>${repo.name}</name>\n` +
    `${i2}<url>${repo.url}</url>\n` +
    `${i1}</${tag}>`
  );
}

const DIST_MGMT_RE     = /([ \t]*)<distributionManagement>(.*?)<\/distributionManagement>/gs;
const DIST_REPO_RE     = /\n?[ \t]*<repository>.*?<\/repository>/gs;
const DIST_SNAPSHOT_RE = /\n?[ \t]*<snapshotRepository>.*?<\/snapshotRepository>/gs;

/**
 * Updates <distributionManagement> blocks in Maven POM content.
 * Exported for unit testing.
 */
function updateDistMgmt(content) {
  return content.replace(DIST_MGMT_RE, (match, indent, body) => {
    if (!/<(?:repository|snapshotRepository)>/.test(body)) return match;
    if (body.includes(COMMERCIAL_MARKER)) return match;

    let newBody = body.replace(DIST_REPO_RE, '');
    newBody = newBody.replace(DIST_SNAPSHOT_RE, '');
    newBody = newBody.replace(/\n{3,}/g, '\n\n');
    newBody = newBody.replace(/\n+$/, '');
    newBody += '\n' + buildDistEntry(DIST_RELEASE,  indent);
    newBody += '\n' + buildDistEntry(DIST_SNAPSHOT, indent);
    newBody += '\n' + indent;

    return `${indent}<distributionManagement>${newBody}</distributionManagement>`;
  });
}

// ── Remove central-publishing-maven-plugin ────────────────────────────────────

const PLUGIN_BLOCK_RE     = /\n[ \t]*<plugin>.*?<\/plugin>/gs;
const EMPTY_PLUGINS_RE    = /\n[ \t]*<plugins>[ \t\n]*<\/plugins>/g;
const EMPTY_PLUG_MGMT_RE  = /\n[ \t]*<pluginManagement>[ \t\n]*<\/pluginManagement>/gs;
const EMPTY_BUILD_RE      = /\n[ \t]*<build>[ \t\n]*<\/build>/gs;

/**
 * Removes <plugin> blocks that reference central-publishing-maven-plugin
 * and cleans up empty structural elements.
 * Exported for unit testing.
 */
function removeCentralPlugin(content) {
  content = content.replace(PLUGIN_BLOCK_RE, (m) =>
    m.includes(CENTRAL_PLUGIN_ID) ? '' : m
  );
  content = content.replace(EMPTY_PLUGINS_RE,   '');
  content = content.replace(EMPTY_PLUG_MGMT_RE, '');
  content = content.replace(EMPTY_BUILD_RE,      '');
  return content;
}

// ── Update gradle.publish-plugins.task ───────────────────────────────────────

const GRADLE_PUBLISH_TASK_RE =
  /(<gradle\.publish-plugins\.task>)publishPlugins(<\/gradle\.publish-plugins\.task>)/g;

/**
 * Changes <gradle.publish-plugins.task> from publishPlugins to build.
 * Exported for unit testing.
 */
function updateGradlePublishTask(content) {
  return content.replace(GRADLE_PUBLISH_TASK_RE, '$1build$2');
}

// ── Remove -DaltSnapshotDeploymentRepository from .mvn/maven.config ──────────

const ALT_SNAPSHOT_REPO_RE = /[ \t]*-DaltSnapshotDeploymentRepository(?:=\S*)?/g;

/**
 * Removes -DaltSnapshotDeploymentRepository from .mvn/maven.config if present.
 * Returns true when the file was modified.
 * Exported for unit testing.
 */
function updateMavenConfig(root) {
  const configPath = path.join(root, '.mvn', 'maven.config');
  if (!fs.existsSync(configPath)) return false;

  const lines   = fs.readFileSync(configPath, 'utf-8').split(/(\r?\n)/);
  const newLines = [];
  let changed    = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '\n' || line === '\r\n' || line === '') {
      newLines.push(line);
      continue;
    }
    const newLine = line.replace(ALT_SNAPSHOT_REPO_RE, '').trim();
    if (newLine === line.trim()) {
      newLines.push(line);
    } else {
      changed = true;
      if (newLine) newLines.push(newLine);
    }
  }

  if (!changed) return false;

  fs.writeFileSync(configPath, newLines.join(''), 'utf-8');
  core.info(`  Removed -DaltSnapshotDeploymentRepository from .mvn/maven.config`);
  return true;
}

// ── File processing ───────────────────────────────────────────────────────────

/**
 * Applies all distribution management transformations to a single file.
 * Returns true when the file was modified.
 * Exported for unit testing.
 */
function processFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!XML_EXTS.has(ext)) return false;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    core.warning(`  Cannot read ${filePath}: ${e.message}`);
    return false;
  }

  let newContent = updateDistMgmt(content);
  newContent = removeCentralPlugin(newContent);
  newContent = updateGradlePublishTask(newContent);

  if (newContent === content) return false;

  fs.writeFileSync(filePath, newContent, 'utf-8');
  core.info(`  Updated: ${filePath}`);
  return true;
}

/**
 * Walks root, applies transformations to all XML/POM files and maven.config.
 * Returns the number of files changed.
 */
function processDirectory(root) {
  let changed = 0;
  walkDir(root, (filePath) => {
    if (processFile(filePath)) changed++;
  });
  if (updateMavenConfig(root)) changed++;
  core.info(`\nUpdated distribution management in ${changed} file(s).`);
  return changed;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

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

// ── Entry point ───────────────────────────────────────────────────────────────

async function run() {
  try {
    const repository = core.getInput('repository', { required: true });
    const branch     = core.getInput('branch',     { required: true });
    const token      = core.getInput('token',      { required: true });
    const commitMsg  = core.getInput('commit-message') || 'Updating distribution management for commercial repo';
    const gitName    = core.getInput('git-user-name')  || 'Spring Builds';
    const gitEmail   = core.getInput('git-user-email') || 'svc.spring-builds@broadcom.com';
    core.setSecret(token);

    core.info('=== Update Distribution Management ===');
    core.info(`Repository: ${repository}`);
    core.info(`Branch:     ${branch}`);
    core.info('');

    const repoDir = path.join(os.tmpdir(), '_dist_mgmt_repo');
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

    core.info('Scanning for distributionManagement and central-publishing-maven-plugin...');
    processDirectory(repoDir);

    await exec.exec('git', ['-C', repoDir, 'add', '.']);

    const diffCode = await exec.exec(
      'git', ['-C', repoDir, 'diff', '--cached', '--quiet'],
      { ignoreReturnCode: true }
    );
    if (diffCode === 0) {
      core.info('No distribution management changes to commit.');
      return;
    }

    await exec.exec('git', ['-C', repoDir, 'commit', '-m', commitMsg]);
    await exec.exec('git', ['-C', repoDir, 'push', 'origin', branch]);

    core.info('');
    core.info(`Distribution management updates committed to '${branch}'.`);
  } catch (err) {
    core.setFailed(`Action failed: ${err.message}`);
  }
}

module.exports = {
  buildDistEntry,
  updateDistMgmt,
  removeCentralPlugin,
  updateGradlePublishTask,
  updateMavenConfig,
  processFile,
  processDirectory,
  DIST_RELEASE,
  DIST_SNAPSHOT,
};

if (require.main === module) {
  run();
}
