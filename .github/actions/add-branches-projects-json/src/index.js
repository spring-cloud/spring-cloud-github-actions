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

// ── Core add logic ──────────────────────────────────────────────────────────

/**
 * Resolves the JDK list to give the new branch.
 *
 * Priority: the source branch's own list, then the section's 'default', then the
 * matching section of the global 'defaults' entry (its branch entry first, then its
 * 'default'). The final ['17', '21'] fallback matches update-projects-json.
 */
function resolveJdkVersions(data, section, sec, sourceBranch) {
  const jdk = sec.jdkVersions || {};
  if (jdk[sourceBranch]) return [...jdk[sourceBranch]];
  if (jdk['default']) return [...jdk['default']];

  const defaults = ((data['defaults'] || {})[section] || {}).jdkVersions || {};
  if (defaults[sourceBranch]) return [...defaults[sourceBranch]];
  if (defaults['default']) return [...defaults['default']];
  return ['17', '21'];
}

/**
 * Registers one new branch in the projects.json data object.
 *
 * Behaviour:
 *   - Derives the project key from the repo name (strips org prefix and -commercial suffix)
 *     and the section the same way retire-branch-projects-json does, so the two are
 *     symmetric: 'commercial' for -commercial repos, 'oss' for everything else.
 *   - Adds the branch to <section>.branches.scheduled (newest first, like update-projects-json).
 *   - Copies <section>.jdkVersions[sourceBranch] to the new branch.
 *   - Leaves branches.default alone. A new release line branch is a maintenance line; the
 *     branch it was cut from stays the default.
 *
 * Returns an array of human-readable change descriptions (empty when nothing changed).
 */
function addBranch(data, repo, branch, sourceBranch) {
  const repoName = repo.split('/').pop();
  const isCommercial = repoName.endsWith('-commercial');
  const projectKey = isCommercial ? repoName.slice(0, -'-commercial'.length) : repoName;
  const section = isCommercial ? 'commercial' : 'oss';

  const changes = [];

  let entry = data[projectKey];
  if (entry === undefined) {
    // Deep copy rather than reuse: update-projects-json hands out the shared 'defaults'
    // object and then mutates it, which silently rewrites the fallback every other project
    // relies on. Seed a real entry for this project instead.
    const seed = ((data['defaults'] || {})[section]) || {};
    entry = { [section]: JSON.parse(JSON.stringify(seed)) };
    data[projectKey] = entry;
    changes.push(`created '${projectKey}' entry seeded from defaults.${section}`);
  }

  if (!entry[section]) entry[section] = {};
  const sec = entry[section];
  if (!sec.branches) sec.branches = {};
  if (!Array.isArray(sec.branches.scheduled)) sec.branches.scheduled = [];
  if (!sec.jdkVersions) sec.jdkVersions = {};

  if (sec.branches.scheduled.includes(branch)) {
    core.info(`  '${branch}' already in ${section}.branches.scheduled — skipping.`);
  } else {
    sec.branches.scheduled.unshift(branch);
    changes.push(`added '${branch}' to ${section}.branches.scheduled`);
  }

  if (sec.jdkVersions[branch] !== undefined) {
    core.info(`  ${section}.jdkVersions['${branch}'] already exists — skipping.`);
  } else {
    const jdks = resolveJdkVersions(data, section, sec, sourceBranch);
    sec.jdkVersions[branch] = jdks;
    changes.push(`set ${section}.jdkVersions['${branch}'] = ${JSON.stringify(jdks)}`);
  }

  return changes;
}

/**
 * Applies every addition. Returns the flat list of change descriptions.
 */
function addBranches(data, additions) {
  const changes = [];
  for (const addition of additions) {
    const repo = addition.repo;
    const branch = addition.branch;
    const sourceBranch = addition.sourceBranch || 'main';
    if (!repo || !branch) {
      throw new Error(`Each addition needs a 'repo' and a 'branch': ${JSON.stringify(addition)}`);
    }
    core.info(`${repo} — ${sourceBranch} -> ${branch}`);
    for (const change of addBranch(data, repo, branch, sourceBranch)) {
      core.info(`  ${change}`);
      changes.push(`${repo}: ${change}`);
    }
  }
  return changes;
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function run() {
  try {
    const additionsInput = core.getInput('additions', { required: true });
    const dryRun = (core.getInput('dry-run') || 'false').toLowerCase() === 'true';
    const commitMessageInput = core.getInput('commit-message');
    const token = core.getInput('token', { required: true });
    core.setSecret(token);

    core.setOutput('changed', 'false');
    core.setOutput('patch', '');

    let additions;
    try {
      additions = JSON.parse(additionsInput);
    } catch {
      core.setFailed('Invalid JSON supplied for the additions input');
      return;
    }
    if (!Array.isArray(additions)) {
      core.setFailed('The additions input must be a JSON array');
      return;
    }

    core.info('=== Add Branches to Projects JSON ===');
    core.info(`Additions: ${additions.length}`);
    core.info(`Dry run:   ${dryRun}`);
    core.info('');

    if (additions.length === 0) {
      core.info('Nothing to register.');
      return;
    }

    const githubRepository = process.env.GITHUB_REPOSITORY;
    const repoDir = path.join(os.tmpdir(), '_add_branches_projects_json_repo');
    if (fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }

    await exec.exec('git', [
      'clone', '--quiet', '--single-branch', '--branch', 'main',
      `https://x-access-token:${token}@github.com/${githubRepository}.git`,
      repoDir,
    ]);

    await exec.exec('git', ['-C', repoDir, 'config', 'user.name', 'Spring Builds']);
    await exec.exec('git', ['-C', repoDir, 'config', 'user.email', 'svc.spring-builds@broadcom.com']);

    const projectsFile = path.join(repoDir, 'config', 'projects.json');
    const data = JSON.parse(fs.readFileSync(projectsFile, 'utf-8'));

    const changes = addBranches(data, additions);
    if (changes.length === 0) {
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

    let patch = '';
    await exec.exec('git', ['-C', repoDir, '--no-pager', 'diff', '--cached'], {
      listeners: { stdout: (d) => { patch += d.toString(); } },
    });

    core.setOutput('changed', 'true');
    core.setOutput('patch', patch);

    const message = commitMessageInput || `Update projects.json: register ${additions.length} new branch(es)`;

    if (dryRun) {
      core.info(`[dry run] not committing "${message}" to ${githubRepository}@main.`);
      return;
    }

    await exec.exec('git', ['-C', repoDir, 'commit', '--quiet', '-m', message]);
    await exec.exec('git', ['-C', repoDir, 'push', '--quiet', 'origin', 'main']);

    core.info('projects.json committed and pushed.');
  } catch (err) {
    core.setFailed(`Action failed: ${err.message}`);
  }
}

module.exports = { dumpsPretty, resolveJdkVersions, addBranch, addBranches };

if (require.main === module) {
  run();
}
