'use strict';

// Checks that a .settings.xml can resolve commercial hotfix artifacts.
//
// The docs build of a hotfix tag runs Maven with `--settings .settings.xml -P spring` (forced
// by .mvn/maven.config), so that file alone has to supply the commercial release repository
// and the credentials for it. Comments are stripped and the elements are read structurally, so
// a comment, or a <server> with no matching repository, cannot satisfy it - which a search for
// the URL or the id in the text would.
//
// Requires, in the `spring` profile, the commercial release repository in both <repositories>
// and <pluginRepositories> (releases not disabled), and a <server> with the same id and a
// username and password.
//
// Node has no XML parser and these modules take no dependencies (workflows run them with no
// install step), so this is regular-expression based, like the repo's XML-editing actions. It
// does not check well-formedness: Maven fails loudly on a malformed file, and a damaged one
// is still rejected here, as missing the profile, repository or server it looks for.

const fs = require('fs');

const PROFILE_ID = 'spring';
const REPO_ID = 'spring-commercial-release';
const REPO_URL_PREFIX = 'https://usw1.packages.broadcom.com/';
const BLOCKS = [['repositories', 'repository'], ['pluginRepositories', 'pluginRepository']];

const stripComments = xml => xml.replace(/<!--[\s\S]*?-->/g, '');

const blocks = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1]);

const field = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : '';
};

const without = (xml, tags) =>
  tags.reduce((acc, tag) => acc.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'), ''), xml);

// A profile's own <id>, not one belonging to a repository nested inside it.
const profileId = profile =>
  field(without(profile, ['repositories', 'pluginRepositories', 'activation', 'properties']), 'id');


function problems(xml) {
  const clean = stripComments(xml);

  const found = [];

  const profiles = blocks(clean, 'profile').filter(p => profileId(p) === PROFILE_ID);
  if (profiles.length === 0) {
    found.push(`no <profile> with id '${PROFILE_ID}'`);
  } else {
    for (const [block, entry] of BLOCKS) {
      const entries = profiles
        .flatMap(p => blocks(p, block))
        .flatMap(b => blocks(b, entry))
        .filter(e => field(e, 'id') === REPO_ID && field(e, 'url').startsWith(REPO_URL_PREFIX));
      if (entries.length === 0) {
        found.push(`profile '${PROFILE_ID}' has no <${entry}> with id '${REPO_ID}' and a url `
          + `starting ${REPO_URL_PREFIX} inside <${block}>`);
      }
      for (const e of entries) {
        if (blocks(e, 'releases').some(r => field(r, 'enabled').toLowerCase() === 'false')) {
          found.push(`<${entry}> '${REPO_ID}' in <${block}> has releases disabled, but it is `
            + 'the repository that holds the hotfix releases');
        }
      }
    }
  }

  const servers = blocks(clean, 'server').filter(s => field(s, 'id') === REPO_ID);
  if (servers.length === 0) {
    found.push(`no <server> with id '${REPO_ID}', so the repository would be requested without credentials`);
  } else if (!servers.some(s => field(s, 'username') && field(s, 'password'))) {
    found.push(`<server> '${REPO_ID}' has no username and password`);
  }

  return found;
}

module.exports = { problems };

// CLI: verify-commercial-settings.js <path-to-.settings.xml>
// Exit status 0 when satisfied, 1 with the problems on stderr otherwise.
if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('usage: verify-commercial-settings.js <path-to-.settings.xml>\n');
    process.exit(2);
  }
  const found = problems(fs.readFileSync(file, 'utf-8'));
  found.forEach(p => process.stderr.write(`  - ${p}\n`));
  process.exit(found.length ? 1 : 0);
}
