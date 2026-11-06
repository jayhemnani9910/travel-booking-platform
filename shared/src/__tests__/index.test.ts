// The real airport data module imports a generated JSON file; replace it with a tiny fixture.
jest.mock('../data/us-airports', () => {
  const sfo = {
    id: 1,
    iata: 'SFO',
    name: 'San Francisco International Airport',
    city: 'San Francisco',
    state: 'CA',
    country: 'United States',
    isoCountry: 'US',
    latitude: 0,
    longitude: 0,
    type: 'large_airport'
  };
  return { ALL_AIRPORTS: [sfo], US_AIRPORTS: [sfo] };
});

import * as shared from '../index';
import * as airports from '../lib/airports';
import * as validators from '../validators/common';
import * as contracts from '../contracts/common';
import * as airportData from '../data/us-airports';

describe('shared package entry point', () => {
  it('exposes exactly the public runtime API', () => {
    expect(Object.keys(shared).sort()).toEqual([
      'ALL_AIRPORTS',
      'US_AIRPORTS',
      'US_STATES',
      'US_STATES_FULL',
      'ValidationError',
      'formatAirportLabel',
      'generateIdempotencyKey',
      'generateTraceId',
      'getAirportByCode',
      'getNearbyAirportCodes',
      'isLikelyAirportCode',
      'resolveAirportQuery',
      'searchAirports',
      'validateAddress',
      'validateEmail',
      'validatePhone',
      'validateSSN',
      'validateState',
      'validateZipCode'
    ]);
  });

  it('forwards each export from its source module', () => {
    expect(shared.generateTraceId).toBe(contracts.generateTraceId);

    expect(shared.ValidationError).toBe(validators.ValidationError);
    expect(shared.US_STATES).toBe(validators.US_STATES);
    expect(shared.US_STATES_FULL).toBe(validators.US_STATES_FULL);
    expect(shared.validateSSN).toBe(validators.validateSSN);
    expect(shared.validateState).toBe(validators.validateState);
    expect(shared.validateZipCode).toBe(validators.validateZipCode);
    expect(shared.validateEmail).toBe(validators.validateEmail);
    expect(shared.validatePhone).toBe(validators.validatePhone);
    expect(shared.validateAddress).toBe(validators.validateAddress);
    expect(shared.generateIdempotencyKey).toBe(validators.generateIdempotencyKey);

    expect(shared.US_AIRPORTS).toBe(airportData.US_AIRPORTS);
    expect(shared.ALL_AIRPORTS).toBe(airportData.ALL_AIRPORTS);

    expect(shared.formatAirportLabel).toBe(airports.formatAirportLabel);
    expect(shared.searchAirports).toBe(airports.searchAirports);
    expect(shared.resolveAirportQuery).toBe(airports.resolveAirportQuery);
    expect(shared.getAirportByCode).toBe(airports.getAirportByCode);
    expect(shared.getNearbyAirportCodes).toBe(airports.getNearbyAirportCodes);
    expect(shared.isLikelyAirportCode).toBe(airports.isLikelyAirportCode);
  });

  it('wires the airport helpers to the airport data', () => {
    expect(shared.getAirportByCode('sfo')?.city).toBe('San Francisco');
    expect(shared.isLikelyAirportCode('SFO')).toBe(true);
  });
});
