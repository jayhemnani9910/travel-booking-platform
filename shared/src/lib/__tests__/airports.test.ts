import type { AirportMetadata } from '../../data/airport-types';

// The real data module imports a generated JSON file; swap in a small fixture
// so the tests are deterministic and independent of the generated dataset.
jest.mock('../../data/us-airports', () => {
  const base = { country: 'United States', isoCountry: 'US', latitude: 0, longitude: 0, type: 'large_airport' };
  const airports: AirportMetadata[] = [
    { ...base, id: 1, iata: 'JFK', name: 'John F Kennedy International Airport', city: 'New York', state: 'NY', metroCode: 'NYC' },
    { ...base, id: 2, iata: 'LGA', name: 'LaGuardia Airport', city: 'New York', state: 'NY', metroCode: 'NYC' },
    { ...base, id: 3, iata: 'EWR', name: 'Liberty International Airport', city: 'Newark', state: 'NJ', metroCode: 'NYC' },
    { ...base, id: 4, iata: 'AUS', name: 'Bergstrom International Airport', city: 'Austin', state: 'TX' },
    { ...base, id: 5, iata: 'SFO', name: 'San Francisco International Airport', city: 'San Francisco', state: 'CA', metroCode: 'SFO' },
    { ...base, id: 6, iata: 'LHR', name: 'Heathrow Airport', city: 'London', country: 'United Kingdom', isoCountry: 'GB' }
  ];
  return { ALL_AIRPORTS: airports, US_AIRPORTS: airports.filter((a) => a.isoCountry === 'US') };
});

import {
  formatAirportLabel,
  isLikelyAirportCode,
  getAirportByCode,
  searchAirports,
  resolveAirportQuery,
  getNearbyAirportCodes
} from '../airports';

const codes = (matches: { airport: AirportMetadata }[]) => matches.map((m) => m.airport.iata);

