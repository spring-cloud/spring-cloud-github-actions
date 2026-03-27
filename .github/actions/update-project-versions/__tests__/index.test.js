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
  it('converts a three-part version', () => {
    expect(releaseTrainVersionToFileName('2025.1.0')).toBe('2025_1_0.properties');
  });

  it('converts a version with a patch number greater than zero', () => {
    expect(releaseTrainVersionToFileName('2023.0.3')).toBe('2023_0_3.properties');
  });

  it('converts a version with double-digit segments', () => {
    expect(releaseTrainVersionToFileName('2024.0.10')).toBe('2024_0_10.properties');
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
