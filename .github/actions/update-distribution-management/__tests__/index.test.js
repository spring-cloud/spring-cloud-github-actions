'use strict';

jest.mock('@actions/core');
jest.mock('@actions/exec');

const core = require('@actions/core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildDistEntry,
  updateDistMgmt,
  removeCentralPlugin,
  updateGradlePublishTask,
  updateMavenConfig,
  processFile,
  DIST_RELEASE,
  DIST_SNAPSHOT,
} = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  core.info.mockImplementation(() => {});
  core.warning.mockImplementation(() => {});
  core.setFailed.mockImplementation(() => {});
  core.setSecret.mockImplementation(() => {});
});

// ── buildDistEntry ───────────────────────────────────────────────────────────

describe('buildDistEntry', () => {
  test('builds a release repository entry', () => {
    const result = buildDistEntry(DIST_RELEASE, '  ');
    expect(result).toContain('<repository>');
    expect(result).toContain('spring-commercial-release');
    expect(result).toContain('https://usw1.packages.broadcom.com');
  });

  test('builds a snapshot repository entry', () => {
    const result = buildDistEntry(DIST_SNAPSHOT, '  ');
    expect(result).toContain('<snapshotRepository>');
    expect(result).toContain('spring-commercial-snapshot');
  });

  test('uses provided indent for outer tag', () => {
    const result = buildDistEntry(DIST_RELEASE, '\t\t');
    expect(result).toMatch(/^\t\t\t<repository>/m);
  });
});

// ── updateDistMgmt ────────────────────────────────────────────────────────────

describe('updateDistMgmt', () => {
  const apacheDistMgmt = `<project>
  <distributionManagement>
    <repository>
      <id>ossrh</id>
      <url>https://oss.sonatype.org/service/local/staging/deploy/maven2/</url>
    </repository>
    <snapshotRepository>
      <id>ossrh</id>
      <url>https://oss.sonatype.org/content/repositories/snapshots</url>
    </snapshotRepository>
  </distributionManagement>
</project>`;

  test('replaces repository and snapshotRepository with Broadcom entries', () => {
    const result = updateDistMgmt(apacheDistMgmt);
    expect(result).toContain('spring-commercial-release');
    expect(result).toContain('spring-commercial-snapshot');
    expect(result).not.toContain('ossrh');
    expect(result).not.toContain('sonatype.org');
  });

  test('is idempotent — skips already-updated blocks', () => {
    const already = `<distributionManagement>
  <repository>
    <id>spring-commercial-release</id>
    <url>https://usw1.packages.broadcom.com/artifactory/spring-enterprise-maven-prod-local</url>
  </repository>
</distributionManagement>`;
    expect(updateDistMgmt(already)).toBe(already);
  });

  test('skips distributionManagement blocks without repository tags', () => {
    const noRepos = '<distributionManagement>remove</distributionManagement>';
    expect(updateDistMgmt(noRepos)).toBe(noRepos);
  });
});

// ── removeCentralPlugin ───────────────────────────────────────────────────────

describe('removeCentralPlugin', () => {
  const withCentralPlugin = `<project>
  <build>
    <plugins>
      <plugin>
        <groupId>org.sonatype.central</groupId>
        <artifactId>central-publishing-maven-plugin</artifactId>
        <version>0.4.0</version>
      </plugin>
    </plugins>
  </build>
</project>`;

  test('removes central-publishing-maven-plugin block', () => {
    const result = removeCentralPlugin(withCentralPlugin);
    expect(result).not.toContain('central-publishing-maven-plugin');
    expect(result).not.toContain('<plugins>');
    expect(result).not.toContain('<build>');
  });

  test('preserves other plugins', () => {
    const withTwo = `<build>
  <plugins>
    <plugin>
      <artifactId>central-publishing-maven-plugin</artifactId>
    </plugin>
    <plugin>
      <artifactId>maven-compiler-plugin</artifactId>
    </plugin>
  </plugins>
</build>`;
    const result = removeCentralPlugin(withTwo);
    expect(result).not.toContain('central-publishing-maven-plugin');
    expect(result).toContain('maven-compiler-plugin');
    expect(result).toContain('<plugins>');
  });

  test('leaves content unchanged when no central plugin', () => {
    const noCentral = '<build><plugins><plugin><artifactId>maven-jar-plugin</artifactId></plugin></plugins></build>';
    expect(removeCentralPlugin(noCentral)).toBe(noCentral);
  });
});