describe('airports', () => {
  describe('formatAirportLabel', () => {
    it('includes the state when present', () => {
      expect(formatAirportLabel(getAirportByCode('JFK')!)).toBe('New York, NY (JFK) · John F Kennedy International Airport');
    });

    it('omits the state when missing', () => {
      expect(formatAirportLabel(getAirportByCode('LHR')!)).toBe('London (LHR) · Heathrow Airport');
    });
  });

  describe('isLikelyAirportCode', () => {
    it('accepts three letters in any case, ignoring surrounding whitespace', () => {
      expect(isLikelyAirportCode('JFK')).toBe(true);
      expect(isLikelyAirportCode('jfk')).toBe(true);
      expect(isLikelyAirportCode('  sFo ')).toBe(true);
    });

    it('rejects empty values and anything that is not exactly three letters', () => {
      expect(isLikelyAirportCode(undefined)).toBe(false);
      expect(isLikelyAirportCode(null)).toBe(false);
      expect(isLikelyAirportCode('')).toBe(false);
      expect(isLikelyAirportCode('JF')).toBe(false);
      expect(isLikelyAirportCode('JFKX')).toBe(false);
      expect(isLikelyAirportCode('J1K')).toBe(false);
    });
  });

  describe('getAirportByCode', () => {
    it('looks up case-insensitively and trims input', () => {
      expect(getAirportByCode(' jfk ')?.name).toBe('John F Kennedy International Airport');
    });

    it('returns undefined for empty or unknown codes', () => {
      expect(getAirportByCode(undefined)).toBeUndefined();
      expect(getAirportByCode(null)).toBeUndefined();
      expect(getAirportByCode('')).toBeUndefined();
      expect(getAirportByCode('ZZZ')).toBeUndefined();
    });
  });

  describe('searchAirports', () => {
    it('returns nothing for a blank query', () => {
      expect(searchAirports('')).toEqual([]);
      expect(searchAirports('   ')).toEqual([]);
    });

    it('returns nothing when no airport matches', () => {
      expect(searchAirports('zzzz')).toEqual([]);
    });

    it('scores an exact IATA match highest and keeps the raw input', () => {
      const [top] = searchAirports(' lhr ');
      expect(top).toMatchObject({ score: 120, matchedField: 'iata', input: ' lhr ' });
      expect(top.airport.iata).toBe('LHR');
    });

    it('scores an IATA prefix match', () => {
      const [top] = searchAirports('lh');
      expect(top.airport.iata).toBe('LHR');
      expect(top).toMatchObject({ score: 95, matchedField: 'iata' });
    });

    it('scores an exact city match above a city prefix match', () => {
      const results = searchAirports('new york');
      expect(codes(results)).toEqual(['JFK', 'LGA']);
      expect(results.every((r) => r.score === 110 && r.matchedField === 'city')).toBe(true);

      const prefix = searchAirports('newa');
      expect(codes(prefix)).toEqual(['EWR']);
      expect(prefix[0]).toMatchObject({ score: 90, matchedField: 'city' });
    });

    it('scores a city substring match', () => {
      const [top] = searchAirports('ondo');
      expect(top.airport.iata).toBe('LHR');
      expect(top).toMatchObject({ score: 70, matchedField: 'city' });
    });

    it('scores a name substring match above a city substring match', () => {
      const [top] = searchAirports('heathrow');
      expect(top.airport.iata).toBe('LHR');
      expect(top).toMatchObject({ score: 75, matchedField: 'name' });
    });

    it('scores an exact name match', () => {
      const [top] = searchAirports('LaGuardia Airport');
      expect(top.airport.iata).toBe('LGA');
      expect(top).toMatchObject({ score: 100, matchedField: 'name' });
    });

    it('matches on metro code', () => {
      const results = searchAirports('nyc');
      expect(codes(results)).toEqual(['JFK', 'LGA', 'EWR']);
      expect(results.every((r) => r.score === 85 && r.matchedField === 'metro')).toBe(true);
    });

    it('orders results by score, highest first', () => {
      const results = searchAirports('a');
      const scores = results.map((r) => r.score);
      expect(scores).toEqual([...scores].sort((x, y) => y - x));
      expect(results[0].score).toBe(95);
      expect(results[0].airport.iata).toBe('AUS');
    });

    it('limits results to 8 by default and honours maxResults', () => {
      expect(searchAirports('airport')).toHaveLength(6);
      expect(searchAirports('airport', { maxResults: 2 })).toHaveLength(2);
    });
  });

  describe('resolveAirportQuery', () => {
    it('returns nothing for a blank query', () => {
      expect(resolveAirportQuery('')).toEqual([]);
      expect(resolveAirportQuery('  ')).toEqual([]);
    });

    it('returns nothing when no airport matches', () => {
      expect(resolveAirportQuery('zzzz')).toEqual([]);
    });

    it('adds other airports in the same metro, scored just below the top match, without duplicates', () => {
      const results = resolveAirportQuery('JFK');
      expect(codes(results)).toEqual(['JFK', 'LGA', 'EWR']);
      expect(results[0]).toMatchObject({ score: 120, matchedField: 'iata' });
      expect(results.slice(1).every((r) => r.score === 115 && r.matchedField === 'metro' && r.input === 'JFK')).toBe(true);
    });

    it('keeps the base match when it is already in the metro list', () => {
      const results = resolveAirportQuery('new york');
      expect(codes(results)).toEqual(['JFK', 'LGA', 'EWR']);
      expect(results[1]).toMatchObject({ score: 110, matchedField: 'city' });
      expect(results[2]).toMatchObject({ score: 105, matchedField: 'metro' });
    });

    it('does not expand to the metro when includeNearby is false', () => {
      expect(codes(resolveAirportQuery('JFK', { includeNearby: false }))).toEqual(['JFK']);
    });

    it('does not expand when the top match has no metro code', () => {
      expect(codes(resolveAirportQuery('AUS'))).toEqual(['AUS']);
    });

    it('caps the combined list at maxResults', () => {
      expect(codes(resolveAirportQuery('JFK', { maxResults: 2 }))).toEqual(['JFK', 'LGA']);
    });
  });

  describe('getNearbyAirportCodes', () => {
    it('returns every airport in the same metro', () => {
      expect(getNearbyAirportCodes('lga')).toEqual(['JFK', 'LGA', 'EWR']);
    });

    it('returns just the airport itself when it has no metro', () => {
      expect(getNearbyAirportCodes('AUS')).toEqual(['AUS']);
    });

    it('returns an empty list for an unknown code', () => {
      expect(getNearbyAirportCodes('ZZZ')).toEqual([]);
    });
  });
});
