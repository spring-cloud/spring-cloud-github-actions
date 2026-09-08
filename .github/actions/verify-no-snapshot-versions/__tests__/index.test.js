const fs = require('fs');
const path = require('path');
const {
  isPreRelease,
  looksLikeVersion,
  isVersionKey,
  extractVersionCheckOffAnnotations,
  checkPomContent,
  checkGradlePropertiesContent,
  checkBuildGradleContent,
  findFiles,
} = require('../src/index');

const fixturePath = (name) => path.join(__dirname, 'fixtures', name);
const loadFixture = (name) => fs.readFileSync(fixturePath(name), 'utf-8');

// ─── isPreRelease ────────────────────────────────────────────────────────────

describe('isPreRelease', () => {
  it('returns false for a plain release version', () => {
    expect(isPreRelease('4.2.0')).toBe(false);
  });

  it('returns false for a release train version (year-based)', () => {
    expect(isPreRelease('2023.0.1')).toBe(false);
  });

  it('returns true for a SNAPSHOT version', () => {
    expect(isPreRelease('4.2.0-SNAPSHOT')).toBe(true);
  });

  it('returns true for a SNAPSHOT version regardless of case', () => {
    expect(isPreRelease('4.2.0-snapshot')).toBe(true);
  });

  it('returns true for a milestone version -M1', () => {
    expect(isPreRelease('4.2.0-M1')).toBe(true);
  });

  it('returns true for a milestone version -M12', () => {
    expect(isPreRelease('4.2.0-M12')).toBe(true);
  });

  it('returns true for a release candidate -RC1', () => {
    expect(isPreRelease('3.3.0-RC1')).toBe(true);
  });

  it('returns true for a release candidate -RC2', () => {
    expect(isPreRelease('3.3.0-RC2')).toBe(true);
  });

  it('returns false for a version that merely contains digits (e.g. 3.0.0)', () => {
    expect(isPreRelease('3.0.0')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isPreRelease('')).toBe(false);
  });
});

// ─── isPreRelease with allow-prerelease ──────────────────────────────────────
// A milestone or release-candidate build legitimately mixes -M<n>, -RC<n> and GA
// versions, so those are permitted; -SNAPSHOT never is.

describe('isPreRelease with allowPrerelease', () => {
  it('still rejects -SNAPSHOT', () => {
    expect(isPreRelease('4.2.0-SNAPSHOT', true)).toBe(true);
  });

  it('still rejects -SNAPSHOT whatever its casing', () => {
    expect(isPreRelease('4.2.0-snapshot', true)).toBe(true);
  });

  it('permits a milestone version', () => {
    expect(isPreRelease('4.2.0-M1', true)).toBe(false);
  });

  it('permits a release candidate version', () => {
    expect(isPreRelease('3.3.0-RC1', true)).toBe(false);
  });

  it('permits a milestone alongside a release candidate and a GA version', () => {
    for (const v of ['5.1.0-M1', '5.1.0-RC1', '4.2.3']) {
      expect(isPreRelease(v, true)).toBe(false);
    }
  });

  it('leaves GA versions alone', () => {
    expect(isPreRelease('4.2.0', true)).toBe(false);
  });
});

// ─── looksLikeVersion ────────────────────────────────────────────────────────

describe('looksLikeVersion', () => {
  it.each(['4.2.0', '4.2.0-SNAPSHOT', '2023.0.1-RC1', 'v1.2.3', '17'])(
    'returns true for %s',
    (value) => {
      expect(looksLikeVersion(value)).toBe(true);
    }
  );

  it.each([
    'https://repo.spring.io/libs-snapshot',
    'libs-snapshot',
    'org.example:my-lib:1.0.0',
    '${spring-boot.version}',
    'UTF-8 -M1',
    '',
  ])('returns false for %s', (value) => {
    expect(looksLikeVersion(value)).toBe(false);
  });
});

// ─── isVersionKey ────────────────────────────────────────────────────────────

