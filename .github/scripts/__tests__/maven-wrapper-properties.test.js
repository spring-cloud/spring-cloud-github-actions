const {
  propsPath, scriptPaths, cmp, propertyValue,
  currentMaven, dependabotWrapperVersion, rewrite, wrapperDirs,
} = require('../maven-wrapper-properties');

const TARGET = { maven: '3.9.16', wrapper: '3.3.4' };

const distUrl = (version, host = 'https://repo.maven.apache.org/maven2', ext = 'zip') =>
  `${host}/org/apache/maven/apache-maven/${version}/apache-maven-${version}-bin.${ext}`;

// The exact shape found across the estate: one line, written in 2018, no wrapper keys.
const LEGACY = `distributionUrl=${distUrl('3.6.0', 'https://repo1.maven.org/maven2')}\n`;

// What maven-wrapper-plugin 3.x generates today.
const CURRENT = [
  'wrapperVersion=3.3.4',
  'distributionType=bin',
  `distributionUrl=${distUrl('3.9.16')}`,
  'wrapperUrl=https://repo.maven.apache.org/maven2/org/apache/maven/wrapper/maven-wrapper/3.3.4/maven-wrapper-3.3.4.jar',
  '',
].join('\n');

const APACHE_LICENCE = [
  '# Licensed to the Apache Software Foundation (ASF) under one',
  '# or more contributor license agreements.  See the NOTICE file',
  '#',
  '#   http://www.apache.org/licenses/LICENSE-2.0',
  '',
].join('\n');

// ─── propertyValue ───────────────────────────────────────────────────────────
// Mirrors Dependabot's get_property_value, so the edge cases are its edge cases.

describe('propertyValue', () => {
  it('reads a plain key=value', () => {
    expect(propertyValue('wrapperVersion=3.3.4\n', 'wrapperVersion')).toBe('3.3.4');
  });

  it('accepts a colon separator, as .properties allows', () => {
    expect(propertyValue('wrapperVersion : 3.3.4\n', 'wrapperVersion')).toBe('3.3.4');
  });

  it('tolerates leading and trailing whitespace', () => {
    expect(propertyValue('\t  wrapperVersion\t=\t3.3.4  \n', 'wrapperVersion')).toBe('3.3.4');
  });

  it('ignores # comments', () => {
    expect(propertyValue('#wrapperVersion=9.9.9\n', 'wrapperVersion')).toBeNull();
  });

  it('ignores ! comments', () => {
    expect(propertyValue('!wrapperVersion=9.9.9\n', 'wrapperVersion')).toBeNull();
  });

  it('joins Java line continuations before matching', () => {
    expect(propertyValue('wrapperVersion=3.\\\n  3.4\n', 'wrapperVersion')).toBe('3.3.4');
  });

  it('returns null for an absent key', () => {
    expect(propertyValue(LEGACY, 'wrapperVersion')).toBeNull();
  });

  it('does not confuse a key that is a suffix of another', () => {
    expect(propertyValue('distributionUrl=x\n', 'Url')).toBeNull();
  });
});

// ─── currentMaven ────────────────────────────────────────────────────────────

describe('currentMaven', () => {
  it('reads the version out of a distributionUrl', () => {
    expect(currentMaven(`distributionUrl=${distUrl('3.9.1')}\n`)).toBe('3.9.1');
  });

  it('reads it from a tar.gz distribution', () => {
    expect(currentMaven(`distributionUrl=${distUrl('3.9.1', undefined, 'tar.gz')}\n`)).toBe('3.9.1');
  });

  it('reads it from a mirror host', () => {
    expect(currentMaven(LEGACY)).toBe('3.6.0');
  });

  it('returns null when the URL is not a shape we recognise', () => {
    expect(currentMaven('distributionUrl=https://example.com/maven.zip\n')).toBeNull();
  });

  it('returns null when there is no distributionUrl at all', () => {
    expect(currentMaven('wrapperVersion=3.3.4\n')).toBeNull();
  });
});

// ─── dependabotWrapperVersion ────────────────────────────────────────────────
// The predicate the whole audit rests on: null here means Dependabot's parser
// raises, which aborts that repository's entire update job.

