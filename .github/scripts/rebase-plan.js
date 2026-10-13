'use strict';

// Works out which branches rebase-release-branches.yml has to rebase, from a release train's
// train.yml (spring-io/release-train, read at the tag named after the train).
//
// Every spring-cloud version in train.yml leads to release/<version> in the project's
// commercial repo. How that branch is brought up to date depends on where the version goes:
//
//   maven_central     an OSS release. <x.y>.x-internal (commercial repo) is rebased onto the OSS
//                     <x.y>.x branch, then release/<version> onto the rebased -internal branch.
//   spring_enterprise a commercial release. release/<version> is rebased onto the commercial
//                     <x.y>.x branch.
//   hotfix            the 4-segment versions (5.0.4.1). They are spring_enterprise in train.yml
//                     but cut from -internal, so when the project has an <x.y>.x-internal branch
//                     they follow the OSS path. Without one they follow the commercial path.
//
// Only -internal and release/* branches are ever rewritten. The OSS and commercial <x.y>.x
// branches are used as bases and never pushed to.
//
// -internal is shared by the whole minor line, so one job covers every version of a project in
// that line: 5.0.4 and 5.0.4.1 rebase -internal once and both release branches follow it.

const { execFileSync } = require('child_process');
const fs = require('fs');

const ORG = 'spring-cloud';

const isHotfix = version => /^\d+\.\d+\.\d+\.\d+$/.test(version);

// 5.0.4 -> 5.0, 5.0.4.1 -> 5.0, 5.1.0-RC1 -> 5.1
const lineOf = version => {
  const m = String(version).match(/^(\d+)\.(\d+)\./);
  return m ? `${m[1]}.${m[2]}` : null;
};

// Reads the `releases:` section of train.yml. The file is machine-written and regular, so
// this reads the three indent levels it uses instead of pulling in a YAML dependency (the
// scripts here have none):
//
//   releases:
//     spring-cloud-config:                                   project
//       "5.0.4":                                             version
//         release-repository: spring-cloud/...-commercial    fields of the version
//         deployment-destination: maven_central
//
// Returns [{ project, version, repository, destination, state }] in file order.
const parseTrainYml = text => {
  const entries = [];
  let inReleases = false;
  let project = null;
  let current = null;

  for (const line of String(text).split('\n')) {
    if (/^\S/.test(line)) {
      inReleases = /^releases:\s*$/.test(line);
      project = null;
      current = null;
      continue;
    }
    if (!inReleases) continue;

    let m;
    if ((m = line.match(/^ {2}([A-Za-z0-9._-]+):\s*$/))) {
      project = m[1];
      current = null;
    } else if (project && (m = line.match(/^ {4}"?([^":\s]+)"?:\s*$/))) {
      current = { project, version: m[1], repository: '', destination: '', state: '' };
      entries.push(current);
    } else if (current && (m = line.match(/^ {6}([a-z-]+):\s*(\S+)\s*$/))) {
      if (m[1] === 'release-repository') current.repository = m[2];
      else if (m[1] === 'deployment-destination') current.destination = m[2];
      else if (m[1] === 'state') current.state = m[2];
    }
  }
  return entries;
};

// The spring-cloud projects among the train's entries. train.yml also carries Reactor,
// Micrometer, Spring Data and so on, none of which this repo manages.
const isCloudProject = e => e.project.startsWith('spring-cloud-') && e.repository.startsWith(`${ORG}/`);

// Pure: entries in, plan out. `internalExists(repo, branch)` is injected so tests need no
// network.
//
// `projects` is the optional filter. Names the train does not contain come back in `unknown`
// so the summary can say so rather than silently doing nothing for a typo.
const buildPlan = ({ entries, projects = [], internalExists }) => {
  const cloud = entries.filter(isCloudProject);
  const wanted = new Set(projects);
  const present = new Set(cloud.map(e => e.project));
  const unknown = [...wanted].filter(p => !present.has(p));

  const skipped = [];
  const lines = new Map();
  for (const e of cloud) {
    if (wanted.size && !wanted.has(e.project)) continue;
    const line = lineOf(e.version);
    if (!line) {
      skipped.push({ project: e.project, version: e.version, reason: `unusable version '${e.version}'` });
      continue;
    }
    const key = `${e.project}@${line}`;
    if (!lines.has(key)) lines.set(key, { project: e.project, line, versions: [] });
    lines.get(key).versions.push(e);
  }

  const jobs = [];
  for (const { project, line, versions } of lines.values()) {
    const commercialRepo = `${ORG}/${project}-commercial`;
    const internalBranch = `${line}.x-internal`;
    const oss = versions.some(v => v.destination === 'maven_central') ||
      (versions.some(v => isHotfix(v.version)) && internalExists(commercialRepo, internalBranch));
    jobs.push({
      project,
      line,
      mode: oss ? 'oss' : 'commercial',
      // A space separated string rather than an array: matrix values go through
      // fromJSON and into env vars, and the job just word-splits it.
      versions: versions.map(v => v.version).join(' '),
      // The version the base branch is resolved from. Every version in a line gives the same
      // <x.y>.x, so the first will do.
      base_version: versions[0].version,
    });
  }
  return { jobs, skipped, unknown };
};

