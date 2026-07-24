'use strict';

jest.mock('@actions/core');
jest.mock('@actions/exec');

const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const {
  parseBranch,
  findSource,
  parseMajorRange,
  parseMinorExtglob,
  representativeTag,
  tagAlreadyCovered,
  updateStandardTags,
  updateHotfixTags,
  updatePlaybook,
  removeBranchFromPlaybook,
} = require('../src/index');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'antora-playbook.yml');

beforeEach(() => {
  jest.clearAllMocks();
  core.info.mockImplementation(() => {});
  core.warning.mockImplementation(() => {});
  core.error.mockImplementation(() => {});
  core.setFailed.mockImplementation(() => {});
  core.setSecret.mockImplementation(() => {});
});

// ── parseBranch ───────────────────────────────────────────────────────────────

describe('parseBranch', () => {
  test('parses standard X.Y.x branch', () => {
    expect(parseBranch('4.3.x')).toEqual({ major: 4, minor: 3, patch: null });
    expect(parseBranch('10.0.x')).toEqual({ major: 10, minor: 0, patch: null });
  });

  test('parses hotfix X.Y.Z.x branch', () => {
    expect(parseBranch('4.3.3.x')).toEqual({ major: 4, minor: 3, patch: 3 });
    expect(parseBranch('5.0.1.x')).toEqual({ major: 5, minor: 0, patch: 1 });
  });

  test('returns null for non-matching branches', () => {
    expect(parseBranch('main')).toBeNull();
    expect(parseBranch('release/4.2.7')).toBeNull();
    expect(parseBranch('feature/foo')).toBeNull();
  });
});

// ── parseMajorRange ───────────────────────────────────────────────────────────

describe('parseMajorRange', () => {
  test('parses v{4..9}. prefix', () => {
    expect(parseMajorRange("v{4..9}.+({0..9}).+({0..9})")).toEqual([4, 9]);
  });

  test('returns null for patterns without range', () => {
    expect(parseMajorRange("v4.+([0-9]).+([0-9])")).toBeNull();
    expect(parseMajorRange("!v4.0.+([0-9])")).toBeNull();
  });
});

// ── parseMinorExtglob ─────────────────────────────────────────────────────────

describe('parseMinorExtglob', () => {
  test('parses +({0..9}) at given position', () => {
    const s = "v{4..9}.+({0..3}).+({0..9})";
    const afterMajor = "v{4..9}.".length;
    expect(parseMinorExtglob(s, afterMajor)).toEqual([0, 3, '+({0..3})']);
  });

  test('returns null when no extglob at position', () => {
    const s = "v{4..9}.+([0-9]).+([0-9])";
    expect(parseMinorExtglob(s, "v{4..9}.".length)).toBeNull();
  });
});

// ── representativeTag ─────────────────────────────────────────────────────────

describe('representativeTag', () => {
  test('builds a GA tag for a standard branch', () => {
    expect(representativeTag({ major: 5, minor: 2, patch: null })).toBe('v5.2.0');
    expect(representativeTag({ major: 2026, minor: 0, patch: null })).toBe('v2026.0.0');
  });

  test('builds a first-hotfix tag for a hotfix branch', () => {
    expect(representativeTag({ major: 5, minor: 0, patch: 1 })).toBe('v5.0.1.1');
    expect(representativeTag({ major: 2025, minor: 0, patch: 2 })).toBe('v2025.0.2.1');
  });
});

// ── tagAlreadyCovered ─────────────────────────────────────────────────────────

