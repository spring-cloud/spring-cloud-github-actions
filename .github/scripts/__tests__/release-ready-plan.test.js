'use strict';

const { buildPlan, summarize, isHotfixTrain } = require('../release-ready-plan');

const entries = list => list.map(([key, version]) => ({ key, version }));
const branches = (...list) => (repo, branch) => list.includes(`${repo}:${branch}`);
const tags = (...list) => (repo, tag) => list.includes(`${repo}:${tag}`);
const noTags = tags();

describe('buildPlan', () => {
  it('plans a project whose release branch exists and is untagged', () => {
    const { todo, skipped } = buildPlan({
      entries: entries([['spring-cloud-config', '5.0.3-SNAPSHOT']]),
      branchExists: branches('spring-cloud/spring-cloud-config-commercial:release/5.0.3'),
      tagExists: noTags,
    });
    expect(todo).toEqual([{ project: 'spring-cloud-config', version: '5.0.3', branch: 'release/5.0.3' }]);
    expect(skipped).toEqual([]);
  });

  it('keeps a pre-release version as is', () => {
    const { todo } = buildPlan({
      entries: entries([['spring-cloud-config', '5.1.0-M1']]),
      branchExists: branches('spring-cloud/spring-cloud-config-commercial:release/5.1.0-M1'),
      tagExists: noTags,
    });
    expect(todo[0].branch).toBe('release/5.1.0-M1');
  });

  it('plans a hotfix version', () => {
    const { todo } = buildPlan({
      entries: entries([['spring-cloud-vault', '5.0.3.1-SNAPSHOT']]),
      branchExists: branches('spring-cloud/spring-cloud-vault-commercial:release/5.0.3.1'),
      tagExists: noTags,
    });
    expect(todo[0].branch).toBe('release/5.0.3.1');
  });

  it('skips a version already tagged in either repo', () => {
    for (const repo of ['spring-cloud/spring-cloud-config', 'spring-cloud/spring-cloud-config-commercial']) {
      const { todo, skipped } = buildPlan({
        entries: entries([['spring-cloud-config', '5.0.3']]),
        branchExists: () => true,
        tagExists: tags(`${repo}:v5.0.3`),
      });
      expect(todo).toEqual([]);
      expect(skipped[0].reason).toMatch(/already released \(tag v5\.0\.3 in /);
    }
  });

  it('skips a project with no release branch', () => {
    const { todo, skipped } = buildPlan({
      entries: entries([['spring-cloud-config', '5.0.3']]),
      branchExists: () => false,
      tagExists: noTags,
    });
    expect(todo).toEqual([]);
    expect(skipped[0].reason).toMatch(/no release branch/);
  });

  it('skips non-project keys and unusable versions', () => {
    const { todo, skipped } = buildPlan({
      entries: entries([['spring-boot', '4.0.0'], ['spring-cloud-config', 'oops']]),
      branchExists: () => true,
      tagExists: noTags,
    });
    expect(todo).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/unusable version/);
  });
});

describe('hotfix trains', () => {
  const all = () => true;
  const list = entries([
    ['spring-cloud-config', '5.0.6.1-SNAPSHOT'],
    ['spring-cloud-commons', '5.0.4-SNAPSHOT'],
  ]);

  it('recognises a 4-segment train', () => {
    expect(isHotfixTrain('2025.1.4.1')).toBe(true);
    expect(isHotfixTrain('2025.1.4')).toBe(false);
    expect(isHotfixTrain('2026.0.0-RC1')).toBe(false);
  });

  it('plans only the hotfix versions', () => {
    const { todo, skipped } = buildPlan({
      train: '2025.1.4.1', entries: list, branchExists: all, tagExists: noTags,
    });
    expect(todo.map(t => t.project)).toEqual(['spring-cloud-config']);
    expect(skipped).toEqual([{ project: 'spring-cloud-commons', reason: "not a hotfix version '5.0.4-SNAPSHOT'" }]);
  });

  it('plans the non-hotfix versions for a regular train', () => {
    const { todo } = buildPlan({ train: '2025.1.4', entries: list, branchExists: all, tagExists: noTags });
    expect(todo).toHaveLength(2);
  });
});

describe('summarize', () => {
  it('lists both sections', () => {
    const out = summarize({
      train: '2026.1.0', file: 'f.properties',
      todo: [{ project: 'a', branch: 'release/1.0.0' }],
      skipped: [{ project: 'b', branch: 'release/2.0.0', reason: 'why' }],
    });
    expect(out).toContain('**To mark ready (1)**');
    expect(out).toContain('- a -> `release/1.0.0`');
    expect(out).toContain('- b (`release/2.0.0`): why');
  });
});
