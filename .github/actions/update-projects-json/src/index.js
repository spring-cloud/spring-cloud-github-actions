'use strict';

const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Branch helpers ──────────────────────────────────────────────────────────

/**
 * Returns true when branch is a hotfix branch.
 * Hotfix patterns: X.Y.Z.x (e.g. 4.3.3.x) or release/X.Y.Z (e.g. release/4.2.7)
 */
function isHotfixBranch(branch) {
  if (branch.startsWith('release/')) return true;
  const parts = branch.split('.');
  return parts.length >= 4 && parts[parts.length - 1] === 'x';
}

/**
 * Returns the X.Y.x parent of a hotfix branch.
 *   4.3.3.x       → 4.3.x
 *   release/4.2.7 → 4.2.x
 */
function parentBranch(branch) {
  const version = branch.startsWith('release/') ? branch.slice('release/'.length) : branch;
  const parts = version.split('.');
  return `${parts[0]}.${parts[1]}.x`;
}

// ── JDK resolution ──────────────────────────────────────────────────────────

/**
 * Determines which JDK list to copy into commercial.jdkVersions for the new branch.
 * Priority:
 *   1. For hotfix branches → oss.jdkVersions[parent .x branch]
 *                          → commercial.jdkVersions[parent .x branch] (parent already commercial)
 *   2. For regular branches → oss.jdkVersions[ossBranch]
 *   3. Fallback → commercial.jdkVersions['default'] or oss.jdkVersions['default'] or ['17','21']
 */
function resolveJdkVersions(entry, commercialBranch, ossBranch) {
  const ossJdk = ((entry.oss || {}).jdkVersions) || {};
  const commercialJdk = ((entry.commercial || {}).jdkVersions) || {};
  const ossDefaultBranches = ((entry.oss || {}).branches || {}).default || [];

  if (isHotfixBranch(commercialBranch)) {
    const p = parentBranch(commercialBranch);
    if (ossJdk[p]) {
      core.info(`  Hotfix branch — using JDKs from oss.jdkVersions['${p}']: ${JSON.stringify(ossJdk[p])}`);
      return [...ossJdk[p]];
    }
    if (commercialJdk[p]) {
      core.info(`  Hotfix branch — parent '${p}' is already commercial; using commercial.jdkVersions['${p}']: ${JSON.stringify(commercialJdk[p])}`);
      return [...commercialJdk[p]];
    }
    // Parent branch not in projects.json — tag was cut from the OSS default branch (e.g. main).
    // Fall back to the JDKs configured for the OSS default branch.
    for (const defaultBranch of ossDefaultBranches) {
      if (ossJdk[defaultBranch]) {
        core.info(`  Hotfix branch — parent '${p}' not found; falling back to oss.jdkVersions['${defaultBranch}'] (OSS default): ${JSON.stringify(ossJdk[defaultBranch])}`);
        return [...ossJdk[defaultBranch]];
      }
    }
  }

  if (ossBranch && ossJdk[ossBranch]) {
    core.info(`  Using JDKs from oss.jdkVersions['${ossBranch}']: ${JSON.stringify(ossJdk[ossBranch])}`);
    return [...ossJdk[ossBranch]];
  }

  const fallback = commercialJdk['default'] || ossJdk['default'] || ['17', '21'];
  core.info(`  No matching JDK entry found — using fallback: ${JSON.stringify(fallback)}`);
  return [...fallback];
}

// ── JSON serialization ──────────────────────────────────────────────────────

/**
 * Serializes data to JSON (indent=2) while keeping string arrays on a single line,
 * matching the style used in projects.json.
 */
function dumpsPretty(data) {
  const raw = JSON.stringify(data, null, 2);
  return raw.replace(/\[\n(?:\s+"[^"]*",?\n)+\s*\]/g, (match) => {
    const items = match.match(/"[^"]*"/g);
    return '[' + items.join(', ') + ']';
  });
}

// ── Core update logic ───────────────────────────────────────────────────────

/**
 * Updates the projects.json data object when a new commercial branch is initialized.
 * Returns true if any changes were made.
 */
