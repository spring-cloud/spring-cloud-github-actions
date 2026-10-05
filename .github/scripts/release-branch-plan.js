'use strict';

// Works out which projects in a release train still need a release branch, for
// create-release-branches.yml.
//
// The train's releaser config names every project and the version it releases. Each of the
// three branch-creating workflows derives the branch it creates from that same version, so
// the name is derived here the same way and looked up in the commercial repo: a project whose
// branch already exists is left alone, the rest go into the matrix.
//
//   create-oss-release-branch         reads <train>-INTERNAL-SNAPSHOT, creates release/<x.y.z>[-M1|-RC2]
//   create-commercial-release-branch  reads <train>,                   creates release/<x.y.z>
//   create-hotfix-release-branch      reads <train>,                   creates release/<x.y.z.h>
//
// Hotfix versions are the 4-segment ones. The releaser config lists them as -SNAPSHOT, since
// the train is not finalized when the branches are cut.

const { execFileSync } = require('child_process');
const fs = require('fs');
const { fetchReleaserConfig } = require('./releaser-config');

const MODES = [
  'create-oss-release-branch',
  'create-commercial-release-branch',
  'create-hotfix-release-branch',
];

// Entries in the releaser config that are not spring-cloud projects. spring-cloud-release is
// deliberately absent: it is a project like any other and needs its own release branch.
const NON_PROJECT_KEYS = new Set(['spring-boot']);

const COMMERCIAL_ORG = 'spring-cloud';

// Which properties file a mode reads, and the milestone/RC phase of the train.
//
// OSS strips the phase and reads the -INTERNAL-SNAPSHOT file, exactly as the `train` step of
// create-oss-release-branch does, so one file serves every pre-release of a train. The other
// two modes read the train as given.
const parseTrain = (mode, train) => {
  const given = String(train).trim();
  if (mode !== 'create-oss-release-branch') return { configTrain: given, qualifier: '' };

  let t = given.replace(/-INTERNAL-SNAPSHOT$/i, '');
  let qualifier = '';
  const m = t.match(/-(M|RC)(\d+)$/i);
  if (m) {
    qualifier = `${m[1].toUpperCase()}${m[2]}`;
    t = t.slice(0, t.length - m[0].length);
  }
  return { configTrain: `${t}-INTERNAL-SNAPSHOT`, qualifier };
};

// The release branch a config entry leads to, or a reason there isn't one.
const branchFor = (mode, rawVersion, qualifier) => {
  const stripped = rawVersion.replace(/-SNAPSHOT$/i, '');

  if (mode === 'create-hotfix-release-branch') {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(stripped)) return { skip: 'not a hotfix version' };
    return { version: stripped, branch: `release/${stripped}` };
  }

  if (mode === 'create-oss-release-branch') {
    // 5.1.0-INTERNAL-SNAPSHOT -> 5.1.0: everything after the first `-` goes.
    const version = rawVersion.split('-')[0];
    if (!/^\d+\.\d+(\..+)?$/.test(version)) return { skip: `unusable version '${rawVersion}'` };
    const qualified = qualifier ? `${version}-${qualifier}` : version;
    return { version: qualified, branch: `release/${qualified}` };
  }

  if (!/^\d+\.\d+/.test(stripped)) return { skip: `unusable version '${rawVersion}'` };
  return { version: stripped, branch: `release/${stripped}` };
};

// Pure: entries in, plan out. `exists(repo, branch)` is injected so tests need no network.
const buildPlan = ({ mode, train, entries, exists }) => {
  if (!MODES.includes(mode)) throw new Error(`unknown mode '${mode}'`);
  const { qualifier } = parseTrain(mode, train);

  const todo = [];
  const skipped = [];
  for (const { key, version: raw } of entries) {
    if (NON_PROJECT_KEYS.has(key)) continue;
    const hit = branchFor(mode, raw, qualifier);
    if (hit.skip) {
      skipped.push({ project: key, reason: hit.skip });
      continue;
    }
    const repo = `${COMMERCIAL_ORG}/${key}-commercial`;
    if (exists(repo, hit.branch)) {
      skipped.push({ project: key, branch: hit.branch, reason: 'branch already exists' });
    } else {
      todo.push({ project: key, version: hit.version, branch: hit.branch });
    }
  }
  return { todo, skipped };
};

// 404 is the answer "no", anything else (auth, rate limit) is a failure that must not be
// read as "the branch is missing" - that would try to create branches that may be there.
const branchExists = (repo, branch) => {
  try {
    execFileSync('gh', ['api', `repos/${repo}/git/ref/heads/${branch}`, '--silent'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch (err) {
    const stderr = String(err.stderr || '');
    if (/404|Not Found/i.test(stderr)) return false;
    throw new Error(`could not check ${repo}@${branch}: ${stderr.trim() || err.message}`);
  }
};

const summarize = ({ mode, train, file, todo, skipped }) => {
  const lines = [
    `### ${mode} - ${train}`,
    '',
    `Releaser config: \`${file}\``,
    '',
    `**To create (${todo.length})**`,
    '',
    ...(todo.length ? todo.map(t => `- ${t.project} -> \`${t.branch}\``) : ['- none']),
    '',
    `**Skipped (${skipped.length})**`,
    '',
    ...(skipped.length
      ? skipped.map(s => `- ${s.project}${s.branch ? ` (\`${s.branch}\`)` : ''}: ${s.reason}`)
      : ['- none']),
    '',
  ];
  return lines.join('\n');
};

module.exports = { MODES, NON_PROJECT_KEYS, parseTrain, branchFor, buildPlan, summarize };

// CLI:  node release-branch-plan.js <mode> <spring-cloud-release-train>
//
// Writes `matrix` (a {include:[...]} object) and `has_work` to $GITHUB_OUTPUT and a report to
// $GITHUB_STEP_SUMMARY, when those are set.
if (require.main === module) {
  const [mode, train] = process.argv.slice(2);
  if (!mode || !train) {
    process.stderr.write(`usage: release-branch-plan.js <${MODES.join('|')}> <release-train>\n`);
    process.exit(2);
  }
  try {
    const { configTrain } = parseTrain(mode, train);
    const { file, entries } = fetchReleaserConfig(configTrain);
    const plan = buildPlan({ mode, train, entries, exists: branchExists });
    const report = summarize({ mode, train, file, ...plan });

    process.stdout.write(report + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT,
        `matrix=${JSON.stringify({ include: plan.todo })}\nhas_work=${plan.todo.length > 0}\n`);
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