describe('isVersionKey', () => {
  it.each([
    'version',
    'spring-boot.version',
    'spring-cloud-commons-version',
    'spring_boot_version',
    'springBootVersion',
  ])('returns true for %s', (key) => {
    expect(isVersionKey(key)).toBe(true);
  });

  it.each(['url', 'repo.url', 'project.build.sourceEncoding', 'versions'])(
    'returns false for %s',
    (key) => {
      expect(isVersionKey(key)).toBe(false);
    }
  );
});

// ─── checkPomContent ─────────────────────────────────────────────────────────

describe('checkPomContent', () => {
  describe('with a clean pom', () => {
    it('returns no violations', () => {
      expect(checkPomContent(loadFixture('clean-pom.xml'))).toEqual([]);
    });
  });

  describe('with a SNAPSHOT pom', () => {
    let violations;

    beforeAll(() => {
      violations = checkPomContent(loadFixture('snapshot-pom.xml'));
    });

    it('detects the project SNAPSHOT version', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ location: '<version>', version: '4.2.0-SNAPSHOT' }),
        ])
      );
    });

    it('detects the parent SNAPSHOT version', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ location: '<parent><version>', version: '4.2.0-SNAPSHOT' }),
        ])
      );
    });

    it('detects a SNAPSHOT in <properties>', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            location: '<properties><spring-boot.version>',
            version: '3.3.0-SNAPSHOT',
          }),
        ])
      );
    });

    it('detects a SNAPSHOT in a direct <dependency>', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            location: expect.stringContaining('<dependencies><dependency>'),
            version: '3.3.0-SNAPSHOT',
          }),
        ])
      );
    });

    it('detects a SNAPSHOT in <dependencyManagement>', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            location: expect.stringContaining('<dependencyManagement>'),
            version: '4.2.0-SNAPSHOT',
          }),
        ])
      );
    });

    it('detects a SNAPSHOT in <build><plugins>', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            location: expect.stringContaining('<build><plugins>'),
            version: '3.3.0-SNAPSHOT',
          }),
        ])
      );
    });

    it('detects a SNAPSHOT in <build><pluginManagement>', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            location: expect.stringContaining('<build><pluginManagement>'),
            version: '3.13.0-SNAPSHOT',
          }),
        ])
      );
    });

    it('does NOT flag the clean spring-cloud-commons.version property', () => {
      const hasCleanFalsePositive = violations.some(
        (v) => v.location.includes('spring-cloud-commons.version') && v.version === '4.2.0'
      );
      expect(hasCleanFalsePositive).toBe(false);
    });
  });

  describe('with a milestone pom', () => {
    let violations;

    beforeAll(() => {
      violations = checkPomContent(loadFixture('milestone-pom.xml'));
    });

    it('detects a -M2 project version', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ location: '<version>', version: '4.2.0-M2' }),
        ])
      );
    });

    it('detects -M1 in spring-boot.version property', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            location: '<properties><spring-boot.version>',
            version: '3.3.0-M1',
          }),
        ])
      );
    });

    it('detects -M3 in spring-cloud-commons.version property', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            location: '<properties><spring-cloud-commons.version>',
            version: '4.2.0-M3',
          }),
        ])
      );
    });
  });

  describe('with a release candidate pom', () => {
    let violations;

    beforeAll(() => {
      violations = checkPomContent(loadFixture('rc-pom.xml'));
    });

    it('detects a -RC1 project version', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ location: '<version>', version: '4.2.0-RC1' }),
        ])
      );
    });

    it('detects -RC2 in spring-boot.version property', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            location: '<properties><spring-boot.version>',
            version: '3.3.0-RC2',
          }),
        ])
      );
    });

    it('detects -RC1 in spring-cloud-commons.version property', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            location: '<properties><spring-cloud-commons.version>',
            version: '4.2.0-RC1',
          }),
        ])
      );
    });
  });

  describe('with non-version properties', () => {
    it('does NOT flag release-valued properties regardless of key', () => {
      const xml = `<project>
        <version>4.2.0</version>
        <properties>
          <java.version>17</java.version>
          <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        </properties>
      </project>`;
      expect(checkPomContent(xml)).toEqual([]);
    });

    it('flags a pre-release value under a key that does not end in .version', () => {
      const xml = `<project>
        <version>4.2.0</version>
        <properties>
          <spring-cloud-commons-version>4.3.0-SNAPSHOT</spring-cloud-commons-version>
          <internal.tooling>1.2.0-RC1</internal.tooling>
        </properties>
      </project>`;
      const violations = checkPomContent(xml);
      expect(violations).toEqual(
        expect.arrayContaining([
          {
            location: '<properties><spring-cloud-commons-version>',
            version: '4.3.0-SNAPSHOT',
          },
          { location: '<properties><internal.tooling>', version: '1.2.0-RC1' },
        ])
      );
    });

    it('does NOT flag a URL property that happens to end in -snapshot', () => {
      const xml = `<project>
        <version>4.2.0</version>
        <properties>
          <repo.url>https://repo.spring.io/libs-snapshot</repo.url>
        </properties>
      </project>`;
      expect(checkPomContent(xml)).toEqual([]);
    });
  });

  describe('with pre-release versions nested outside the well-known locations', () => {
    let violations;

    beforeAll(() => {
      violations = checkPomContent(loadFixture('nested-snapshot-pom.xml'));
    });

    // The spring-cloud-function miss: a -SNAPSHOT pinned on a plugin's own
    // <dependencies> block, which a location-by-location check never visits.
    it('detects a SNAPSHOT in a <plugin><dependencies><dependency>', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          {
            location:
              '<build><plugins><plugin>[org.springframework.boot:spring-boot-maven-plugin]' +
              '<dependencies><dependency>[org.springframework.cloud:spring-cloud-function-adapter-gcp]<version>',
            version: '3.1.0-SNAPSHOT',
          },
        ])
      );
    });

    it('detects a SNAPSHOT in a <profile> dependency', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          {
            location:
              '<profiles><profile>[spring]<dependencies><dependency>[org.example:profile-only-dep]<version>',
            version: '9.9.9-SNAPSHOT',
          },
        ])
      );
    });

    it('detects a SNAPSHOT in <profile><properties>', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          {
            location: '<profiles><profile>[spring]<properties><spring-boot.version>',
            version: '3.5.0-SNAPSHOT',
          },
        ])
      );
    });

    it('detects a SNAPSHOT in a <build><extensions><extension>', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          {
            location: '<build><extensions><extension>[org.example:my-wagon]<version>',
            version: '1.0.0-SNAPSHOT',
          },
        ])
      );
    });

    it('detects a milestone in a <reporting> plugin', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          {
            location:
              '<reporting><plugins><plugin>[org.apache.maven.plugins:maven-javadoc-plugin]<version>',
            version: '3.6.0-M1',
          },
        ])
      );
    });

    it('detects a SNAPSHOT in a kebab-case version property', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          {
            location: '<properties><spring-cloud-commons-version>',
            version: '4.3.0-SNAPSHOT',
          },
        ])
      );
    });

    it('honours @releaser:version-check-off on the sample project version', () => {
      expect(violations.some((v) => v.version === '0.0.1-SNAPSHOT')).toBe(false);
    });

    it('does NOT flag the snapshot repository URL', () => {
      expect(violations.some((v) => String(v.version).startsWith('http'))).toBe(false);
    });
  });

  describe('with invalid XML', () => {
    it('returns no violations for unparseable content', () => {
      expect(checkPomContent('<not valid xml')).toEqual([]);
    });

    it('returns no violations when there is no <project> root', () => {
      expect(checkPomContent('<notaproject/>')).toEqual([]);
    });
  });

  describe('with @releaser:version-check-off annotations', () => {
    it('ignores a property annotated with @releaser:version-check-off', () => {
      const xml = `<project>
        <version>4.2.0</version>
        <properties>
          <maven-failsafe-plugin.version>3.0.0-M3</maven-failsafe-plugin.version> <!-- @releaser:version-check-off -->
          <spring-boot.version>3.3.0-SNAPSHOT</spring-boot.version>
        </properties>
      </project>`;
      const violations = checkPomContent(xml);
      expect(violations.some((v) => v.location.includes('maven-failsafe-plugin.version'))).toBe(false);
      expect(violations.some((v) => v.location.includes('spring-boot.version'))).toBe(true);
    });

    it('ignores an inline <version> in a dependency annotated with @releaser:version-check-off', () => {
      const xml = `<project>
        <version>4.2.0</version>
        <dependencies>
          <dependency>
            <groupId>org.example</groupId>
            <artifactId>ignored-dep</artifactId>
            <version>2.0.0-SNAPSHOT</version> <!-- @releaser:version-check-off -->
          </dependency>
          <dependency>
            <groupId>org.example</groupId>
            <artifactId>checked-dep</artifactId>
            <version>3.0.0-SNAPSHOT</version>
          </dependency>
        </dependencies>
      </project>`;
      const violations = checkPomContent(xml);
      expect(violations.some((v) => v.location.includes('ignored-dep'))).toBe(false);
      expect(violations.some((v) => v.location.includes('checked-dep'))).toBe(true);
    });

    it('ignores a plugin <version> annotated with @releaser:version-check-off', () => {
      const xml = `<project>
        <version>4.2.0</version>
        <build>
          <plugins>
            <plugin>
              <groupId>org.example</groupId>
              <artifactId>ignored-plugin</artifactId>
              <version>1.0.0-M1</version> <!-- @releaser:version-check-off -->
            </plugin>
          </plugins>
        </build>
      </project>`;
      const violations = checkPomContent(xml);
      expect(violations).toEqual([]);
    });
  });
});

