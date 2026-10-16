'use strict';

// Works out which projects in a release train have a release branch that is ready to be
// marked ready, for mark-release-train-ready.yml.
//
// The mirror image of release-branch-plan.js: that one wants the branch to be missing, this
// one wants it to be there. Release branches only exist in the <project>-commercial repos, so
// there is no mode - the train's properties file is read as given, the branch is
// release/<version> with any -SNAPSHOT taken off, and a project goes into the matrix when
//
//   - the version has not been released (no v<version> tag in the OSS or commercial repo), and
//   - release/<version> exists in <project>-commercial.
//
// A project the train is not releasing still has an entry, naming its previous release. That
// release is tagged, or its branch is gone, so the same two checks leave it out.
//
// A hotfix train (2025.1.4.1) is the exception. Its file also lists the projects that are not
// getting a hotfix, at the versions they have in the regular train. Those have no tag yet and
// do have a branch, so the checks above would pick them up - but the regular train's run
// marks them ready, so only the 4-segment (x.y.z.h) versions are planned for a hotfix train.

const fs = require('fs');
const { fetchReleaserConfig } = require('./releaser-config');
const { NON_PROJECT_KEYS, ORG, ghBranchExists, ghTagExists } = require('./release-branch-plan');

// A hotfix train has four segments, like the hotfix versions in it.
const isHotfixTrain = train => /^\d+\.\d+\.\d+\.\d+$/.test(String(train).trim());

// Pure: entries in, plan out. `branchExists(repo, branch)` and `tagExists(repo, tag)` are
// injected so tests need no network.
const buildPlan = ({ train, entries, branchExists, tagExists }) => {
  const hotfix = isHotfixTrain(train);
  const todo = [];
  const skipped = [];
  for (const { key, version: raw } of entries) {
    if (NON_PROJECT_KEYS.has(key)) continue;
    const version = raw.replace(/-SNAPSHOT$/i, '');
    if (!/^\d+\.\d+/.test(version)) {
      skipped.push({ project: key, reason: `unusable version '${raw}'` });
      continue;
    }
    if (hotfix && !/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
      skipped.push({ project: key, reason: `not a hotfix version '${raw}'` });
      continue;
    }
    const branch = `release/${version}`;
    const ossRepo = `${ORG}/${key}`;
    const commercialRepo = `${ossRepo}-commercial`;
    const tag = `v${version}`;
    const taggedIn = [ossRepo, commercialRepo].find(repo => tagExists(repo, tag));
    if (taggedIn) {
      skipped.push({ project: key, branch, reason: `already released (tag ${tag} in ${taggedIn})` });
    } else if (!branchExists(commercialRepo, branch)) {
      skipped.push({ project: key, branch, reason: `no release branch in ${key}-commercial` });
    } else {
      todo.push({ project: key, version, branch });
    }
  }
  return { todo, skipped };
};

const summarize = ({ train, file, todo, skipped }) => [
  `### project-ready - ${train}`,
  '',
  `Releaser config: \`${file}\``,
  '',
  `**To mark ready (${todo.length})**`,
  '',
  ...(todo.length ? todo.map(t => `- ${t.project} -> \`${t.branch}\``) : ['- none']),
  '',
  `**Skipped (${skipped.length})**`,
  '',
  ...(skipped.length
    ? skipped.map(s => `- ${s.project}${s.branch ? ` (\`${s.branch}\`)` : ''}: ${s.reason}`)
    : ['- none']),
  '',
].join('\n');

module.exports = { buildPlan, summarize, isHotfixTrain };

// CLI:  node release-ready-plan.js <spring-cloud-release-train>
//
// Writes `matrix` (a {include:[...]} object) and `has_work` to $GITHUB_OUTPUT and a report to
// $GITHUB_STEP_SUMMARY, when those are set.
if (require.main === module) {
  const [train] = process.argv.slice(2);
  if (!train) {
    process.stderr.write('usage: release-ready-plan.js <release-train>\n');
    process.exit(2);
  }
  try {
    const { file, entries } = fetchReleaserConfig(train.trim());
    const plan = buildPlan({ train, entries, branchExists: ghBranchExists, tagExists: ghTagExists });
    const report = summarize({ train, file, ...plan });

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
