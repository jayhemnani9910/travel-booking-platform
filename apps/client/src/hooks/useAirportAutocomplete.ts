import { useState, useEffect, useCallback, useRef } from 'react';
import { airportsApi } from '../services/api';

export interface AirportSuggestion {
  iata: string;
  icao?: string;
  name: string;
  city: string;
  state?: string;
  country: string;
  timezone?: string;
  latitude: number;
  longitude: number;
  metroCode?: string;
  label: string;
  score: number;
  matchedField: string;
}

export interface UseAirportAutocompleteResult {
  suggestions: AirportSuggestion[];
  loading: boolean;
  error: string | null;
  search: (query: string) => void;
  clear: () => void;
}

export function useAirportAutocomplete(
  minChars: number = 2,
  debounceMs: number = 300
): UseAirportAutocompleteResult {
  const [suggestions, setSuggestions] = useState<AirportSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    setSuggestions([]);
    setError(null);
    setLoading(false);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const search = useCallback(
    (query: string) => {
      // Cancel any pending debounced search
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Abort any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const trimmed = query.trim();

      if (trimmed.length < minChars) {
        clear();
        return;
      }

      setLoading(true);
      setError(null);

      debounceTimerRef.current = setTimeout(async () => {
        try {
          const controller = new AbortController();
          abortControllerRef.current = controller;

          const response = await airportsApi.suggest(trimmed, 8, controller.signal);
          if (controller.signal.aborted) return;
          const data = response.data?.data?.suggestions || [];

          setSuggestions(data);
          setLoading(false);
        } catch (err: any) {
          if (err.name === 'CanceledError' || err.name === 'AbortError') {
            // Ignore aborted requests
            return;
          }
          console.error('Airport autocomplete error:', err);
          setError('Failed to load airport suggestions');
          setSuggestions([]);
          setLoading(false);
        }
      }, debounceMs);
    },
    [minChars, debounceMs, clear]
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return { suggestions, loading, error, search, clear };
}
