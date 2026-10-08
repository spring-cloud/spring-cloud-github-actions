'use strict';

const { parseTrain, branchFor, buildPlan } = require('../release-branch-plan');

const OSS = 'create-oss-release-branch';
const COMMERCIAL = 'create-commercial-release-branch';
const HOTFIX = 'create-hotfix-release-branch';

const entries = list => list.map(([key, version]) => ({ key, version }));
const none = () => false;
const noTags = { branchExists: none, tagExists: none };

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

  it('OSS skips versions that are not -INTERNAL-SNAPSHOT', () => {
    expect(branchFor(OSS, '5.0.4-SNAPSHOT', '').skip).toMatch(/not being released/);
    expect(branchFor(OSS, '5.0.3', '').skip).toMatch(/not being released/);
    expect(branchFor(OSS, '5.1.0-internal-snapshot', '').branch).toBe('release/5.1.0');
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
    expect(() => buildPlan({ mode: 'nope', train: '1', entries: [], ...noTags })).toThrow(/unknown mode/);
  });

  it('skips spring-boot and spring-vault but includes spring-cloud-release', () => {
    const { todo } = buildPlan({
      mode: COMMERCIAL, train: '2026.1.0', ...noTags,
      entries: entries([['spring-boot', '4.0.0'], ['spring-vault', '4.0.0'],
        ['spring-cloud-release', '2026.1.0'],
        ['spring-cloud-config', '5.1.0']]),
    });
    expect(todo.map(t => t.project)).toEqual(['spring-cloud-release', 'spring-cloud-config']);
  });

  it('leaves out projects whose branch already exists in the commercial repo', () => {
    const branchExists = (repo, branch) =>
      repo === 'spring-cloud/spring-cloud-config-commercial' && branch === 'release/5.1.0';
    const { todo, skipped } = buildPlan({
      mode: OSS, train: '2026.1.0', branchExists, tagExists: none,
      entries: entries([['spring-cloud-config', '5.1.0-INTERNAL-SNAPSHOT'],
        ['spring-cloud-commons', '5.1.0-INTERNAL-SNAPSHOT']]),
    });
    expect(todo).toEqual([{ project: 'spring-cloud-commons', version: '5.1.0', branch: 'release/5.1.0' }]);
    expect(skipped).toEqual([
      { project: 'spring-cloud-config', branch: 'release/5.1.0', reason: 'branch already exists' }]);
  });

  it('only plans the -INTERNAL-SNAPSHOT projects of an OSS train', () => {
    const { todo, skipped } = buildPlan({
      mode: OSS, train: '2026.1.0', ...noTags,
      entries: entries([['spring-cloud-config', '5.1.0-INTERNAL-SNAPSHOT'],
        ['spring-cloud-commons', '5.1.0-SNAPSHOT'], ['spring-cloud-release', '2026.1.0-INTERNAL-SNAPSHOT']]),
    });
    expect(todo.map(t => t.project)).toEqual(['spring-cloud-config', 'spring-cloud-release']);
    expect(skipped).toEqual([{
      project: 'spring-cloud-commons', reason: 'not being released in this train (not -INTERNAL-SNAPSHOT)' }]);
  });

  it('only plans the hotfix projects of a hotfix train', () => {
    const { todo, skipped } = buildPlan({
      mode: HOTFIX, train: '2025.1.2', ...noTags,
      entries: entries([['spring-cloud-config', '5.0.4.1-SNAPSHOT'], ['spring-cloud-commons', '5.0.3-SNAPSHOT']]),
    });
    expect(todo.map(t => t.project)).toEqual(['spring-cloud-config']);
    expect(skipped.map(s => s.project)).toEqual(['spring-cloud-commons']);
  });

  it.each([
    ['OSS repo', 'spring-cloud/spring-cloud-config'],
    ['commercial repo', 'spring-cloud/spring-cloud-config-commercial'],
  ])('skips a version already tagged in the %s, even with no branch', (_, taggedRepo) => {
    const tagExists = (repo, tag) => repo === taggedRepo && tag === 'v5.0.3';
    const { todo, skipped } = buildPlan({
      mode: COMMERCIAL, train: '2025.1.2', branchExists: none, tagExists,
      // Not being released in this train: the entry still names the previous release.
      entries: entries([['spring-cloud-config', '5.0.3'], ['spring-cloud-commons', '5.0.4']]),
    });
    expect(todo.map(t => t.project)).toEqual(['spring-cloud-commons']);
    expect(skipped).toEqual([{
      project: 'spring-cloud-config', branch: 'release/5.0.3',
      reason: `already released (tag v5.0.3 in ${taggedRepo})` }]);
  });

  it('looks for the phase-qualified tag on a milestone', () => {
    const seen = [];
    buildPlan({
      mode: OSS, train: '2026.0.0-M1', branchExists: none,
      tagExists: (repo, tag) => { seen.push(tag); return false; },
      entries: entries([['spring-cloud-config', '5.1.0-INTERNAL-SNAPSHOT']]),
    });
    expect(new Set(seen)).toEqual(new Set(['v5.1.0-M1']));
  });

  it('checks the hotfix tag without the -SNAPSHOT', () => {
    const { todo } = buildPlan({
      mode: HOTFIX, train: '2025.1.2', branchExists: none,
      tagExists: (repo, tag) => tag === 'v5.0.4.1',
      entries: entries([['spring-cloud-config', '5.0.4.1-SNAPSHOT']]),
    });
    expect(todo).toEqual([]);
  });
});
