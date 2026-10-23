'use strict';

const { updateMappings, lineOf, nextSnapshot } = require('../start-site-mappings');

// The shape of start.spring.io's application.yml around the spring-cloud bom, including
// the neighbouring boms that are also called spring-cloud-something.
const file = mappings => [
  'initializr:',
  '  env:',
  '    boms:',
  '      spring-ai:',
  '        groupId: org.springframework.ai',
  '        artifactId: spring-ai-bom',
  '        mappings:',
  '          - compatibilityRange: "[4.0.0,4.2.0-M1)"',
  '            version: 2.0.1',
  '      spring-cloud:',
  '        groupId: org.springframework.cloud',
  '        artifactId: spring-cloud-dependencies',
  '        versionProperty: spring-cloud.version',
  '        order: 50',
  '        mappings:',
  ...mappings,
  '      spring-cloud-azure:',
  '        groupId: com.azure.spring',
  '        artifactId: spring-cloud-azure-dependencies',
  '        mappings:',
  '          - compatibilityRange: "[4.0.0,4.1.0-M1)"',
  '            version: 7.3.0',
  '',
].join('\n');

const entry = (range, version, snapshot) => [
  `          - compatibilityRange: "${range}"`,
  `            version: ${version}`,
  ...(snapshot ? ['            repositories:', '              - spring-snapshots'] : []),
];

const GA_LINE = entry('[4.0.0,4.2.0-M1)', '2025.1.3');
const RC_TRAIN = [
  ...entry('[4.2.0-M1,4.2.0-SNAPSHOT)', '2026.0.0-RC1'),
  ...entry('[4.2.0-SNAPSHOT,4.3.0-M1)', '2026.0.0-SNAPSHOT', true),
];

describe('lineOf', () => {
  it('reduces a version to major.minor', () => {
    expect(lineOf('2025.1.4')).toBe('2025.1');
    expect(lineOf('2026.0.0-SNAPSHOT')).toBe('2026.0');
    expect(lineOf('2026.0.0-RC1')).toBe('2026.0');
  });

  it('does not match a different line that shares a prefix', () => {
    expect(lineOf('2025.10.0')).toBe('2025.10');
    expect(lineOf('2025.1.4')).not.toBe(lineOf('2025.10.0'));
  });

  it('returns null for anything that is not a version', () => {
    expect(lineOf('main')).toBeNull();
    expect(lineOf(undefined)).toBeNull();
  });
});

describe('nextSnapshot', () => {
  it('moves to the next patch', () => {
    expect(nextSnapshot('2026.0.0')).toBe('2026.0.1-SNAPSHOT');
    expect(nextSnapshot('2026.0.9')).toBe('2026.0.10-SNAPSHOT');
  });
});

describe('a patch release of a line that is already mapped', () => {
  // The bug: 2025.1.4 did not find the 2025.1.3 entry, so a second pair was appended.
  const src = file([...GA_LINE, ...RC_TRAIN]);
  const r = updateMappings(src, { releaseVersion: '2025.1.4', bootVersion: '4.0.9' });

  it('rewrites the existing entry rather than adding one', () => {
    expect(r.status).toBe('edited');
    expect(r.action).toBe('updated');
    expect(r.text).toContain('version: 2025.1.4');
    expect(r.text).not.toContain('version: 2025.1.3');
    expect(r.text.match(/version: 2025\.1\./g)).toHaveLength(1);
  });

  it('leaves the range alone, since the train has not changed phase', () => {
    expect(r.text).toContain('compatibilityRange: "[4.0.0,4.2.0-M1)"');
    expect(r.text).not.toContain('4.0.9');
  });

  it('touches nothing else, the other train and the other boms included', () => {
    const before = src.split('\n');
    const after = r.text.split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.filter((l, i) => l !== before[i])).toEqual(['            version: 2025.1.4']);
  });

  it('reports what changed', () => {
    expect(r.from).toBe('2025.1.3');
    expect(r.changeDetail).toBe('`2025.1.3` → `2025.1.4`');
  });
});