// ── updateGradlePublishTask ───────────────────────────────────────────────────

describe('updateGradlePublishTask', () => {
  test('changes publishPlugins to build', () => {
    const input = '<gradle.publish-plugins.task>publishPlugins</gradle.publish-plugins.task>';
    const result = updateGradlePublishTask(input);
    expect(result).toContain('>build<');
    expect(result).not.toContain('publishPlugins');
  });

  test('leaves other content unchanged', () => {
    const input = '<gradle.publish-plugins.task>build</gradle.publish-plugins.task>';
    expect(updateGradlePublishTask(input)).toBe(input);
  });
});

// ── updateMavenConfig ─────────────────────────────────────────────────────────

describe('updateMavenConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-mgmt-test-'));
    fs.mkdirSync(path.join(tmpDir, '.mvn'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('removes -DaltSnapshotDeploymentRepository from maven.config', () => {
    const configPath = path.join(tmpDir, '.mvn', 'maven.config');
    fs.writeFileSync(configPath, '-B -DaltSnapshotDeploymentRepository=foo::bar\n');
    const changed = updateMavenConfig(tmpDir);
    expect(changed).toBe(true);
    const result = fs.readFileSync(configPath, 'utf-8');
    expect(result).not.toContain('-DaltSnapshotDeploymentRepository');
    expect(result).toContain('-B');
  });

  test('removes bare -DaltSnapshotDeploymentRepository', () => {
    const configPath = path.join(tmpDir, '.mvn', 'maven.config');
    fs.writeFileSync(configPath, '-DaltSnapshotDeploymentRepository\n--batch-mode\n');
    const changed = updateMavenConfig(tmpDir);
    expect(changed).toBe(true);
    const result = fs.readFileSync(configPath, 'utf-8');
    expect(result).toContain('--batch-mode');
  });

  test('returns false when maven.config does not exist', () => {
    expect(updateMavenConfig(tmpDir + '/nonexistent')).toBe(false);
  });

  test('returns false when flag is not present', () => {
    const configPath = path.join(tmpDir, '.mvn', 'maven.config');
    fs.writeFileSync(configPath, '-B --batch-mode\n');
    expect(updateMavenConfig(tmpDir)).toBe(false);
  });
});

// ── processFile ──────────────────────────────────────────────────────────────

describe('processFile', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-mgmt-file-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('processes a pom.xml with distributionManagement', () => {
    const content = `<project>
  <distributionManagement>
    <repository>
      <id>ossrh</id>
      <url>https://oss.sonatype.org/service/local/staging/deploy/maven2/</url>
    </repository>
    <snapshotRepository>
      <id>ossrh-snapshot</id>
      <url>https://oss.sonatype.org/snapshots</url>
    </snapshotRepository>
  </distributionManagement>
</project>`;
    const filePath = path.join(tmpDir, 'pom.xml');
    fs.writeFileSync(filePath, content);
    expect(processFile(filePath)).toBe(true);
    const updated = fs.readFileSync(filePath, 'utf-8');
    expect(updated).toContain('spring-commercial-release');
  });

  test('skips .gradle files', () => {
    const filePath = path.join(tmpDir, 'build.gradle');
    fs.writeFileSync(filePath, 'distributionManagement {}');
    expect(processFile(filePath)).toBe(false);
  });

  test('returns false when no changes needed', () => {
    const content = `<project><name>unchanged</name></project>`;
    const filePath = path.join(tmpDir, 'pom.xml');
    fs.writeFileSync(filePath, content);
    expect(processFile(filePath)).toBe(false);
  });
});
