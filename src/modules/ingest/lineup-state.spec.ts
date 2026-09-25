import { lineupsComplete } from './lineup-state';

const xi = (n: number) => Array.from({ length: n }, (_, i) => ({ playerExternalId: String(i) }));

describe('lineupsComplete', () => {
  it('needs both sides', () => {
    expect(lineupsComplete([{ teamExternalId: '1', starters: xi(11) }], '1', '2')).toBe(false);
    expect(
      lineupsComplete(
        [
          { teamExternalId: '1', starters: xi(11) },
          { teamExternalId: '2', starters: xi(11) },
        ],
        '1',
        '2',
      ),
    ).toBe(true);
  });

  it('does not accept a short or empty XI', () => {
    expect(
      lineupsComplete(
        [
          { teamExternalId: '1', starters: xi(11) },
          { teamExternalId: '2', starters: xi(4) },
        ],
        '1',
        '2',
      ),
    ).toBe(false);
    expect(lineupsComplete([], '1', '2')).toBe(false);
  });

  it('ignores lineups for teams not in the fixture', () => {
    expect(
      lineupsComplete(
        [
          { teamExternalId: '1', starters: xi(11) },
          { teamExternalId: '9', starters: xi(11) },
        ],
        '1',
        '2',
      ),
    ).toBe(false);
  });
});
