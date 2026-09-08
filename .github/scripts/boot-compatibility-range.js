'use strict';

// The compatibilityRange a spring-cloud bom mapping on start.spring.io carries: the range
// of Spring Boot versions a given Spring Cloud release supports.
//
// A train needs two mappings, added when its first milestone ships and then carried
// through the whole progression:
//
//   [4.2.0-M1,4.2.0-SNAPSHOT)   2026.0.0-M1        the release being offered
//   [4.2.0-SNAPSHOT,4.3.0-M1)   2026.0.0-SNAPSHOT  the train's snapshot line
//
// Both are anchored on the Spring Boot version in the release's properties file, but only
// on its numeric base. The floor of the release range is the *phase* floor rather than
// that Boot version verbatim - 4.2.0-M1 for the whole milestone phase even when the train
// is built against Boot 4.2.0-M2 - so the range does not churn on every milestone and a
// user on an earlier Boot milestone is still offered the train.

const { split } = require('./prerelease-rank');

// The numeric part of a Boot version: 4.2.0-M2 -> 4.2.0, 4.2.0-SNAPSHOT -> 4.2.0,
// 4.2.0 -> 4.2.0. Throws rather than guessing, because every range below is built from
// this and a wrong one would be published to start.spring.io.
const bootBase = version => {
  const base = String(version).trim().replace(/-[A-Za-z].*$/, '');
  if (!/^\d+\.\d+\.\d+$/.test(base)) {
    throw new Error(
      `'${version}' is not a <major>.<minor>.<patch> Spring Boot version, so no ` +
      'compatibility range can be derived from it.');
  }
  return base;
};

// The next Boot minor line, patch zeroed: 4.2.0-M2 -> 4.3.0, 4.9.1 -> 4.10.0. The major is
// never rolled - Boot going 4.x to 5.0 is not something to infer from arithmetic, and the
// upper bound only has to be a version beyond this line.
const nextBootMinor = version => {
  const [major, minor] = bootBase(version).split('.').map(Number);
  return `${major}.${minor + 1}.0`;
};

// Which phase of the train a Spring Cloud version is in. Shared grammar with the
// milestone/board resolution rather than a second copy of the -M<n>/-RC<n> regex.
const phaseOf = releaseVersion => {
  const s = split(releaseVersion);
  if (!s) {
    throw new Error(`'${releaseVersion}' is not a release version this can classify.`);
  }
  return s.kind; // 'M' | 'RC' | null
};

// The range for the entry carrying the release itself.
//
//   milestones -> [<base>-M1,<base>-SNAPSHOT)   floor is the phase, not the Boot version
//   candidates -> [<base>-RC1,<base>-SNAPSHOT)
//   GA         -> [<base>,<nextMinor>-M1)       widened, since GA serves the whole line
//
// The pre-release forms stop at <base>-SNAPSHOT so the snapshot entry below takes over
// from there; the GA form has no such neighbour to defer to.
const rangeFor = (bootVersion, releaseVersion) => {
  const base = bootBase(bootVersion);
  const phase = phaseOf(releaseVersion);
  if (phase === null) return `[${base},${nextBootMinor(bootVersion)}-M1)`;
  return `[${base}-${phase}1,${base}-SNAPSHOT)`;
};

// The range for the entry carrying the train's snapshot line. Written once, when the first
// milestone adds it, and never rewritten afterwards.
const snapshotRangeFor = bootVersion =>
  `[${bootBase(bootVersion)}-SNAPSHOT,${nextBootMinor(bootVersion)}-M1)`;

module.exports = { bootBase, nextBootMinor, phaseOf, rangeFor, snapshotRangeFor };
