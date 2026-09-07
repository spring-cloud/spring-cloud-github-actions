'use strict';

const {
  RELEASER_CONFIG_REPO, RELEASER_CONFIG_BRANCH, parseReleaserConfig, versionOf,
} = require('../releaser-config');

const SAMPLE = [
  'releaser.fixed-versions[spring-boot]=4.2.0-M2',
  'releaser.fixed-versions[spring-cloud-build]=5.1.0-M1',
  'releaser.fixed-versions[spring-cloud-config]=5.1.0-M1',
  'releaser.fixed-versions[spring-cloud-release]=2026.0.0-M1',
].join('\n');

describe('the config location', () => {
  // Deliberately commercial for OSS trains too - the OSS branch stopped at 2025.1.3 and
  // disagrees with reality where the two overlap.
  it('is the commercial repository', () => {
    expect(RELEASER_CONFIG_REPO).toBe('spring-cloud/spring-cloud-release-commercial');
    expect(RELEASER_CONFIG_BRANCH).toBe('jenkins-releaser-config');
  });
});

describe('parseReleaserConfig', () => {
  it('reads every fixed-versions entry, in file order', () => {
    expect(parseReleaserConfig(SAMPLE)).toEqual([
      { key: 'spring-boot', version: '4.2.0-M2' },
      { key: 'spring-cloud-build', version: '5.1.0-M1' },
      { key: 'spring-cloud-config', version: '5.1.0-M1' },
      { key: 'spring-cloud-release', version: '2026.0.0-M1' },
    ]);
  });

  it('trims whitespace around the key and the version', () => {
    expect(parseReleaserConfig('releaser.fixed-versions[ spring-boot ]= 4.2.0 '))
      .toEqual([{ key: 'spring-boot', version: '4.2.0' }]);
  });

  it('ignores lines that are not fixed-versions entries', () => {
    const withNoise = ['# a comment', '', 'other.key=value', SAMPLE].join('\n');
    expect(parseReleaserConfig(withNoise)).toHaveLength(4);
  });

  it('survives a file with no trailing newline', () => {
    expect(parseReleaserConfig(SAMPLE.trimEnd())).toHaveLength(4);
  });

  it('returns an empty list for content with no entries', () => {
    expect(parseReleaserConfig('# nothing here')).toEqual([]);
    expect(parseReleaserConfig('')).toEqual([]);
  });
});

describe('versionOf', () => {
  const entries = parseReleaserConfig(SAMPLE);

  it('finds a project', () => {
    expect(versionOf(entries, 'spring-cloud-config')).toBe('5.1.0-M1');
  });

  // The properties key is always the plain name, whichever repository the release is for.
  it('strips a -commercial suffix before looking up', () => {
    expect(versionOf(entries, 'spring-cloud-config-commercial')).toBe('5.1.0-M1');
  });

  it('returns null for a project that is not in the file', () => {
    expect(versionOf(entries, 'spring-cloud-nonesuch')).toBeNull();
  });

  it('does not match on a prefix', () => {
    expect(versionOf(entries, 'spring-cloud')).toBeNull();
  });
});
