import {
  validateSSN,
  validateState,
  validateZipCode,
  validateEmail,
  validatePhone,
  validateAddress,
  ValidationError,
  US_STATES,
  US_STATES_FULL
} from './common';

describe('Validation Tests', () => {
  describe('validateSSN', () => {
    it('should accept valid SSN format', () => {
      expect(() => validateSSN('123-45-6789')).not.toThrow();
    });

    it('should reject invalid SSN format', () => {
      expect(() => validateSSN('123-45-678')).toThrow(ValidationError);
      expect(() => validateSSN('123456789')).toThrow(ValidationError);
      expect(() => validateSSN('123-45-67890')).toThrow(ValidationError);
      expect(() => validateSSN('123-456-789')).toThrow(ValidationError);
      expect(() => validateSSN('12-34-5678')).toThrow(ValidationError);
    });

    it('should reject empty SSN', () => {
      expect(() => validateSSN('')).toThrow(ValidationError);
    });
  });

  describe('validateState', () => {
    it('should accept valid state abbreviations', () => {
      US_STATES.forEach(state => {
        expect(() => validateState(state)).not.toThrow();
        expect(() => validateState(state.toLowerCase())).not.toThrow();
      });
    });

    it('should accept valid state full names', () => {
      US_STATES_FULL.forEach(state => {
        expect(() => validateState(state)).not.toThrow();
        expect(() => validateState(state.toLowerCase())).not.toThrow();
      });
    });

    it('should reject invalid states', () => {
      expect(() => validateState('XX')).toThrow(ValidationError);
      expect(() => validateState('Californiaa')).toThrow(ValidationError); // Misspelled full name
      expect(() => validateState('CA ')).toThrow(ValidationError); // Trailing space
      expect(() => validateState('')).toThrow(ValidationError);
    });
  });

  describe('validateZipCode', () => {
    it('should accept valid 5-digit ZIP codes', () => {
      expect(() => validateZipCode('12345')).not.toThrow();
      expect(() => validateZipCode('95123')).not.toThrow();
      expect(() => validateZipCode('90086')).not.toThrow();
    });

    it('should accept valid 9-digit ZIP codes', () => {
      expect(() => validateZipCode('12345-6789')).not.toThrow();
      expect(() => validateZipCode('95123-4567')).not.toThrow();
      expect(() => validateZipCode('90086-1929')).not.toThrow();
    });

    it('should reject invalid ZIP codes', () => {
      expect(() => validateZipCode('1234')).toThrow(ValidationError); // Too short
      expect(() => validateZipCode('123456')).toThrow(ValidationError); // Too long
      expect(() => validateZipCode('12345-678')).toThrow(ValidationError); // ZIP+4 too short
      expect(() => validateZipCode('12345-67890')).toThrow(ValidationError); // ZIP+4 too long
      expect(() => validateZipCode('12345A')).toThrow(ValidationError); // Invalid char
      expect(() => validateZipCode('12345-678A')).toThrow(ValidationError); // Invalid char
      expect(() => validateZipCode('')).toThrow(ValidationError);
    });

    it('should reject malformed ZIP codes from examples', () => {
      expect(() => validateZipCode('1247')).toThrow(ValidationError); // 4 digits
      expect(() => validateZipCode('1829A')).toThrow(ValidationError); // Invalid char
      expect(() => validateZipCode('37849-392')).toThrow(ValidationError); // ZIP+4 too short
      expect(() => validateZipCode('2374-2384')).toThrow(ValidationError); // ZIP+4 invalid
    });
  });

  describe('validateEmail', () => {
    it('should accept valid email formats', () => {
      expect(() => validateEmail('user@example.com')).not.toThrow();
      expect(() => validateEmail('test.user@domain.org')).not.toThrow();
      expect(() => validateEmail('user+tag@example.co.uk')).not.toThrow();
    });

    it('should reject invalid email formats', () => {
      expect(() => validateEmail('invalid-email')).toThrow(ValidationError);
      expect(() => validateEmail('user@')).toThrow(ValidationError);
      expect(() => validateEmail('@domain.com')).toThrow(ValidationError);
      expect(() => validateEmail('')).toThrow(ValidationError);
    });
  });

  describe('validatePhone', () => {
    it('should accept valid phone formats', () => {
      expect(() => validatePhone('123-456-7890')).not.toThrow();
      expect(() => validatePhone('(123) 456-7890')).not.toThrow();
      expect(() => validatePhone('123.456.7890')).not.toThrow();
      expect(() => validatePhone('1234567890')).not.toThrow();
      expect(() => validatePhone('+1 123-456-7890')).not.toThrow();
    });

    it('should reject invalid phone formats', () => {
      expect(() => validatePhone('123')).toThrow(ValidationError);
      expect(() => validatePhone('123-45-67890')).toThrow(ValidationError);
      expect(() => validatePhone('abc-def-ghij')).toThrow(ValidationError);
      expect(() => validatePhone('')).toThrow(ValidationError);
    });
  });

  describe('validateAddress', () => {
    it('should accept valid address with all fields', () => {
      const validAddress = {
        street: '123 Main St',
        city: 'San Jose',
        state: 'CA',
        zipCode: '95123',
        country: 'USA'
      };
      expect(() => validateAddress(validAddress)).not.toThrow();
    });

    it('should reject address with missing required fields', () => {
      const invalidAddress = {
        street: '123 Main St',
        city: 'San Jose',
        state: 'CA',
        zipCode: '95123'
      };
      expect(() => validateAddress(invalidAddress as any)).toThrow(ValidationError);
    });

    it('should reject address with invalid state', () => {
      const invalidAddress = {
        street: '123 Main St',
        city: 'San Jose',
        state: 'XX',
        zipCode: '95123',
        country: 'USA'
      };
      expect(() => validateAddress(invalidAddress)).toThrow(ValidationError);
    });

    it('should reject address with invalid ZIP code', () => {
      const invalidAddress = {
        street: '123 Main St',
        city: 'San Jose',
        state: 'CA',
        zipCode: '9512',
        country: 'USA'
      };
      expect(() => validateAddress(invalidAddress)).toThrow(ValidationError);
    });
  });
});