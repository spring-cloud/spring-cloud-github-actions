'use strict';

const core = require('@actions/core');
const exec = require('@actions/exec');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const YAML = require('yaml');
const { Scalar } = YAML;

// ── Branch parsing ────────────────────────────────────────────────────────────

const BRANCH_RE = /^(\d+)\.(\d+)(?:\.(\d+))?\.x$/;

/**
 * Parses X.Y.x or X.Y.Z.x into { major, minor, patch }.
 * patch is null for standard (non-hotfix) branches.
 * Returns null when the name does not match either pattern.
 * Exported for unit testing.
 */
function parseBranch(branch) {
  const m = branch.match(BRANCH_RE);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: m[3] !== undefined ? parseInt(m[3], 10) : null,
  };
}

// ── Source lookup ─────────────────────────────────────────────────────────────

/**
 * Returns the source YAMLMap whose url matches repoUrl.
 * Falls back to the first source entry when none matches.
 * Exported for unit testing.
 */
function findSource(sourcesSeq, repoUrl) {
  const norm = repoUrl.replace(/\/$/, '');
  for (const src of sourcesSeq.items) {
    const url = src.get('url');
    if (url && String(url).replace(/\/$/, '') === norm) return src;
  }
  return sourcesSeq.items[0];
}

// ── Tag-pattern helpers ───────────────────────────────────────────────────────

/**
 * Parses the major version range from a pattern like v{MIN..MAX}.
 * Returns [lo, hi] or null.
 * Exported for unit testing.
 */
function parseMajorRange(s) {
  const m = s.match(/^v\{(\d+)\.\.(\d+)\}\./);
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
  return null;
}

/**
 * Looks for the first minor-version extglob +({N..M}) starting at afterMajorDotPos.
 * Returns [lo, hi, fullMatchStr] or null.
 * Exported for unit testing.
 */
function parseMinorExtglob(s, afterMajorDotPos) {
  const rest = s.slice(afterMajorDotPos);
  const m = rest.match(/^(\+\(\{(\d+)\.\.(\d+)\}\))/);
  if (m) return [parseInt(m[2], 10), parseInt(m[3], 10), m[1]];
  return null;
}

/**
 * Returns true when a positive tag pattern can match 4-part version strings (e.g. vX.Y.Z.N).
 * Exported for unit testing.
 */
function isFourPartPattern(s) {
  if (s.startsWith('!')) return false;
  if (/\?\(\./.test(s)) return true;
  let tmp = s.replace(/\+\([^)]*\)/g, 'X');
  tmp = tmp.replace(/\??\([^)]*\)/g, 'X');
  tmp = tmp.replace(/\{[^}]*\}/g, 'X');
  return (tmp.match(/\./g) || []).length >= 3;
}

// ── Tag-pattern update logic ──────────────────────────────────────────────────

/**
 * Ensures the tags YAMLSeq covers vMAJOR.MINOR.* tags for a standard branch.
 * Finds the first positive pattern beginning with v{MIN..MAX}. and expands the
 * major and/or minor range if needed. Returns true when the sequence was modified.
 * Exported for unit testing.
 */
