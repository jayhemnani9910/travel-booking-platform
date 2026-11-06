import * as models from '../index';
import * as common from '../common';

describe('models/index', () => {
  it('re-exports the common models module', () => {
    // common.ts holds only interfaces, so there are no runtime values to forward.
    expect(Object.keys(models)).toEqual(Object.keys(common));
    expect(Object.keys(models)).toEqual([]);
  });
});