describe('a line with nothing mapped', () => {
  it('adds a new train, with its snapshot, for a first milestone', () => {
    const r = updateMappings(file(GA_LINE), { releaseVersion: '2026.0.0-M1', bootVersion: '4.2.0-M2' });
    expect(r.action).toBe('added');
    expect(r.text).toContain('compatibilityRange: "[4.2.0-M1,4.2.0-SNAPSHOT)"');
    expect(r.text).toContain('version: 2026.0.0-M1');
    expect(r.text).toContain('compatibilityRange: "[4.2.0-SNAPSHOT,4.3.0-M1)"');
    expect(r.text).toContain('version: 2026.0.0-SNAPSHOT');
    expect(r.text.match(/- spring-snapshots/g)).toHaveLength(1);
  });

  it('puts the new entries inside the bom, ahead of the next one', () => {
    const r = updateMappings(file(GA_LINE), { releaseVersion: '2026.0.0-M1', bootVersion: '4.2.0-M2' });
    const lines = r.text.split('\n');
    expect(lines.indexOf('            version: 2026.0.0-SNAPSHOT')).toBeLessThan(lines.indexOf('      spring-cloud-azure:'));
  });

  it('adds a .0 that skipped its milestones, with the next patch as its snapshot', () => {
    const r = updateMappings(file(GA_LINE), { releaseVersion: '2026.0.0', bootVersion: '4.2.0' });
    expect(r.action).toBe('added');
    expect(r.text).toContain('compatibilityRange: "[4.2.0,4.3.0-M1)"');
    expect(r.text).toContain('version: 2026.0.1-SNAPSHOT');
    expect(r.text).not.toContain('version: 2026.0.0-SNAPSHOT');
  });

  it('declines a patch release for a line that has aged off the site', () => {
    const src = file(GA_LINE);
    const r = updateMappings(src, { releaseVersion: '2024.0.9', bootVersion: '3.4.5' });
    expect(r.status).toBe('no-mapping');
    expect(r.text).toBeUndefined();
    expect(r.mappings).toEqual(['2025.1.3']);
  });
});

describe('moving a train through its phases', () => {
  it('bumps the version of a milestone entry and leaves its range and snapshot alone', () => {
    const src = file([...GA_LINE, ...entry('[4.2.0-M1,4.2.0-SNAPSHOT)', '2026.0.0-M1'),
      ...entry('[4.2.0-SNAPSHOT,4.3.0-M1)', '2026.0.0-SNAPSHOT', true)]);
    const r = updateMappings(src, { releaseVersion: '2026.0.0-M2', bootVersion: '4.2.0-M3' });
    expect(r.action).toBe('updated');
    expect(r.text).toContain('compatibilityRange: "[4.2.0-M1,4.2.0-SNAPSHOT)"');
    expect(r.text).toContain('version: 2026.0.0-M2');
    expect(r.text).toContain('version: 2026.0.0-SNAPSHOT');
  });

  it('leaves the floor at -M1 at the first release candidate', () => {
    const src = file([...GA_LINE, ...entry('[4.2.0-M1,4.2.0-SNAPSHOT)', '2026.0.0-M2'),
      ...entry('[4.2.0-SNAPSHOT,4.3.0-M1)', '2026.0.0-SNAPSHOT', true)]);
    const r = updateMappings(src, { releaseVersion: '2026.0.0-RC1', bootVersion: '4.2.0-RC1' });
    expect(r.text).toContain('compatibilityRange: "[4.2.0-M1,4.2.0-SNAPSHOT)"');
    expect(r.text).toContain('version: 2026.0.0-RC1');
    expect(r.text).toContain('version: 2026.0.0-SNAPSHOT');
  });

  describe('at GA', () => {
    const src = file([...GA_LINE, ...RC_TRAIN]);
    const r = updateMappings(src, { releaseVersion: '2026.0.0', bootVersion: '4.2.0' });

    it('widens the release range and releases the version', () => {
      expect(r.action).toBe('updated');
      expect(r.text).toContain('compatibilityRange: "[4.2.0,4.3.0-M1)"');
      expect(r.text).toContain('version: 2026.0.0\n');
      expect(r.text).not.toContain('2026.0.0-RC1');
    });

    it("moves the line's snapshot on to the next patch, leaving its range and repository", () => {
      expect(r.text).toContain('version: 2026.0.1-SNAPSHOT');
      expect(r.text).not.toContain('2026.0.0-SNAPSHOT');
      expect(r.text).toContain('compatibilityRange: "[4.2.0-SNAPSHOT,4.3.0-M1)"');
      expect(r.text.match(/- spring-snapshots/g)).toHaveLength(1);
      expect(r.snapshotFrom).toBe('2026.0.0-SNAPSHOT');
      expect(r.snapshotTo).toBe('2026.0.1-SNAPSHOT');
    });

    it('does not add or drop a mapping', () => {
      expect(r.text.match(/compatibilityRange/g)).toHaveLength(src.match(/compatibilityRange/g).length);
    });

    it('leaves the earlier line alone', () => {
      expect(r.text).toContain('version: 2025.1.3');
    });
  });
});