describe('tagAlreadyCovered', () => {
  function makeTagsSeq(patterns) {
    const doc = YAML.parseDocument(`tags: [${patterns.map(p => `'${p}'`).join(', ')}]`);
    return doc.getIn(['tags']);
  }

  test('matches a tag against a broad custom pattern the range parser ignores', () => {
    const seq = makeTagsSeq(['v20{2..9}+({3..9}).+({0..9}).+({0..9})?(.+({0..9}))?(-{RC,M}*)']);
    expect(tagAlreadyCovered(seq, 'v2025.0.0')).toBe(true);
    expect(tagAlreadyCovered(seq, 'v2026.0.0')).toBe(true);
    expect(tagAlreadyCovered(seq, 'v2025.0.2.1')).toBe(true);
  });

  test('returns false when no positive pattern matches', () => {
    const seq = makeTagsSeq(['v20{2..9}+({3..9}).+({0..9}).+({0..9})?(.+({0..9}))?(-{RC,M}*)']);
    expect(tagAlreadyCovered(seq, 'v2030.0.0')).toBe(false);
  });

  test('matches against a standard range pattern', () => {
    const seq = makeTagsSeq(['v{4..9}.+({0..3}).+({0..9})?(-{RC,M}*)']);
    expect(tagAlreadyCovered(seq, 'v5.2.0')).toBe(true);
    expect(tagAlreadyCovered(seq, 'v5.5.0')).toBe(false);
    expect(tagAlreadyCovered(seq, 'v10.0.0')).toBe(false);
  });

  test('ignores negative (exclusion) patterns', () => {
    const seq = makeTagsSeq(['!v2023.0.0-M1']);
    expect(tagAlreadyCovered(seq, 'v2023.0.0-M1')).toBe(false);
  });
});

// ── updateStandardTags ────────────────────────────────────────────────────────

describe('updateStandardTags', () => {
  function makeTagsSeq(patterns) {
    const doc = YAML.parseDocument(`tags: [${patterns.map(p => `'${p}'`).join(', ')}]`);
    return doc.getIn(['tags']);
  }

  test('returns false when major and minor are already covered', () => {
    const seq = makeTagsSeq(["v{4..9}.+({0..3}).+({0..9})?(-{RC,M}*)"]);
    expect(updateStandardTags(seq, 5, 2)).toBe(false);
  });

  test('expands major range when major is out of range', () => {
    const seq = makeTagsSeq(["v{4..9}.+({0..3}).+({0..9})?(-{RC,M}*)"]);
    const changed = updateStandardTags(seq, 10, 0);
    expect(changed).toBe(true);
    const val = seq.items[0].value;
    expect(val).toContain('v{4..10}.');
  });

  test('expands minor range when minor is out of range', () => {
    const seq = makeTagsSeq(["v{4..9}.+({0..3}).+({0..9})?(-{RC,M}*)"]);
    const changed = updateStandardTags(seq, 5, 5);
    expect(changed).toBe(true);
    const val = seq.items[0].value;
    expect(val).toContain('+({0..5})');
  });

  test('expands both major and minor ranges', () => {
    const seq = makeTagsSeq(["v{4..9}.+({0..3}).+({0..9})?(-{RC,M}*)"]);
    const changed = updateStandardTags(seq, 10, 7);
    expect(changed).toBe(true);
    const val = seq.items[0].value;
    expect(val).toContain('v{4..10}.');
    expect(val).toContain('+({0..7})');
  });

  test('appends generic pattern when no range pattern exists', () => {
    const seq = makeTagsSeq(["!v4.0.+([0-9])"]);
    const changed = updateStandardTags(seq, 5, 0);
    expect(changed).toBe(true);
    expect(seq.items.length).toBe(2);
    expect(seq.items[1].value).toContain('v5.');
  });

  test('does not append a duplicate generic pattern when one already exists', () => {
    const seq = makeTagsSeq(["!v4.0.+([0-9])", "v5.+([0-9]).+([0-9])?(-{RC,M}*)"]);
    const changed = updateStandardTags(seq, 5, 3);
    expect(changed).toBe(false);
    expect(seq.items.length).toBe(2);
  });

  test('preserves QUOTE_SINGLE type on updated pattern', () => {
    const seq = makeTagsSeq(["v{4..9}.+({0..3}).+({0..9})?(-{RC,M}*)"]);
    updateStandardTags(seq, 10, 0);
    const { Scalar: S } = require('yaml');
    expect(seq.items[0].type).toBe(S.QUOTE_SINGLE);
  });
});

// ── updateHotfixTags ──────────────────────────────────────────────────────────

