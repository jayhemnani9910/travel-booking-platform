import { AirportMetadata, ALL_AIRPORTS } from '../data/us-airports';

export interface AirportMatch {
  airport: AirportMetadata;
  score: number;
  matchedField: 'iata' | 'city' | 'name' | 'alias' | 'metro';
  input: string;
}

export interface ResolveAirportOptions {
  includeNearby?: boolean;
  maxResults?: number;
}

const AIRPORT_BY_CODE = new Map(ALL_AIRPORTS.map((airport) => [airport.iata.toUpperCase(), airport]));

const normalize = (value: string) => value.trim().toLowerCase();
const AIRPORT_CODE_REGEX = /^[A-Za-z]{3}$/;

export const formatAirportLabel = (airport: AirportMetadata) =>
  `${airport.city}${airport.state ? `, ${airport.state}` : ''} (${airport.iata}) · ${airport.name}`;

export function isLikelyAirportCode(value?: string | null): value is string {
  if (!value) return false;
  return AIRPORT_CODE_REGEX.test(value.trim());
}

export function getAirportByCode(code?: string | null): AirportMetadata | undefined {
  if (!code) return undefined;
  return AIRPORT_BY_CODE.get(code.trim().toUpperCase());
}

function scoreAirport(query: string, airport: AirportMetadata): AirportMatch | null {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return null;
  }

  // No aliases in generated data yet - can be added later
  const aliasMatches: string[] = [];
  const normalizedCity = normalize(airport.city);
  const normalizedName = normalize(airport.name);
  const normalizedMetro = airport.metroCode ? normalize(airport.metroCode) : undefined;
  const normalizedIata = airport.iata.toLowerCase();

  let score = 0;
  let matchedField: AirportMatch['matchedField'] = 'name';

  if (normalizedIata === normalizedQuery) {
    score = 120;
    matchedField = 'iata';
  } else if (normalizedIata.startsWith(normalizedQuery)) {
    score = 95;
    matchedField = 'iata';
  }

  if (normalizedCity === normalizedQuery) {
    score = Math.max(score, 110);
    matchedField = 'city';
  } else if (normalizedCity.startsWith(normalizedQuery)) {
    score = Math.max(score, 90);
    matchedField = 'city';
  } else if (normalizedCity.includes(normalizedQuery)) {
    score = Math.max(score, 70);
    matchedField = 'city';
  }

  if (normalizedName === normalizedQuery) {
    score = Math.max(score, 100);
    matchedField = 'name';
  } else if (normalizedName.includes(normalizedQuery)) {
    score = Math.max(score, 75);
    matchedField = 'name';
  }

  const aliasHit = aliasMatches.find((alias) => alias === normalizedQuery || alias.startsWith(normalizedQuery) || alias.includes(normalizedQuery));
  if (aliasHit) {
    score = Math.max(score, 80);
    matchedField = 'alias';
  }

  if (normalizedMetro && normalizedMetro === normalizedQuery) {
    score = Math.max(score, 85);
    matchedField = 'metro';
  }

  if (score === 0) {
    return null;
  }

  return {
    airport,
    score,
    matchedField,
    input: query
  };
}

function dedupeAirports(matches: AirportMatch[]) {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = match.airport.iata;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function searchAirports(query: string, options?: ResolveAirportOptions): AirportMatch[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return [];
  }

  const matches = ALL_AIRPORTS.map((airport) => scoreAirport(query, airport))
    .filter((match): match is AirportMatch => Boolean(match))
    .sort((a, b) => b.score - a.score);

  const maxResults = options?.maxResults ?? 8;
  return matches.slice(0, maxResults);
}

export function resolveAirportQuery(query: string, options?: ResolveAirportOptions): AirportMatch[] {
  if (!query?.trim()) {
    return [];
  }

  const baseMaxResults = options?.maxResults ?? 5;
  const baseMatches = searchAirports(query, { maxResults: baseMaxResults });
  if (baseMatches.length === 0) {
    return baseMatches;
  }

  if (options?.includeNearby === false) {
    return baseMatches;
  }

  const anchorMetro = baseMatches[0].airport.metroCode;
  if (!anchorMetro) {
    return baseMatches;
  }

  const metroMatches = ALL_AIRPORTS
    .filter((airport) => airport.metroCode === anchorMetro)
    .map((airport) => ({
      airport,
      score: baseMatches[0].score - 5,
      matchedField: 'metro' as const,
      input: query
    }));

  return dedupeAirports([...baseMatches, ...metroMatches]).slice(0, baseMaxResults);
}

export function getNearbyAirportCodes(code: string): string[] {
  const airport = getAirportByCode(code);
  if (!airport?.metroCode) {
    return airport ? [airport.iata] : [];
  }
  return ALL_AIRPORTS.filter((item) => item.metroCode === airport.metroCode).map((item) => item.iata);
}