// ─── extractVersionCheckOffAnnotations ──────────────────────────────────────

describe('extractVersionCheckOffAnnotations', () => {
  it('extracts annotated property key', () => {
    const xml = `<properties>
      <maven-failsafe-plugin.version>3.0.0-M3</maven-failsafe-plugin.version> <!-- @releaser:version-check-off -->
      <spring-boot.version>3.3.0</spring-boot.version>
    </properties>`;
    const { excludedPropertyKeys, excludedVersionValues } = extractVersionCheckOffAnnotations(xml);
    expect(excludedPropertyKeys.has('maven-failsafe-plugin.version')).toBe(true);
    expect(excludedPropertyKeys.has('spring-boot.version')).toBe(false);
    expect(excludedVersionValues.size).toBe(0);
  });

  it('extracts annotated version value', () => {
    const xml = `<dependency>
      <version>2.0.0-SNAPSHOT</version> <!-- @releaser:version-check-off -->
    </dependency>`;
    const { excludedPropertyKeys, excludedVersionValues } = extractVersionCheckOffAnnotations(xml);
    expect(excludedVersionValues.has('2.0.0-SNAPSHOT')).toBe(true);
    expect(excludedPropertyKeys.size).toBe(0);
  });

  it('returns empty sets when no annotations are present', () => {
    const xml = `<properties>
      <spring-boot.version>3.3.0</spring-boot.version>
    </properties>`;
    const { excludedPropertyKeys, excludedVersionValues } = extractVersionCheckOffAnnotations(xml);
    expect(excludedPropertyKeys.size).toBe(0);
    expect(excludedVersionValues.size).toBe(0);
  });
});

