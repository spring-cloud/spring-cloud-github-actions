'use strict';

const { PROJECT_NAME_SUBSTITUTIONS, resolveProjectName } = require('../project-name-substitutions');

describe('resolveProjectName', () => {
  // spring-cloud-release's root pom.xml artifactId is the historical
  // spring-cloud-starter-build, which create-hotfix-release-branch.yml's derive job detects
  // before resolving the project's own fixed version in the releaser config.
  it('translates spring-cloud-starter-build to spring-cloud-release', () => {
    expect(resolveProjectName('spring-cloud-starter-build')).toBe('spring-cloud-release');
  });

  it('translates spring-cloud to spring-cloud-release', () => {
    expect(resolveProjectName('spring-cloud')).toBe('spring-cloud-release');
  });

  it('translates spring-boot-starter-parent to spring-boot', () => {
    expect(resolveProjectName('spring-boot-starter-parent')).toBe('spring-boot');
  });

  it('translates verifier to spring-cloud-contract', () => {
    expect(resolveProjectName('verifier')).toBe('spring-cloud-contract');
  });

  it('leaves an unmapped name unchanged', () => {
    expect(resolveProjectName('spring-cloud-stream')).toBe('spring-cloud-stream');
  });

  it('exposes the same keys update-project-versions/action.yml defaults to', () => {
    expect(Object.keys(PROJECT_NAME_SUBSTITUTIONS).sort()).toEqual([
      'spring-boot-starter-parent',
      'spring-cloud',
      'spring-cloud-dependencies-parent',
      'spring-cloud-starter-build',
      'springBoot',
      'verifier',
    ].sort());
  });
});
