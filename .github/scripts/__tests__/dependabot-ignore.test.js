const { findMavenIgnore, pickMavenTarget, parseRange } = require('../dependabot-ignore');

const NAME = 'org.apache.maven:apache-maven';
const cfg = (ignore, extra = {}) => ({
  version: 2,
  updates: [{ 'package-ecosystem': 'maven', directory: '/', 'target-branch': '3.2.x', ignore, ...extra }],
});
const ctx = { branch: '3.2.x', defaultBranch: 'main', current: '3.9.16' };
const ignored = (config, candidate, over = {}) =>
  findMavenIgnore(config, { ...ctx, candidate, ...over });

describe('parseRange', () => {
  it.each([
    ['>=3.10.0', '3.10.0', true], ['>=3.10.0', '3.9.16', false],
    ['> 3.9', '3.9.1', true], ['<4', '3.10.0', true], ['<4', '4.0.0', false],
    ['<=3.9.9', '3.9.9', true], ['=3.9.1', '3.9.1', true], ['=3.9.1', '3.9.2', false],
    ['>=3.9, <3.10', '3.9.16', true], ['>=3.9, <3.10', '3.10.0', false],
    ['[3.10,)', '3.10.0', true], ['[3.10,)', '3.9.16', false],
    ['(,4.0)', '3.99.0', true], ['[3.9,3.10)', '3.10.0', false],
    ['[3.9,3.10),[4,5)', '4.1.0', true],
    ['3.x', '3.10.0', true], ['3.x', '4.0.0', false], ['3.10.*', '3.10.1', true],
    ['3.10.*', '3.9.9', false], ['~> 3.9', '3.10.0', true], ['~> 3.9.1', '3.9.9', true],
    ['~> 3.9.1', '3.10.0', false],
  ])('%s vs %s', (range, version, expected) => {
    expect(parseRange(range)(version)).toBe(expected);
  });

  it.each(['', 'latest', '>=abc', '[1,2', '^3.9'])('rejects %j', range => {
    expect(parseRange(range)).toBeNull();
  });
});

describe('findMavenIgnore', () => {
  const rule = { 'dependency-name': NAME, versions: ['>=3.10.0'] };

  it('ignores a version inside the range on the matching branch', () => {
    expect(ignored(cfg([rule]), '3.10.0')).toMatch(/versions '>=3\.10\.0'/);
  });

  it('allows a version outside the range', () => {
    expect(ignored(cfg([rule]), '3.9.17')).toBeNull();
  });

  it('does not apply to a different target-branch', () => {
    expect(ignored(cfg([rule]), '3.10.0', { branch: '4.3.x' })).toBeNull();
  });

  it('applies an entry with no target-branch to the default branch only', () => {
    const config = cfg([rule], { 'target-branch': undefined });
    expect(ignored(config, '3.10.0', { branch: 'main' })).not.toBeNull();
    expect(ignored(config, '3.10.0', { branch: '3.2.x' })).toBeNull();
  });

  it('ignores every version when the rule has no versions or update-types', () => {
    expect(ignored(cfg([{ 'dependency-name': NAME }]), '3.9.17')).toMatch(/all versions/);
  });

  it('honours update-types against the current version', () => {
    const minor = cfg([{ 'dependency-name': NAME, 'update-types': ['version-update:semver-minor'] }]);
    expect(ignored(minor, '3.10.0')).toMatch(/semver-minor/);
    expect(ignored(minor, '3.9.17')).toBeNull();
    expect(ignored(minor, '4.0.0')).toBeNull();
    const major = cfg([{ 'dependency-name': NAME, 'update-types': ['version-update:semver-major'] }]);
    expect(ignored(major, '4.0.0')).not.toBeNull();
  });

  it('cannot apply update-types without a current version', () => {
    const minor = cfg([{ 'dependency-name': NAME, 'update-types': ['version-update:semver-minor'] }]);
    expect(ignored(minor, '3.10.0', { current: null })).toBeNull();
  });

  it('ignores other dependencies, wildcard names match', () => {
    expect(ignored(cfg([{ 'dependency-name': 'org.apache.maven:maven-core' }]), '3.10.0')).toBeNull();
    expect(ignored(cfg([{ 'dependency-name': 'org.apache.maven:*' }]), '3.10.0')).not.toBeNull();
  });

  it('only reads maven entries that cover the root', () => {
    expect(ignored(cfg([rule], { 'package-ecosystem': 'github-actions' }), '3.10.0')).toBeNull();
    expect(ignored(cfg([rule], { directory: '/sub' }), '3.10.0')).toBeNull();
    expect(ignored(cfg([rule], { directory: undefined, directories: ['/sub', '/'] }), '3.10.0'))
      .not.toBeNull();
  });

  it('matches nothing, and warns, on an unreadable range', () => {
    const warn = jest.fn();
    expect(ignored(cfg([{ 'dependency-name': NAME, versions: ['^3.10'] }]), '3.10.0', { warn })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('^3.10'));
  });

  it.each([null, undefined, {}, { updates: null }])('tolerates config %j', config => {
    expect(ignored(config, '3.10.0')).toBeNull();
  });
});

describe('pickMavenTarget', () => {
  const candidates = ['3.9.16', '3.9.17', '3.10.0'];
  const rule = { 'dependency-name': NAME, versions: ['>=3.10.0'] };

  it('falls back to the newest version that is not ignored', () => {
    const r = pickMavenTarget(cfg([rule]), { ...ctx, candidates });
    expect(r.target).toBe('3.9.17');
    expect(r.skipped.map(s => s.version)).toEqual(['3.10.0']);
  });

  it('picks the newest when nothing is ignored for the branch', () => {
    const r = pickMavenTarget(cfg([rule]), { ...ctx, branch: '4.3.x', candidates });
    expect(r).toEqual({ target: '3.10.0', skipped: [] });
  });

  it('returns a null target when every candidate is ignored', () => {
    const r = pickMavenTarget(cfg([{ 'dependency-name': NAME }]), { ...ctx, candidates });
    expect(r.target).toBeNull();
    expect(r.skipped).toHaveLength(3);
  });
});
