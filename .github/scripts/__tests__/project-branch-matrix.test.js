const {
  parseProjectFilter, typeKeysFor, repoName, knownProjectKeys,
  walkProjects, buildBranchMatrix, buildRepoMatrix,
} = require('../project-branch-matrix');

// A trimmed fixture shaped like the real config/projects.json: two OSS-and-commercial
// projects, one commercial-only project (mirroring spring-cloud-sleuth), and a `defaults`
// key that must never be treated as a project.
const PROJECTS = {
  'spring-cloud-alpha': {
    oss: { branches: { scheduled: ['main', '5.0.x'], default: ['main'] } },
    commercial: {
      branches: {
        scheduled: ['5.1.x-internal', '4.3.x', '4.2.x'],
        default: ['4.3.x'],
      },
    },
  },
  'spring-cloud-beta': {
    oss: { branches: { scheduled: ['main'], default: ['main'] } },
    commercial: { branches: { scheduled: ['3.1.x'], default: ['3.1.x'] } },
  },
  'spring-cloud-commercial-only': {
    commercial: { branches: { scheduled: ['3.1.x'], default: ['3.1.x'] } },
  },
  defaults: {
    oss: { branches: { scheduled: ['main'], default: ['main'] } },
  },
};

describe('parseProjectFilter', () => {
  it('returns an empty set for blank input', () => {
    expect(parseProjectFilter('').size).toBe(0);
    expect(parseProjectFilter(undefined).size).toBe(0);
  });

  it('splits, trims and drops empties from a comma-separated list', () => {
    expect(parseProjectFilter(' spring-cloud-alpha ,, spring-cloud-beta,'))
      .toEqual(new Set(['spring-cloud-alpha', 'spring-cloud-beta']));
  });
});

describe('typeKeysFor', () => {
  it('expands both/empty to oss and commercial', () => {
    expect(typeKeysFor('both')).toEqual(['oss', 'commercial']);
    expect(typeKeysFor('')).toEqual(['oss', 'commercial']);
    expect(typeKeysFor(undefined)).toEqual(['oss', 'commercial']);
  });

  it('passes a single type straight through', () => {
    expect(typeKeysFor('oss')).toEqual(['oss']);
    expect(typeKeysFor('commercial')).toEqual(['commercial']);
  });
});

describe('repoName', () => {
  it('builds the plain repo name for oss', () => {
    expect(repoName('spring-cloud-alpha', 'oss')).toBe('spring-cloud/spring-cloud-alpha');
  });

  it('appends -commercial for commercial', () => {
    expect(repoName('spring-cloud-alpha', 'commercial'))
      .toBe('spring-cloud/spring-cloud-alpha-commercial');
  });
});

describe('knownProjectKeys', () => {
  it('lists every project except defaults', () => {
    expect(knownProjectKeys(PROJECTS).sort()).toEqual([
      'spring-cloud-alpha', 'spring-cloud-beta', 'spring-cloud-commercial-only',
    ]);
  });
});

describe('walkProjects', () => {
  it('skips defaults and visits every project/type pair present', () => {
    const seen = [];
    walkProjects(PROJECTS, {}, ({ projectKey, typeKey }) => seen.push(`${projectKey}:${typeKey}`));
    expect(seen).toEqual(expect.arrayContaining([
      'spring-cloud-alpha:oss', 'spring-cloud-alpha:commercial',
      'spring-cloud-beta:oss', 'spring-cloud-beta:commercial',
      'spring-cloud-commercial-only:commercial',
    ]));
    expect(seen).not.toContain('defaults:oss');
    expect(seen).not.toContain('spring-cloud-commercial-only:oss');
  });

  it('applies a project filter', () => {
    const seen = [];
    walkProjects(PROJECTS, { filter: 'spring-cloud-alpha' }, ({ projectKey }) => seen.push(projectKey));
    expect(new Set(seen)).toEqual(new Set(['spring-cloud-alpha']));
  });

  it('applies a repoType filter', () => {
    const seen = [];
    walkProjects(PROJECTS, { repoType: 'oss' }, ({ typeKey }) => seen.push(typeKey));
    expect(new Set(seen)).toEqual(new Set(['oss']));
  });
});