describe('dependabotWrapperVersion', () => {
  it('prefers an explicit wrapperVersion', () => {
    expect(dependabotWrapperVersion(CURRENT)).toBe('3.3.4');
  });

  it('falls back to a version parsed out of wrapperUrl', () => {
    const text = `distributionUrl=${distUrl('3.9.1')}\n` +
      'wrapperUrl=https://repo.maven.apache.org/maven2/org/apache/maven/wrapper/maven-wrapper/3.2.0/maven-wrapper-3.2.0.jar\n';
    expect(dependabotWrapperVersion(text)).toBe('3.2.0');
  });

  it('parses the pre-Apache takari wrapperUrl too', () => {
    const text = LEGACY +
      'wrapperUrl=https://repo1.maven.org/maven2/io/takari/maven-wrapper/0.5.6/maven-wrapper-0.5.6.jar\n';
    expect(dependabotWrapperVersion(text)).toBe('0.5.6');
  });

  it('falls back to the version banner in a script', () => {
    const mvnw = '#!/bin/sh\n# Apache Maven Wrapper startup script, version 3.2.0\n';
    expect(dependabotWrapperVersion(LEGACY, [mvnw])).toBe('3.2.0');
  });

  it('reads the Windows batch banner wording', () => {
    const cmd = '@REM Apache Maven Wrapper startup batch script, version 3.1.1\r\n';
    expect(dependabotWrapperVersion(LEGACY, [cmd])).toBe('3.1.1');
  });

  it('returns null for the legacy one-line file with no scripts — the estate-wide breakage', () => {
    expect(dependabotWrapperVersion(LEGACY, [])).toBeNull();
  });

  it('returns null when the scripts carry no banner — old mvnw, as in the samples', () => {
    const oldMvnw = '#!/bin/sh\n# Licensed to the Apache Software Foundation\nMAVEN_PROJECTBASEDIR=x\n';
    expect(dependabotWrapperVersion(LEGACY, [oldMvnw])).toBeNull();
  });

  it('does not accept a commented-out wrapperVersion', () => {
    expect(dependabotWrapperVersion(`#wrapperVersion=9.9.9\n${LEGACY}`, [])).toBeNull();
  });
});

// ─── rewrite ─────────────────────────────────────────────────────────────────

describe('rewrite', () => {
  it('bumps both version occurrences in the distributionUrl', () => {
    // Rewriting only the filename would produce a URL that 404s on every build.
    const out = rewrite(`distributionUrl=${distUrl('3.9.1')}\n`, TARGET);
    expect(out).toContain('/apache-maven/3.9.16/apache-maven-3.9.16-bin.zip');
    expect(out).not.toContain('3.9.1/');
  });

  it('keeps a mirror host rather than forcing Maven Central', () => {
    expect(rewrite(LEGACY, TARGET)).toContain('https://repo1.maven.org/maven2/org/apache/maven');
  });

  it('preserves comments and the licence header', () => {
    const src = `${APACHE_LICENCE}distributionUrl=${distUrl('3.9.1')}\n`;
    expect(rewrite(src, TARGET)).toContain(APACHE_LICENCE);
  });

  it('refreshes an existing wrapperVersion', () => {
    const src = `wrapperVersion=3.2.0\ndistributionUrl=${distUrl('3.9.1')}\n`;
    expect(propertyValue(rewrite(src, TARGET), 'wrapperVersion')).toBe('3.3.4');
  });

  it('migrates a takari wrapperUrl to the Apache coordinates', () => {
    const src = LEGACY +
      'wrapperUrl=https://repo1.maven.org/maven2/io/takari/maven-wrapper/0.5.6/maven-wrapper-0.5.6.jar\n';
    expect(propertyValue(rewrite(src, TARGET), 'wrapperUrl'))
      .toBe('https://repo.maven.apache.org/maven2/org/apache/maven/wrapper/maven-wrapper/3.3.4/maven-wrapper-3.3.4.jar');
  });

  describe('adding the missing wrapperVersion', () => {
    it('adds it when the file has neither wrapper key', () => {
      expect(propertyValue(rewrite(LEGACY, TARGET), 'wrapperVersion')).toBe('3.3.4');
    });

    it('places it directly above distributionUrl, below any licence header', () => {
      const out = rewrite(`${APACHE_LICENCE}distributionUrl=${distUrl('3.6.0')}\n`, TARGET);
      const lines = out.split('\n');
      const added = lines.findIndex(l => l.startsWith('wrapperVersion='));
      const dist = lines.findIndex(l => l.startsWith('distributionUrl='));
      expect(added).toBe(dist - 1);
      expect(lines[0]).toBe('# Licensed to the Apache Software Foundation (ASF) under one');
    });

    it('does NOT invent it when a parseable wrapperUrl is already there', () => {
      const src = LEGACY +
        'wrapperUrl=https://repo.maven.apache.org/maven2/org/apache/maven/wrapper/maven-wrapper/3.2.0/maven-wrapper-3.2.0.jar\n';
      expect(propertyValue(rewrite(src, TARGET), 'wrapperVersion')).toBeNull();
    });

    it('adds it even when the distributionUrl is unrecognised, since that is the key Dependabot needs', () => {
      const src = 'distributionUrl=https://example.com/maven.zip\n';
      expect(propertyValue(rewrite(src, TARGET), 'wrapperVersion')).toBe('3.3.4');
    });

    it('appends it when there is no distributionUrl line to sit above', () => {
      expect(propertyValue(rewrite('distributionType=bin\n', TARGET), 'wrapperVersion')).toBe('3.3.4');
    });

    it('ignores a commented-out wrapperVersion and adds a real one', () => {
      const out = rewrite(`#wrapperVersion=9.9.9\n${LEGACY}`, TARGET);
      expect(propertyValue(out, 'wrapperVersion')).toBe('3.3.4');
      expect(out).toContain('#wrapperVersion=9.9.9');
    });
  });

  describe('whitespace fidelity', () => {
    // Regression: the pattern used to end in `\s*$`, which under /m is greedy enough to
    // swallow the line's newline - and on a file's last line, the file's final newline -
    // so every generated PR carried a spurious "\ No newline at end of file".
    it('preserves a trailing newline', () => {
      expect(rewrite(`distributionUrl=${distUrl('3.9.1')}\n`, TARGET).endsWith('\n')).toBe(true);
    });

    it('preserves CRLF line endings', () => {
      const src = `distributionUrl=${distUrl('3.9.1')}\r\nwrapperVersion=3.2.0\r\n`;
      const out = rewrite(src, TARGET);
      expect(out).toContain('-bin.zip\r\n');
      expect(out.includes('\n\n')).toBe(false);
    });

    it('preserves the absence of a trailing newline', () => {
      expect(rewrite(`distributionUrl=${distUrl('3.9.1')}`, TARGET).endsWith('zip')).toBe(true);
    });

    it('preserves trailing spaces after the URL', () => {
      expect(rewrite(`distributionUrl=${distUrl('3.9.1')}   \n`, TARGET)).toContain('zip   \n');
    });
  });

  describe('stability', () => {
    it('is a byte-for-byte no-op on an already-current file', () => {
      expect(rewrite(CURRENT, TARGET)).toBe(CURRENT);
    });

    it('is idempotent', () => {
      const once = rewrite(LEGACY, TARGET);
      expect(rewrite(once, TARGET)).toBe(once);
    });

    it('makes a broken file readable by Dependabot', () => {
      expect(dependabotWrapperVersion(LEGACY, [])).toBeNull();
      expect(dependabotWrapperVersion(rewrite(LEGACY, TARGET), [])).toBe('3.3.4');
    });
  });
});

