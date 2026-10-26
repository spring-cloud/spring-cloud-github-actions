'use strict';

const { problems } = require('../verify-commercial-settings');

const USW1 = 'https://usw1.packages.broadcom.com/artifactory/spring-enterprise-maven-prod-local';
const SERVER = `<server><id>spring-commercial-release</id>
  <username>\${env.COMMERCIAL_ARTIFACTORY_USERNAME}</username>
  <password>\${env.COMMERCIAL_ARTIFACTORY_PASSWORD}</password></server>`;

const repo = (tag, { id = 'spring-commercial-release', url = USW1, releases = '' } = {}) =>
  `<${tag}><id>${id}</id><url>${url}</url>${releases}</${tag}>`;

const settings = ({
  servers = SERVER,
  profileId = 'spring',
  repos = repo('repository'),
  pluginRepos = repo('pluginRepository'),
  extra = '',
  ns = '',
} = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<settings${ns}>
  ${extra}
  <servers>${servers}</servers>
  <profiles><profile><id>${profileId}</id>
    <repositories>${repos}</repositories>
    <pluginRepositories>${pluginRepos}</pluginRepositories>
  </profile></profiles>
</settings>`;

describe('problems', () => {
  it('accepts a complete file', () => {
    expect(problems(settings())).toEqual([]);
  });

  it('accepts a namespaced file', () => {
    expect(problems(settings({ ns: ' xmlns="http://maven.apache.org/SETTINGS/1.0.0"' }))).toEqual([]);
  });

  it('accepts a root element with several attributes, as Maven settings files have', () => {
    const ns = ' xmlns="http://maven.apache.org/SETTINGS/1.0.0"\n    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n'
      + '    xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0 https://maven.apache.org/xsd/settings-1.0.0.xsd"';
    expect(problems(settings({ ns }))).toEqual([]);
  });

  it('accepts other repositories alongside the commercial one', () => {
    const other = repo('repository', { id: 'spring-snapshots', url: 'https://repo.spring.io/libs-snapshot-local' });
    expect(problems(settings({ repos: other + repo('repository') }))).toEqual([]);
  });

  it('accepts the profile id appearing after its repositories', () => {
    const xml = settings().replace(
      /<profile><id>spring<\/id>([\s\S]*?)<\/profile>/, '<profile>$1<id>spring</id></profile>');
    expect(problems(xml)).toEqual([]);
  });

  describe('a text search would be satisfied, a structural check is not', () => {
    it('rejects the URL and id appearing only in a comment', () => {
      const oss = settings({
        servers: '',
        repos: repo('repository', { id: 'spring-snapshots', url: 'https://repo.spring.io/x' }),
        pluginRepos: repo('pluginRepository', { id: 'spring-snapshots', url: 'https://repo.spring.io/x' }),
        extra: `<!-- spring-commercial-release ${USW1} -->`,
      });
      expect(problems(oss)).toHaveLength(3);
    });

    it('rejects a server with no repository to use it', () => {
      const found = problems(settings({ repos: '<!-- none -->', pluginRepos: '<!-- none -->' }));
      expect(found).toHaveLength(2);
      found.forEach(p => expect(p).toMatch(/inside </));
    });

    it('rejects a commercial repository that is only in a comment', () => {
      const commented = `<!-- ${repo('repository')} -->`;
      expect(problems(settings({ repos: commented }))).toHaveLength(1);
    });
  });

  it('rejects repositories without pluginRepositories', () => {
    const found = problems(settings({ pluginRepos: '' }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/<pluginRepository>/);
  });

  it('rejects pluginRepositories without repositories', () => {
    const found = problems(settings({ repos: '' }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/<repository>/);
  });

  it('rejects the wrong URL host', () => {
    expect(problems(settings({ repos: repo('repository', { url: 'https://repo.spring.io/release' }) })))
      .toHaveLength(1);
  });

  it('rejects the wrong repository id', () => {
    expect(problems(settings({ repos: repo('repository', { id: 'something-else' }) }))).toHaveLength(1);
  });

  it('does not count repositories in a different profile', () => {
    const found = problems(settings({ profileId: 'ide' }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/no <profile> with id 'spring'/);
  });

  it('rejects releases disabled on the commercial release repository', () => {
    const disabled = repo('repository', { releases: '<releases><enabled>false</enabled></releases>' });
    const found = problems(settings({ repos: disabled }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/releases disabled/);
  });

  it('rejects a missing server', () => {
    const found = problems(settings({ servers: '' }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/without credentials/);
  });

  it('rejects a server with no credentials', () => {
    const found = problems(settings({ servers: '<server><id>spring-commercial-release</id></server>' }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/no username and password/);
  });

  it('does not count a server for another id', () => {
    const other = SERVER.replace('spring-commercial-release', 'repo.spring.io');
    expect(problems(settings({ servers: other }))).toHaveLength(1);
  });

  it('still rejects a truncated file, as missing what it looks for', () => {
    const found = problems('<settings><servers>');
    expect(found.length).toBeGreaterThan(0);
  });
});