describe('buildBranchMatrix', () => {
  it('builds one entry per scheduled branch and excludes -internal by default', () => {
    const { entries, excluded } = buildBranchMatrix(PROJECTS, { repoType: 'commercial' });
    expect(entries).toEqual(expect.arrayContaining([
      { project: 'spring-cloud-alpha', repo: 'spring-cloud/spring-cloud-alpha-commercial', type: 'commercial', branch: '4.2.x' },
      { project: 'spring-cloud-alpha', repo: 'spring-cloud/spring-cloud-alpha-commercial', type: 'commercial', branch: '4.3.x' },
    ]));
    expect(entries.some(e => e.branch === '5.1.x-internal')).toBe(false);
    expect(excluded).toEqual(['spring-cloud/spring-cloud-alpha-commercial@5.1.x-internal']);
  });

  it('keeps -internal branches in entries when excludeInternal is false', () => {
    const { entries, excluded } = buildBranchMatrix(PROJECTS, {
      repoType: 'commercial', excludeInternal: false,
    });
    expect(entries.some(e => e.branch === '5.1.x-internal')).toBe(true);
    expect(excluded).toEqual([]);
  });

  it('sorts by repo then branch', () => {
    // Sorted by the repo/branch *fields* via localeCompare, not by the concatenated
    // "repo@branch" string - those disagree here, since '-' sorts before '@' and
    // "spring-cloud-beta" is a prefix of "spring-cloud-beta-commercial".
    const { entries } = buildBranchMatrix(PROJECTS, { filter: 'spring-cloud-beta', repoType: 'both' });
    expect(entries.map(e => `${e.repo}@${e.branch}`)).toEqual([
      'spring-cloud/spring-cloud-beta@main',
      'spring-cloud/spring-cloud-beta-commercial@3.1.x',
    ]);
    for (let i = 1; i < entries.length; i++) {
      const cmp = entries[i - 1].repo.localeCompare(entries[i].repo) ||
        entries[i - 1].branch.localeCompare(entries[i].branch);
      expect(cmp).toBeLessThanOrEqual(0);
    }
  });
});

describe('buildRepoMatrix', () => {
  it('builds one entry per repo with branches joined by comma', () => {
    const { entries } = buildRepoMatrix(PROJECTS, { filter: 'spring-cloud-beta' });
    expect(entries).toEqual(expect.arrayContaining([
      { project: 'spring-cloud-beta', repo: 'spring-cloud/spring-cloud-beta', type: 'oss', branches: 'main' },
      { project: 'spring-cloud-beta', repo: 'spring-cloud/spring-cloud-beta-commercial', type: 'commercial', branches: '3.1.x' },
    ]));
  });

  it('omits a repo whose type section is absent entirely', () => {
    const { entries } = buildRepoMatrix(PROJECTS, {
      filter: 'spring-cloud-commercial-only', repoType: 'oss',
    });
    expect(entries).toEqual([]);
  });

  it('still includes a repo whose section has an empty branch list, unlike buildBranchMatrix', () => {
    // dependabot-report.yml and dependabot-triage.yml always push one entry per surviving
    // (project, type) pair, even with nothing to scan - only lock-unlock-branches.yml wants
    // that case dropped, and it filters the result itself rather than this function deciding
    // for every caller.
    const projects = { empty: { oss: { branches: { scheduled: [] } } } };
    const { entries } = buildRepoMatrix(projects, { repoType: 'oss' });
    expect(entries).toEqual([{ project: 'empty', repo: 'spring-cloud/empty', type: 'oss', branches: '' }]);
  });

  it('supports a custom branchesOf selector (scheduled union default)', () => {
    const { entries } = buildRepoMatrix(PROJECTS, {
      filter: 'spring-cloud-alpha',
      repoType: 'commercial',
      branchesOf: section =>
        [...new Set([...(section.branches?.scheduled || []), ...(section.branches?.default || [])])],
    });
    expect(entries[0].branches.split(',').sort()).toEqual(
      ['4.2.x', '4.3.x', '5.1.x-internal'].sort());
  });
});