// ─── checkGradlePropertiesContent ───────────────────────────────────────────

describe('checkGradlePropertiesContent', () => {
  describe('with a clean gradle.properties', () => {
    it('returns no violations', () => {
      expect(checkGradlePropertiesContent(loadFixture('clean-gradle.properties'))).toEqual([]);
    });
  });

  describe('with a SNAPSHOT gradle.properties', () => {
    let violations;

    beforeAll(() => {
      violations = checkGradlePropertiesContent(loadFixture('snapshot-gradle.properties'));
    });

    it('detects a SNAPSHOT project version', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          { location: 'version', version: '4.2.0-SNAPSHOT' },
        ])
      );
    });

    it('detects SNAPSHOT in springBootVersion', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          { location: 'springBootVersion', version: '3.3.0-SNAPSHOT' },
        ])
      );
    });

    it('detects SNAPSHOT in springCloudBusVersion', () => {
      expect(violations).toEqual(
        expect.arrayContaining([
          { location: 'springCloudBusVersion', version: '4.2.0-SNAPSHOT' },
        ])
      );
    });

    it('does NOT flag clean springCloudCommonsVersion', () => {
      const hasFalsePositive = violations.some(
        (v) => v.location === 'springCloudCommonsVersion'
      );
      expect(hasFalsePositive).toBe(false);
    });

    it('does NOT flag non-version properties like java.version', () => {
      const hasFalsePositive = violations.some(
        (v) => v.location === 'java.version'
      );
      expect(hasFalsePositive).toBe(false);
    });
  });

  describe('with a milestone gradle.properties', () => {
    let violations;

    beforeAll(() => {
      violations = checkGradlePropertiesContent(loadFixture('milestone-gradle.properties'));
    });

    it('detects a -M1 project version', () => {
      expect(violations).toEqual(
        expect.arrayContaining([{ location: 'version', version: '4.2.0-M1' }])
      );
    });

    it('detects -M2 in springBootVersion', () => {
      expect(violations).toEqual(
        expect.arrayContaining([{ location: 'springBootVersion', version: '3.3.0-M2' }])
      );
    });
  });

  describe('with a release candidate gradle.properties', () => {
    let violations;

    beforeAll(() => {
      violations = checkGradlePropertiesContent(loadFixture('rc-gradle.properties'));
    });

    it('detects a -RC1 project version', () => {
      expect(violations).toEqual(
        expect.arrayContaining([{ location: 'version', version: '4.2.0-RC1' }])
      );
    });

    it('detects -RC2 in springBootVersion', () => {
      expect(violations).toEqual(
        expect.arrayContaining([{ location: 'springBootVersion', version: '3.3.0-RC2' }])
      );
    });
  });

  describe('with comment lines and blank lines', () => {
    it('ignores comment lines starting with #', () => {
      const content = '# This is a comment with 1.0.0-SNAPSHOT\nversion=4.2.0\n';
      expect(checkGradlePropertiesContent(content)).toEqual([]);
    });

    it('ignores blank lines', () => {
      const content = '\n\nversion=4.2.0\n\n';
      expect(checkGradlePropertiesContent(content)).toEqual([]);
    });
  });

  describe('with keys that do not end in Version', () => {
    it('flags a pre-release value under any key', () => {
      expect(checkGradlePropertiesContent('springCloud=2025.0.0-SNAPSHOT\n')).toEqual([
        { location: 'springCloud', version: '2025.0.0-SNAPSHOT' },
      ]);
    });

    it('does NOT flag a repository URL ending in -snapshot', () => {
      expect(
        checkGradlePropertiesContent('repo.url=https://repo.spring.io/libs-snapshot\n')
      ).toEqual([]);
    });

    it('honours a @releaser:version-check-off annotation on the line', () => {
      const content =
        'failsafeVersion=3.0.0-M3 # @releaser:version-check-off\nspringBootVersion=3.3.0-SNAPSHOT\n';
      expect(checkGradlePropertiesContent(content)).toEqual([
        { location: 'springBootVersion', version: '3.3.0-SNAPSHOT' },
      ]);
    });
  });
});

