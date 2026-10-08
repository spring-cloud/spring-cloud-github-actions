'use strict';

// Works out which projects in a release train still need a release branch, for
// create-release-branches.yml.
//
// The train's releaser config names every project and the version it releases. Each of the
// three branch-creating workflows derives the branch it creates from that same version, so
// the name is derived here the same way and looked up in the commercial repo: a project whose
// branch already exists is left alone, the rest go into the matrix.
//
// A v<version> tag in either the OSS or the commercial repo means that version has already
// been released, so the project is skipped whatever its branch state - the same guard
// create-commercial-release-branch applies. This covers a project the train is not releasing,
// whose entry still names its previous release, and a release branch that has since been
// deleted.
//
//   create-oss-release-branch         reads <train>-INTERNAL-SNAPSHOT, creates release/<x.y.z>[-M1|-RC2]
//   create-commercial-release-branch  reads <train>,                   creates release/<x.y.z>
//   create-hotfix-release-branch      reads <train>,                   creates release/<x.y.z.h>
//
// The -INTERNAL-SNAPSHOT file lists every project, but only the ones being released in the
// train are at -INTERNAL-SNAPSHOT. The rest are at plain -SNAPSHOT and have neither a tag nor a
// release branch yet, so the tag and branch checks cannot tell them apart - the suffix does.
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
const NON_PROJECT_KEYS = new Set(['spring-boot', 'spring-vault']);

const ORG = 'spring-cloud';

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
    if (!/-INTERNAL-SNAPSHOT$/i.test(rawVersion)) {
      return { skip: 'not being released in this train (not -INTERNAL-SNAPSHOT)' };
    }
    // 5.1.0-INTERNAL-SNAPSHOT -> 5.1.0: everything after the first `-` goes.
    const version = rawVersion.split('-')[0];
    if (!/^\d+\.\d+(\..+)?$/.test(version)) return { skip: `unusable version '${rawVersion}'` };
    const qualified = qualifier ? `${version}-${qualifier}` : version;
    return { version: qualified, branch: `release/${qualified}` };
  }

  if (!/^\d+\.\d+/.test(stripped)) return { skip: `unusable version '${rawVersion}'` };
  return { version: stripped, branch: `release/${stripped}` };
};

// Pure: entries in, plan out. `branchExists(repo, branch)` and `tagExists(repo, tag)` are
// injected so tests need no network.
const buildPlan = ({ mode, train, entries, branchExists, tagExists }) => {
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
    const ossRepo = `${ORG}/${key}`;
    const commercialRepo = `${ossRepo}-commercial`;
    const tag = `v${hit.version}`;
    const taggedIn = [ossRepo, commercialRepo].find(repo => tagExists(repo, tag));
    if (taggedIn) {
      skipped.push({ project: key, branch: hit.branch, reason: `already released (tag ${tag} in ${taggedIn})` });
    } else if (branchExists(commercialRepo, hit.branch)) {
      skipped.push({ project: key, branch: hit.branch, reason: 'branch already exists' });
    } else {
      todo.push({ project: key, version: hit.version, branch: hit.branch });
    }
  }
  return { todo, skipped };
};

// 404 is the answer "no", anything else (auth, rate limit) is a failure that must not be
// read as "the branch is missing" - that would try to create branches that may be there.
const refExists = (repo, ref) => {
  try {
    execFileSync('gh', ['api', `repos/${repo}/git/ref/${ref}`, '--silent'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch (err) {
    const stderr = String(err.stderr || '');
    if (/404|Not Found/i.test(stderr)) return false;
    throw new Error(`could not check ${repo} ${ref}: ${stderr.trim() || err.message}`);
  }
};
const ghBranchExists = (repo, branch) => refExists(repo, `heads/${branch}`);
const ghTagExists = (repo, tag) => refExists(repo, `tags/${tag}`);

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
    const plan = buildPlan({ mode, train, entries, branchExists: ghBranchExists, tagExists: ghTagExists });
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
