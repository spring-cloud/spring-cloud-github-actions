const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  releaseTrainVersionToFileName,
  getReleaserConfigUrl,
  fetchReleaserConfig,
  parseReleaserConfig,
  detectProjectName,
  replaceProjectVersion,
  replaceParentVersion,
  replacePropertyValue,
  updateGradlePropertiesContent,
  updateBuildGradleContent,
  camelToKebab,
  artifactIdToProjectName,
  isChildOfRoot,
  updatePomFile,
  findFiles,
} = require('../src/index');

const fixturePath = (...parts) => path.join(__dirname, 'fixtures', ...parts);
const loadFixture = (...parts) => fs.readFileSync(fixturePath(...parts), 'utf-8');

// ── camelToKebab ─────────────────────────────────────────────────────────────

describe('camelToKebab', () => {
  it('converts a single-word camel prefix', () => {
    expect(camelToKebab('spring')).toBe('spring');
  });

  it('converts springBoot → spring-boot', () => {
    expect(camelToKebab('springBoot')).toBe('spring-boot');
  });

  it('converts springCloudConfig → spring-cloud-config', () => {
    expect(camelToKebab('springCloudConfig')).toBe('spring-cloud-config');
  });

  it('converts springCloudKubernetes → spring-cloud-kubernetes', () => {
    expect(camelToKebab('springCloudKubernetes')).toBe('spring-cloud-kubernetes');
  });
});

// ── artifactIdToProjectName ───────────────────────────────────────────────────

describe('artifactIdToProjectName', () => {
  it('strips -dependencies suffix', () => {
    expect(artifactIdToProjectName('spring-cloud-dependencies')).toBe('spring-cloud');
  });

  it('strips -parent suffix', () => {
    expect(artifactIdToProjectName('spring-cloud-build-parent')).toBe('spring-cloud-build');
  });

  it('leaves plain names unchanged', () => {
    expect(artifactIdToProjectName('spring-cloud-config')).toBe('spring-cloud-config');
  });
});

// ── replaceProjectVersion ─────────────────────────────────────────────────────

describe('replaceProjectVersion', () => {
  it('replaces the project version when there is no parent block', () => {
    const xml = `<project>\n  <version>4.1.0</version>\n</project>`;
    expect(replaceProjectVersion(xml, '4.1.0', '4.1.1')).toContain('<version>4.1.1</version>');
  });

  it('replaces the project version and NOT the parent version', () => {
    const xml = loadFixture('maven-single', 'pom.xml');
    const updated = replaceProjectVersion(xml, '4.1.0', '4.1.1');
    // Project version updated
    expect(updated).toMatch(/<artifactId>spring-cloud-config<\/artifactId>\s*<version>4\.1\.1<\/version>/);
    // Parent version untouched
    expect(updated).toContain('<version>4.1.1</version>'); // parent also 4.1.1 in fixture — used different value intentionally
    // Verify the parent block is still 4.1.1 (unchanged because it was already 4.1.1)
    const parentBlock = updated.match(/<parent>[\s\S]*?<\/parent>/)[0];
    expect(parentBlock).toContain('<version>4.1.1</version>');
  });

  it('does not change the XML when old version does not match', () => {
    const xml = `<project><version>4.1.0</version></project>`;
    expect(replaceProjectVersion(xml, '9.9.9', '4.1.1')).toBe(xml);
  });

  it('returns unchanged XML when old and new version are the same', () => {
    const xml = `<project><version>4.1.0</version></project>`;
    expect(replaceProjectVersion(xml, '4.1.0', '4.1.0')).toBe(xml);
  });
});

// ── replaceParentVersion ──────────────────────────────────────────────────────

