'use strict';

const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Constants ────────────────────────────────────────────────────────────────

const OLD_SPRING_IO_RE = /https?:\/\/repo\.spring\.io\/(?!artifactory\/spring-commercial)/;

const COMMERCIAL_REPOS = [
  {
    id:               'spring-commercial-snapshot',
    name:             'Spring Commercial Snapshot Repository',
    url:              'https://usw1.packages.broadcom.com/artifactory/spring-enterprise-maven-dev-local',
    snapshotsEnabled: true,
    releasesEnabled:  false,
  },
  {
    id:               'spring-commercial-release',
    name:             'Spring Commercial Release Repository',
    url:              'https://usw1.packages.broadcom.com/artifactory/spring-enterprise-maven-prod-local',
    snapshotsEnabled: false,
  },
  {
    id:               'repo-spring-io-spring-commercial-snapshot',
    name:             'Spring Commercial Snapshot Repository On repo.spring.io',
    url:              'https://repo.spring.io/artifactory/spring-commercial-snapshot-remote',
    snapshotsEnabled: true,
    releasesEnabled:  false,
  },
  {
    id:               'repo-spring-io-spring-commercial-release',
    name:             'Spring Commercial Release Repository On repo.spring.io',
    url:              'https://repo.spring.io/artifactory/spring-commercial-release-remote',
    snapshotsEnabled: false,
  },
];

const COMMERCIAL_URLS = new Set(COMMERCIAL_REPOS.map(r => r.url));

const XML_EXTS  = new Set(['.xml', '.pom']);
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'target', 'build',
  '.gradle', '__pycache__', '.mvn', '.idea',
]);

// ── Maven POM handling ────────────────────────────────────────────────────────

const POM_REPOS_RE        = /([ \t]*)<repositories>(.*?)<\/repositories>/gs;
const POM_PLUGIN_REPOS_RE = /([ \t]*)<pluginRepositories>(.*?)<\/pluginRepositories>/gs;

/**
 * Builds a complete <repositories> or <pluginRepositories> XML block.
 * preservedEntries are raw XML strings for repository entries that should be kept
 * in addition to the commercial repos (used by the spring-cloud-contract override).
 * Exported for unit testing.
 */
function buildPomBlock(tag, indent, preservedEntries = []) {
  const entryTag = tag === 'repositories' ? 'repository' : 'pluginRepository';
  const i1 = indent + '\t';
  const i2 = i1 + '\t';
  const i3 = i2 + '\t';
  const lines = [`${indent}<${tag}>`];

  for (const repo of COMMERCIAL_REPOS) {
    lines.push(`${i1}<${entryTag}>`);
    lines.push(`${i2}<id>${repo.id}</id>`);
    lines.push(`${i2}<name>${repo.name}</name>`);
    lines.push(`${i2}<url>${repo.url}</url>`);
    if (repo.snapshotsEnabled !== undefined) {
      lines.push(`${i2}<snapshots>`);
      lines.push(`${i3}<enabled>${repo.snapshotsEnabled}</enabled>`);
      lines.push(`${i2}</snapshots>`);
    }
    if (repo.releasesEnabled !== undefined) {
      lines.push(`${i2}<releases>`);
      lines.push(`${i3}<enabled>${repo.releasesEnabled}</enabled>`);
      lines.push(`${i2}</releases>`);
    }
    lines.push(`${i1}</${entryTag}>`);
  }

  for (const entry of preservedEntries) {
    lines.push(`${i1}${entry}`);
  }

  lines.push(`${indent}</${tag}>`);
  return lines.join('\n');
}

/**
 * Updates <repositories> and <pluginRepositories> blocks in POM content.
 * preserveIds is a Set of repository IDs to keep alongside the commercial repos.
 * Exported for unit testing.
 */
