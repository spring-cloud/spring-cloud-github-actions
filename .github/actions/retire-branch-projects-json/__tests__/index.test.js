'use strict';

jest.mock('@actions/core');
jest.mock('@actions/exec');

const core = require('@actions/core');
const { dumpsPretty, retireBranch } = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  core.info.mockImplementation(() => {});
  core.warning.mockImplementation(() => {});
  core.error.mockImplementation(() => {});
  core.setFailed.mockImplementation(() => {});
  core.setSecret.mockImplementation(() => {});
});

// ── dumpsPretty ─────────────────────────────────────────────────────────────

describe('dumpsPretty', () => {
  test('keeps string arrays on a single line', () => {
    const data = { scheduled: ['4.3.x', '5.0.x'] };
    expect(dumpsPretty(data)).toContain('["4.3.x", "5.0.x"]');
  });
});

// ── retireBranch ─────────────────────────────────────────────────────────────

describe('retireBranch', () => {
  function makeData() {
    return {
      defaults: {
        oss: {
          branches: { default: ['main'], scheduled: ['4.3.x', '5.0.x'] },
          jdkVersions: { '4.3.x': ['17'], '5.0.x': ['17', '21'] },
        },
        commercial: {
          branches: { default: ['5.0.x'], scheduled: ['5.0.x'] },
          jdkVersions: { '5.0.x': ['17', '21'] },
        },
      },
      'spring-cloud-config': {
        oss: {
          branches: { default: ['main'], scheduled: ['4.1.x', '4.2.x'] },
          jdkVersions: { '4.1.x': ['17'], '4.2.x': ['17', '21'] },
        },
        commercial: {
          branches: { default: ['4.2.x'], scheduled: ['4.1.x', '4.2.x'] },
          jdkVersions: { '4.1.x': ['17'], '4.2.x': ['17', '21'] },
        },
      },
    };
  }

  test('removes branch from oss scheduled and jdkVersions for oss repo', () => {
    const data = makeData();
    const changed = retireBranch(data, 'spring-cloud/spring-cloud-config', '4.1.x');
    expect(changed).toBe(true);
    expect(data['spring-cloud-config'].oss.branches.scheduled).not.toContain('4.1.x');
    expect(data['spring-cloud-config'].oss.jdkVersions['4.1.x']).toBeUndefined();
    // commercial section untouched
    expect(data['spring-cloud-config'].commercial.branches.scheduled).toContain('4.1.x');
  });

  test('removes branch from commercial section for commercial repo', () => {
    const data = makeData();
    const changed = retireBranch(data, 'spring-cloud/spring-cloud-config-commercial', '4.1.x');
    expect(changed).toBe(true);
    expect(data['spring-cloud-config'].commercial.branches.scheduled).not.toContain('4.1.x');
    expect(data['spring-cloud-config'].commercial.jdkVersions['4.1.x']).toBeUndefined();
    // oss section untouched
    expect(data['spring-cloud-config'].oss.branches.scheduled).toContain('4.1.x');
  });

  test('falls back to defaults for unknown project', () => {
    const data = makeData();
    const changed = retireBranch(data, 'spring-cloud/unknown-project', '4.3.x');
    expect(changed).toBe(true);
    expect(data['defaults'].oss.branches.scheduled).not.toContain('4.3.x');
  });

  test('throws when branch is the default branch', () => {
    const data = makeData();
    expect(() => retireBranch(data, 'spring-cloud/spring-cloud-config', 'main')).toThrow(
      /listed in oss\.branches\.default/
    );
  });

  test('throws when commercial branch is the commercial default', () => {
    const data = makeData();
    expect(() =>
      retireBranch(data, 'spring-cloud/spring-cloud-config-commercial', '4.2.x')
    ).toThrow(/listed in commercial\.branches\.default/);
  });

  test('returns false when branch is not in any section', () => {
    const data = makeData();
    const changed = retireBranch(data, 'spring-cloud/spring-cloud-config', '9.9.x');
    expect(changed).toBe(false);
  });

  test('returns false when section does not exist', () => {
    const data = makeData();
    // defaults has no commercial.branches.default pointing to this branch,
    // but let's try an entry with no commercial section at all
    data['no-commercial-project'] = { oss: { branches: { scheduled: [] }, jdkVersions: {} } };
    const changed = retireBranch(data, 'spring-cloud/no-commercial-project-commercial', '4.3.x');
    expect(changed).toBe(false);
  });

  test('handles only jdkVersions removal (branch not in scheduled)', () => {
    const data = makeData();
    // Remove from scheduled manually but keep jdkVersions
    data['spring-cloud-config'].oss.branches.scheduled = [];
    const changed = retireBranch(data, 'spring-cloud/spring-cloud-config', '4.1.x');
    expect(changed).toBe(true);
    expect(data['spring-cloud-config'].oss.jdkVersions['4.1.x']).toBeUndefined();
  });
});

// ── run: push retry ──────────────────────────────────────────────────────────

describe('run push retry', () => {
  const fs = require('fs');
  const exec = require('@actions/exec');
  const { run } = require('../src/index');

  const projects = () => JSON.stringify({
    'spring-cloud-config': {
      commercial: { branches: { scheduled: ['release/5.0.3'], default: ['5.0.x'] }, jdkVersions: {} },
    },
  });

  beforeEach(() => {
    process.env.GITHUB_REPOSITORY = 'spring-cloud/spring-cloud-github-actions';
    core.getInput.mockImplementation(name => ({
      repo: 'spring-cloud/spring-cloud-config-commercial', branch: 'release/5.0.3', token: 't',
    }[name]));
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    jest.spyOn(fs, 'readFileSync').mockImplementation(projects);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    jest.spyOn(global, 'setTimeout').mockImplementation(fn => { fn(); return 0; });
  });
  afterEach(() => jest.restoreAllMocks());

  test('reapplies the change on the new main after a rejected push', async () => {
    let pushes = 0;
    exec.exec.mockImplementation(async (cmd, args) => {
      if (args.includes('diff')) return 1; // something staged
      if (args.includes('push')) return ++pushes === 1 ? 1 : 0;
      return 0;
    });
    await run();
    expect(pushes).toBe(2);
    expect(core.setFailed).not.toHaveBeenCalled();
    const calls = exec.exec.mock.calls.map(c => c[1].join(' '));
    expect(calls.some(c => c.includes('reset --hard origin/main'))).toBe(true);
    expect(calls.filter(c => c.includes(' commit ')).length).toBe(2);
  });

  test('fails after repeated rejections', async () => {
    exec.exec.mockImplementation(async (cmd, args) => (args.includes('push') || args.includes('diff') ? 1 : 0));
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('rejected 5 times'));
  });
});
