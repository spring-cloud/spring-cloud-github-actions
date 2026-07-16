'use strict';

jest.mock('@actions/core');
jest.mock('@actions/exec');

const core = require('@actions/core');
const { isHotfixBranch, parentBranch, resolveJdkVersions, dumpsPretty, updateProjects } = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  core.info.mockImplementation(() => {});
  core.warning.mockImplementation(() => {});
  core.error.mockImplementation(() => {});
  core.setFailed.mockImplementation(() => {});
  core.setSecret.mockImplementation(() => {});
});

// ── isHotfixBranch ──────────────────────────────────────────────────────────

describe('isHotfixBranch', () => {
  test('returns false for standard X.Y.x branches', () => {
    expect(isHotfixBranch('4.3.x')).toBe(false);
    expect(isHotfixBranch('5.0.x')).toBe(false);
    expect(isHotfixBranch('10.2.x')).toBe(false);
  });

  test('returns false for main and other names', () => {
    expect(isHotfixBranch('main')).toBe(false);
    expect(isHotfixBranch('feature/foo')).toBe(false);
  });

  test('returns true for four-part X.Y.Z.x branches', () => {
    expect(isHotfixBranch('4.3.3.x')).toBe(true);
    expect(isHotfixBranch('5.0.1.x')).toBe(true);
  });

  test('returns true for release/ prefixed branches', () => {
    expect(isHotfixBranch('release/4.2.7')).toBe(true);
    expect(isHotfixBranch('release/5.0.0')).toBe(true);
  });
});

// ── parentBranch ────────────────────────────────────────────────────────────

describe('parentBranch', () => {
  test('derives X.Y.x from four-part hotfix branch', () => {
    expect(parentBranch('4.3.3.x')).toBe('4.3.x');
    expect(parentBranch('5.0.1.x')).toBe('5.0.x');
  });

  test('derives X.Y.x from release/ prefixed branch', () => {
    expect(parentBranch('release/4.2.7')).toBe('4.2.x');
    expect(parentBranch('release/5.0.0')).toBe('5.0.x');
  });
});

// ── dumpsPretty ─────────────────────────────────────────────────────────────

describe('dumpsPretty', () => {
  test('keeps string arrays on a single line', () => {
    const data = { branches: { scheduled: ['4.3.x', '5.0.x'] } };
    const result = dumpsPretty(data);
    expect(result).toContain('["4.3.x", "5.0.x"]');
    expect(result).not.toMatch(/\n\s+"4\.3\.x"/);
  });

  test('uses two-space indentation for objects', () => {
    const data = { a: { b: 'c' } };
    expect(dumpsPretty(data)).toBe('{\n  "a": {\n    "b": "c"\n  }\n}');
  });

  test('handles nested arrays inside objects', () => {
    const data = {
      defaults: {
        commercial: {
          branches: { scheduled: ['3.0.x', '3.1.x'] },
          jdkVersions: { '3.0.x': ['17', '21'] },
        },
      },
    };
    const result = dumpsPretty(data);
    expect(result).toContain('["3.0.x", "3.1.x"]');
    expect(result).toContain('["17", "21"]');
  });
});

// ── resolveJdkVersions ──────────────────────────────────────────────────────