function updatePom(content, preserveIds = new Set()) {
  const replaceBlock = (match, indent, body, tag) => {
    if (!OLD_SPRING_IO_RE.test(match)) return match;
    if ([...COMMERCIAL_URLS].some(u => match.includes(u))) return match;

    let preserved = [];
    if (preserveIds.size > 0) {
      const entryTag = tag === 'repositories' ? 'repository' : 'pluginRepository';
      const entryRe  = new RegExp(`[ \\t]*<${entryTag}>[\\s\\S]*?<\\/${entryTag}>`, 'g');
      for (const m of match.matchAll(entryRe)) {
        const idMatch = m[0].match(/<id>(.*?)<\/id>/);
        if (idMatch && preserveIds.has(idMatch[1].trim())) {
          preserved.push(m[0].trim());
        }
      }
    }
    return buildPomBlock(tag, indent, preserved);
  };

  content = content.replace(POM_REPOS_RE,        (m, ind, body) => replaceBlock(m, ind, body, 'repositories'));
  content = content.replace(POM_PLUGIN_REPOS_RE,  (m, ind, body) => replaceBlock(m, ind, body, 'pluginRepositories'));
  return content;
}

// ── Gradle handling ───────────────────────────────────────────────────────────

const GRADLE_REPOS_RE = /([ \t]*)repositories\s*\{/g;
const BUILDSCRIPT_RE  = /\bbuildscript\s*\{/g;

/**
 * Finds the closing brace index matching the open brace at openPos.
 * Exported for unit testing.
 */
function findBraceEnd(text, openPos) {
  let depth = 0;
  for (let i = openPos; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function detectInnerIndent(blockBody, fallback) {
  for (const line of blockBody.split('\n')) {
    const stripped = line.trimStart();
    if (stripped) return line.slice(0, line.length - stripped.length);
  }
  return fallback;
}

/**
 * Builds maven {} blocks for Gradle.
 * withCredentials adds credential blocks (used by spring-cloud-contract override).
 * Exported for unit testing.
 */
function buildGradleMavenEntries(indent, isKotlin, withCredentials = false) {
  const i2 = indent + '    ';
  const i3 = i2 + '    ';
  const lines = [];

  for (const repo of COMMERCIAL_REPOS) {
    lines.push(`${indent}maven {`);
    if (withCredentials) {
      if (isKotlin) {
        lines.push(`${i2}name = "${repo.id}"`);
        lines.push(`${i2}url = uri("${repo.url}")`);
      } else {
        lines.push(`${i2}name "${repo.id}"`);
        lines.push(`${i2}url "${repo.url}"`);
      }
      lines.push(`${i2}credentials {`);
      if (isKotlin) {
        lines.push(`${i3}username = System.env.ARTIFACTORY_USERNAME`);
        lines.push(`${i3}password = System.env.ARTIFACTORY_PASSWORD`);
      } else {
        lines.push(`${i3}username System.env.ARTIFACTORY_USERNAME`);
        lines.push(`${i3}password System.env.ARTIFACTORY_PASSWORD`);
      }
      lines.push(`${i2}}`);
    } else {
      if (isKotlin) {
        lines.push(`${i2}url = uri("${repo.url}")`);
      } else {
        lines.push(`${i2}url '${repo.url}'`);
      }
    }
    lines.push(`${indent}}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Updates a single Gradle repositories {} block body.
 * Returns [newBody, changed].
 * Exported for unit testing.
 */
function processGradleBlock(blockBody, innerIndent, isKotlin, forceAdd = false, withCredentials = false) {
  if ([...COMMERCIAL_URLS].some(u => blockBody.includes(u))) return [blockBody, false];
  if (!forceAdd && !OLD_SPRING_IO_RE.test(blockBody)) return [blockBody, false];

  const toRemove  = [];
  let searchPos   = 0;
  const mavenRe   = /[ \t]*maven\s*\{/g;

  while (searchPos < blockBody.length) {
    mavenRe.lastIndex = searchPos;
    const m = mavenRe.exec(blockBody);
    if (!m) break;

    const absStart   = m.index;
    const braceOpen  = m.index + m[0].length - 1;
    const braceClose = findBraceEnd(blockBody, braceOpen);
    if (braceClose === -1) { searchPos = m.index + m[0].length; continue; }

    if (OLD_SPRING_IO_RE.test(blockBody.slice(absStart, braceClose + 1))) {
      toRemove.push([absStart, braceClose + 1]);
    }
    searchPos = braceClose + 1;
  }

  const newEntries = buildGradleMavenEntries(innerIndent, isKotlin, withCredentials);

  if (forceAdd && toRemove.length === 0) {
    const lastNl   = blockBody.lastIndexOf('\n');
    const insertAt = lastNl >= 0 ? lastNl + 1 : blockBody.length;
    return [blockBody.slice(0, insertAt) + newEntries + blockBody.slice(insertAt), true];
  }

  if (toRemove.length === 0) return [blockBody, false];

  const insertAt = toRemove[0][0];
  let newBody    = blockBody;
  for (const [start, end] of [...toRemove].reverse()) {
    let endPos = end;
    while (endPos < newBody.length && newBody[endPos] === '\n') endPos++;
    newBody = newBody.slice(0, start) + newBody.slice(endPos);
  }
  const safeInsert = Math.min(insertAt, newBody.length);
  newBody = newBody.slice(0, safeInsert) + newEntries + newBody.slice(safeInsert);
  return [newBody, true];
}

/**
 * Updates all repositories {} blocks in Gradle content.
 * Exported for unit testing.
 */
function updateGradle(content, isKotlin, withCredentials = false) {
  const buildscriptRanges = [];
  BUILDSCRIPT_RE.lastIndex = 0;
  for (const bsm of content.matchAll(BUILDSCRIPT_RE)) {
    const bsClose = findBraceEnd(content, bsm.index + bsm[0].length - 1);
    if (bsClose !== -1) buildscriptRanges.push([bsm.index, bsClose]);
  }

  const fileHasSpringIo = OLD_SPRING_IO_RE.test(content);

  const result  = [];
  let pos       = 0;
  let changed   = false;

  GRADLE_REPOS_RE.lastIndex = 0;
  for (const reposMatch of content.matchAll(GRADLE_REPOS_RE)) {
    if (reposMatch.index < pos) continue;

    const inBuildscript = buildscriptRanges.some(([s, e]) => reposMatch.index >= s && reposMatch.index <= e);
    const forceAdd      = inBuildscript && fileHasSpringIo;

    const outerIndent = reposMatch[1];
    const blockOpen   = reposMatch.index + reposMatch[0].length - 1;
    const blockClose  = findBraceEnd(content, blockOpen);
    if (blockClose === -1) continue;

    const blockBody   = content.slice(blockOpen + 1, blockClose);
    const innerIndent = detectInnerIndent(blockBody, outerIndent + '    ');

    const [newBody, wasChanged] = processGradleBlock(blockBody, innerIndent, isKotlin, forceAdd, withCredentials);
    if (wasChanged) {
      result.push(content.slice(pos, blockOpen + 1));
      result.push(newBody);
      result.push('}');
      pos     = blockClose + 1;
      changed = true;
    }
  }

  result.push(content.slice(pos));
  return [result.join(''), changed];
}

// ── File dispatch ─────────────────────────────────────────────────────────────

/**
 * Processes a single file — replaces repo.spring.io references with commercial repos.
 * updatedSet tracks file paths already modified so the default handler skips them.
 * Returns true when the file was modified.
 * Exported for unit testing.
 */
function processFile(filePath, updatedSet = new Set(), preserveIds = new Set(), withCredentials = false) {
  const ext      = path.extname(filePath).toLowerCase();
  const isKts    = filePath.endsWith('.gradle.kts');
  const isGradle = ext === '.gradle' || isKts;
  const isXml    = XML_EXTS.has(ext);

  if (!isXml && !isGradle) return false;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    core.warning(`  Cannot read ${filePath}: ${e.message}`);
    return false;
  }

  if (!OLD_SPRING_IO_RE.test(content)) return false;
  if (updatedSet.has(filePath)) return false;

  let newContent;
  let changed = false;

  if (isXml) {
    newContent = updatePom(content, preserveIds);
    changed    = newContent !== content;
  } else {
    [newContent, changed] = updateGradle(content, isKts, withCredentials);
  }

  if (!changed) return false;

  fs.writeFileSync(filePath, newContent, 'utf-8');
  core.info(`  Updated: ${filePath}`);
  return true;
}

// ── Project-specific overrides registry ──────────────────────────────────────

/**
 * Project overrides run BEFORE the default handler.
 * Return the set of file paths they updated so the default handler can skip them.
 *
 * Each override is a function(root) => Set<string> of updated file paths.
 */
const PROJECT_OVERRIDES = {
  'spring-cloud-contract': springCloudContractUpdate,
};

/**
 * Spring Cloud Contract override:
 *   POM: replaces repo.spring.io repos while preserving the spring-milestones entry.
 *   Gradle: replaces with named maven {} blocks that include credentials.
 */
function springCloudContractUpdate(root) {
  const updated   = new Set();
  const preserveIds = new Set(['spring-milestones']);

  walkDir(root, (filePath) => {
    const ext      = path.extname(filePath).toLowerCase();
    const isKts    = filePath.endsWith('.gradle.kts');
    const isGradle = ext === '.gradle' || isKts;
    const isXml    = XML_EXTS.has(ext);

    if (!isXml && !isGradle) return;

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      core.warning(`  Cannot read ${filePath}: ${e.message}`);
      return;
    }

    if (!OLD_SPRING_IO_RE.test(content)) return;

    let newContent = content;
    let changed    = false;

    if (isXml) {
      newContent = updatePom(content, preserveIds);
      changed    = newContent !== content;
    } else {
      [newContent, changed] = updateGradle(content, isKts, true);
    }

    if (changed) {
      fs.writeFileSync(filePath, newContent, 'utf-8');
      core.info(`  Updated: ${filePath}`);
      updated.add(filePath);
    }
  });

  core.info(`Spring Cloud Contract: updated repository references in ${updated.size} file(s).`);
  return updated;
}

function lookupProjectOverride(repoName) {
  const projectName = repoName.replace(/-commercial$/, '');
  return PROJECT_OVERRIDES[projectName] || PROJECT_OVERRIDES[repoName] || null;
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
    const commitMsg  = core.getInput('commit-message') || 'Updating repositories to commercial Broadcom repositories';
    const gitName    = core.getInput('git-user-name')  || 'Spring Builds';
    const gitEmail   = core.getInput('git-user-email') || 'svc.spring-builds@broadcom.com';
    core.setSecret(token);

    core.info('=== Update Commercial Repositories ===');
    core.info(`Repository: ${repository}`);
    core.info(`Branch:     ${branch}`);
    core.info('');

    const repoDir = path.join(os.tmpdir(), '_repos_repo');
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

    const repoName    = repository.split('/').pop();
    const override    = lookupProjectOverride(repoName);
    let updatedByOverride = new Set();

    if (override) {
      core.info(`Running project-specific override for: ${repoName}`);
      updatedByOverride = override(repoDir);
      core.info('');
    }

    core.info('Scanning for old repo.spring.io repository references...');
    let changed = 0;
    walkDir(repoDir, (filePath) => {
      if (processFile(filePath, updatedByOverride)) changed++;
    });
    core.info(`\nUpdated repository references in ${changed} file(s).`);

    await exec.exec('git', ['-C', repoDir, 'add', '.']);

    const diffCode = await exec.exec(
      'git', ['-C', repoDir, 'diff', '--cached', '--quiet'],
      { ignoreReturnCode: true }
    );
    if (diffCode === 0) {
      core.info('No repository changes to commit.');
      return;
    }

    await exec.exec('git', ['-C', repoDir, 'commit', '-m', commitMsg]);
    await exec.exec('git', ['-C', repoDir, 'push', 'origin', branch]);

    core.info('');
    core.info(`Repository updates committed to '${branch}'.`);
  } catch (err) {
    core.setFailed(`Action failed: ${err.message}`);
  }
}

module.exports = {
  buildPomBlock,
  updatePom,
  findBraceEnd,
  buildGradleMavenEntries,
  processGradleBlock,
  updateGradle,
  processFile,
  lookupProjectOverride,
  COMMERCIAL_REPOS,
  OLD_SPRING_IO_RE,
};

if (require.main === module) {
  run();
}
