import { firstOfEach } from './first-of-each';

describe('firstOfEach', () => {
  it('keeps the first of each key, in order', () => {
    const rows = [
      { k: 'a', n: 1 },
      { k: 'b', n: 2 },
      { k: 'a', n: 3 },
    ];
    expect(firstOfEach(rows, (r) => r.k)).toEqual([
      { k: 'a', n: 1 },
      { k: 'b', n: 2 },
    ]);
  });
});