// ─── wrapperDirs ─────────────────────────────────────────────────────────────
// The pom.xml condition is not cosmetic: Dependabot only reads a wrapper in the
// directory of a pom it fetches, so a wrapper without one is never looked at.

describe('wrapperDirs', () => {
  const props = d => (d === '.' ? '' : `${d}/`) + '.mvn/wrapper/maven-wrapper.properties';
  const pom = d => (d === '.' ? '' : `${d}/`) + 'pom.xml';

  it('finds the root wrapper as "."', () => {
    expect(wrapperDirs([pom('.'), props('.')])).toEqual(['.']);
  });

  it('finds module wrappers', () => {
    const paths = [pom('.'), props('.'), pom('bom'), props('bom')];
    expect(wrapperDirs(paths)).toEqual(['.', 'bom']);
  });

  it('finds deeply nested module wrappers', () => {
    const d = 'samples/a/b';
    expect(wrapperDirs([pom('.'), props('.'), pom(d), props(d)])).toEqual(['.', d]);
  });

  it('excludes a wrapper directory with no pom.xml beside it', () => {
    const paths = [pom('.'), props('.'), props('tools')];
    expect(wrapperDirs(paths)).toEqual(['.']);
  });

  it('excludes a module that has a pom but no wrapper', () => {
    expect(wrapperDirs([pom('.'), props('.'), pom('core')])).toEqual(['.']);
  });

  it('orders the root first, then alphabetically', () => {
    const dirs = ['zeta', 'alpha', 'mid'];
    const paths = [pom('.'), props('.'), ...dirs.flatMap(d => [pom(d), props(d)])];
    expect(wrapperDirs(paths)).toEqual(['.', 'alpha', 'mid', 'zeta']);
  });

  it('does not mistake a similarly named path for a wrapper', () => {
    const paths = [pom('.'), 'docs/maven-wrapper.properties', 'src/.mvn/wrapper/other.properties'];
    expect(wrapperDirs(paths)).toEqual([]);
  });

  it('returns an empty list for a branch with no poms at all', () => {
    expect(wrapperDirs(['README.md', 'index.html'])).toEqual([]);
  });
});

// ─── path helpers and cmp ────────────────────────────────────────────────────

describe('propsPath and scriptPaths', () => {
  it('does not prefix root paths with ./', () => {
    expect(propsPath('.')).toBe('.mvn/wrapper/maven-wrapper.properties');
    expect(scriptPaths('.')).toContain('mvnw');
  });

  it('prefixes module paths with the directory', () => {
    expect(propsPath('bom')).toBe('bom/.mvn/wrapper/maven-wrapper.properties');
    expect(scriptPaths('bom')).toContain('bom/mvnw.cmd');
  });

  it('lists the Unix scripts before the Windows ones, as Dependabot prefers them', () => {
    const s = scriptPaths('.');
    expect(s.indexOf('mvnw')).toBeLessThan(s.indexOf('mvnw.cmd'));
  });
});

describe('cmp', () => {
  it('orders by numeric segment, not lexically', () => {
    expect(cmp('3.9.9', '3.9.16')).toBeLessThan(0);
  });

  it('treats missing segments as zero', () => {
    expect(cmp('3.9', '3.9.0')).toBe(0);
  });

  it('returns 0 for equal versions', () => {
    expect(cmp('3.9.16', '3.9.16')).toBe(0);
  });

  it('detects a version ahead of the target', () => {
    expect(cmp('4.0.1', '3.9.16')).toBeGreaterThan(0);
  });
});
