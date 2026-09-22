const { cmp } = require('../version-cmp');

describe('cmp', () => {
  it('orders by major, then minor, then patch', () => {
    expect(cmp('3.9.16', '3.9.9')).toBeGreaterThan(0);
    expect(cmp('3.9.9', '3.9.16')).toBeLessThan(0);
    expect(cmp('3.9.16', '3.9.16')).toBe(0);
    expect(cmp('4.0.0', '3.9.16')).toBeGreaterThan(0);
  });

  it('treats a missing trailing segment as 0', () => {
    expect(cmp('3.9', '3.9.0')).toBe(0);
    expect(cmp('3.9.1', '3.9')).toBeGreaterThan(0);
  });

  it('strips a leading v from either side', () => {
    expect(cmp('v0.4.26', 'v0.4.15')).toBeGreaterThan(0);
    expect(cmp('v0.4.15', '0.4.15')).toBe(0);
    expect(cmp('0.4.26', 'v0.4.15')).toBeGreaterThan(0);
  });
});
