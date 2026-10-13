'use strict';

const { isHotfix, lineOf, parseTrainYml, isCloudProject, buildPlan, summarizeResults } = require('../rebase-plan');

const TRAIN = `state: pending
schedule:
  participation:
    join: 2026-10-09
releases:
  reactor:
    "2025.0.8":
      release-repository: reactor/reactor-commercial
      deployment-destination: maven_central
      state: pending
  spring-cloud-config:
    "4.3.6":
      release-repository: spring-cloud/spring-cloud-config-commercial
      initial-release-branch-type: release
      deployment-destination: spring_enterprise
      state: pending
      commit-hashes:
        joined: abc
    "5.0.6":
      release-repository: spring-cloud/spring-cloud-config-commercial
      deployment-destination: maven_central
      state: ready
    "5.0.6.1":
      release-repository: spring-cloud/spring-cloud-config-commercial
      deployment-destination: spring_enterprise
    "5.1.0-RC1":
      release-repository: spring-cloud/spring-cloud-config-commercial
      deployment-destination: maven_central
  spring-cloud-netflix:
    "3.1.10":
      release-repository: spring-cloud/spring-cloud-netflix-commercial
      deployment-destination: spring_enterprise
    "3.1.10.1":
      release-repository: spring-cloud/spring-cloud-netflix-commercial
      deployment-destination: spring_enterprise
    "5.0.3.1":
      release-repository: spring-cloud/spring-cloud-netflix-commercial
      deployment-destination: spring_enterprise
  spring-boot:
    "4.0.0":
      release-repository: spring-projects/spring-boot-commercial
      deployment-destination: maven_central
`;

describe('version helpers', () => {
  it('detects hotfixes by the fourth segment', () => {
    expect(isHotfix('5.0.4.1')).toBe(true);
    expect(isHotfix('5.0.4')).toBe(false);
    expect(isHotfix('5.1.0-RC1')).toBe(false);
  });

  it('takes the minor line, qualifier or not', () => {
    expect(lineOf('5.0.4')).toBe('5.0');
    expect(lineOf('5.0.4.1')).toBe('5.0');
    expect(lineOf('5.1.0-RC1')).toBe('5.1');
    expect(lineOf('2025.1.4')).toBe('2025.1');
    expect(lineOf('nope')).toBeNull();
  });
});

describe('parseTrainYml', () => {
  const entries = parseTrainYml(TRAIN);

  it('reads only the releases section, in order', () => {
    expect(entries.map(e => `${e.project}@${e.version}`)).toEqual([
      'reactor@2025.0.8', 'spring-cloud-config@4.3.6', 'spring-cloud-config@5.0.6',
      'spring-cloud-config@5.0.6.1', 'spring-cloud-config@5.1.0-RC1', 'spring-cloud-netflix@3.1.10',
      'spring-cloud-netflix@3.1.10.1', 'spring-cloud-netflix@5.0.3.1', 'spring-boot@4.0.0',
    ]);
  });

  it('reads the fields of each version, not the ones nested deeper', () => {
    expect(entries[1]).toEqual({
      project: 'spring-cloud-config', version: '4.3.6',
      repository: 'spring-cloud/spring-cloud-config-commercial',
      destination: 'spring_enterprise', state: 'pending',
    });
    expect(entries[2].state).toBe('ready');
  });

  it('keeps only spring-cloud projects', () => {
    expect([...new Set(entries.filter(isCloudProject).map(e => e.project))])
      .toEqual(['spring-cloud-config', 'spring-cloud-netflix']);
  });

  it('returns nothing for a file without releases', () => {
    expect(parseTrainYml('state: pending\n')).toEqual([]);
  });
});

describe('buildPlan', () => {
  const entries = parseTrainYml(TRAIN);
  const internal = (...have) => (repo, branch) => have.includes(`${repo}@${branch}`);
  const jobsOf = plan => plan.jobs.map(j => `${j.project} ${j.line} ${j.mode} [${j.versions}]`);

  it('splits a project by minor line and picks the path from the destination', () => {
    const plan = buildPlan({ entries, internalExists: internal() });
    expect(jobsOf(plan)).toContain('spring-cloud-config 4.3 commercial [4.3.6]');
    expect(jobsOf(plan)).toContain('spring-cloud-config 5.1 oss [5.1.0-RC1]');
  });

  it('shares one OSS job between a release and its hotfix', () => {
    const plan = buildPlan({ entries, internalExists: internal() });
    expect(jobsOf(plan)).toContain('spring-cloud-config 5.0 oss [5.0.6 5.0.6.1]');
  });

  it('sends a hotfix down the OSS path only when the project has an -internal branch', () => {
    const none = buildPlan({ entries, internalExists: internal() });
    expect(jobsOf(none)).toContain('spring-cloud-netflix 5.0 commercial [5.0.3.1]');

    const has = buildPlan({
      entries,
      internalExists: internal('spring-cloud/spring-cloud-netflix-commercial@5.0.x-internal'),
    });
    expect(jobsOf(has)).toContain('spring-cloud-netflix 5.0 oss [5.0.3.1]');
  });

  it('keeps a commercial release and its hotfix together when there is no -internal branch', () => {
    const plan = buildPlan({ entries, internalExists: internal() });
    expect(jobsOf(plan)).toContain('spring-cloud-netflix 3.1 commercial [3.1.10 3.1.10.1]');
  });

  it('filters to the projects asked for and reports names the train lacks', () => {
    const plan = buildPlan({
      entries, projects: ['spring-cloud-netflix', 'spring-cloud-nope'], internalExists: internal(),
    });
    expect(new Set(plan.jobs.map(j => j.project))).toEqual(new Set(['spring-cloud-netflix']));
    expect(plan.unknown).toEqual(['spring-cloud-nope']);
  });

  it('does not treat a non-cloud project as unknown or plan it', () => {
    const plan = buildPlan({ entries, projects: ['spring-boot'], internalExists: internal() });
    expect(plan.jobs).toEqual([]);
    expect(plan.unknown).toEqual(['spring-boot']);
  });

  it('gives the job a version to resolve the base branch from', () => {
    const plan = buildPlan({ entries, internalExists: internal() });
    expect(plan.jobs.find(j => j.project === 'spring-cloud-config' && j.line === '5.0').base_version).toBe('5.0.6');
  });
});

describe('summarizeResults', () => {
  const r = (project, branch, status, detail = '', base = '5.0.x') => ({ project, branch, base, status, detail });

  it('lists conflicts, blocked branches and errors as work to do by hand, first', () => {
    const out = summarizeResults({
      train: '2026.10.22', dryRun: false,
      results: [
        r('b', 'release/1', 'rebased'),
        r('a', '5.0.x-internal', 'conflict', 'conflicts in: pom.xml'),
        r('a', 'release/5.0.4', 'blocked', 'needs 5.0.x-internal rebased first'),
      ],
    });
    expect(out).toMatch(/2 branch\(es\) could not be rebased and must be rebased by hand/);
    expect(out.indexOf('5.0.x-internal')).toBeLessThan(out.indexOf('Rebased (1)'));
    expect(out).toContain('conflicts in: pom.xml');
  });

  it('says so when everything went through, and marks a dry run', () => {
    const out = summarizeResults({
      train: 't', dryRun: true,
      results: [r('a', 'release/1', 'rebased'), r('a', 'release/2', 'up-to-date'), r('a', 'release/3', 'skipped')],
    });
    expect(out).toMatch(/Every branch was rebased cleanly/);
    expect(out).toMatch(/dry run, nothing pushed/);
    expect(out).not.toMatch(/by hand/);
  });
});
