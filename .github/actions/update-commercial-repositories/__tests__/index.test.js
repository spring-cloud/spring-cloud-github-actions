'use strict';

jest.mock('@actions/core');
jest.mock('@actions/exec');

const core = require('@actions/core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildPomBlock,
  updatePom,
  findBraceEnd,
  buildGradleMavenEntries,
  processGradleBlock,
  updateGradle,
  processFile,
  lookupProjectOverride,
  COMMERCIAL_REPOS,
} = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  core.info.mockImplementation(() => {});
  core.warning.mockImplementation(() => {});
  core.setFailed.mockImplementation(() => {});
  core.setSecret.mockImplementation(() => {});
});

// ── buildPomBlock ─────────────────────────────────────────────────────────────

describe('buildPomBlock', () => {
  test('builds repositories block with all four commercial repos', () => {
    const result = buildPomBlock('repositories', '  ');
    expect(result).toMatch(/^  <repositories>/);
    expect(result).toMatch(/<\/repositories>$/);
    COMMERCIAL_REPOS.forEach(r => {
      expect(result).toContain(`<id>${r.id}</id>`);
    });
  });

  test('builds pluginRepositories block', () => {
    const result = buildPomBlock('pluginRepositories', '');
    expect(result).toContain('<pluginRepository>');
    expect(result).toContain('</pluginRepository>');
  });

  test('includes preserved entries', () => {
    const preserved = ['<repository><id>spring-milestones</id></repository>'];
    const result = buildPomBlock('repositories', '', preserved);
    expect(result).toContain('spring-milestones');
  });

  test('includes snapshots/releases enabled elements', () => {
    const result = buildPomBlock('repositories', '');
    expect(result).toContain('<snapshots>');
    expect(result).toContain('<enabled>true</enabled>');
    expect(result).toContain('<enabled>false</enabled>');
  });
});

// ── updatePom ─────────────────────────────────────────────────────────────────

