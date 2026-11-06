import * as validators from '../index';
import * as common from '../common';

describe('validators/index', () => {
  it('re-exports every validator from common', () => {
    const names = Object.keys(common);
    expect(names).toEqual(expect.arrayContaining(['validateState', 'validateZipCode', 'ValidationError', 'US_STATES']));
    expect(Object.keys(validators).sort()).toEqual([...names].sort());
    for (const name of names) {
      expect(validators[name as keyof typeof validators]).toBe(common[name as keyof typeof common]);
    }
  });
});
