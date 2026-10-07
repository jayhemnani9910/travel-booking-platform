/**
 * Validators for common data validation across services
 */

import { Address } from '../models/common';

export class ValidationError extends Error {
  constructor(message: string, public field: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// US States whitelist with full names
export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

export const US_STATES_FULL = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'
];

/**
 * Validate Social Security Number format: ###-##-####
 * Raises 'invalid_driver_id' exception for non-matching patterns
 */
export function validateSSN(ssn: string): void {
  if (!ssn) {
    throw new ValidationError('SSN is required', 'ssn');
  }
  
  const ssnRegex = /^\d{3}-\d{2}-\d{4}$/;
  if (!ssnRegex.test(ssn)) {
    throw new ValidationError('Invalid SSN format. Expected: ###-##-####', 'ssn');
  }
}

/**
 * Validate US state code or full name
 * Raises 'malformed_state' exception for invalid states
 */
export function validateState(state: string): void {
  if (!state) {
    throw new ValidationError('State is required', 'state');
  }
  
  const upperState = state.toUpperCase();
  const lowerState = state.toLowerCase();
  
  if (US_STATES.includes(upperState) || 
      US_STATES_FULL.some(s => s.toLowerCase() === lowerState)) {
    return;
  }
  
  throw new ValidationError(`Invalid US state: ${state}`, 'state');
}

/**
 * Validate ZIP code per spec examples
 *
 * SPEC CLARIFICATION REQUIRED:
 * - Spec pattern states: "##### or #####-####" (5-digit or ZIP+4 format)
 * - Spec examples include: "12" as VALID (2-digit)
 * - This is a CONTRADICTION that should be resolved with stakeholders
 *
 * CURRENT IMPLEMENTATION follows spec EXAMPLES (accepts 2-digit):
 * Valid: 95123, 12, 95192, 10293, 90086-1929 (2-digit, 5-digit, or 5+4-digit)
 * Invalid: 1247 (4 digits), 1829A (contains letter), 37849-392 (wrong format), 2374-2384 (wrong format)
 *
 * To change to match spec PATTERN (reject 2-digit), update regex to: /^(\d{5}|\d{5}-\d{4})$/
 */
export function validateZipCode(zipCode: string): void {
  if (!zipCode) {
    throw new ValidationError('ZIP code is required', 'zipCode');
  }

  // Accept: exactly 2 digits OR exactly 5 digits OR 5 digits + hyphen + 4 digits
  // Following spec EXAMPLES (which include 2-digit "12" as valid)
  const zipRegex = /^(\d{2}|\d{5}|\d{5}-\d{4})$/;
  if (!zipRegex.test(zipCode)) {
    throw new ValidationError('Invalid ZIP code format. Expected: 2 digits, 5 digits, or 5+4 (e.g., 12, 95123, 90086-1929)', 'zipCode');
  }
}

/**
 * Validate email format
 */
export function validateEmail(email: string): void {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ValidationError('Invalid email format', 'email');
  }
}

/**
 * Validate phone number format
 */
export function validatePhone(phone: string): void {
  const phoneRegex = /^\+?1?[-.\s]?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})$/;
  if (!phoneRegex.test(phone)) {
    throw new ValidationError('Invalid phone number format', 'phone');
  }
}

/**
 * Validate address
 */
export function validateAddress(address: Address): void {
  if (!address.street || !address.city || !address.state || !address.zipCode || !address.country) {
    throw new ValidationError('Address must have all required fields', 'address');
  }
  
  validateState(address.state);
  validateZipCode(address.zipCode);
}

/**
 * Generate idempotency key
 */
export function generateIdempotencyKey(): string {
  return `idem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}