describe('replaceParentVersion', () => {
  it('replaces only the <version> inside the <parent> block', () => {
    const xml = loadFixture('maven-multi', 'spring-cloud-config-server', 'pom.xml');
    const updated = replaceParentVersion(xml, '4.1.0', '4.1.1');
    const parentBlock = updated.match(/<parent>[\s\S]*?<\/parent>/)[0];
    expect(parentBlock).toContain('<version>4.1.1</version>');
  });

  it('does not touch content outside the <parent> block', () => {
    const xml = `<project>
  <parent><artifactId>root</artifactId><version>1.0.0</version></parent>
  <version>1.0.0</version>
</project>`;
    const updated = replaceParentVersion(xml, '1.0.0', '2.0.0');
    // Parent version updated
    expect(updated).toMatch(/<parent>[\s\S]*?<version>2\.0\.0<\/version>[\s\S]*?<\/parent>/);
    // Project version untouched
    expect(updated).toMatch(/<\/parent>\s*<version>1\.0\.0<\/version>/);
  });
});

// ── replacePropertyValue ──────────────────────────────────────────────────────

describe('replacePropertyValue', () => {
  it('replaces the value of a named property tag', () => {
    const xml = `<properties><spring-boot.version>3.2.2</spring-boot.version></properties>`;
    expect(replacePropertyValue(xml, 'spring-boot.version', '3.2.3')).toContain(
      '<spring-boot.version>3.2.3</spring-boot.version>'
    );
  });

  it('handles property names with hyphens and dots', () => {
    const xml = `<properties><spring-cloud-config.version>4.1.0</spring-cloud-config.version></properties>`;
    expect(replacePropertyValue(xml, 'spring-cloud-config.version', '4.1.1')).toContain(
      '<spring-cloud-config.version>4.1.1</spring-cloud-config.version>'
    );
  });

  it('does not replace unrelated tags with similar names', () => {
    const xml = `<properties><spring-boot.version>3.2.2</spring-boot.version><spring-boot-extra.version>1.0</spring-boot-extra.version></properties>`;
    const updated = replacePropertyValue(xml, 'spring-boot.version', '3.2.3');
    expect(updated).toContain('<spring-boot.version>3.2.3</spring-boot.version>');
    expect(updated).toContain('<spring-boot-extra.version>1.0</spring-boot-extra.version>');
  });
});

// ── updateGradlePropertiesContent ─────────────────────────────────────────────

describe('updateGradlePropertiesContent', () => {
  const content = loadFixture('releaser-config', '2024_1_0.properties');
  const substitutions = {
    'verifier': 'spring-cloud-contract',
    'boot': 'spring-boot'
  }
  const versions = parseReleaserConfig(content, substitutions);
  const projectVersion = '3.1.1';

  let result;
  beforeAll(() => {
    result = updateGradlePropertiesContent(
      loadFixture('gradle-project', 'gradle.properties'),
      projectVersion,
      versions
    );
  });

  it('updates the bare version= key to projectVersion', () => {
    expect(result.updated).toMatch(/^version=3\.1\.1$/m);
    expect(result.updatedProperties).toContain('version: 3.1.1');
  });

  it('updates springBootVersion', () => {
    expect(result.updated).toMatch(/^springBootVersion=3\.2\.3$/m);
    expect(result.updatedProperties).toContain('springBootVersion: 3.2.3');
  });
  it('updates bootVersion', () => {
    expect(result.updated).toMatch(/^bootVersion=3\.2\.3$/m);
    expect(result.updatedProperties).toContain('bootVersion: 3.2.3');
  });

  it('updates springCloudCommonsVersion', () => {
    expect(result.updated).toMatch(/^springCloudCommonsVersion=4\.1\.1$/m);
  });

  it('updates springCloudBusVersion', () => {
    expect(result.updated).toMatch(/^springCloudBusVersion=4\.1\.1$/m);
  });

  it('updates verifierVersion', () => {
    expect(result.updated).toMatch(/^verifierVersion=4\.1\.1$/m);
  });

  it('leaves non-Version keys unchanged', () => {
    expect(result.updated).toMatch(/^someOtherProperty=foobar$/m);
    expect(result.updated).toMatch(/^releaseFlag=true$/m);
  });

  it('does not match keys that are not pure camelCaseVersion pattern', () => {
    const content = `releaseVersion=1.0.0\nversionCode=42\n`;
    const { updated } = updateGradlePropertiesContent(content, '2.0.0', {});
    expect(updated).toBe(content);
  });
});