describe('a patch release of a line that has a snapshot mapping', () => {
  const src = file([
    ...entry('[4.2.0,4.3.0-M1)', '2026.0.0'),
    ...entry('[4.2.0-SNAPSHOT,4.3.0-M1)', '2026.0.1-SNAPSHOT', true),
  ]);

  it('bumps both the version and the snapshot, keeping the range', () => {
    const r = updateMappings(src, { releaseVersion: '2026.0.1', bootVersion: '4.2.1' });
    expect(r.text).toContain('compatibilityRange: "[4.2.0,4.3.0-M1)"');
    expect(r.text).toContain('version: 2026.0.1\n');
    expect(r.text).toContain('version: 2026.0.2-SNAPSHOT');
    expect(r.changeDetail).toBe('`2026.0.0` → `2026.0.1` and `2026.0.1-SNAPSHOT` → `2026.0.2-SNAPSHOT`');
  });

  it('finishes a half-done update: release already bumped, snapshot not', () => {
    const half = file([
      ...entry('[4.2.0,4.3.0-M1)', '2026.0.1'),
      ...entry('[4.2.0-SNAPSHOT,4.3.0-M1)', '2026.0.1-SNAPSHOT', true),
    ]);
    const r = updateMappings(half, { releaseVersion: '2026.0.1', bootVersion: '4.2.1' });
    expect(r.status).toBe('edited');
    expect(r.text).toContain('version: 2026.0.2-SNAPSHOT');
    expect(r.changeDetail).toBe('`2026.0.1-SNAPSHOT` → `2026.0.2-SNAPSHOT`');
  });
});

describe('a re-run', () => {
  it('reports already-current when nothing would change', () => {
    const src = file([
      ...entry('[4.0.0,4.2.0-M1)', '2025.1.4'),
    ]);
    const r = updateMappings(src, { releaseVersion: '2025.1.4', bootVersion: '4.0.9' });
    expect(r.status).toBe('already-current');
    expect(r.text).toBeUndefined();
  });

  it('reports already-current for a GA whose snapshot has already moved on', () => {
    const src = file([
      ...entry('[4.2.0,4.3.0-M1)', '2026.0.0'),
      ...entry('[4.2.0-SNAPSHOT,4.3.0-M1)', '2026.0.1-SNAPSHOT', true),
    ]);
    expect(updateMappings(src, { releaseVersion: '2026.0.0', bootVersion: '4.2.0' }).status)
      .toBe('already-current');
  });
});

describe('declining', () => {
  it('needs a Boot version', () => {
    const r = updateMappings(file(GA_LINE), { releaseVersion: '2025.1.4', bootVersion: '' });
    expect(r.status).toBe('no-boot-version');
  });

  it('needs a Boot version it can parse', () => {
    const r = updateMappings(file(GA_LINE), { releaseVersion: '2025.1.4', bootVersion: 'main' });
    expect(r.status).toBe('no-boot-version');
  });

  it('will not guess when a snapshot mapping has no release beside it', () => {
    const src = file([...GA_LINE, ...entry('[4.2.0-SNAPSHOT,4.3.0-M1)', '2026.0.0-SNAPSHOT', true)]);
    const r = updateMappings(src, { releaseVersion: '2026.0.0-M1', bootVersion: '4.2.0-M1' });
    expect(r.status).toBe('unexpected-mappings');
  });

  it('reports a file with no spring-cloud bom', () => {
    const r = updateMappings('initializr:\n  env:\n', { releaseVersion: '2025.1.4', bootVersion: '4.0.9' });
    expect(r.status).toBe('bom-not-found');
  });

  it('is not misled by the neighbouring spring-cloud-* boms', () => {
    // spring-cloud-azure sits directly below, with a version line of its own.
    const r = updateMappings(file(GA_LINE), { releaseVersion: '2025.1.4', bootVersion: '4.0.9' });
    expect(r.text).toContain('version: 7.3.0');
    expect(r.text).toContain('version: 2.0.1');
  });
});
