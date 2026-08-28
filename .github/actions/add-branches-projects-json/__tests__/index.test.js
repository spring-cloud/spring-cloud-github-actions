'use strict';

jest.mock('@actions/core');
jest.mock('@actions/exec');

const core = require('@actions/core');
const { dumpsPretty, resolveJdkVersions, addBranch, addBranches } = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  core.info.mockImplementation(() => {});
  core.warning.mockImplementation(() => {});
  core.error.mockImplementation(() => {});
  core.setFailed.mockImplementation(() => {});
  core.setSecret.mockImplementation(() => {});
});

function makeData() {
  return {
    defaults: {
      oss: {
        branches: { default: ['main'], scheduled: ['main'] },
        jdkVersions: { main: ['17', '21', '25'], default: ['17', '21', '25'] },
      },
      commercial: {
        branches: { default: ['4.3.x'], scheduled: ['4.3.x'] },
        jdkVersions: { '4.3.x': ['17', '21', '25'], default: ['17', '21'] },
      },
    },
    'spring-cloud-config': {
      oss: {
        branches: { default: ['main'], scheduled: ['main'] },
        jdkVersions: { main: ['17', '21', '25'] },
      },
      commercial: {
        branches: { default: ['3.3.x'], scheduled: ['3.3.x'] },
        jdkVersions: { '3.3.x': ['17', '21'] },
      },
    },
  };
}

// ── dumpsPretty ─────────────────────────────────────────────────────────────

describe('dumpsPretty', () => {
  test('keeps string arrays on a single line', () => {
    expect(dumpsPretty({ scheduled: ['5.0.x', 'main'] })).toContain('["5.0.x", "main"]');
  });
});

// ── addBranch ───────────────────────────────────────────────────────────────

describe('addBranch', () => {
  test('adds the branch to oss scheduled and copies the source branch JDKs', () => {
    const data = makeData();
    const changes = addBranch(data, 'spring-cloud/spring-cloud-config', '5.0.x', 'main');

    expect(changes).toHaveLength(2);
    expect(data['spring-cloud-config'].oss.branches.scheduled).toEqual(['5.0.x', 'main']);
    expect(data['spring-cloud-config'].oss.jdkVersions['5.0.x']).toEqual(['17', '21', '25']);
  });

  test('leaves branches.default alone — main stays the default line', () => {
    const data = makeData();
    addBranch(data, 'spring-cloud/spring-cloud-config', '5.0.x', 'main');
    expect(data['spring-cloud-config'].oss.branches.default).toEqual(['main']);
  });

  test('copies the JDK list rather than aliasing the source branch entry', () => {
    const data = makeData();
    addBranch(data, 'spring-cloud/spring-cloud-config', '5.0.x', 'main');
    data['spring-cloud-config'].oss.jdkVersions['5.0.x'].push('26');
    expect(data['spring-cloud-config'].oss.jdkVersions.main).toEqual(['17', '21', '25']);
  });

  test('modifies the commercial section for a -commercial repo', () => {
    const data = makeData();
    addBranch(data, 'spring-cloud/spring-cloud-config-commercial', '5.0.x', '3.3.x');
    expect(data['spring-cloud-config'].commercial.branches.scheduled).toEqual(['5.0.x', '3.3.x']);
    expect(data['spring-cloud-config'].commercial.jdkVersions['5.0.x']).toEqual(['17', '21']);
    expect(data['spring-cloud-config'].oss.branches.scheduled).toEqual(['main']);
  });

  test('is idempotent — a second call reports no changes', () => {
    const data = makeData();
    addBranch(data, 'spring-cloud/spring-cloud-config', '5.0.x', 'main');
    const changes = addBranch(data, 'spring-cloud/spring-cloud-config', '5.0.x', 'main');
    expect(changes).toEqual([]);
    expect(data['spring-cloud-config'].oss.branches.scheduled).toEqual(['5.0.x', 'main']);
  });

  test('seeds a missing project entry from defaults without mutating defaults', () => {
    const data = makeData();
    const changes = addBranch(data, 'spring-cloud/spring-cloud-new-thing', '5.0.x', 'main');

    expect(changes[0]).toContain('seeded from defaults.oss');
    expect(data['spring-cloud-new-thing'].oss.branches.scheduled).toEqual(['5.0.x', 'main']);
    expect(data['spring-cloud-new-thing'].oss.jdkVersions['5.0.x']).toEqual(['17', '21', '25']);
    // The shared defaults entry must come back untouched.
    expect(data.defaults.oss.branches.scheduled).toEqual(['main']);
    expect(data.defaults.oss.jdkVersions['5.0.x']).toBeUndefined();
  });
});

// ── resolveJdkVersions ──────────────────────────────────────────────────────

describe('resolveJdkVersions', () => {
  test('falls back to the section default when the source branch has no entry', () => {
    const data = makeData();
    const sec = { jdkVersions: { default: ['21'] } };
    expect(resolveJdkVersions(data, 'oss', sec, 'main')).toEqual(['21']);
  });

  test('falls back to the global defaults entry when the section has nothing', () => {
    const data = makeData();
    expect(resolveJdkVersions(data, 'oss', { jdkVersions: {} }, 'main')).toEqual(['17', '21', '25']);
  });

  test('falls back to 17/21 when projects.json has no defaults at all', () => {
    expect(resolveJdkVersions({}, 'oss', {}, 'main')).toEqual(['17', '21']);
  });
});

// ── addBranches ─────────────────────────────────────────────────────────────

describe('addBranches', () => {
  test('applies every addition and returns one description per change', () => {
    const data = makeData();
    const changes = addBranches(data, [
      { repo: 'spring-cloud/spring-cloud-config', branch: '5.0.x', sourceBranch: 'main' },
      { repo: 'spring-cloud/spring-cloud-commons', branch: '5.0.x' },
    ]);

    expect(changes.filter((c) => c.startsWith('spring-cloud/spring-cloud-config:'))).toHaveLength(2);
    expect(data['spring-cloud-config'].oss.branches.scheduled).toContain('5.0.x');
    expect(data['spring-cloud-commons'].oss.branches.scheduled).toContain('5.0.x');
  });

  test('defaults sourceBranch to main', () => {
    const data = makeData();
    addBranches(data, [{ repo: 'spring-cloud/spring-cloud-config', branch: '5.0.x' }]);
    expect(data['spring-cloud-config'].oss.jdkVersions['5.0.x']).toEqual(['17', '21', '25']);
  });

  test('throws when an addition is missing a branch', () => {
    expect(() => addBranches(makeData(), [{ repo: 'spring-cloud/spring-cloud-config' }]))
      .toThrow(/needs a 'repo' and a 'branch'/);
  });
});