describe('updateHotfixTags', () => {
  function makeTagsSeq(patterns) {
    const doc = YAML.parseDocument(`tags: [${patterns.map(p => `'${p}'`).join(', ')}]`);
    return doc.getIn(['tags']);
  }

  test('appends 4-part hotfix pattern when none exists', () => {
    const seq = makeTagsSeq(["v{4..9}.+({0..3}).+({0..9})?(-{RC,M}*)"]);
    const changed = updateHotfixTags(seq, 5, 0, 1);
    expect(changed).toBe(true);
    const last = seq.items[seq.items.length - 1].value;
    expect(last).toBe("v5.0.1.+([0-9])?(-{RC,M}*)");
  });

  test('appends even when a different 4-part pattern already exists (coverage is decided by the caller)', () => {
    const seq = makeTagsSeq(["v9.9.9.+([0-9])?(-{RC,M}*)"]);
    const changed = updateHotfixTags(seq, 5, 0, 1);
    expect(changed).toBe(true);
    expect(seq.items.map(i => i.value)).toContain("v5.0.1.+([0-9])?(-{RC,M}*)");
  });

  test('returns false when the exact same hotfix pattern already exists', () => {
    const seq = makeTagsSeq(["v5.0.1.+([0-9])?(-{RC,M}*)"]);
    expect(updateHotfixTags(seq, 5, 0, 1)).toBe(false);
    expect(seq.items.length).toBe(1);
  });
});

// ── updatePlaybook (full integration via fixture) ─────────────────────────────

