'use strict';

const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

// ── Core retire logic ───────────────────────────────────────────────────────

/**
 * Removes a branch from config/projects.json when the branch is being retired.
 *
 * Behaviour:
 *   - Derives the project key from the repo name (strips org prefix and -commercial suffix).
 *   - Falls back to the 'defaults' entry when no project-specific entry exists.
 *   - Modifies the 'commercial' section for -commercial repos, 'oss' for all others.
 *   - Throws when the branch is set as the default (prevents retiring an active branch).
 *   - Removes the branch from scheduled and jdkVersions.
 *
 * Returns true if any changes were made.
 */
function retireBranch(data, repo, branch) {
  const repoName = repo.split('/').pop();
  const isCommercial = repoName.endsWith('-commercial');
  const projectKey = isCommercial ? repoName.slice(0, -'-commercial'.length) : repoName;
  const section = isCommercial ? 'commercial' : 'oss';

  core.info(`Project key: '${projectKey}'  Section: '${section}'`);

  let entry;
  let entryKey;
  if (data[projectKey] !== undefined) {
    entry = data[projectKey];
    entryKey = projectKey;
    core.info(`Using project entry: '${projectKey}'`);
  } else {
    entry = data['defaults'];
    entryKey = 'defaults';
    core.info(`No entry for '${projectKey}', using 'defaults'`);
  }

  const sec = entry[section];
  if (!sec) {
    core.info(`No '${section}' section found in '${entryKey}' — nothing to do.`);
    return false;
  }

  // Preflight: refuse to retire a branch that is set as the default
  const defaultBranches = ((sec.branches || {}).default) || [];
  if (defaultBranches.includes(branch)) {
    throw new Error(
      `'${branch}' is listed in ${section}.branches.default.\n` +
      'Update or remove the default branch entry before retiring.'
    );
  }

  let changed = false;

  // Remove from scheduled
  const scheduled = ((sec.branches || {}).scheduled) || [];
  const schedIdx = scheduled.indexOf(branch);
  if (schedIdx !== -1) {
    scheduled.splice(schedIdx, 1);
    core.info(`Removed '${branch}' from ${section}.branches.scheduled.`);
    changed = true;
  } else {
    core.info(`'${branch}' not found in ${section}.branches.scheduled — skipping.`);
  }

  // Remove from jdkVersions
  const jdkVersions = sec.jdkVersions || {};
  if (jdkVersions[branch] !== undefined) {
    delete jdkVersions[branch];
    core.info(`Removed ${section}.jdkVersions['${branch}'].`);
    changed = true;
  } else {
    core.info(`'${branch}' not found in ${section}.jdkVersions — skipping.`);
  }

  return changed;
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function run() {
  try {
    const repo = core.getInput('repo', { required: true });
    const branch = core.getInput('branch', { required: true });
    const token = core.getInput('token', { required: true });
    core.setSecret(token);

    const githubRepository = process.env.GITHUB_REPOSITORY;

    core.info('=== Retire Branch from Projects JSON ===');
    core.info(`Repo:   ${repo}`);
    core.info(`Branch: ${branch}`);
    core.info('');

    const baseName = repo.split('/').pop().replace(/-commercial$/, '');

    const repoDir = path.join(os.tmpdir(), '_retire_projects_json_repo');
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

    const changed = retireBranch(data, repo, branch);

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

    await exec.exec('git', [
      '-C', repoDir, 'commit', '-m',
      `Update projects.json: retire ${baseName} branch ${branch}`,
    ]);
    await exec.exec('git', ['-C', repoDir, 'push', 'origin', 'main']);

    core.info('projects.json committed and pushed.');
  } catch (err) {
    core.setFailed(`Action failed: ${err.message}`);
  }
}

module.exports = { dumpsPretty, retireBranch };

if (require.main === module) {
  run();
}
