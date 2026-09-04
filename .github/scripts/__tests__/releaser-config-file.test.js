'use strict';

const { releaserConfigFileName } = require('../releaser-config-file');

describe('releaserConfigFileName', () => {
  it('converts a three-part GA version', () => {
    expect(releaserConfigFileName('2025.1.0')).toBe('2025_1_0.properties');
  });

  it('converts a version with a patch number greater than zero', () => {
    expect(releaserConfigFileName('2023.0.3')).toBe('2023_0_3.properties');
  });

  it('converts a version with double-digit segments', () => {
    expect(releaserConfigFileName('2024.0.10')).toBe('2024_0_10.properties');
  });

  it('converts a four-part commercial hotfix version', () => {
    expect(releaserConfigFileName('2025.1.2.1')).toBe('2025_1_2_1.properties');
  });

  // The case every copy of this rule used to disagree on. A milestone release validated
  // 2026_0_0-M1.properties and stamped from 2026_0_0-m1.properties.
  it('lower-cases a milestone qualifier', () => {
    expect(releaserConfigFileName('2026.0.0-M1')).toBe('2026_0_0-m1.properties');
  });

  it('lower-cases a release candidate qualifier', () => {
    expect(releaserConfigFileName('2026.0.0-RC2')).toBe('2026_0_0-rc2.properties');
  });

  it('lower-cases a snapshot qualifier', () => {
    expect(releaserConfigFileName('2026.0.0-SNAPSHOT')).toBe('2026_0_0-snapshot.properties');
  });

  // The whole qualifier, not just its first word.
  it('lower-cases a multi-word internal snapshot qualifier', () => {
    expect(releaserConfigFileName('2026.0.0-INTERNAL-SNAPSHOT'))
      .toBe('2026_0_0-internal-snapshot.properties');
  });

  it('leaves an already lower-cased qualifier alone', () => {
    expect(releaserConfigFileName('2026.0.0-m1')).toBe('2026_0_0-m1.properties');
  });

  it('trims surrounding whitespace', () => {
    expect(releaserConfigFileName('  2026.0.0-M1  ')).toBe('2026_0_0-m1.properties');
  });

  it('never lower-cases the numeric part', () => {
    expect(releaserConfigFileName('2026.0.0')).toBe('2026_0_0.properties');
  });
});