describe('updatePlaybook', () => {
  let fixtureContent;

  beforeEach(() => {
    fixtureContent = fs.readFileSync(FIXTURE_PATH, 'utf-8');
  });

  test('adds a new branch to the matching source', () => {
    const { changed, output } = updatePlaybook(
      fixtureContent, '5.0.x',
      'https://github.com/spring-cloud/spring-cloud-config-commercial'
    );
    expect(changed).toBe(true);
    expect(output).toContain('5.0.x');
  });

  test('is idempotent — returns false when branch already present', () => {
    const { changed } = updatePlaybook(
      fixtureContent, '4.3.x',
      'https://github.com/spring-cloud/spring-cloud-config-commercial'
    );
    expect(changed).toBe(false);
  });

  test('falls back to first source when URL not found', () => {
    const { changed, output } = updatePlaybook(fixtureContent, '5.0.x', '');
    expect(changed).toBe(true);
    expect(output).toContain('5.0.x');
  });

  test('preserves flow-style brackets on branches sequence', () => {
    const { output } = updatePlaybook(
      fixtureContent, '5.0.x',
      'https://github.com/spring-cloud/spring-cloud-config-commercial'
    );
    // branches should still be on one line
    expect(output).toMatch(/branches: \[/);
  });

  test('updates major range when major is out of range', () => {
    const { changed, output } = updatePlaybook(
      fixtureContent, '10.0.x',
      'https://github.com/spring-cloud/spring-cloud-config-commercial'
    );
    expect(changed).toBe(true);
    expect(output).toContain('v{4..10}.');
  });

  test('updates minor range when minor exceeds current max', () => {
    const { changed, output } = updatePlaybook(
      fixtureContent, '4.5.x',
      'https://github.com/spring-cloud/spring-cloud-config-commercial'
    );
    expect(changed).toBe(true);
    expect(output).toContain('+({0..5})');
  });

  test('appends hotfix tag pattern for X.Y.Z.x branch', () => {
    const { changed, output } = updatePlaybook(
      fixtureContent, '4.3.3.x',
      'https://github.com/spring-cloud/spring-cloud-config-commercial'
    );
    expect(changed).toBe(true);
    expect(output).toContain('v4.3.3.+([0-9])');
  });

  test('preserves unrelated parts of the file', () => {
    const { output } = updatePlaybook(fixtureContent, '5.0.x', '');
    expect(output).toContain('Spring Cloud Config');
    expect(output).toContain('ui:');
    expect(output).toContain('ui-bundle.zip');
  });

  test('handles no content.sources gracefully', () => {
    const noSources = 'site:\n  title: Test\n';
    const { changed } = updatePlaybook(noSources, '5.0.x', '');
    expect(changed).toBe(false);
  });

  test('skips tag update for non-version branch names', () => {
    const { changed, output } = updatePlaybook(fixtureContent, 'main', '');
    // main is already present → no change
    const { changed: c2 } = updatePlaybook(output || fixtureContent, 'feature-foo', '');
    // branch added but no tag update
    expect(c2).toBe(true);
  });

  // Regression: a broad custom pattern the range parser doesn't recognise still
  // covers the branch's tags, so no redundant tag entry should be appended.
  const CUSTOM = [
    'content:',
    '  sources:',
    '    - url: https://github.com/spring-cloud/spring-cloud-release-commercial',
    '      branches: [2025.0.x]',
    "      tags: ['v20{2..9}+({3..9}).+({0..9}).+({0..9})?(.+({0..9}))?(-{RC,M}*)', '!v2023.0.0-M1']",
    '',
  ].join('\n');

  test('does not append a redundant tag pattern when a broad pattern already covers the branch', () => {
    const { changed, output } = updatePlaybook(
      CUSTOM, '2026.0.x',
      'https://github.com/spring-cloud/spring-cloud-release-commercial'
    );
    // Branch is added, but no 'v2026...' tag pattern is appended.
    expect(changed).toBe(true);
    expect(output).toContain('2026.0.x');
    expect(output).not.toContain('v2026.+([0-9])');
  });

  test('appends a tag pattern when the broad pattern does not cover the branch', () => {
    const { changed, output } = updatePlaybook(
      CUSTOM, '2030.0.x',
      'https://github.com/spring-cloud/spring-cloud-release-commercial'
    );
    expect(changed).toBe(true);
    expect(output).toContain('v2030.+([0-9])');
  });

  test('does not append a redundant hotfix pattern when a broad pattern covers it', () => {
    const { changed, output } = updatePlaybook(
      CUSTOM, '2025.0.2.x',
      'https://github.com/spring-cloud/spring-cloud-release-commercial'
    );
    // v2025.0.2.1 already matches the broad 4-part-capable pattern.
    expect(output).not.toContain('v2025.0.2.+([0-9])');
    // The only change (if any) is the branch entry, never a tag entry.
    if (changed) expect(output).toContain('2025.0.2.x');
  });
});

// ── removeBranchFromPlaybook ──────────────────────────────────────────────────

describe('removeBranchFromPlaybook', () => {
  let fixtureContent;

  beforeEach(() => {
    fixtureContent = fs.readFileSync(FIXTURE_PATH, 'utf-8');
  });

  test('removes an existing branch from the matching source', () => {
    const { changed, output } = removeBranchFromPlaybook(
      fixtureContent, '4.3.x',
      'https://github.com/spring-cloud/spring-cloud-config-commercial'
    );
    expect(changed).toBe(true);
    // The removed branch is gone from the branches list, the others remain.
    expect(output).not.toContain("'4.3.x'");
    expect(output).toMatch(/branches: \[ ?main, '4\.2\.x' ?\]/);
  });

  test('is a no-op when the branch is not present', () => {
    const { changed, output } = removeBranchFromPlaybook(
      fixtureContent, '9.9.x',
      'https://github.com/spring-cloud/spring-cloud-config-commercial'
    );
    expect(changed).toBe(false);
    expect(output).toBe(fixtureContent);
  });

  test('leaves tags untouched when removing a branch', () => {
    const { output } = removeBranchFromPlaybook(
      fixtureContent, '4.3.x',
      'https://github.com/spring-cloud/spring-cloud-config-commercial'
    );
    // Tag patterns are preserved exactly.
    expect(output).toContain('v{4..9}.+({0..3}).+({0..9})?(-{RC,M}*)');
    expect(output).toContain('!v4.0.+([0-9]).+([0-9])?(-{RC,M}*)');
  });

  test('preserves flow-style brackets on branches sequence', () => {
    const { output } = removeBranchFromPlaybook(
      fixtureContent, '4.3.x',
      'https://github.com/spring-cloud/spring-cloud-config-commercial'
    );
    expect(output).toMatch(/branches: \[/);
  });

  test('falls back to first source when URL not found', () => {
    const { changed, output } = removeBranchFromPlaybook(fixtureContent, '4.3.x', '');
    expect(changed).toBe(true);
    expect(output).not.toContain("'4.3.x'");
    expect(output).toMatch(/branches: \[ ?main, '4\.2\.x' ?\]/);
  });

  test('handles no content.sources gracefully', () => {
    const noSources = 'site:\n  title: Test\n';
    const { changed } = removeBranchFromPlaybook(noSources, '4.3.x', '');
    expect(changed).toBe(false);
  });

  test('preserves unrelated parts of the file', () => {
    const { output } = removeBranchFromPlaybook(
      fixtureContent, '4.3.x',
      'https://github.com/spring-cloud/spring-cloud-config-commercial'
    );
    expect(output).toContain('Spring Cloud Config');
    expect(output).toContain('ui:');
    expect(output).toContain('ui-bundle.zip');
  });
});