// ─── checkBuildGradleContent ─────────────────────────────────────────────────

describe('checkBuildGradleContent', () => {
  describe('with a clean build.gradle (Groovy)', () => {
    it('returns no violations', () => {
      expect(checkBuildGradleContent(loadFixture('clean-build.gradle'))).toEqual([]);
    });
  });

  describe('with a SNAPSHOT build.gradle', () => {
    it('detects a SNAPSHOT project version', () => {
      expect(checkBuildGradleContent(loadFixture('snapshot-build.gradle'))).toEqual([
        { location: 'version', version: '4.2.0-SNAPSHOT' },
      ]);
    });
  });

  describe('with a milestone build.gradle', () => {
    it('detects a -M1 project version', () => {
      expect(checkBuildGradleContent(loadFixture('milestone-build.gradle'))).toEqual([
        { location: 'version', version: '4.2.0-M1' },
      ]);
    });
  });

  describe('with a release candidate build.gradle', () => {
    it('detects a -RC1 project version', () => {
      expect(checkBuildGradleContent(loadFixture('rc-build.gradle'))).toEqual([
        { location: 'version', version: '4.2.0-RC1' },
      ]);
    });
  });

  describe('with a clean build.gradle.kts (Kotlin)', () => {
    it('returns no violations for double-quoted version', () => {
      expect(checkBuildGradleContent(loadFixture('clean-build.gradle.kts'))).toEqual([]);
    });
  });

  describe('with a SNAPSHOT build.gradle.kts', () => {
    it('detects a SNAPSHOT in a double-quoted version declaration', () => {
      expect(checkBuildGradleContent(loadFixture('snapshot-build.gradle.kts'))).toEqual([
        { location: 'version', version: '4.2.0-SNAPSHOT' },
      ]);
    });
  });

  describe('edge cases', () => {
    it('returns no violations when there is no version declaration', () => {
      const content = 'group = "org.example"\n';
      expect(checkBuildGradleContent(content)).toEqual([]);
    });

    it('handles version with single quotes', () => {
      expect(checkBuildGradleContent("version = '3.0.0-SNAPSHOT'")).toEqual([
        { location: 'version', version: '3.0.0-SNAPSHOT' },
      ]);
    });

    it('handles version with double quotes', () => {
      expect(checkBuildGradleContent('version = "3.0.0-SNAPSHOT"')).toEqual([
        { location: 'version', version: '3.0.0-SNAPSHOT' },
      ]);
    });

    it('returns no violations for a clean version with single quotes', () => {
      expect(checkBuildGradleContent("version = '4.2.0'")).toEqual([]);
    });
  });

  describe('with pre-release versions outside the project version declaration', () => {
    it('detects a SNAPSHOT in inline dependency coordinates', () => {
      const content = `dependencies {
    implementation 'org.springframework.cloud:spring-cloud-commons:4.2.0-SNAPSHOT'
}`;
      expect(checkBuildGradleContent(content)).toEqual([
        {
          location: 'org.springframework.cloud:spring-cloud-commons',
          version: '4.2.0-SNAPSHOT',
        },
      ]);
    });

    it('detects a SNAPSHOT in a plugin version', () => {
      const content = `plugins {
    id 'org.example.plugin' version '2.0.0-SNAPSHOT'
}`;
      expect(checkBuildGradleContent(content)).toEqual([
        { location: 'plugin [org.example.plugin]', version: '2.0.0-SNAPSHOT' },
      ]);
    });

    it('detects a SNAPSHOT in Groovy map-style dependency notation', () => {
      const content = `dependencies {
    implementation group: 'org.example', name: 'my-lib', version: '1.0.0-SNAPSHOT'
}`;
      expect(checkBuildGradleContent(content)).toEqual([
        { location: 'version', version: '1.0.0-SNAPSHOT' },
      ]);
    });

    it('detects a SNAPSHOT in a version variable other than the project version', () => {
      expect(checkBuildGradleContent(`ext.springCloudVersion = '2025.0.0-SNAPSHOT'`)).toEqual([
        { location: 'ext.springCloudVersion', version: '2025.0.0-SNAPSHOT' },
      ]);
    });

    it('does NOT flag a repository URL ending in -snapshot', () => {
      const content = `repositories {
    maven { url 'https://repo.spring.io/libs-snapshot' }
    maven { url = "https://repo.spring.io/libs-snapshot-local" }
}`;
      expect(checkBuildGradleContent(content)).toEqual([]);
    });

    it('ignores versions in line and block comments', () => {
      const content = `// implementation 'org.example:my-lib:1.0.0-SNAPSHOT'
/*
 * version = '9.9.9-SNAPSHOT'
 */
version = '4.2.0'`;
      expect(checkBuildGradleContent(content)).toEqual([]);
    });

    it('honours a @releaser:version-check-off annotation on the line', () => {
      const content = `dependencies {
    testImplementation 'org.example:only-milestones:1.0.0-M1' // @releaser:version-check-off
    implementation 'org.example:my-lib:2.0.0-SNAPSHOT'
}`;
      expect(checkBuildGradleContent(content)).toEqual([
        { location: 'org.example:my-lib', version: '2.0.0-SNAPSHOT' },
      ]);
    });
  });
});