function updateProjects(data, ossRepo, ossBranch, commercialBranch, setDefault) {
  const projectName = ossRepo.split('/').pop();

  let entry;
  if (data[projectName] !== undefined) {
    entry = data[projectName];
    core.info(`Using project entry: '${projectName}'`);
  } else {
    entry = data['defaults'];
    core.info(`No entry for '${projectName}', using 'defaults'`);
  }

  let changed = false;

  if (!entry.commercial) entry.commercial = {};
  const commercial = entry.commercial;
  if (!commercial.branches) commercial.branches = {};
  const branches = commercial.branches;
  if (!branches.scheduled) branches.scheduled = [];
  const scheduled = branches.scheduled;
  if (!commercial.jdkVersions) commercial.jdkVersions = {};
  const jdkMap = commercial.jdkVersions;

  // 1. Add to commercial.branches.scheduled
  if (scheduled.includes(commercialBranch)) {
    core.info(`'${commercialBranch}' already in commercial.branches.scheduled — skipping.`);
  } else {
    scheduled.unshift(commercialBranch);
    core.info(`Added '${commercialBranch}' to commercial.branches.scheduled.`);
    changed = true;
  }

  // 2. Update commercial.branches.default
  if (setDefault) {
    if (!branches.default) branches.default = [];
    if (branches.default.includes(commercialBranch)) {
      core.info(`'${commercialBranch}' already in commercial.branches.default — skipping.`);
    } else {
      branches.default = [commercialBranch];
      core.info(`Set commercial.branches.default = ['${commercialBranch}'].`);
      changed = true;
    }
  }

  // 3. Add commercial.jdkVersions for the new branch
  if (jdkMap[commercialBranch] !== undefined) {
    core.info(`commercial.jdkVersions['${commercialBranch}'] already exists — skipping.`);
  } else {
    const jdks = resolveJdkVersions(entry, commercialBranch, ossBranch);
    jdkMap[commercialBranch] = jdks;
    core.info(`Set commercial.jdkVersions['${commercialBranch}'] = ${JSON.stringify(jdks)}.`);
    changed = true;
  }

  // 4. Remove the branch from the OSS entry (regular branches only, not tag-based hotfixes)
  if (ossBranch && !isHotfixBranch(commercialBranch)) {
    if (!entry.oss) entry.oss = {};
    const oss = entry.oss;
    if (!oss.branches) oss.branches = {};
    if (!oss.branches.scheduled) oss.branches.scheduled = [];
    const ossSched = oss.branches.scheduled;

    const idx = ossSched.indexOf(ossBranch);
    if (idx !== -1) {
      ossSched.splice(idx, 1);
      core.info(`Removed '${ossBranch}' from oss.branches.scheduled.`);
      changed = true;
    } else {
      core.info(`'${ossBranch}' not in oss.branches.scheduled — skipping removal.`);
    }

    if (!oss.jdkVersions) oss.jdkVersions = {};
    const ossJdk = oss.jdkVersions;
    if (ossJdk[ossBranch] !== undefined) {
      delete ossJdk[ossBranch];
      core.info(`Removed oss.jdkVersions['${ossBranch}'].`);
      changed = true;
    } else {
      core.info(`oss.jdkVersions['${ossBranch}'] not found — skipping removal.`);
    }
  }

  return changed;
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function run() {
  try {
    const ossRepo = core.getInput('oss-repo', { required: true });
    const ossBranch = (core.getInput('oss-branch') || '').trim();
    const commercialBranch = core.getInput('commercial-branch', { required: true }).trim();
    const setDefaultStr = (core.getInput('set-default-branch') || 'false').toLowerCase();
    const setDefault = ['true', '1', 'yes'].includes(setDefaultStr);
    const token = core.getInput('token', { required: true });
    core.setSecret(token);

    const githubRepository = process.env.GITHUB_REPOSITORY;

    core.info('=== Update Projects JSON ===');
    core.info(`OSS repo:          ${ossRepo}`);
    core.info(`OSS branch:        ${ossBranch || '<none>'}`);
    core.info(`Commercial branch: ${commercialBranch}`);
    core.info(`Set default:       ${setDefault}`);
    core.info('');

    const repoDir = path.join(os.tmpdir(), '_projects_json_repo');
    if (fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }

    await exec.exec('git', [
      'clone', '--single-branch', '--branch', 'main',
      `https://x-access-token:${token}@github.com/${githubRepository}.git`,
      repoDir,
    ]);

    await exec.exec('git', ['-C', repoDir, 'config', 'user.name', 'Spring Builds']);
    await exec.exec('git', ['-C', repoDir, 'config', 'user.email', 'svc.spring-builds@broadcom.com']);

    const projectsFile = path.join(repoDir, 'config', 'projects.json');
    const data = JSON.parse(fs.readFileSync(projectsFile, 'utf-8'));

    const changed = updateProjects(data, ossRepo, ossBranch, commercialBranch, setDefault);

    if (!changed) {
      core.info('No changes required.');
      return;
    }

    fs.writeFileSync(projectsFile, dumpsPretty(data) + '\n', 'utf-8');

    await exec.exec('git', ['-C', repoDir, 'add', 'config/projects.json']);

    const diffCode = await exec.exec(
      'git', ['-C', repoDir, 'diff', '--cached', '--quiet'],
      { ignoreReturnCode: true }
    );
    if (diffCode === 0) {
      core.info('projects.json is unchanged — nothing to commit.');
      return;
    }

    const projectName = ossRepo.split('/').pop();
    await exec.exec('git', [
      '-C', repoDir, 'commit', '-m',
      `Update projects.json: add ${projectName} commercial branch ${commercialBranch}`,
    ]);
    await exec.exec('git', ['-C', repoDir, 'push', 'origin', 'main']);

    core.info('projects.json committed and pushed.');
  } catch (err) {
    core.setFailed(`Action failed: ${err.message}`);
  }
}

module.exports = { isHotfixBranch, parentBranch, resolveJdkVersions, dumpsPretty, updateProjects };

if (require.main === module) {
  run();
}