function updateStandardTags(tagsSeq, major, minor) {
  for (let i = 0; i < tagsSeq.items.length; i++) {
    const tagNode = tagsSeq.items[i];
    const s = String(tagNode instanceof Scalar ? tagNode.value : tagNode);

    if (s.startsWith('!')) continue;

    const majorRange = parseMajorRange(s);
    if (!majorRange) continue;

    const [lo, hi]    = majorRange;
    const majorEnd    = `v{${lo}..${hi}}.`.length;
    const minorInfo   = parseMinorExtglob(s, majorEnd);

    let mLo, mHi, minorStr, minorOk;
    if (minorInfo) {
      [mLo, mHi, minorStr] = minorInfo;
      minorOk = mLo <= minor && minor <= mHi;
    } else {
      mLo = mHi = minorStr = null;
      minorOk = true;
    }

    const majorOk = lo <= major && major <= hi;

    if (majorOk && minorOk) {
      core.info(`Tag pattern already covers v${major}.${minor}.*: '${s}'`);
      return false;
    }

    let newS = s;

    if (!majorOk) {
      const newLo = Math.min(lo, major);
      const newHi = Math.max(hi, major);
      newS = newS.replace(/^v\{\d+\.\.\d+\}/, `v{${newLo}..${newHi}}`);
      core.info(`Updated tag pattern (major range {${lo}..${hi}} → {${newLo}..${newHi}}): '${s}' → '${newS}'`);
    }

    if (!minorOk && minorStr !== null) {
      const newMLo = Math.min(mLo, minor);
      const newMHi = Math.max(mHi, minor);
      const newMinorStr = `+({${newMLo}..${newMHi}})`;
      const prev = newS;
      newS = newS.replace(minorStr, newMinorStr);
      core.info(`Updated tag pattern (minor range {${mLo}..${mHi}} → {${newMLo}..${newMHi}}): '${prev}' → '${newS}'`);
    }

    if (tagNode instanceof Scalar) {
      tagNode.value = newS;
      tagNode.type  = Scalar.QUOTE_SINGLE;
    } else {
      const sc   = new Scalar(newS);
      sc.type    = Scalar.QUOTE_SINGLE;
      tagsSeq.items[i] = sc;
    }
    return true;
  }

  // No range-based pattern found — append a generic one for this major version.
  const newPat = `v${major}.+([0-9]).+([0-9])?(-{RC,M}*)`;
  const sc     = new Scalar(newPat);
  sc.type      = Scalar.QUOTE_SINGLE;
  tagsSeq.items.push(sc);
  core.info(`No range pattern found; appended: '${newPat}'`);
  return true;
}

/**
 * Ensures the tags YAMLSeq covers vMAJOR.MINOR.PATCH.N tags for a hotfix branch.
 * Appends a new 4-part pattern unless one already exists. Returns true when modified.
 * Exported for unit testing.
 */
function updateHotfixTags(tagsSeq, major, minor, patch) {
  const patterns = tagsSeq.items.map(t => String(t instanceof Scalar ? t.value : t));
  if (patterns.some(isFourPartPattern)) {
    core.info('Hotfix tags already covered by an existing 4-part pattern.');
    return false;
  }
  const newPat = `v${major}.${minor}.${patch}.+([0-9])?(-{RC,M}*)`;
  const sc     = new Scalar(newPat);
  sc.type      = Scalar.QUOTE_SINGLE;
  tagsSeq.items.push(sc);
  core.info(`Appended hotfix tag pattern: '${newPat}'`);
  return true;
}

// ── Playbook update ───────────────────────────────────────────────────────────

/**
 * Parses the Antora playbook content, adds the branch and updates tag patterns.
 * Returns { changed: boolean, output: string }.
 * Exported for unit testing.
 */