describe('updatePom', () => {
  const withOldRepos = `<project>
  <repositories>
    <repository>
      <id>spring-releases</id>
      <url>https://repo.spring.io/release</url>
    </repository>
  </repositories>
</project>`;

  test('replaces old repo.spring.io URLs with commercial repos', () => {
    const result = updatePom(withOldRepos);
    COMMERCIAL_REPOS.forEach(r => {
      expect(result).toContain(r.url);
    });
    expect(result).not.toContain('spring-releases');
    expect(result).not.toContain('repo.spring.io/release');
  });

  test('is idempotent — skips already-updated blocks', () => {
    const alreadyUpdated = updatePom(withOldRepos);
    expect(updatePom(alreadyUpdated)).toBe(alreadyUpdated);
  });

  test('leaves blocks without old spring.io URLs unchanged', () => {
    const noOld = `<project><repositories><repository><id>central</id><url>https://repo.maven.apache.org/maven2</url></repository></repositories></project>`;
    expect(updatePom(noOld)).toBe(noOld);
  });

  test('preserves specified repository IDs', () => {
    const content = `<project>
  <repositories>
    <repository>
      <id>spring-milestones</id>
      <url>https://repo.spring.io/milestone</url>
    </repository>
  </repositories>
</project>`;
    const result = updatePom(content, new Set(['spring-milestones']));
    expect(result).toContain('spring-milestones');
    COMMERCIAL_REPOS.forEach(r => expect(result).toContain(r.url));
  });

  test('updates pluginRepositories as well', () => {
    const withPlugin = `<project>
  <pluginRepositories>
    <pluginRepository>
      <id>spring-plugin</id>
      <url>https://repo.spring.io/plugins-release</url>
    </pluginRepository>
  </pluginRepositories>
</project>`;
    const result = updatePom(withPlugin);
    expect(result).toContain('<pluginRepository>');
    COMMERCIAL_REPOS.forEach(r => expect(result).toContain(r.url));
  });

  describe('keepOssRepositories', () => {
    const mixed = `<project>
  <repositories>
    <repository>
      <id>spring-snapshots</id>
      <url>https://repo.spring.io/libs-snapshot-local</url>
      <snapshots>
        <enabled>true</enabled>
      </snapshots>
    </repository>
    <repository>
      <id>spring-milestones</id>
      <url>https://repo.spring.io/libs-milestone-local</url>
    </repository>
    <repository>
      <id>internal-mirror</id>
      <url>https://nexus.example.com/maven</url>
    </repository>
  </repositories>
  <pluginRepositories>
    <pluginRepository>
      <id>spring-snapshots</id>
      <url>https://repo.spring.io/libs-snapshot-local</url>
    </pluginRepository>
  </pluginRepositories>
</project>`;

    test('is off by default: OSS repo.spring.io entries are dropped', () => {
      const result = updatePom(mixed);
      expect(result).not.toContain('libs-snapshot-local');
      expect(result).not.toContain('libs-milestone-local');
    });

    test('keeps the old repo.spring.io entries in both block types', () => {
      const result = updatePom(mixed, new Set(), false, true);
      expect(result.match(/libs-snapshot-local/g)).toHaveLength(2);
      expect(result.match(/libs-milestone-local/g)).toHaveLength(1);
      COMMERCIAL_REPOS.forEach(r => expect(result).toContain(r.url));
    });

    test('puts the commercial repos before the kept OSS ones', () => {
      const result = updatePom(mixed, new Set(), false, true);
      const firstBlock = result.slice(0, result.indexOf('</repositories>'));
      expect(firstBlock.indexOf('spring-enterprise-maven-prod-local'))
        .toBeLessThan(firstBlock.indexOf('libs-snapshot-local'));
    });

    test('does not keep entries that are not repo.spring.io', () => {
      const result = updatePom(mixed, new Set(), false, true);
      expect(result).not.toContain('nexus.example.com');
    });

    test('is idempotent', () => {
      const once = updatePom(mixed, new Set(), false, true);
      expect(updatePom(once, new Set(), false, true)).toBe(once);
    });

    test('does not declare spring-snapshots twice alongside includeSnapshotRepo', () => {
      const result = updatePom(mixed, new Set(), true, true);
      const firstBlock = result.slice(0, result.indexOf('</repositories>'));
      expect(firstBlock.match(/<id>spring-snapshots<\/id>/g)).toHaveLength(1);
      expect(firstBlock).toContain('https://repo.spring.io/snapshot');
      expect(firstBlock).not.toContain('libs-snapshot-local');
    });

    describe('id collision with a commercial repository', () => {
      const clash = `<project>
  <repositories>
    <repository>
      <id>spring-commercial-release</id>
      <url>https://repo.spring.io/release</url>
    </repository>
  </repositories>
</project>`;

      test('throws, naming the id, the block and the URL', () => {
        expect(() => updatePom(clash, new Set(), false, true))
          .toThrow(/<repositories> entry 'spring-commercial-release' \(https:\/\/repo\.spring\.io\/release\)/);
      });

      test('throws for a pluginRepository too', () => {
        const plugin = clash
          .replace(/repositories>/g, 'pluginRepositories>')
          .replace(/repository>/g, 'pluginRepository>');
        expect(() => updatePom(plugin, new Set(), false, true)).toThrow(/<pluginRepositories> entry/);
      });

      test('does not throw when the OSS entries are being dropped anyway', () => {
        expect(() => updatePom(clash)).not.toThrow();
      });

      test('does not throw for the same id on a non-OSS URL, which is dropped', () => {
        const nonOss = clash.replace('https://repo.spring.io/release', 'https://nexus.example.com/maven');
        expect(() => updatePom(nonOss, new Set(), false, true)).not.toThrow();
      });
    });

    test('does not duplicate an entry that is also in preserveIds', () => {
      const result = updatePom(mixed, new Set(['spring-milestones']), false, true);
      expect(result.match(/<id>spring-milestones<\/id>/g)).toHaveLength(1);
    });
  });
});

// ── findBraceEnd ──────────────────────────────────────────────────────────────

describe('findBraceEnd', () => {
  test('finds matching closing brace', () => {
    const text = 'maven { url "foo" }';
    expect(findBraceEnd(text, 6)).toBe(18);
  });

  test('handles nested braces', () => {
    const text = 'repositories { maven { url "foo" } }';
    // outer '{' is at index 13; its matching '}' is at the end (index 35)
    expect(findBraceEnd(text, 13)).toBe(35);
  });

  test('returns -1 for unmatched brace', () => {
    const text = 'maven { url "foo"';
    expect(findBraceEnd(text, 6)).toBe(-1);
  });
});

// ── processGradleBlock ────────────────────────────────────────────────────────