describe('resolveJdkVersions', () => {
  const entry = {
    oss: {
      jdkVersions: {
        default: ['17', '21'],
        '4.3.x': ['17'],
        '5.0.x': ['17', '21'],
      },
    },
    commercial: {
      jdkVersions: {
        '4.3.x': ['17', '21'],
      },
    },
  };

  test('uses oss jdkVersions for the oss branch (regular branch)', () => {
    expect(resolveJdkVersions(entry, '5.0.x', '5.0.x')).toEqual(['17', '21']);
  });

  test('uses oss parent branch jdkVersions for hotfix', () => {
    expect(resolveJdkVersions(entry, '4.3.3.x', '')).toEqual(['17']);
  });

  test('falls back to commercial parent jdkVersions when oss parent missing', () => {
    const entryNoOssParent = {
      oss: { jdkVersions: { default: ['17'] } },
      commercial: { jdkVersions: { '4.3.x': ['17', '21'] } },
    };
    expect(resolveJdkVersions(entryNoOssParent, '4.3.3.x', '')).toEqual(['17', '21']);
  });

  test('falls back to oss default branch JDKs for hotfix when parent not in projects.json', () => {
    // Simulates spring-cloud-build where oss.jdkVersions only has 'main' (no '5.0.x')
    const entryMainOnly = {
      oss: {
        branches: { default: ['main'], scheduled: ['main'] },
        jdkVersions: { main: ['17', '21', '25'] },
      },
      commercial: {
        jdkVersions: { '4.3.x': ['17', '21', '25'] },
      },
    };
    // release/5.0.2.1 → parent is 5.0.x → not in oss or commercial jdkVersions
    // → should fall back to oss.jdkVersions['main']
    expect(resolveJdkVersions(entryMainOnly, 'release/5.0.2.1', '')).toEqual(['17', '21', '25']);
  });

  test('falls back to oss default when no matching branch', () => {
    expect(resolveJdkVersions(entry, '6.0.x', 'unknown')).toEqual(['17', '21']);
  });

  test('returns hardcoded fallback when no defaults exist', () => {
    const emptyEntry = {};
    expect(resolveJdkVersions(emptyEntry, '1.0.x', '')).toEqual(['17', '21']);
  });

  test('uses oss-branch JDKs directly for release/ branch created from an OSS branch', () => {
    const entryWithMain = {
      oss: {
        branches: { default: ['main'], scheduled: ['main'] },
        jdkVersions: { main: ['17', '21'], '4.2.x': ['17'] },
      },
      commercial: { jdkVersions: {} },
    };
    // release/4.2.7 created from OSS main branch — should use ossJdk['main']
    expect(resolveJdkVersions(entryWithMain, 'release/4.2.7', 'main')).toEqual(['17', '21']);
  });

  test('uses commercial branch JDKs for release/ branch created from a commercial source', () => {
    const entryCommercial = {
      oss: { jdkVersions: {} },
      commercial: {
        jdkVersions: { main: ['17', '21', '25'] },
      },
    };
    // release/5.0.0 created from commercial main — should use commercialJdk['main']
    expect(resolveJdkVersions(entryCommercial, 'release/5.0.0', 'main', true)).toEqual(['17', '21', '25']);
  });
});

// ── updateProjects ──────────────────────────────────────────────────────────