// ─── findFiles ───────────────────────────────────────────────────────────────

describe('findFiles', () => {
  it('finds all fixtures of a given name', () => {
    const fixturesDir = path.join(__dirname, 'fixtures');
    // All .xml fixtures are named *-pom.xml or clean-pom.xml etc; look for clean-pom.xml specifically
    const results = findFiles(fixturesDir, 'clean-pom.xml');
    expect(results).toHaveLength(1);
    expect(results[0]).toContain('clean-pom.xml');
  });

  it('skips node_modules, target, build, and .gradle directories', () => {
    const tmpDir = require('os').tmpdir();
    const testDir = path.join(tmpDir, 'findFiles-test-' + Date.now());
    const skipDir = path.join(testDir, 'target');
    const normalDir = path.join(testDir, 'src');
    fs.mkdirSync(skipDir, { recursive: true });
    fs.mkdirSync(normalDir, { recursive: true });
    fs.writeFileSync(path.join(skipDir, 'pom.xml'), '<project/>');
    fs.writeFileSync(path.join(normalDir, 'pom.xml'), '<project/>');

    const results = findFiles(testDir, 'pom.xml');
    expect(results.some((f) => f.includes('target'))).toBe(false);
    expect(results.some((f) => f.includes('src'))).toBe(true);

    fs.rmSync(testDir, { recursive: true });
  });

  it('excludes files matching exclude patterns', () => {
    const tmpDir = require('os').tmpdir();
    const testDir = path.join(tmpDir, 'findFiles-exclude-test-' + Date.now());
    const testProjectsDir = path.join(testDir, 'spring-cloud-contract-maven-plugin', 'src', 'test', 'projects', 'my-project');
    const samplesDir = path.join(testDir, 'samples', 'standalone', 'dsl');
    const normalDir = path.join(testDir, 'my-module');
    fs.mkdirSync(testProjectsDir, { recursive: true });
    fs.mkdirSync(samplesDir, { recursive: true });
    fs.mkdirSync(normalDir, { recursive: true });
    fs.writeFileSync(path.join(testProjectsDir, 'pom.xml'), '<project/>');
    fs.writeFileSync(path.join(samplesDir, 'pom.xml'), '<project/>');
    fs.writeFileSync(path.join(normalDir, 'pom.xml'), '<project/>');

    const excludePatterns = [
      new RegExp('^.*spring-cloud-contract-maven-plugin/src/test/projects/.*$'),
      new RegExp('^.*samples/standalone/[a-z]+/.*$'),
    ];
    const results = findFiles(testDir, 'pom.xml', excludePatterns);
    expect(results.some((f) => f.includes('test/projects'))).toBe(false);
    expect(results.some((f) => f.includes('standalone'))).toBe(false);
    expect(results.some((f) => f.includes('my-module'))).toBe(true);

    fs.rmSync(testDir, { recursive: true });
  });

  it('excludes entire directories matching exclude patterns', () => {
    const tmpDir = require('os').tmpdir();
    const testDir = path.join(tmpDir, 'findFiles-excludedir-test-' + Date.now());
    const batsDir = path.join(testDir, 'src', 'test', 'bats');
    const normalDir = path.join(testDir, 'src', 'main');
    fs.mkdirSync(batsDir, { recursive: true });
    fs.mkdirSync(normalDir, { recursive: true });
    fs.writeFileSync(path.join(batsDir, 'pom.xml'), '<project/>');
    fs.writeFileSync(path.join(normalDir, 'pom.xml'), '<project/>');

    const excludePatterns = [new RegExp('^.*src/test/bats/.*$')];
    const results = findFiles(testDir, 'pom.xml', excludePatterns);
    expect(results.some((f) => f.includes('bats'))).toBe(false);
    expect(results.some((f) => f.includes('main'))).toBe(true);

    fs.rmSync(testDir, { recursive: true });
  });
});