describe('processGradleBlock', () => {
  const blockWithOldRepo =
    "\n    maven { url 'https://repo.spring.io/release' }\n";

  test('replaces old maven block with commercial repos', () => {
    const [newBody, changed] = processGradleBlock(blockWithOldRepo, '    ', false);
    expect(changed).toBe(true);
    COMMERCIAL_REPOS.forEach(r => expect(newBody).toContain(r.url));
    expect(newBody).not.toContain('repo.spring.io/release');
  });

  test('adds credentials when withCredentials=true', () => {
    const [newBody, changed] = processGradleBlock(blockWithOldRepo, '    ', false, false, true);
    expect(changed).toBe(true);
    expect(newBody).toContain('credentials');
    expect(newBody).toContain('ARTIFACTORY_USERNAME');
  });

  test('returns unchanged when block has commercial URLs already', () => {
    const blockWithCommercial =
      `\n    maven { url '${COMMERCIAL_REPOS[0].url}' }\n`;
    const [, changed] = processGradleBlock(blockWithCommercial, '    ', false);
    expect(changed).toBe(false);
  });

  test('force-adds repos when forceAdd=true and no spring.io URL in block', () => {
    const emptyBlock = '\n    mavenCentral()\n';
    const [newBody, changed] = processGradleBlock(emptyBlock, '    ', false, true);
    expect(changed).toBe(true);
    COMMERCIAL_REPOS.forEach(r => expect(newBody).toContain(r.url));
  });
});

// ── updateGradle ──────────────────────────────────────────────────────────────

describe('updateGradle', () => {
  const gradleContent = `
repositories {
    maven { url 'https://repo.spring.io/release' }
    mavenCentral()
}
`;

  test('replaces spring.io maven block with commercial repos', () => {
    const [result, changed] = updateGradle(gradleContent, false);
    expect(changed).toBe(true);
    COMMERCIAL_REPOS.forEach(r => expect(result).toContain(r.url));
  });

  test('uses Kotlin DSL syntax when isKotlin=true', () => {
    const kts = `\nrepositories {\n    maven { url = uri("https://repo.spring.io/release") }\n}\n`;
    const [result, changed] = updateGradle(kts, true);
    expect(changed).toBe(true);
    expect(result).toContain('uri(');
  });

  test('force-adds commercial repos to buildscript repositories when file has spring.io', () => {
    const withBuildscript = `
buildscript {
    repositories {
        mavenCentral()
    }
}
repositories {
    maven { url 'https://repo.spring.io/milestone' }
}
`;
    const [result, changed] = updateGradle(withBuildscript, false);
    expect(changed).toBe(true);
    // Commercial repos should appear in the buildscript repositories too
    expect(result.indexOf(COMMERCIAL_REPOS[0].url)).toBeGreaterThan(-1);
  });
});

// ── lookupProjectOverride ─────────────────────────────────────────────────────

describe('lookupProjectOverride', () => {
  test('finds spring-cloud-contract override', () => {
    expect(lookupProjectOverride('spring-cloud-contract')).toBeInstanceOf(Function);
  });

  test('finds spring-cloud-contract-commercial override', () => {
    expect(lookupProjectOverride('spring-cloud-contract-commercial')).toBeInstanceOf(Function);
  });

  test('returns null for projects without overrides', () => {
    expect(lookupProjectOverride('spring-cloud-config')).toBeNull();
  });
});

// ── processFile ───────────────────────────────────────────────────────────────

describe('processFile', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commercial-repos-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('reports the file and leaves it unwritten when a kept OSS id collides with a commercial one', () => {
    const content = `<project>
  <repositories>
    <repository>
      <id>spring-commercial-snapshot</id>
      <url>https://repo.spring.io/libs-snapshot-local</url>
    </repository>
  </repositories>
</project>`;
    const filePath = path.join(tmpDir, 'pom.xml');
    fs.writeFileSync(filePath, content);
    expect(() => processFile(filePath, new Set(), new Set(), false, false, true))
      .toThrow(new RegExp(`${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: <repositories> entry 'spring-commercial-snapshot'`));
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(content);
  });

  test('updates a pom.xml with old spring.io repos', () => {
    const content = `<project>
  <repositories>
    <repository>
      <id>spring-releases</id>
      <url>https://repo.spring.io/release</url>
    </repository>
  </repositories>
</project>`;
    const filePath = path.join(tmpDir, 'pom.xml');
    fs.writeFileSync(filePath, content);
    expect(processFile(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toContain(COMMERCIAL_REPOS[0].url);
  });

  test('updates a build.gradle with old spring.io maven block', () => {
    const content = `repositories {\n    maven { url 'https://repo.spring.io/release' }\n}\n`;
    const filePath = path.join(tmpDir, 'build.gradle');
    fs.writeFileSync(filePath, content);
    expect(processFile(filePath)).toBe(true);
  });

  test('skips file already in updatedSet', () => {
    const filePath = path.join(tmpDir, 'pom.xml');
    fs.writeFileSync(filePath, `<repositories><repository><url>https://repo.spring.io/release</url></repository></repositories>`);
    expect(processFile(filePath, new Set([filePath]))).toBe(false);
  });

  test('skips unknown file extensions', () => {
    const filePath = path.join(tmpDir, 'build.sh');
    fs.writeFileSync(filePath, 'curl https://repo.spring.io/release');
    expect(processFile(filePath)).toBe(false);
  });
});