const ghBranchExists = (repo, branch) => {
  try {
    execFileSync('gh', ['api', `repos/${repo}/branches/${branch}`, '--silent'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch (err) {
    const stderr = String(err.stderr || '');
    // 404 is the answer "no". Anything else (auth, rate limit) must not be read as "this is
    // not an OSS line" - that would rebase a hotfix onto the wrong base.
    if (/404|Not Found/i.test(stderr)) return false;
    throw new Error(`could not check ${repo} ${branch}: ${stderr.trim() || err.message}`);
  }
};

const summarize = ({ train, jobs, skipped, unknown }) => {
  const lines = [
    `### Rebase release branches - ${train}`,
    '',
    `**To rebase (${jobs.length})**`,
    '',
    ...(jobs.length
      ? jobs.map(j => `- ${j.project} ${j.line}.x (${j.mode}): ${j.versions.split(' ').map(v => `\`release/${v}\``).join(', ')}`)
      : ['- none']),
    '',
  ];
  if (skipped.length) {
    lines.push(`**Skipped (${skipped.length})**`, '',
      ...skipped.map(s => `- ${s.project} ${s.version}: ${s.reason}`), '');
  }
  if (unknown.length) {
    lines.push(`:warning: Not in the train, ignored: ${unknown.map(p => `\`${p}\``).join(', ')}`, '');
  }
  return lines.join('\n');
};

// The report written once every job has finished. `results` is the {project, branch, base,
// status, detail} lines rebase-branches.sh writes. Conflicts (and anything that blocked behind
// one, or errored) come first and are spelled out as work for a person, since that is the one
// thing the run cannot do itself.
const STATUS_LABEL = { rebased: 'Rebased', 'up-to-date': 'Already up to date', skipped: 'Skipped' };

const summarizeResults = ({ train, results, dryRun }) => {
  const by = status => results.filter(r => r.status === status);
  const manual = results.filter(r => ['conflict', 'blocked', 'error'].includes(r.status));
  const row = r => `| ${r.project} | \`${r.branch}\` | ${r.base ? `\`${r.base}\`` : ''} | ${r.detail || ''} |`;
  const table = rows => ['| Project | Branch | Rebased onto | Detail |', '|---|---|---|---|', ...rows.map(row), ''];

  const lines = [`### Rebase release branches - ${train}${dryRun ? ' (dry run, nothing pushed)' : ''}`, ''];
  if (manual.length) {
    lines.push(`:x: **${manual.length} branch(es) could not be rebased and must be rebased by hand**`, '',
      ...table(manual.sort((a, b) => a.project.localeCompare(b.project))));
    const conflicts = by('conflict');
    if (conflicts.length) {
      lines.push('To rebase one by hand (the base branch is only read, never pushed):', '', '```',
        'git clone git@github.com:spring-cloud/<project>-commercial.git && cd <project>-commercial',
        'git checkout <branch> && git rebase <base>   # resolve, then: git rebase --continue',
        'git push --force-with-lease origin <branch>', '```', '',
        'For a release/ branch after a -internal rebase, use `git rebase --onto <rebased -internal> <old -internal tip> <branch>`.', '');
    }
  } else {
    lines.push(':white_check_mark: Every branch was rebased cleanly or was already up to date.', '');
  }
  for (const status of ['rebased', 'up-to-date', 'skipped']) {
    const rows = by(status);
    if (!rows.length) continue;
    lines.push(`<details><summary>${STATUS_LABEL[status]} (${rows.length})</summary>`, '', ...table(rows), '</details>', '');
  }
  return lines.join('\n');
};

module.exports = { isHotfix, lineOf, parseTrainYml, isCloudProject, buildPlan, summarize, summarizeResults };

// CLI:  node rebase-plan.js <spring-cloud-release-train> [projects]
//
// `projects` is a comma separated list, blank for every spring-cloud project in the train.
// Writes `matrix` (a {include:[...]} object) and `has_work` to $GITHUB_OUTPUT and a report to
// $GITHUB_STEP_SUMMARY, when those are set.
if (require.main === module) {
  const [train, projectsArg = ''] = process.argv.slice(2);
  if (!train) {
    process.stderr.write('usage: rebase-plan.js <release-train> [comma,separated,projects]\n');
    process.exit(2);
  }
  try {
    const raw = execFileSync('gh', ['api', `repos/spring-io/release-train/contents/train.yml?ref=${train}`,
      '-H', 'Accept: application/vnd.github.raw'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const entries = parseTrainYml(raw);
    if (!entries.length) throw new Error(`no releases found in train.yml at ${train}`);

    const projects = projectsArg.split(',').map(p => p.trim()).filter(Boolean);
    const plan = buildPlan({ entries, projects, internalExists: ghBranchExists });
    const report = summarize({ train, ...plan });

    process.stdout.write(report + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT,
        `matrix=${JSON.stringify({ include: plan.jobs })}\nhas_work=${plan.jobs.length > 0}\n`);
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
