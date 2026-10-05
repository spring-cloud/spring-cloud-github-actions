'use strict';

const { parseTrain, branchFor, buildPlan } = require('../release-branch-plan');

const OSS = 'create-oss-release-branch';
const COMMERCIAL = 'create-commercial-release-branch';
const HOTFIX = 'create-hotfix-release-branch';

const entries = list => list.map(([key, version]) => ({ key, version }));
const none = () => false;

describe('parseTrain', () => {
  it('reads OSS from the internal snapshot file, with the phase taken off', () => {
    expect(parseTrain(OSS, '2026.0.0-M1'))
      .toEqual({ configTrain: '2026.0.0-INTERNAL-SNAPSHOT', qualifier: 'M1' });
    expect(parseTrain(OSS, '2026.0.0-rc2'))
      .toEqual({ configTrain: '2026.0.0-INTERNAL-SNAPSHOT', qualifier: 'RC2' });
    expect(parseTrain(OSS, '2026.1.0'))
      .toEqual({ configTrain: '2026.1.0-INTERNAL-SNAPSHOT', qualifier: '' });
  });

  it('accepts a train the caller already suffixed', () => {
    expect(parseTrain(OSS, '2026.1.0-INTERNAL-SNAPSHOT').configTrain)
      .toBe('2026.1.0-INTERNAL-SNAPSHOT');
  });

  it('reads the other modes as given', () => {
    expect(parseTrain(COMMERCIAL, '2025.1.2')).toEqual({ configTrain: '2025.1.2', qualifier: '' });
    expect(parseTrain(HOTFIX, '2025.1.2.1')).toEqual({ configTrain: '2025.1.2.1', qualifier: '' });
  });
});

describe('branchFor', () => {
  it('OSS drops everything after the first dash and appends the phase', () => {
    expect(branchFor(OSS, '5.1.0-INTERNAL-SNAPSHOT', '')).toEqual({ version: '5.1.0', branch: 'release/5.1.0' });
    expect(branchFor(OSS, '5.1.0-INTERNAL-SNAPSHOT', 'M1'))
      .toEqual({ version: '5.1.0-M1', branch: 'release/5.1.0-M1' });
  });

  it('commercial strips only -SNAPSHOT', () => {
    expect(branchFor(COMMERCIAL, '5.0.3-SNAPSHOT', '').branch).toBe('release/5.0.3');
    expect(branchFor(COMMERCIAL, '5.0.3', '').branch).toBe('release/5.0.3');
  });

  it('hotfix takes 4-segment versions and strips -SNAPSHOT', () => {
    expect(branchFor(HOTFIX, '5.0.4.1-SNAPSHOT', '')).toEqual({ version: '5.0.4.1', branch: 'release/5.0.4.1' });
  });

  it('hotfix skips versions that are not 4-segment', () => {
    expect(branchFor(HOTFIX, '5.0.4-SNAPSHOT', '').skip).toMatch(/not a hotfix/);
    expect(branchFor(HOTFIX, '5.0.4.1.2', '').skip).toMatch(/not a hotfix/);
  });
});

describe('buildPlan', () => {
  it('rejects an unknown mode', () => {
    expect(() => buildPlan({ mode: 'nope', train: '1', entries: [], exists: none })).toThrow(/unknown mode/);
  });

  it('skips spring-boot but includes spring-cloud-release', () => {
    const { todo } = buildPlan({
      mode: COMMERCIAL, train: '2026.1.0', exists: none,
      entries: entries([['spring-boot', '4.0.0'], ['spring-cloud-release', '2026.1.0'],
        ['spring-cloud-config', '5.1.0']]),
    });
    expect(todo.map(t => t.project)).toEqual(['spring-cloud-release', 'spring-cloud-config']);
  });

  it('leaves out projects whose branch already exists in the commercial repo', () => {
    const exists = (repo, branch) =>
      repo === 'spring-cloud/spring-cloud-config-commercial' && branch === 'release/5.1.0';
    const { todo, skipped } = buildPlan({
      mode: OSS, train: '2026.1.0', exists,
      entries: entries([['spring-cloud-config', '5.1.0-INTERNAL-SNAPSHOT'],
        ['spring-cloud-commons', '5.1.0-INTERNAL-SNAPSHOT']]),
    });
    expect(todo).toEqual([{ project: 'spring-cloud-commons', version: '5.1.0', branch: 'release/5.1.0' }]);
    expect(skipped).toEqual([
      { project: 'spring-cloud-config', branch: 'release/5.1.0', reason: 'branch already exists' }]);
  });

  it('only plans the hotfix projects of a hotfix train', () => {
    const { todo, skipped } = buildPlan({
      mode: HOTFIX, train: '2025.1.2', exists: none,
      entries: entries([['spring-cloud-config', '5.0.4.1-SNAPSHOT'], ['spring-cloud-commons', '5.0.3-SNAPSHOT']]),
    });
    expect(todo.map(t => t.project)).toEqual(['spring-cloud-config']);
    expect(skipped.map(s => s.project)).toEqual(['spring-cloud-commons']);
  });
});
