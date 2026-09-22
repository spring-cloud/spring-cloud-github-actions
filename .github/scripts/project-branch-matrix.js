'use strict';

// Every consumer of config/projects.json filters by project name and oss/commercial, then
// walks branches.scheduled (or, for a couple of callers, scheduled union default). This
// module factors out exactly that shared traversal - the shape of the resulting matrix
// entries stays with each caller because it genuinely differs: one entry per branch for a
// workflow that hits a per-branch API, one entry per repository (branches joined into a
// string) for a workflow whose API call is repo-wide.

function parseProjectFilter(raw) {
  const trimmed = (raw || '').trim();
  return trimmed
    ? new Set(trimmed.split(',').map(p => p.trim()).filter(Boolean))
    : new Set();
}

function typeKeysFor(repoType) {
  const type = (repoType || 'both').trim();
  return type === 'both' ? ['oss', 'commercial'] : [type];
}

function repoName(projectKey, typeKey) {
  return typeKey === 'commercial'
    ? `spring-cloud/${projectKey}-commercial`
    : `spring-cloud/${projectKey}`;
}

function knownProjectKeys(projects) {
  return Object.keys(projects).filter(k => k !== 'defaults');
}

// Visits every (project, type) pair that survives the projects/repo_type filters, in
// projects.json's own order. `visit` receives { projectKey, typeKey, repo, section }, where
// `section` is `projects[projectKey][typeKey]` - the caller decides how to turn that into
// matrix entries.
function walkProjects(projects, { filter, repoType } = {}, visit) {
  const filterSet = filter instanceof Set ? filter : parseProjectFilter(filter);
  for (const [projectKey, config] of Object.entries(projects)) {
    if (projectKey === 'defaults') continue;
    if (filterSet.size > 0 && !filterSet.has(projectKey)) continue;
    for (const typeKey of typeKeysFor(repoType)) {
      const section = config[typeKey];
      if (!section) continue;
      visit({ projectKey, typeKey, repo: repoName(projectKey, typeKey), section });
    }
  }
}

// One entry per (repo, branch) drawn from branches.scheduled - the shape
// update-maven-wrapper.yml and ci-status-report.yml already build. `-internal` branches are
// diverted into `excluded` by default, since they are the in-flight development line for the
// next train and most callers leave them alone; pass `excludeInternal: false` to get every
// branch back in `entries` instead (rollout-actions-ref.yml treats internal branches
// differently rather than skipping them, so it needs them present).
function buildBranchMatrix(projects, { filter, repoType, excludeInternal = true } = {}) {
  const entries = [];
  const excluded = [];
  walkProjects(projects, { filter, repoType }, ({ projectKey, typeKey, repo, section }) => {
    for (const branch of section.branches?.scheduled || []) {
      if (excludeInternal && branch.endsWith('-internal')) {
        excluded.push(`${repo}@${branch}`);
        continue;
      }
      entries.push({ project: projectKey, repo, type: typeKey, branch });
    }
  });
  entries.sort((a, b) => a.repo.localeCompare(b.repo) || a.branch.localeCompare(b.branch));
  excluded.sort();
  return { entries, excluded };
}

// One entry per repository, with its branches joined into a comma-separated string rather
// than fanned out per branch - for callers whose API call is repo-wide (Dependabot PRs are
// listed repo-wide and then attributed to a branch, so a per-branch fan-out would repeat the
// same fetch). A matrix value can't carry an array without `toJson` pretty-printing it and
// breaking the consuming YAML, hence the join. `branchesOf(section)` decides which branches
// count; defaults to branches.scheduled. Every (project, type) pair that survives the
// filters gets an entry, even one with no branches at all - a caller that needs to skip
// those (lock-unlock-branches.yml does, since a repo with nothing to lock is pointless to
// visit) filters the result itself rather than this function deciding for every caller.
function buildRepoMatrix(projects, { filter, repoType, branchesOf } = {}) {
  const pick = branchesOf || (section => section.branches?.scheduled || []);
  const entries = [];
  walkProjects(projects, { filter, repoType }, ({ projectKey, typeKey, repo, section }) => {
    const branches = pick(section);
    entries.push({ project: projectKey, repo, type: typeKey, branches: branches.join(',') });
  });
  entries.sort((a, b) => a.repo.localeCompare(b.repo));
  return { entries };
}

module.exports = {
  parseProjectFilter, typeKeysFor, repoName, knownProjectKeys,
  walkProjects, buildBranchMatrix, buildRepoMatrix,
};
