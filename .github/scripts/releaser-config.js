'use strict';

// Where the releaser config lives, and how to read it.
//
// Five places needed this and each carried its own copy: the repository name, the branch,
// the gh fetch, the base64 decode and the `releaser.fixed-versions[...]` parse. The copies
// drifted twice - spring-release-train-project-ready was still reading the OSS repository
// long after the other four moved, and the properties file name was upper-cased in two of
// them - so the rule lives here now and the callers keep only their own error wording.

const { execFileSync } = require('child_process');
const { releaserConfigFileName } = require('./releaser-config-file');

// Always spring-cloud-release-commercial, for OSS trains too, and deliberately not derived
// from whether a release is commercial: that repository holds the releaser config for every
// train now, and its train files are plain OSS train files - 2026_0_0-m1.properties is
// spring-cloud-config=5.1.0-M1 and so on, with no commercial-only versions in it.
//
// The OSS repository's copy of this branch stopped at 2025.1.3 and disagrees with reality
// where the two still overlap: it names 5.0.3 versions of spring-cloud-task, -netflix,
// -zookeeper and -vault that have no tags and were never released.
const RELEASER_CONFIG_REPO = 'spring-cloud/spring-cloud-release-commercial';
const RELEASER_CONFIG_BRANCH = 'jenkins-releaser-config';

// Exported as well as used here: post-release rewrites a properties file line by line to
// build the next one, so it needs the pattern itself rather than the parsed result. No /g
// flag, so sharing one instance carries no lastIndex state between callers.
const ENTRY_RE = /^releaser\.fixed-versions\[([^\]]+)\]=(.+)$/;

// The `releaser.fixed-versions[...]` lines of a properties file, in file order. Anything
// else in the file is ignored rather than rejected - these files have carried comments and
// other keys before.
const parseReleaserConfig = content => {
  const entries = [];
  for (const line of String(content).split('\n')) {
    const m = line.match(ENTRY_RE);
    if (m) entries.push({ key: m[1].trim(), version: m[2].trim() });
  }
  return entries;
};

// One project's version, or null. The key is always the plain project name, so a
// -commercial suffix is stripped before looking it up.
const versionOf = (entries, project) => {
  const key = String(project).replace(/-commercial$/, '');
  const hit = entries.find(e => e.key === key);
  return hit ? hit.version : null;
};

// Reads the properties file for a train version and returns it parsed.
//
// Throws rather than exiting, so each caller can add the guidance that makes sense where it
// is - "post-release writes the -snapshot file", "this workflow does not create one", and
// so on. `err.reason` is 'not-found' when the file could not be read and 'empty' when it
// held no entries, for callers that want to tell those apart.
const fetchReleaserConfig = (trainVersion, { token } = {}) => {
  const file = releaserConfigFileName(trainVersion);
  let content;
  try {
    const b64 = execFileSync('gh', ['api',
      `repos/${RELEASER_CONFIG_REPO}/contents/${file}?ref=${RELEASER_CONFIG_BRANCH}`,
      '--jq', '.content'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: token ? { ...process.env, GH_TOKEN: token } : process.env,
      });
    content = Buffer.from(b64.replace(/\s/g, ''), 'base64').toString('utf8');
  } catch (err) {
    const e = new Error(
      `could not read ${file} from ${RELEASER_CONFIG_REPO}@${RELEASER_CONFIG_BRANCH}`);
    e.reason = 'not-found';
    e.file = file;
    throw e;
  }

  const entries = parseReleaserConfig(content);
  if (!entries.length) {
    const e = new Error(`${file} contains no releaser.fixed-versions[...] entries`);
    e.reason = 'empty';
    e.file = file;
    throw e;
  }
  return { file, content, entries };
};

module.exports = {
  RELEASER_CONFIG_REPO,
  RELEASER_CONFIG_BRANCH,
  ENTRY_RE,
  parseReleaserConfig,
  versionOf,
  fetchReleaserConfig,
};

// CLI, so a composite action's bash can read the config without a second implementation:
//
//   node releaser-config.js <train>            -> key=version per line
//   node releaser-config.js <train> <project>  -> that project's version alone
//
// Progress goes to stderr so stdout is only ever the value being asked for. Exit 3 means
// the file could not be read, 4 that the project is not in it - distinct so a caller can
// say something useful about each.
if (require.main === module) {
  const [trainVersion, project] = process.argv.slice(2);
  if (!trainVersion) {
    process.stderr.write('usage: releaser-config.js <release-train-version> [project]\n');
    process.exit(2);
  }
  let config;
  try {
    process.stderr.write(
      `Reading ${releaserConfigFileName(trainVersion)} from ` +
      `${RELEASER_CONFIG_REPO}@${RELEASER_CONFIG_BRANCH}...\n`);
    config = fetchReleaserConfig(trainVersion);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(3);
  }
  if (!project) {
    for (const e of config.entries) process.stdout.write(`${e.key}=${e.version}\n`);
    process.exit(0);
  }
  const version = versionOf(config.entries, project);
  if (!version) {
    process.stderr.write(
      `'${project.replace(/-commercial$/, '')}' is not in ${config.file}\n`);
    process.exit(4);
  }
  process.stdout.write(version + '\n');
}
