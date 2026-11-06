import {
  ValidationError,
  US_STATES,
  US_STATES_FULL,
  validateSSN,
  validateState,
  validateZipCode,
  validateEmail,
  validatePhone,
  validateAddress,
  generateIdempotencyKey
} from '../common';
import { Address } from '../../models/common';

const validAddress: Address = {
  street: '123 Main St',
  city: 'San Jose',
  state: 'CA',
  zipCode: '95123',
  country: 'USA'
};

const errorOf = (fn: () => void): ValidationError => {
  try {
    fn();
  } catch (error) {
    return error as ValidationError;
  }
  throw new Error('expected function to throw');
};

describe('validators/common', () => {
  describe('ValidationError', () => {
    it('is an Error carrying the message, field and name', () => {
      const error = new ValidationError('bad value', 'thing');
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('bad value');
      expect(error.field).toBe('thing');
      expect(error.name).toBe('ValidationError');
    });
  });

  describe('state lists', () => {
    it('has all 50 states as codes and full names', () => {
      expect(US_STATES).toHaveLength(50);
      expect(US_STATES_FULL).toHaveLength(50);
      expect(new Set(US_STATES).size).toBe(50);
    });
  });

  it.each([
    ['validateSSN', () => validateSSN(''), 'ssn', 'SSN is required'],
    ['validateSSN', () => validateSSN('123456789'), 'ssn', 'Invalid SSN format. Expected: ###-##-####'],
    ['validateState', () => validateState(''), 'state', 'State is required'],
    ['validateState', () => validateState('Texass'), 'state', 'Invalid US state: Texass'],
    ['validateZipCode', () => validateZipCode(''), 'zipCode', 'ZIP code is required'],
    ['validateZipCode', () => validateZipCode('123'), 'zipCode', expect.stringContaining('Invalid ZIP code format')],
    ['validateEmail', () => validateEmail('a@b'), 'email', 'Invalid email format'],
    ['validatePhone', () => validatePhone('555-1234'), 'phone', 'Invalid phone number format']
  ])('%s reports the failing field and message', (_name, fn, field, message) => {
    const error = errorOf(fn);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.field).toBe(field);
    expect(error.message).toEqual(message);
  });

  describe('validateState', () => {
    it('accepts mixed-case codes and full names', () => {
      expect(() => validateState('Ca')).not.toThrow();
      expect(() => validateState('NEW YORK')).not.toThrow();
      expect(() => validateState('north carolina')).not.toThrow();
    });
  });

  describe('validateZipCode', () => {
    it('accepts the 2-digit form from the spec examples', () => {
      expect(() => validateZipCode('12')).not.toThrow();
    });

    it('rejects 1 and 3 digit values', () => {
      expect(() => validateZipCode('1')).toThrow(ValidationError);
      expect(() => validateZipCode('123')).toThrow(ValidationError);
    });
  });

  describe('validateAddress', () => {
    it('accepts a complete, valid address', () => {
      expect(() => validateAddress(validAddress)).not.toThrow();
    });

    it.each(['street', 'city', 'state', 'zipCode', 'country'] as const)('rejects an address with an empty %s', (key) => {
      const error = errorOf(() => validateAddress({ ...validAddress, [key]: '' }));
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.field).toBe('address');
    });

    it('reports the state field when the state is invalid', () => {
      expect(errorOf(() => validateAddress({ ...validAddress, state: 'ZZ' })).field).toBe('state');
    });

    it('reports the zipCode field when the ZIP is invalid', () => {
      expect(errorOf(() => validateAddress({ ...validAddress, zipCode: '1234' })).field).toBe('zipCode');
    });
  });

  describe('generateIdempotencyKey', () => {
    it('builds a key from the current time and a random suffix', () => {
      const now = 1700000000000;
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
      try {
        expect(generateIdempotencyKey()).toMatch(new RegExp(`^idem_${now}_[a-z0-9]{1,9}$`));
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('produces different keys on successive calls', () => {
      const keys = new Set(Array.from({ length: 50 }, () => generateIdempotencyKey()));
      expect(keys.size).toBe(50);
    });
  });
});
