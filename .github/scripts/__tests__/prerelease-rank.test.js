'use strict';

const { rank, byRankDesc, best, split, isPrerelease, next } =
  require('../prerelease-rank');

describe('rank', () => {
  it('ranks the base itself highest', () => {
    expect(rank('2026.0.0', '2026.0.0')).toEqual([2, 0]);
  });

  it('ranks release candidates above milestones', () => {
    expect(rank('2026.0.0-RC1', '2026.0.0')).toEqual([1, 1]);
    expect(rank('2026.0.0-M1', '2026.0.0')).toEqual([0, 1]);
  });

  it('returns null for titles that do not belong to the base', () => {
    expect(rank('2025.1.2', '2026.0.0')).toBeNull();
    expect(rank('2026.0.0-SNAPSHOT', '2026.0.0')).toBeNull();
    expect(rank('2026.0.01', '2026.0.0')).toBeNull();
    expect(rank('2026.0.0-M1-extra', '2026.0.0')).toBeNull();
  });
});

describe('byRankDesc', () => {
  it('sorts M10 above M9 rather than below it as a string would', () => {
    const entries = [
      { title: '2026.0.0-M9', rank: rank('2026.0.0-M9', '2026.0.0') },
      { title: '2026.0.0-M10', rank: rank('2026.0.0-M10', '2026.0.0') },
    ];
    entries.sort(byRankDesc);
    expect(entries[0].title).toBe('2026.0.0-M10');
  });
});

describe('best', () => {
  it('picks the furthest-along title belonging to the base', () => {
    const titles = ['2026.0.0-M1', '2026.0.0-M2', '2026.0.0-RC1', '2025.1.2'];
    expect(best(titles, '2026.0.0')).toBe('2026.0.0-RC1');
  });

  it('prefers GA over every pre-release', () => {
    expect(best(['2026.0.0-RC1', '2026.0.0'], '2026.0.0')).toBe('2026.0.0');
  });

  it('returns null when nothing belongs to the base', () => {
    expect(best(['2025.1.2'], '2026.0.0')).toBeNull();
  });
});

describe('split', () => {
  it('pulls a milestone apart', () => {
    expect(split('2026.0.0-M1')).toEqual({ base: '2026.0.0', kind: 'M', num: 1 });
  });

  it('pulls a release candidate apart', () => {
    expect(split('2026.0.0-RC12')).toEqual({ base: '2026.0.0', kind: 'RC', num: 12 });
  });

  it('reports a GA version as having no qualifier', () => {
    expect(split('2026.0.0')).toEqual({ base: '2026.0.0', kind: null, num: 0 });
  });

  it('accepts a four-segment commercial hotfix version', () => {
    expect(split('2025.1.2.1')).toEqual({ base: '2025.1.2.1', kind: null, num: 0 });
  });

  it('trims surrounding whitespace', () => {
    expect(split('  2026.0.0-M1  ')).toEqual({ base: '2026.0.0', kind: 'M', num: 1 });
  });

  it('returns null for qualifiers outside the grammar', () => {
    expect(split('2026.0.0-SNAPSHOT')).toBeNull();
    expect(split('5.0.3-INTERNAL-SNAPSHOT')).toBeNull();
    expect(split('2026.0')).toBeNull();
    expect(split('')).toBeNull();
  });
});

describe('isPrerelease', () => {
  it('is true only for -M<n> and -RC<n>', () => {
    expect(isPrerelease('2026.0.0-M1')).toBe(true);
    expect(isPrerelease('2026.0.0-RC1')).toBe(true);
    expect(isPrerelease('2026.0.0')).toBe(false);
    expect(isPrerelease('2026.0.0-SNAPSHOT')).toBe(false);
  });
});

describe('next', () => {
  it('walks a whole train from the first milestone to the release after GA', () => {
    expect(next('2026.0.0-M1', 'none')).toBe('2026.0.0-M2');
    expect(next('2026.0.0-M2', 'RC')).toBe('2026.0.0-RC1');
    expect(next('2026.0.0-RC1', 'none')).toBe('2026.0.0-RC2');
    expect(next('2026.0.0-RC2', 'GA')).toBe('2026.0.0');
    expect(next('2026.0.0', 'none')).toBe('2026.0.1');
  });

  it('increments numerically, so M9 is followed by M10', () => {
    expect(next('2026.0.0-M9', 'none')).toBe('2026.0.0-M10');
    expect(next('2026.0.0-RC9', '')).toBe('2026.0.0-RC10');
  });

  it('treats a missing promote_to as staying in the current phase', () => {
    expect(next('2026.0.0-M1')).toBe('2026.0.0-M2');
    expect(next('2026.0.0-M1', undefined)).toBe('2026.0.0-M2');
    expect(next('2026.0.0-M1', '')).toBe('2026.0.0-M2');
  });

  it('accepts promote_to in any case', () => {
    expect(next('2026.0.0-M1', 'rc')).toBe('2026.0.0-RC1');
    expect(next('2026.0.0-RC1', 'ga')).toBe('2026.0.0');
  });

  it('ignores promote_to for a GA version', () => {
    expect(next('2025.1.2', 'GA')).toBe('2025.1.3');
    expect(next('2025.1.2', 'RC')).toBe('2025.1.3');
  });

  it('bumps the last segment of a four-segment hotfix version', () => {
    expect(next('2025.1.2.1', 'none')).toBe('2025.1.2.2');
  });

  it('refuses to take a milestone straight to GA', () => {
    expect(() => next('2026.0.0-M1', 'GA')).toThrow(/cannot be GA/);
  });

  it('refuses to promote a release candidate to a release candidate', () => {
    expect(() => next('2026.0.0-RC1', 'RC')).toThrow(/already a release candidate/);
  });

  it('refuses a version it cannot parse', () => {
    expect(() => next('2026.0.0-SNAPSHOT', 'none')).toThrow(/not a release version/);
    expect(() => next('5.0.3-INTERNAL', 'none')).toThrow(/not a release version/);
  });

  it('refuses an unknown promote_to', () => {
    expect(() => next('2026.0.0-M1', 'FINAL')).toThrow(/Unknown promote_to/);
  });
});
