import { jest } from '@jest/globals';
import { config } from 'dotenv';

// Load test environment
config({ path: '.env.test' });

// Suppress console logs during tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn()
};
