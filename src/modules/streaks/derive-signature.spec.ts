import { deriveSignature, registryHash } from './derive-signature';

describe('registryHash', () => {
  it('ignores order and duplicates', () => {
    expect(registryHash(['b', 'a', 'a'])).toBe(registryHash(['a', 'b']));
  });

  it('changes when a market is added', () => {
    expect(registryHash(['a', 'b'])).not.toBe(registryHash(['a', 'b', 'c']));
  });

  it('is short enough to store per event', () => {
    expect(registryHash(['a'])).toHaveLength(12);
  });
});

describe('deriveSignature', () => {
  const base = { registryHash: 'abc123def456', hasStats: true, hasHalfTime: true, hasScore: true };

  it('matches the format the SQL twin builds', () => {
    expect(deriveSignature(base)).toBe('abc123def456:1:1:1');
    expect(
      deriveSignature({ ...base, hasStats: false, hasHalfTime: false, hasScore: false }),
    ).toBe('abc123def456:0:0:0');
  });

  it('changes when any input arrives', () => {
    const before = deriveSignature({ ...base, hasStats: false });
    expect(deriveSignature(base)).not.toBe(before);
    expect(deriveSignature({ ...base, hasHalfTime: false })).not.toBe(deriveSignature(base));
    expect(deriveSignature({ ...base, hasScore: false })).not.toBe(deriveSignature(base));
  });
});