// ── updateBuildGradleContent ──────────────────────────────────────────────────

describe('updateBuildGradleContent', () => {
  it('updates a single-quoted version declaration', () => {
    const content = loadFixture('gradle-project', 'build.gradle');
    const { updated } = updateBuildGradleContent(content, '3.1.1');
    expect(updated).toMatch(/^version = '3\.1\.1'$/m);
  });

  it('updates a double-quoted version declaration', () => {
    const content = `group = 'org.example'\nversion = "3.1.0"\n`;
    const { updated } = updateBuildGradleContent(content, '3.1.1');
    expect(updated).toMatch(/^version = "3\.1\.1"$/m);
  });

  it('does not change unrelated lines', () => {
    const content = `group = 'org.example'\nversion = '3.1.0'\ndescription = 'My project'\n`;
    const { updated } = updateBuildGradleContent(content, '3.1.1');
    expect(updated).toContain(`group = 'org.example'`);
    expect(updated).toContain(`description = 'My project'`);
  });

  it('returns unchanged content when no version declaration is present', () => {
    const content = `group = 'org.example'\n`;
    expect(updateBuildGradleContent(content, '3.1.1').updated).toBe(content);
  });
});

// ── updatePomFile (filesystem integration) ────────────────────────────────────

describe('updatePomFile', () => {
  let tmpDir;

  beforeEach(() => {
    // Copy fixtures into a temp directory so tests can write to them safely
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-pom-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const versions = {
    'spring-boot': '3.2.3',
    'spring-cloud-commons': '4.1.1',
    'spring-cloud-bus': '4.1.1',
  };

  it('updates project version and properties in the root pom', () => {
    const src = fixturePath('maven-single', 'pom.xml');
    const dest = path.join(tmpDir, 'pom.xml');
    fs.copyFileSync(src, dest);

    const { changed, updatedProperties } = updatePomFile(dest, true, '4.1.1', versions);

    const written = fs.readFileSync(dest, 'utf-8');
    expect(changed).toBe(true);
    expect(written).toMatch(/<artifactId>spring-cloud-config<\/artifactId>\s*<version>4\.1\.1<\/version>/);
    expect(written).toContain('<spring-boot.version>3.2.3</spring-boot.version>');
    expect(written).toContain('<spring-cloud-commons.version>4.1.1</spring-cloud-commons.version>');
    expect(updatedProperties).toContain('version: 4.1.1');
    expect(updatedProperties).toContain('spring-boot.version: 3.2.3');
  });

  it('does not update project version in a child module pom (isRoot=false)', () => {
    const src = fixturePath('maven-multi', 'spring-cloud-config-server', 'pom.xml');
    const dest = path.join(tmpDir, 'pom.xml');
    fs.copyFileSync(src, dest);

    updatePomFile(dest, false, '4.1.1', versions);

    const written = fs.readFileSync(dest, 'utf-8');
    // The child pom has no <version> of its own — project version section absent
    expect(written).not.toMatch(/<artifactId>spring-cloud-config-server<\/artifactId>\s*<version>/);
  });

  it('updates parent version in a child module pom when parent is the root project', () => {
    const src = fixturePath('maven-multi', 'spring-cloud-config-server', 'pom.xml');
    const dest = path.join(tmpDir, 'pom.xml');
    fs.copyFileSync(src, dest);

    updatePomFile(dest, false, '4.1.1', versions);

    const written = fs.readFileSync(dest, 'utf-8');
    const parentBlock = written.match(/<parent>[\s\S]*?<\/parent>/)[0];
    expect(parentBlock).toContain('<version>4.1.1</version>');
  });

  it('leaves properties not in the versions map unchanged', () => {
    const src = fixturePath('maven-single', 'pom.xml');
    const dest = path.join(tmpDir, 'pom.xml');
    fs.copyFileSync(src, dest);

    updatePomFile(dest, true, '4.1.1', versions);

    const written = fs.readFileSync(dest, 'utf-8');
    expect(written).toContain('<some-other.version>1.2.3</some-other.version>');
  });

  it('does not touch non-.version properties', () => {
    const src = fixturePath('maven-single', 'pom.xml');
    const dest = path.join(tmpDir, 'pom.xml');
    fs.copyFileSync(src, dest);

    updatePomFile(dest, true, '4.1.1', versions);

    const written = fs.readFileSync(dest, 'utf-8');
    expect(written).toContain('<java.compiler.release>17</java.compiler.release>');
  });

  it('updates properties in a child module pom', () => {
    const src = fixturePath('maven-multi', 'spring-cloud-config-server', 'pom.xml');
    const dest = path.join(tmpDir, 'pom.xml');
    fs.copyFileSync(src, dest);

    updatePomFile(dest, false, '4.1.1', versions);

    const written = fs.readFileSync(dest, 'utf-8');
    expect(written).toContain('<spring-boot.version>3.2.3</spring-boot.version>');
    expect(written).toContain('<spring-cloud-commons.version>4.1.1</spring-cloud-commons.version>');
  });

  it('updates own <version> in a non-root BOM pom when it matches currentRootVersion', () => {
    const src = fixturePath('maven-bom', 'pom.xml');
    const dest = path.join(tmpDir, 'pom.xml');
    fs.copyFileSync(src, dest);

    const { changed, updatedProperties } = updatePomFile(dest, false, '4.1.1', versions, '4.1.0');

    const written = fs.readFileSync(dest, 'utf-8');
    expect(changed).toBe(true);
    expect(written).toMatch(/<artifactId>spring-cloud-foo-dependencies<\/artifactId>\s*<version>4\.1\.1<\/version>/);
    expect(updatedProperties).toContain('version: 4.1.1');
    expect(written).toContain('<spring-boot.version>3.2.3</spring-boot.version>');
  });

  it('does not update own <version> in a non-root BOM pom when currentRootVersion is not provided', () => {
    const src = fixturePath('maven-bom', 'pom.xml');
    const dest = path.join(tmpDir, 'pom.xml');
    fs.copyFileSync(src, dest);

    updatePomFile(dest, false, '4.1.1', versions);

    const written = fs.readFileSync(dest, 'utf-8');
    expect(written).toContain('<version>4.1.0</version>');
  });

  it('uses exact artifact ID to resolve parent version when it is in the versions map', () => {
    // spring-cloud-dependencies-parent is in the versions map via substitution
    // (as it would be in production). Its stripped name spring-cloud-dependencies is NOT.
    // The parent version must be set to the spring-cloud-build version, not projectVersion.
    const src = fixturePath('maven-bom', 'pom.xml');
    const dest = path.join(tmpDir, 'pom.xml');
    fs.copyFileSync(src, dest);

    const versionsWithExternalParent = {
      ...versions,
      'spring-cloud-dependencies-parent': '4.2.0', // spring-cloud-build version via substitution
    };

    updatePomFile(dest, false, '4.1.1', versionsWithExternalParent, '4.1.0');

    const written = fs.readFileSync(dest, 'utf-8');
    const parentBlock = written.match(/<parent>[\s\S]*?<\/parent>/)[0];
    // Parent version must be 4.2.0 (from versions map), not 4.1.1 (projectVersion)
    expect(parentBlock).toContain('<version>4.2.0</version>');
  });

  it('uses spring-boot version for spring-boot-starter-parent when it is in the versions map', () => {
    // Simulates a samples or IT pom whose parent is spring-boot-starter-parent.
    // The stripped name spring-boot-starter is not in versions, but the exact artifact
    // ID spring-boot-starter-parent is present via the substitution added in action.yml.
    const pomContent = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.1</version>
    <relativePath/>
  </parent>
  <groupId>org.springframework.cloud</groupId>
  <artifactId>spring-cloud-function-sample-basic</artifactId>
  <version>4.1.0</version>
</project>`;
    const dest = path.join(tmpDir, 'pom.xml');
    fs.writeFileSync(dest, pomContent);

    const versionsWithBootParent = {
      ...versions,
      'spring-boot-starter-parent': '3.2.3', // spring-boot version added via substitution in action.yml
    };

    updatePomFile(dest, false, '4.1.1', versionsWithBootParent, '4.1.0');

    const written = fs.readFileSync(dest, 'utf-8');
    const parentBlock = written.match(/<parent>[\s\S]*?<\/parent>/)[0];
    // Parent version must be 3.2.3 (spring-boot version), not 4.1.1 (projectVersion)
    expect(parentBlock).toContain('<version>3.2.3</version>');
  });

  it('does not stamp projectVersion onto an external parent (spring-boot-dependencies) when versions map is empty', () => {
    // Regression test for spring-cloud/spring-cloud-build-commercial commit da5fef0:
    // spring-cloud-build-dependencies/pom.xml has spring-boot-dependencies (an external
    // Spring Boot BOM) as its parent, not the project root. With an empty versions map
    // (hotfix branch stamp step uses versions:'{}'), the old isChildOfRoot heuristic
    // incorrectly treated any parent absent from the map as "child of root" and stamped
    // it with projectVersion (5.0.2.1-SNAPSHOT instead of keeping 4.0.7).
    const pomContent = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.springframework.cloud</groupId>
  <artifactId>spring-cloud-build-dependencies</artifactId>
  <version>5.0.2</version>
  <name>spring-cloud-build-dependencies</name>
  <packaging>pom</packaging>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-dependencies</artifactId>
    <version>4.0.7</version>
    <relativePath/>
  </parent>
</project>`;
    const dest = path.join(tmpDir, 'pom.xml');
    fs.writeFileSync(dest, pomContent);

    // Simulate the hotfix stamp: empty versions map, rootArtifactId = "spring-cloud-build"
    updatePomFile(dest, false, '5.0.2.1-SNAPSHOT', {}, '5.0.2', 'spring-cloud-build');

    const written = fs.readFileSync(dest, 'utf-8');
    const parentBlock = written.match(/<parent>[\s\S]*?<\/parent>/)[0];
    // Parent version must remain 4.0.7 — NOT be stamped with 5.0.2.1-SNAPSHOT
    expect(parentBlock).toContain('<version>4.0.7</version>');
    // Own <version> should be updated (matches currentRootVersion)
    expect(written).toMatch(/<artifactId>spring-cloud-build-dependencies<\/artifactId>\s*<version>5\.0\.2\.1-SNAPSHOT<\/version>/);
  });

  it('still stamps projectVersion onto a genuine child-of-root parent when rootArtifactId is provided', () => {
    const src = fixturePath('maven-multi', 'spring-cloud-config-server', 'pom.xml');
    const dest = path.join(tmpDir, 'pom.xml');
    fs.copyFileSync(src, dest);

    // root artifactId matches the parent of this child module
    updatePomFile(dest, false, '4.1.1', {}, null, 'spring-cloud-config');

    const written = fs.readFileSync(dest, 'utf-8');
    const parentBlock = written.match(/<parent>[\s\S]*?<\/parent>/)[0];
    expect(parentBlock).toContain('<version>4.1.1</version>');
  });

});

// ── isChildOfRoot ─────────────────────────────────────────────────────────────

describe('isChildOfRoot', () => {
  const makeProject = (parentArtifactId) => ({ parent: { artifactId: parentArtifactId } });

  it('returns true when parent matches rootArtifactId exactly', () => {
    expect(isChildOfRoot(makeProject('spring-cloud-config'), {}, 'spring-cloud-config')).toBe(true);
  });

  it('returns true when parent matches the stripped rootArtifactId', () => {
    // root is spring-cloud-foo-parent → stripped → spring-cloud-foo; parent is spring-cloud-foo-parent
    expect(isChildOfRoot(makeProject('spring-cloud-foo-parent'), {}, 'spring-cloud-foo-parent')).toBe(true);
  });

  it('returns false for spring-boot-dependencies when rootArtifactId is known', () => {
    // The exact case from spring-cloud-build-commercial: spring-cloud-build-dependencies
    // has spring-boot-dependencies as parent; root is spring-cloud-build.
    expect(isChildOfRoot(makeProject('spring-boot-dependencies'), {}, 'spring-cloud-build')).toBe(false);
  });

  it('returns false for spring-boot-starter-parent when rootArtifactId is known', () => {
    expect(isChildOfRoot(makeProject('spring-boot-starter-parent'), {}, 'spring-cloud-build')).toBe(false);
  });

  it('returns false for spring-cloud-dependencies-parent when rootArtifactId is known and versions map is empty', () => {
    expect(isChildOfRoot(makeProject('spring-cloud-dependencies-parent'), {}, 'spring-cloud-config')).toBe(false);
  });

  it('returns false when parent is in the versions map regardless of rootArtifactId', () => {
    expect(isChildOfRoot(makeProject('spring-cloud-config'), { 'spring-cloud-config': '4.2.0' }, 'spring-cloud-config')).toBe(false);
  });

  it('falls back to the old heuristic (not-in-versions-map) when rootArtifactId is null', () => {
    // Without rootArtifactId, any parent absent from the map is treated as root
    expect(isChildOfRoot(makeProject('spring-boot-starter-parent'), {}, null)).toBe(true);
  });

  it('returns false with no parent element', () => {
    expect(isChildOfRoot({}, {}, 'spring-cloud-config')).toBe(false);
  });
});

// ── findFiles ──────────────────────────────────────────────────────────────────

describe('findFiles', () => {
  it('finds pom.xml files in a multi-module project', () => {
    const files = findFiles(fixturePath('maven-multi'), 'pom.xml');
    expect(files.length).toBe(2);
    expect(files.some((f) => f.endsWith('pom.xml') && !f.includes('spring-cloud-config-server'))).toBe(true);
    expect(files.some((f) => f.includes('spring-cloud-config-server'))).toBe(true);
  });

  it('finds gradle.properties in a gradle project', () => {
    const files = findFiles(fixturePath('gradle-project'), 'gradle.properties');
    expect(files.length).toBe(1);
  });

  it('finds build.gradle files', () => {
    const files = findFiles(fixturePath('gradle-project'), 'build.gradle');
    expect(files.length).toBe(1);
  });
});

// ── releaseTrainVersionToFileName ─────────────────────────────────────────────

describe('releaseTrainVersionToFileName', () => {
  it('converts a three-part GA version', () => {
    expect(releaseTrainVersionToFileName('2025.1.0')).toBe('2025_1_0.properties');
  });

  it('converts a version with a patch number greater than zero', () => {
    expect(releaseTrainVersionToFileName('2023.0.3')).toBe('2023_0_3.properties');
  });

  it('converts a version with double-digit segments', () => {
    expect(releaseTrainVersionToFileName('2024.0.10')).toBe('2024_0_10.properties');
  });

  it('converts a four-part hotfix GA version', () => {
    expect(releaseTrainVersionToFileName('2025.1.2.1')).toBe('2025_1_2_1.properties');
  });

  it('normalizes uppercase -SNAPSHOT suffix to lowercase', () => {
    expect(releaseTrainVersionToFileName('2025.1.2.1-SNAPSHOT')).toBe('2025_1_2_1-snapshot.properties');
  });

  it('preserves lowercase -snapshot suffix unchanged', () => {
    expect(releaseTrainVersionToFileName('2025.1.2.1-snapshot')).toBe('2025_1_2_1-snapshot.properties');
  });

  it('normalizes uppercase -RC1 suffix to lowercase', () => {
    expect(releaseTrainVersionToFileName('2025.1.2.1-RC1')).toBe('2025_1_2_1-rc1.properties');
  });
});

// ── getReleaserConfigUrl ──────────────────────────────────────────────────────

describe('getReleaserConfigUrl', () => {
  it('builds the OSS URL when commercial=false', () => {
    const url = getReleaserConfigUrl(false, '2025.1.0');
    expect(url).toBe(
      'https://raw.githubusercontent.com/spring-cloud/spring-cloud-release/jenkins-releaser-config/2025_1_0.properties'
    );
  });

  it('builds the commercial URL when commercial=true', () => {
    const url = getReleaserConfigUrl(true, '2025.1.0');
    expect(url).toBe(
      'https://raw.githubusercontent.com/spring-cloud/spring-cloud-release-commercial/jenkins-releaser-config/2025_1_0.properties'
    );
  });
});

// ── fetchReleaserConfig ───────────────────────────────────────────────────────

describe('fetchReleaserConfig', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the response text on success', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => 'releaser.fixed-versions[spring-boot]=4.0.0\n',
    });
    const result = await fetchReleaserConfig('https://example.com/config.properties', 'my-token');
    expect(result).toBe('releaser.fixed-versions[spring-boot]=4.0.0\n');
  });

  it('sends the Authorization header when a token is provided', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '',
    });
    await fetchReleaserConfig('https://example.com/config.properties', 'test-token');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/config.properties',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
    );
  });

  it('throws on a 404 response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    await expect(fetchReleaserConfig('https://example.com/missing.properties', '')).rejects.toThrow(
      'HTTP 404'
    );
  });

  it('includes an access hint on 401/403 responses', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });
    await expect(fetchReleaserConfig('https://example.com/private.properties', '')).rejects.toThrow(
      'ensure the token has read access'
    );
  });
});

