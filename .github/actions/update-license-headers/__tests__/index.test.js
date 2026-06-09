'use strict';

jest.mock('@actions/core');
jest.mock('@actions/exec');

const core = require('@actions/core');
const {
  CHECKSTYLE_HEADER,
  BLOCK_HEADER,
  XML_HEADER,
  HASH_HEADER,
  replacePomLicenses,
  replaceXmlHeader,
  replaceHashHeader,
  processLicenseFile,
} = require('../src/index');

const fs = require('fs');
const os = require('os');
const path = require('path');

beforeEach(() => {
  jest.clearAllMocks();
  core.info.mockImplementation(() => {});
  core.warning.mockImplementation(() => {});
  core.error.mockImplementation(() => {});
  core.setFailed.mockImplementation(() => {});
  core.setSecret.mockImplementation(() => {});
});

// ── Constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  test('CHECKSTYLE_HEADER contains Broadcom copyright pattern', () => {
    expect(CHECKSTYLE_HEADER).toContain('Broadcom');
    expect(CHECKSTYLE_HEADER).toMatch(/\\Q \* Copyright/);
  });

  test('BLOCK_HEADER contains both copyright lines', () => {
    expect(BLOCK_HEADER).toContain('Broadcom Inc.');
    expect(BLOCK_HEADER).toContain('original author or authors');
  });

  test('XML_HEADER is wrapped in <!-- -->', () => {
    expect(XML_HEADER).toMatch(/^<!--/);
    expect(XML_HEADER).toMatch(/-->$/);
  });

  test('HASH_HEADER uses # prefix', () => {
    expect(HASH_HEADER).toMatch(/^# Copyright/m);
  });
});

// ── replacePomLicenses ───────────────────────────────────────────────────────

describe('replacePomLicenses', () => {
  const apachePom = `<project>
  <licenses>
    <license>
      <name>Apache License, Version 2.0</name>
      <url>https://www.apache.org/licenses/LICENSE-2.0</url>
      <comments>Licensed under the Apache License, Version 2.0</comments>
    </license>
  </licenses>
</project>`;

  test('replaces Apache licenses block with Broadcom', () => {
    const result = replacePomLicenses(apachePom);
    expect(result).toContain('Broadcom Inc.');
    expect(result).not.toContain('Apache License');
    expect(result).toMatch(/<licenses>/);
    expect(result).toMatch(/<\/licenses>/);
  });

  test('leaves content unchanged when no Apache marker', () => {
    const noApache = '<project><licenses><license><name>MIT</name></license></licenses></project>';
    expect(replacePomLicenses(noApache)).toBe(noApache);
  });

  test('leaves content unchanged when no licenses block', () => {
    const noLicenses = '<project><name>foo</name></project>';
    expect(replacePomLicenses(noLicenses)).toBe(noLicenses);
  });
});

// ── replaceXmlHeader ─────────────────────────────────────────────────────────

describe('replaceXmlHeader', () => {
  const apacheXmlWithDecl = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Copyright 2013-2023 the original author or authors.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
-->
<project>
  <name>foo</name>
</project>`;

  const apacheXmlWithoutDecl = `<!--
  Licensed under the Apache License, Version 2.0
-->
<beans/>`;

  test('inserts Broadcom header after <?xml ?> declaration', () => {
    const result = replaceXmlHeader(apacheXmlWithDecl);
    expect(result).toMatch(/^<\?xml/);
    expect(result).toContain(XML_HEADER);
    expect(result).not.toContain('Apache License');
  });

  test('prepends Broadcom header when no <?xml ?> declaration', () => {
    const result = replaceXmlHeader(apacheXmlWithoutDecl);
    expect(result).toMatch(/^<!--\n/);
    expect(result).toContain('Broadcom');
    expect(result).not.toContain('Apache License');
  });
});

// ── replaceHashHeader ────────────────────────────────────────────────────────

describe('replaceHashHeader', () => {
  const apacheYaml = `# Copyright 2020 the original author or authors.
# Licensed under the Apache License, Version 2.0
spring:
  application:
    name: my-app
`;

  const apacheShebang = `#!/bin/bash
# Licensed under the Apache License, Version 2.0
echo "hello"
`;

  test('replaces Apache hash header with Broadcom', () => {
    const result = replaceHashHeader(apacheYaml);
    expect(result).toContain('# Copyright © 2012 Broadcom');
    expect(result).not.toContain('Apache License');
    expect(result).toContain('spring:');
  });

  test('preserves shebang line', () => {
    const result = replaceHashHeader(apacheShebang);
    expect(result).toMatch(/^#!\/bin\/bash/);
    expect(result).toContain('# Copyright © 2012 Broadcom');
    expect(result).not.toContain('Apache License');
  });

  test('leaves content unchanged when no Apache marker', () => {
    const noApache = '# My comment\nspring:\n  foo: bar\n';
    expect(replaceHashHeader(noApache)).toBe(noApache);
  });
});

// ── processLicenseFile ────────────────────────────────────────────────────────

describe('processLicenseFile', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('updates a .java file with Apache block comment', () => {
    const content = `/*
 * Copyright 2020 the original author or authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
package com.example;
`;
    const filePath = path.join(tmpDir, 'Foo.java');
    fs.writeFileSync(filePath, content);
    expect(processLicenseFile(filePath)).toBe(true);
    const updated = fs.readFileSync(filePath, 'utf-8');
    expect(updated).toContain('Broadcom Inc.');
    expect(updated).not.toContain('Apache License');
  });

  test('updates a .yml file with hash-style Apache header', () => {
    const content = `# Copyright 2020 the original author or authors.
# Licensed under the Apache License, Version 2.0
spring:
  name: app
`;
    const filePath = path.join(tmpDir, 'app.yml');
    fs.writeFileSync(filePath, content);
    expect(processLicenseFile(filePath)).toBe(true);
    const updated = fs.readFileSync(filePath, 'utf-8');
    expect(updated).toContain('# Copyright © 2012 Broadcom');
  });

  test('skips files without Apache marker', () => {
    const content = `/*\n * No license here.\n */\npublic class Foo {}\n`;
    const filePath = path.join(tmpDir, 'Foo.java');
    fs.writeFileSync(filePath, content);
    expect(processLicenseFile(filePath)).toBe(false);
  });

  test('skips unknown file extensions', () => {
    const filePath = path.join(tmpDir, 'config.conf');
    fs.writeFileSync(filePath, 'Licensed under the Apache License');
    expect(processLicenseFile(filePath)).toBe(false);
  });
});