function updatePlaybook(fileContent, branch, repoUrl = '') {
  const doc = YAML.parseDocument(fileContent);

  const contentNode = doc.getIn(['content']);
  if (!contentNode) {
    core.info('No content node found in playbook — nothing to update.');
    return { changed: false, output: fileContent };
  }

  const sourcesSeq = contentNode.get('sources');
  if (!sourcesSeq || !sourcesSeq.items || sourcesSeq.items.length === 0) {
    core.info('No content.sources found in playbook — nothing to update.');
    return { changed: false, output: fileContent };
  }

  const source  = findSource(sourcesSeq, repoUrl);
  let changed   = false;

  // ── 1. Branches ────────────────────────────────────────────────────────────
  let branchesSeq = source.get('branches');
  if (!branchesSeq) {
    branchesSeq = doc.createNode([]);
    branchesSeq.flow = true;
    source.set('branches', branchesSeq);
  }

  const existingBranches = branchesSeq.items.map(b =>
    String(b instanceof Scalar ? b.value : b)
  );

  if (existingBranches.includes(branch)) {
    core.info(`Branch '${branch}' already present in content.sources.branches`);
  } else {
    branchesSeq.items.push(new Scalar(branch));
    changed = true;
    const updated = branchesSeq.items.map(b => String(b instanceof Scalar ? b.value : b));
    core.info(`Added '${branch}' to content.sources.branches → [${updated.join(', ')}]`);
  }

  // ── 2. Tags ────────────────────────────────────────────────────────────────
  const version = parseBranch(branch);
  if (version === null) {
    core.info(`Branch '${branch}' is not in X.Y.x or X.Y.Z.x format — skipping tag pattern update.`);
  } else {
    const tagsSeq = source.get('tags');
    if (!tagsSeq) {
      core.info("No 'tags' field in source entry — skipping tag update.");
    } else {
      const { major, minor, patch } = version;
      const tagsChanged = patch !== null
        ? updateHotfixTags(tagsSeq, major, minor, patch)
        : updateStandardTags(tagsSeq, major, minor);
      if (tagsChanged) changed = true;
    }
  }

  if (!changed) {
    core.info('Antora playbook already up to date — no changes written.');
    return { changed: false, output: fileContent };
  }

  return { changed: true, output: doc.toString({ lineWidth: 0 }) };
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function run() {
  try {
    const repository    = core.getInput('repository', { required: true });
    const branch        = core.getInput('branch',     { required: true });
    const token         = core.getInput('token',      { required: true });
    const docsBuildBranch = core.getInput('docs-build-branch') || 'docs-build';
    const commitMsg     = core.getInput('commit-message') || 'Updating antora playbook for new branch';
    const gitName       = core.getInput('git-user-name')  || 'Spring Builds';
    const gitEmail      = core.getInput('git-user-email') || 'svc.spring-builds@broadcom.com';
    core.setSecret(token);

    core.info('=== Update Antora Playbook ===');
    core.info(`Repository:        ${repository}`);
    core.info(`New branch:        ${branch}`);
    core.info(`Docs-build branch: ${docsBuildBranch}`);
    core.info('');

    // Check whether the docs-build branch exists
    let branchExists = false;
    try {
      const exitCode = await exec.exec(
        'gh', ['api', `repos/${repository}/branches/${docsBuildBranch}`, '--silent'],
        { ignoreReturnCode: true, env: { ...process.env, GH_TOKEN: token } }
      );
      branchExists = exitCode === 0;
    } catch {
      branchExists = false;
    }

    if (!branchExists) {
      core.warning(
        `update-antora-playbook: The '${docsBuildBranch}' branch does not exist in ${repository}. Antora playbook was not updated.`
      );
      return;
    }

    const repoDir = path.join(os.tmpdir(), '_antora_repo');
    if (fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }

    await exec.exec('git', [
      'clone', '--single-branch', '--branch', docsBuildBranch,
      `https://x-access-token:${token}@github.com/${repository}.git`,
      repoDir,
    ]);

    await exec.exec('git', ['-C', repoDir, 'config', 'user.name', gitName]);
    await exec.exec('git', ['-C', repoDir, 'config', 'user.email', gitEmail]);

    // Find the playbook file
    let playbookFile = null;
    for (const name of ['antora-playbook.yml', 'antora-playbook.yaml']) {
      const candidate = path.join(repoDir, name);
      if (fs.existsSync(candidate)) { playbookFile = candidate; break; }
    }

    if (!playbookFile) {
      core.warning(
        `update-antora-playbook: No antora-playbook.yml found on the '${docsBuildBranch}' branch of ${repository}. Playbook was not updated.`
      );
      return;
    }

    core.info(`Found playbook: ${path.basename(playbookFile)}`);

    const fileContent = fs.readFileSync(playbookFile, 'utf-8');
    const repoUrl     = `https://github.com/${repository}`;
    const { changed, output } = updatePlaybook(fileContent, branch, repoUrl);

    if (!changed) return;

    fs.writeFileSync(playbookFile, output, 'utf-8');

    await exec.exec('git', ['-C', repoDir, 'add', '.']);

    const diffCode = await exec.exec(
      'git', ['-C', repoDir, 'diff', '--cached', '--quiet'],
      { ignoreReturnCode: true }
    );
    if (diffCode === 0) {
      core.info('Antora playbook already up to date — no commit needed.');
      return;
    }

    await exec.exec('git', ['-C', repoDir, 'commit', '-m', commitMsg]);
    await exec.exec('git', ['-C', repoDir, 'push', 'origin', docsBuildBranch]);

    core.info('');
    core.info(`Antora playbook updated on '${docsBuildBranch}'.`);
  } catch (err) {
    core.setFailed(`Action failed: ${err.message}`);
  }
}

module.exports = {
  parseBranch,
  findSource,
  parseMajorRange,
  parseMinorExtglob,
  isFourPartPattern,
  updateStandardTags,
  updateHotfixTags,
  updatePlaybook,
};

if (require.main === module) {
  run();
}