// ── parseReleaserConfig ───────────────────────────────────────────────────────

describe('parseReleaserConfig', () => {
  it('parses the fixture file correctly', () => {
    const content = loadFixture('releaser-config', '2025_1_0.properties');
    const versions = parseReleaserConfig(content);
    expect(versions['spring-boot']).toBe('4.0.0');
    expect(versions['spring-cloud-config']).toBe('5.0.0');
    expect(versions['spring-cloud-release']).toBe('2025.1.0');
  });

  it('ignores blank lines and non-fixed-versions lines', () => {
    const content = `
# a comment
some.other.property=value
releaser.fixed-versions[spring-boot]=3.2.3
releaser.fixed-versions[spring-cloud-config]=4.1.1
`;
    const versions = parseReleaserConfig(content);
    expect(Object.keys(versions)).toHaveLength(2);
    expect(versions['spring-boot']).toBe('3.2.3');
    expect(versions['spring-cloud-config']).toBe('4.1.1');
  });

  it('trims whitespace from project names and versions', () => {
    const content = `releaser.fixed-versions[spring-boot]=3.2.3 \n`;
    const versions = parseReleaserConfig(content);
    expect(versions['spring-boot']).toBe('3.2.3');
  });

  it('returns an empty map when no fixed-versions entries are present', () => {
    expect(parseReleaserConfig('# no versions here\n')).toEqual({});
  });

  it('adds substitution entries from the versions map', () => {
    const content = `
releaser.fixed-versions[spring-cloud-contract]=4.1.0
releaser.fixed-versions[spring-boot]=3.2.3
`;
    const versions = parseReleaserConfig(content, { verifier: 'spring-cloud-contract' });
    expect(versions['verifier']).toBe('4.1.0');
    expect(versions['spring-cloud-contract']).toBe('4.1.0');
  });

  it('silently ignores substitutions whose value is not in the versions map', () => {
    const content = `releaser.fixed-versions[spring-boot]=3.2.3\n`;
    const versions = parseReleaserConfig(content, { verifier: 'spring-cloud-contract' });
    expect(versions['verifier']).toBeUndefined();
  });
});

// ── detectProjectName ─────────────────────────────────────────────────────────

describe('detectProjectName', () => {
  it('reads the artifactId from the root pom.xml', () => {
    const name = detectProjectName(fixturePath('maven-single'));
    expect(name).toBe('spring-cloud-config');
  });

  it('strips -parent suffix from the artifactId', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-project-test-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'pom.xml'),
        '<project><artifactId>spring-cloud-task-parent</artifactId></project>'
      );
      expect(detectProjectName(tmpDir)).toBe('spring-cloud-task');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws when no pom.xml is present in the directory', () => {
    expect(() => detectProjectName(fixturePath('gradle-project'))).toThrow(
      'No root pom.xml found'
    );
  });

  it('throws when the pom.xml has no artifactId', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-project-test-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'pom.xml'),
        '<project><modelVersion>4.0.0</modelVersion></project>'
      );
      expect(() => detectProjectName(tmpDir)).toThrow('no <artifactId> found');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
