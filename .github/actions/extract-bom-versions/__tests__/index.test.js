const fs = require('fs');
const path = require('path');
const { getBomUrl, fetchBomXml, extractVersions, nameToEnvVar } = require('../src/index');

const OSS_REPO = 'spring-cloud/spring-cloud-release';
const COMMERCIAL_REPO = 'spring-cloud/spring-cloud-release-commercial';
const bomUrl = (repo, ref) =>
  `https://raw.githubusercontent.com/${repo}/${ref}/pom.xml`;

const fixturePath = (name) => path.join(__dirname, 'fixtures', name);
const loadFixture = (name) => fs.readFileSync(fixturePath(name), 'utf-8');

// ─── getBomUrl ───────────────────────────────────────────────────────────────

describe('getBomUrl', () => {
  it('returns the OSS BOM URL for the given ref', () => {
    expect(getBomUrl(false, '2023.0.x')).toBe(bomUrl(OSS_REPO, '2023.0.x'));
  });

  it('returns the commercial BOM URL for the given ref', () => {
    expect(getBomUrl(true, '2023.0.x')).toBe(bomUrl(COMMERCIAL_REPO, '2023.0.x'));
  });

  it('defaults to main when ref is main', () => {
    expect(getBomUrl(false, 'main')).toBe(bomUrl(OSS_REPO, 'main'));
  });

  it('accepts a tag as the ref', () => {
    expect(getBomUrl(false, 'v2023.0.1')).toBe(bomUrl(OSS_REPO, 'v2023.0.1'));
  });
});

// ─── fetchBomXml ─────────────────────────────────────────────────────────────

describe('fetchBomXml', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fetches XML without an Authorization header for public repos', async () => {
    const url = bomUrl(OSS_REPO, '2023.0.x');
    const mockXml = loadFixture('minimal-bom.xml');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    });

    const xml = await fetchBomXml(url, '');

    expect(global.fetch).toHaveBeenCalledWith(url, {
      headers: { Accept: 'text/plain' },
    });
    expect(xml).toBe(mockXml);
  });

  it('includes an Authorization header when a token is provided', async () => {
    const url = bomUrl(COMMERCIAL_REPO, '2023.0.x');
    const mockXml = loadFixture('minimal-bom.xml');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => mockXml,
    });

    await fetchBomXml(url, 'my-secret-token');

    expect(global.fetch).toHaveBeenCalledWith(url, {
      headers: {
        Accept: 'text/plain',
        Authorization: 'Bearer my-secret-token',
      },
    });
  });

  it('throws a descriptive error on a non-OK response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(fetchBomXml(bomUrl(OSS_REPO, 'main'), '')).rejects.toThrow(
      'Failed to fetch BOM (HTTP 404: Not Found)'
    );
  });

  it('appends an access hint on 401 Unauthorized', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(fetchBomXml(bomUrl(COMMERCIAL_REPO, '2023.0.x'), 'bad-token')).rejects.toThrow(
      'ensure the token has read access to the repository'
    );
  });

  it('appends an access hint on 403 Forbidden', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    await expect(fetchBomXml(bomUrl(COMMERCIAL_REPO, '2023.0.x'), 'bad-token')).rejects.toThrow(
      'ensure the token has read access to the repository'
    );
  });
});

// ─── extractVersions ────────────────────────────────────────────────────────

describe('extractVersions', () => {
  describe('with a full Spring Cloud BOM', () => {
    let versions;

    beforeAll(() => {
      versions = extractVersions(loadFixture('sample-bom.xml'));
    });

    it('extracts the release train version', () => {
      expect(versions['release-train']).toBe('2023.0.1');
    });

    it('extracts spring-boot.version', () => {
      expect(versions['spring-boot']).toBe('3.2.3');
    });

    it('extracts spring-cloud-config.version', () => {
      expect(versions['spring-cloud-config']).toBe('4.1.1');
    });

    it('extracts spring-cloud-gateway.version', () => {
      expect(versions['spring-cloud-gateway']).toBe('4.1.2');
    });

    it('extracts spring-cloud-kubernetes.version', () => {
      expect(versions['spring-cloud-kubernetes']).toBe('3.1.1');
    });

    it('does NOT include properties that do not end in .version', () => {
      // java.compiler.release and project.build.sourceEncoding should be ignored
      expect(versions['java.compiler.release']).toBeUndefined();
      expect(versions['project.build.sourceEncoding']).toBeUndefined();
    });

    it('includes all expected version entries', () => {
      const expectedKeys = [
        'release-train',
        'spring-boot',
        'spring-cloud-build',
        'spring-cloud-config',
        'spring-cloud-bus',
        'spring-cloud-commons',
        'spring-cloud-circuitbreaker',
        'spring-cloud-gateway',
        'spring-cloud-kubernetes',
        'spring-cloud-openfeign',
        'spring-cloud-sleuth',
        'spring-cloud-stream',
        'spring-cloud-vault',
        'spring-cloud-zookeeper',
      ];
      expect(Object.keys(versions).sort()).toEqual(expectedKeys.sort());
    });
  });

  describe('with a minimal BOM (single property)', () => {
    it('extracts the only version property', () => {
      const versions = extractVersions(loadFixture('minimal-bom.xml'));
      expect(versions['spring-boot']).toBe('3.2.0');
      expect(versions['release-train']).toBe('2023.0.0');
    });
  });

  describe('with a BOM that has no <properties>', () => {
    it('returns only the release-train version', () => {
      const versions = extractVersions(loadFixture('no-properties-bom.xml'));
      expect(Object.keys(versions)).toEqual(['release-train']);
      expect(versions['release-train']).toBe('2023.0.0');
    });
  });

  describe('with invalid XML', () => {
    it('throws an error when there is no <project> root', () => {
      expect(() => extractVersions('<notaproject/>')).toThrow(
        'Invalid POM file: no <project> root element found'
      );
    });
  });
});

// ─── nameToEnvVar ────────────────────────────────────────────────────────────

describe('nameToEnvVar', () => {
  it('converts release-train to RELEASE_TRAIN_VERSION', () => {
    expect(nameToEnvVar('release-train')).toBe('RELEASE_TRAIN_VERSION');
  });

  it('converts spring-boot to SPRING_BOOT_VERSION', () => {
    expect(nameToEnvVar('spring-boot')).toBe('SPRING_BOOT_VERSION');
  });

  it('converts spring-cloud-config to SPRING_CLOUD_CONFIG_VERSION', () => {
    expect(nameToEnvVar('spring-cloud-config')).toBe('SPRING_CLOUD_CONFIG_VERSION');
  });

  it('converts spring-cloud-kubernetes to SPRING_CLOUD_KUBERNETES_VERSION', () => {
    expect(nameToEnvVar('spring-cloud-kubernetes')).toBe('SPRING_CLOUD_KUBERNETES_VERSION');
  });
});
