import { describe, expect, it } from 'vitest';

import { chunk } from 'src/utils';

describe('chunk', () => {
  it('splits into pieces of the given size, the last one shorter', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('returns one piece when everything fits, and none for an empty array', () => {
    expect(chunk([1, 2], 20)).toEqual([[1, 2]]);
    expect(chunk([], 20)).toEqual([]);
  });

  it('rejects sizes that would loop forever or make no sense', () => {
    for (const size of [0, -1, 1.5, Number.NaN]) {
      expect(() => chunk([1], size)).toThrow(RangeError);
    }
  });
});
