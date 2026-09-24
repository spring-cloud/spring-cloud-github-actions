const { PLAYBOOK_PATH, extractBundle, rewrite, cmp } = require('../antora-ui-bundle');

// The exact shape confirmed live on spring-cloud-commons's main, 4.2.x, 4.3.x and 5.0.x
// branches (and their -commercial counterparts).
const PLAYBOOK = [
  'antora:',
  '  extensions:',
  "    - require: '@springio/antora-extensions'",
  "      root_component_name: 'cloud-commons'",
  'site:',
  '  title: Spring Cloud Commons',
  '  url: https://docs.spring.io/spring-cloud-commons/reference/',
  'content:',
  '  sources:',
  '    - url: ./..',
  '      branches: HEAD',
  '      start_path: docs',
  '      worktrees: true',
  'ui:',
  '  bundle:',
  '    url: https://github.com/spring-io/antora-ui-spring/releases/download/v0.4.15/ui-bundle.zip',
  '',
].join('\n');

describe('PLAYBOOK_PATH', () => {
  it('is the per-branch playbook path', () => {
    expect(PLAYBOOK_PATH).toBe('docs/antora-playbook.yml');
  });
});

describe('extractBundle', () => {
  it('reads the repo, tag and full url from a real playbook', () => {
    expect(extractBundle(PLAYBOOK)).toEqual({
      repo: 'spring-io/antora-ui-spring',
      tag: 'v0.4.15',
      url: 'https://github.com/spring-io/antora-ui-spring/releases/download/v0.4.15/ui-bundle.zip',
    });
  });

  it('returns null when there is no release-download url at all', () => {
    expect(extractBundle('ui:\n  bundle:\n    url: https://example.com/ui-bundle.zip\n')).toBeNull();
  });
});

describe('rewrite', () => {
  it('replaces only the tag, leaving everything else byte-identical', () => {
    const out = rewrite(PLAYBOOK, { repo: 'spring-io/antora-ui-spring', tag: 'v0.4.26' });
    expect(out).toContain(
      'url: https://github.com/spring-io/antora-ui-spring/releases/download/v0.4.26/ui-bundle.zip');
    expect(out.replace('v0.4.26', 'v0.4.15')).toBe(PLAYBOOK);
  });

  it('is a no-op when the file has no bundle url', () => {
    const noBundle = 'site:\n  title: X\n';
    expect(rewrite(noBundle, { repo: 'spring-io/antora-ui-spring', tag: 'v0.4.26' })).toBe(noBundle);
  });
});

describe('cmp', () => {
  it('is re-exported from version-cmp for tag comparison', () => {
    expect(cmp('v0.4.26', 'v0.4.15')).toBeGreaterThan(0);
  });
});