describe('updateProjects', () => {
  function makeData() {
    return {
      defaults: {
        oss: {
          branches: { default: ['main'], scheduled: ['4.3.x', '5.0.x'] },
          jdkVersions: { default: ['17', '21'], '4.3.x': ['17'], '5.0.x': ['17', '21'] },
        },
        commercial: {
          branches: { default: ['5.0.x'], scheduled: [] },
          jdkVersions: {},
        },
      },
      'spring-cloud-config': {
        oss: {
          branches: { default: ['main'], scheduled: ['4.1.x', '4.2.x'] },
          jdkVersions: { '4.1.x': ['17'], '4.2.x': ['17', '21'] },
        },
        commercial: {
          branches: { default: ['4.2.x'], scheduled: ['4.2.x'] },
          jdkVersions: { '4.2.x': ['17', '21'] },
        },
      },
    };
  }

  test('adds commercial branch to scheduled and jdkVersions', () => {
    const data = makeData();
    const changed = updateProjects(data, 'spring-cloud/spring-cloud-config', '4.1.x', '4.3.x', false);
    expect(changed).toBe(true);
    expect(data['spring-cloud-config'].commercial.branches.scheduled).toContain('4.3.x');
    expect(data['spring-cloud-config'].commercial.jdkVersions['4.3.x']).toBeDefined();
  });

  test('inserts new branch at the front of scheduled', () => {
    const data = makeData();
    updateProjects(data, 'spring-cloud/spring-cloud-config', '4.1.x', '4.3.x', false);
    expect(data['spring-cloud-config'].commercial.branches.scheduled[0]).toBe('4.3.x');
  });

  test('removes oss branch from scheduled when migrating regular branch', () => {
    const data = makeData();
    updateProjects(data, 'spring-cloud/spring-cloud-config', '4.1.x', '4.1.x', false);
    expect(data['spring-cloud-config'].oss.branches.scheduled).not.toContain('4.1.x');
  });

  test('removes oss jdkVersions entry when migrating regular branch', () => {
    const data = makeData();
    updateProjects(data, 'spring-cloud/spring-cloud-config', '4.1.x', '4.1.x', false);
    expect(data['spring-cloud-config'].oss.jdkVersions['4.1.x']).toBeUndefined();
  });

  test('sets commercial.branches.default when setDefault is true', () => {
    const data = makeData();
    updateProjects(data, 'spring-cloud/spring-cloud-config', '4.1.x', '4.3.x', true);
    expect(data['spring-cloud-config'].commercial.branches.default).toEqual(['4.3.x']);
  });

  test('falls back to defaults entry for unknown project', () => {
    const data = makeData();
    const changed = updateProjects(data, 'spring-cloud/unknown-project', '5.0.x', '5.0.x', false);
    expect(changed).toBe(true);
    expect(data['defaults'].commercial.branches.scheduled).toContain('5.0.x');
  });

  test('returns false when branch already exists in all sections', () => {
    const data = makeData();
    updateProjects(data, 'spring-cloud/spring-cloud-config', '4.2.x', '4.2.x', false);
    const changed = updateProjects(data, 'spring-cloud/spring-cloud-config', '4.2.x', '4.2.x', false);
    expect(changed).toBe(false);
  });

  test('does not remove oss branch for hotfix branch', () => {
    const data = makeData();
    updateProjects(data, 'spring-cloud/spring-cloud-config', '4.1.x', '4.1.1.x', false);
    expect(data['spring-cloud-config'].oss.branches.scheduled).toContain('4.1.x');
  });

  test('handles release/ hotfix branch correctly', () => {
    const data = makeData();
    const changed = updateProjects(data, 'spring-cloud/spring-cloud-config', '', 'release/4.2.7', false);
    expect(changed).toBe(true);
    expect(data['spring-cloud-config'].oss.branches.scheduled).toContain('4.2.x');
  });

  test('strips -commercial suffix for project lookup when source is commercial repo', () => {
    const data = makeData();
    // spring-cloud-config-commercial → looks up 'spring-cloud-config' entry
    const changed = updateProjects(data, 'spring-cloud/spring-cloud-config-commercial', 'main', 'release/4.2.7', false);
    expect(changed).toBe(true);
    // Should update the spring-cloud-config entry, not create a new one
    expect(data['spring-cloud-config'].commercial.branches.scheduled).toContain('release/4.2.7');
    expect(data['spring-cloud-config-commercial']).toBeUndefined();
  });

  test('uses oss-branch JDKs for release/ branch created from OSS branch in updateProjects', () => {
    const data = {
      defaults: {
        oss: {
          branches: { default: ['main'] },
          jdkVersions: { default: ['17', '21'] },
        },
        commercial: { branches: { scheduled: [] }, jdkVersions: {} },
      },
      'spring-cloud-config': {
        oss: {
          branches: { default: ['main'], scheduled: ['4.1.x', '4.2.x'] },
          jdkVersions: { '4.1.x': ['17'], '4.2.x': ['17', '21'], main: ['17', '21', '25'] },
        },
        commercial: {
          branches: { default: ['4.2.x'], scheduled: ['4.2.x'] },
          jdkVersions: { '4.2.x': ['17', '21'] },
        },
      },
    };
    updateProjects(data, 'spring-cloud/spring-cloud-config', 'main', 'release/5.0.0', false);
    // Should use ossJdk['main'] = ['17', '21', '25']
    expect(data['spring-cloud-config'].commercial.jdkVersions['release/5.0.0']).toEqual(['17', '21', '25']);
    // OSS branch should NOT be removed for a release/ branch
    expect(data['spring-cloud-config'].oss.branches.scheduled).toContain('4.2.x');
  });
});
