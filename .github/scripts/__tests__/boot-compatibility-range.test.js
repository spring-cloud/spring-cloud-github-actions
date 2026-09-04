'use strict';

const {
  bootBase, nextBootMinor, phaseOf, rangeFor, snapshotRangeFor,
} = require('../boot-compatibility-range');

describe('bootBase', () => {
  it('strips a milestone qualifier', () => {
    expect(bootBase('4.2.0-M2')).toBe('4.2.0');
  });

  it('strips a release candidate qualifier', () => {
    expect(bootBase('4.2.0-RC1')).toBe('4.2.0');
  });

  it('strips a snapshot qualifier', () => {
    expect(bootBase('4.2.0-SNAPSHOT')).toBe('4.2.0');
  });

  it('leaves a GA version alone', () => {
    expect(bootBase('4.2.0')).toBe('4.2.0');
  });

  it('trims surrounding whitespace', () => {
    expect(bootBase('  4.2.0-M2  ')).toBe('4.2.0');
  });

  it('refuses a version that is not major.minor.patch', () => {
    expect(() => bootBase('4.2')).toThrow(/not a <major>\.<minor>\.<patch>/);
    expect(() => bootBase('')).toThrow(/not a <major>\.<minor>\.<patch>/);
    expect(() => bootBase('main')).toThrow(/not a <major>\.<minor>\.<patch>/);
  });
});

describe('nextBootMinor', () => {
  it('bumps the minor and zeroes the patch', () => {
    expect(nextBootMinor('4.2.0-M2')).toBe('4.3.0');
    expect(nextBootMinor('4.2.5')).toBe('4.3.0');
  });

  it('carries a double-digit minor rather than rolling the major', () => {
    expect(nextBootMinor('4.9.1')).toBe('4.10.0');
    expect(nextBootMinor('4.10.0')).toBe('4.11.0');
  });
});

describe('phaseOf', () => {
  it('classifies each phase of a train', () => {
    expect(phaseOf('2026.0.0-M1')).toBe('M');
    expect(phaseOf('2026.0.0-RC2')).toBe('RC');
    expect(phaseOf('2026.0.0')).toBeNull();
  });

  it('refuses a version outside the grammar', () => {
    expect(() => phaseOf('2026.0.0-SNAPSHOT')).toThrow(/cannot classify|not a release version/);
  });
});

describe('rangeFor', () => {
  // The whole point of anchoring on the phase rather than the Boot version: the train is
  // built against Boot 4.2.0-M2, but the range still opens at 4.2.0-M1 so the bound does
  // not churn on every milestone.
  it('anchors the milestone phase at -M1 whatever Boot milestone the train uses', () => {
    expect(rangeFor('4.2.0-M2', '2026.0.0-M1')).toBe('[4.2.0-M1,4.2.0-SNAPSHOT)');
    expect(rangeFor('4.2.0-M3', '2026.0.0-M2')).toBe('[4.2.0-M1,4.2.0-SNAPSHOT)');
  });

  it('moves the floor to -RC1 for release candidates', () => {
    expect(rangeFor('4.2.0-RC1', '2026.0.0-RC1')).toBe('[4.2.0-RC1,4.2.0-SNAPSHOT)');
    expect(rangeFor('4.2.0-RC2', '2026.0.0-RC2')).toBe('[4.2.0-RC1,4.2.0-SNAPSHOT)');
  });

  it('widens to the next Boot minor at GA', () => {
    expect(rangeFor('4.2.0', '2026.0.0')).toBe('[4.2.0,4.3.0-M1)');
  });

  it('walks a whole train', () => {
    const boot = '4.2.0-M2';
    expect(rangeFor(boot, '2026.0.0-M1')).toBe('[4.2.0-M1,4.2.0-SNAPSHOT)');
    expect(rangeFor(boot, '2026.0.0-M2')).toBe('[4.2.0-M1,4.2.0-SNAPSHOT)');
    expect(rangeFor(boot, '2026.0.0-RC1')).toBe('[4.2.0-RC1,4.2.0-SNAPSHOT)');
    expect(rangeFor(boot, '2026.0.0')).toBe('[4.2.0,4.3.0-M1)');
  });
});

describe('snapshotRangeFor', () => {
  it('runs from the Boot snapshot to the next Boot minor', () => {
    expect(snapshotRangeFor('4.2.0-M2')).toBe('[4.2.0-SNAPSHOT,4.3.0-M1)');
  });

  it('does not depend on which Boot pre-release the train uses', () => {
    expect(snapshotRangeFor('4.2.0-RC1')).toBe(snapshotRangeFor('4.2.0-M2'));
    expect(snapshotRangeFor('4.2.0')).toBe(snapshotRangeFor('4.2.0-M2'));
  });
});
