'use strict';

const { cmp } = require('./version-cmp');

// Reads the `ignore` rules of a parsed .github/dependabot.yml so update-maven-wrapper.yml can
// hold a branch back on the same Maven versions Dependabot has been told to leave alone. A
// branch pinned there on purpose (a plugin that breaks on the newer Maven, say) would otherwise
// get a wrapper PR from this workflow that Dependabot itself would never raise.
//
// Pure functions over the parsed config - fetching and YAML parsing stay in the workflow.
// Anything this module cannot interpret matches nothing: an unreadable rule must never stop a
// branch from being updated.

const MAVEN_DEPENDENCY = 'org.apache.maven:apache-maven';

const isVersion = s => /^\d+(\.\d+)*$/.test(s);

// `*` is the only wildcard dependabot.yml allows in a dependency-name.
function nameMatches(pattern, name) {
  if (typeof pattern !== 'string') return false;
  const re = new RegExp('^' + pattern.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(name);
}

// Does the entry's directory (or directories) cover the repository root, where the wrapper
// the workflow edits lives? A missing directory is read as the root rather than as "nothing".
function coversRoot(entry) {
  const dirs = [].concat(entry.directory || [], entry.directories || []);
  if (!dirs.length) return true;
  return dirs.some(d => ['/', '/*', '/**', '**', '*'].includes(String(d).trim()));
}

// One Dependabot `versions` string, as a predicate over a candidate version - or null when the
// form is not one of those handled. Handled:
//   >=3.10.0   > 3   <4   <=3.9.9   =3.9.1   ~> 3.9   (comma/space separated: all must hold)
//   [3.10,)    (,4.0)   [3.9,3.10)   (Maven intervals, comma-joined: any may hold)
//   3.x   3.10.*   (prefix wildcards)
function parseRange(range) {
  const text = String(range).trim();
  if (!text) return null;

  if (/^[[(]/.test(text)) {
    const intervals = text.match(/[[(][^[\]()]*[\])]/g);
    if (!intervals || intervals.join(',').replace(/\s/g, '') !== text.replace(/\s/g, '')) return null;
    const preds = intervals.map(iv => {
      const m = /^([[(])\s*([^,\s]*)\s*,\s*([^,\s]*)\s*([\])])$/.exec(iv);
      if (!m) return null;
      const [, open, lo, hi, close] = m;
      if ((lo && !isVersion(lo)) || (hi && !isVersion(hi))) return null;
      return v => (!lo || (open === '[' ? cmp(v, lo) >= 0 : cmp(v, lo) > 0))
        && (!hi || (close === ']' ? cmp(v, hi) <= 0 : cmp(v, hi) < 0));
    });
    return preds.includes(null) ? null : v => preds.some(p => p(v));
  }

  const wild = /^(\d+(?:\.\d+)*)\.(?:x|\*)$/i.exec(text);
  if (wild) {
    const prefix = wild[1].split('.');
    return v => {
      const parts = v.split('.');
      return prefix.every((p, i) => Number(parts[i]) === Number(p));
    };
  }

  // Normalise "> = 3" style spacing, then split into comparators.
  const tokens = text.replace(/\s*(>=|<=|~>|>|<|=)\s*/g, ' $1').split(/[\s,]+/).filter(Boolean);
  const preds = [];
  for (const t of tokens) {
    const m = /^(>=|<=|~>|>|<|=)?(\d+(?:\.\d+)*)$/.exec(t);
    if (!m) return null;
    const [, op = '=', ver] = m;
    if (op === '>=') preds.push(v => cmp(v, ver) >= 0);
    else if (op === '>') preds.push(v => cmp(v, ver) > 0);
    else if (op === '<=') preds.push(v => cmp(v, ver) <= 0);
    else if (op === '<') preds.push(v => cmp(v, ver) < 0);
    else if (op === '=') preds.push(v => cmp(v, ver) === 0);
    else {
      // Pessimistic: ~> 3.9 means >= 3.9 and < 4; ~> 3.9.1 means >= 3.9.1 and < 3.10.
      const parts = ver.split('.').map(Number);
      const upper = parts.length > 1 ? [...parts.slice(0, -2), parts[parts.length - 2] + 1] : [parts[0] + 1];
      preds.push(v => cmp(v, ver) >= 0 && cmp(v, upper.join('.')) < 0);
    }
  }
  return preds.length ? v => preds.every(p => p(v)) : null;
}

// The size of the jump from `current` to `candidate`, as Dependabot names it.
function updateType(current, candidate) {
  if (!current || !isVersion(current) || !isVersion(candidate)) return null;
  const a = current.split('.').map(Number), b = candidate.split('.').map(Number);
  if ((a[0] || 0) !== (b[0] || 0)) return 'version-update:semver-major';
  if ((a[1] || 0) !== (b[1] || 0)) return 'version-update:semver-minor';
  return 'version-update:semver-patch';
}

// The first ignore rule that excludes `candidate` for this branch, as a human-readable string,
// or null when none does. `warn` is told about `versions` strings that could not be read.
function findMavenIgnore(config, { branch, defaultBranch, current, candidate, warn = () => {} }) {
  const updates = config && Array.isArray(config.updates) ? config.updates : [];
  for (const entry of updates) {
    if (!entry || entry['package-ecosystem'] !== 'maven' || !coversRoot(entry)) continue;
    if ((entry['target-branch'] || defaultBranch) !== branch) continue;

    for (const rule of Array.isArray(entry.ignore) ? entry.ignore : []) {
      if (!rule || !nameMatches(rule['dependency-name'], MAVEN_DEPENDENCY)) continue;
      const versions = [].concat(rule.versions || []);
      const types = [].concat(rule['update-types'] || []);
      const where = `${rule['dependency-name']} ignore in dependabot.yml`
        + (entry['target-branch'] ? ` (target-branch ${entry['target-branch']})` : '');

      // A rule with neither field ignores the dependency outright.
      if (!versions.length && !types.length) return `${where}: all versions`;

      for (const range of versions) {
        const pred = parseRange(range);
        if (!pred) { warn(`unrecognised ignore versions '${range}' - not applied`); continue; }
        if (pred(candidate)) return `${where}: versions '${range}'`;
      }
      const type = updateType(current, candidate);
      if (type && types.includes(type)) return `${where}: update-types '${type}'`;
    }
  }
  return null;
}

// The newest candidate Dependabot has not been told to ignore for this branch. `candidates` is
// ascending. `skipped` lists the newer ones passed over, so the summary can say why a branch is
// not on the newest Maven. `target` is null when every candidate is ignored.
function pickMavenTarget(config, { branch, defaultBranch, current, candidates, warn }) {
  const skipped = [];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const reason = findMavenIgnore(config, { branch, defaultBranch, current, candidate: candidates[i], warn });
    if (!reason) return { target: candidates[i], skipped };
    skipped.push({ version: candidates[i], reason });
  }
  return { target: null, skipped };
}

module.exports = { findMavenIgnore, pickMavenTarget, parseRange };
