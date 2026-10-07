import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plane, Hotel, Car, MapPin, Calendar, Users, TrendingUp, Loader2 } from 'lucide-react';
import { Button, Card } from '../components/ui';
import { useAirportAutocomplete } from '../hooks/useAirportAutocomplete';

type TravelType = 'flights' | 'hotels' | 'cars';

interface RecentSearch {
  type: TravelType;
  origin?: string;
  destination: string;
  date: string;
}

const POPULAR_DESTINATIONS = [
  { city: 'New York', code: 'JFK', image: '🗽' },
  { city: 'Los Angeles', code: 'LAX', image: '🌴' },
  { city: 'Miami', code: 'MIA', image: '🏖️' },
  { city: 'Las Vegas', code: 'LAS', image: '🎰' },
  { city: 'San Francisco', code: 'SFO', image: '🌉' },
  { city: 'Chicago', code: 'ORD', image: '🏙️' }
];

const TRAVEL_TYPES: TravelType[] = ['flights', 'hotels', 'cars'];

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const typeParam = searchParams.get('type') as TravelType | null;
  const [travelType, setTravelType] = useState<TravelType>(
    typeParam && TRAVEL_TYPES.includes(typeParam) ? typeParam : 'flights'
  );
  const [formData, setFormData] = useState({
    origin: '',
    destination: searchParams.get('destination') || '',
    departureDate: '',
    returnDate: '',
    passengers: 1,
    rooms: 1,
    guests: 1
  });
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [showOriginSuggestions, setShowOriginSuggestions] = useState(false);
  const [showDestSuggestions, setShowDestSuggestions] = useState(false);
  const navigate = useNavigate();
  
  // Airport autocomplete hooks
  const originAutocomplete = useAirportAutocomplete();
  const destAutocomplete = useAirportAutocomplete();

  // Follow the header's Flights/Stays/Cars links (?type=)
  useEffect(() => {
    if (typeParam && TRAVEL_TYPES.includes(typeParam)) {
      setTravelType(typeParam);
    }
  }, [typeParam]);

  const selectType = (type: TravelType) => {
    setTravelType(type);
    setSearchParams({ type }, { replace: true });
  };

  useEffect(() => {
    const stored = localStorage.getItem('recentSearches');
    if (stored) {
      try {
        setRecentSearches(JSON.parse(stored));
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  const saveSearch = () => {
    const search: RecentSearch = {
      type: travelType,
      origin: formData.origin || undefined,
      destination: formData.destination,
      date: formData.departureDate
    };
    
    const updated = [search, ...recentSearches.filter(
      s => !(s.type === search.type && s.destination === search.destination)
    )].slice(0, 5);
    
    setRecentSearches(updated);
    localStorage.setItem('recentSearches', JSON.stringify(updated));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveSearch();
    const params: Record<string, string> = {
      type: travelType,
      origin: formData.origin,
      destination: formData.destination,
      departureDate: formData.departureDate,
      returnDate: formData.returnDate,
      passengers: String(formData.passengers),
      rooms: String(formData.rooms),
      guests: String(formData.guests)
    };
    const searchParams = new URLSearchParams(params);
    navigate(`/results/${travelType}?${searchParams}`);
  };

  const handleQuickSearch = (destination: string, code?: string) => {
    setFormData({
      ...formData,
      destination: code || destination
    });
    setShowDestSuggestions(false);
  };

  const filteredDestinations = POPULAR_DESTINATIONS.filter(dest =>
    dest.city.toLowerCase().includes(formData.destination.toLowerCase()) ||
    dest.code.toLowerCase().includes(formData.destination.toLowerCase())
  );

  const getFormFields = () => {
    switch (travelType) {
      case 'flights':
        return (
          <>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  className="input pl-10"
                  placeholder="JFK, New York, or San Francisco"
                  value={formData.origin}
                  onChange={(e) => {
                    setFormData({...formData, origin: e.target.value});
                    originAutocomplete.search(e.target.value);
                  }}
                  onFocus={() => {
                    setShowOriginSuggestions(true);
                    if (formData.origin) originAutocomplete.search(formData.origin);
                  }}
                  onBlur={() => setTimeout(() => setShowOriginSuggestions(false), 200)}
                />
                {originAutocomplete.loading && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 animate-spin" />
                )}
              </div>
              {showOriginSuggestions && originAutocomplete.suggestions.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white rounded-lg shadow-lg border border-gray-200 max-h-60 overflow-auto">
                  {originAutocomplete.suggestions.map((airport) => (
                    <button
                      key={airport.iata}
                      type="button"
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-3 transition-colors"
                      onClick={() => {
                        setFormData({...formData, origin: airport.iata});
                        setShowOriginSuggestions(false);
                        originAutocomplete.clear();
                      }}
                    >
                      <div className="flex-shrink-0 w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                        <Plane className="w-5 h-5 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{airport.city}</div>
                        <div className="text-sm text-gray-500 truncate">{airport.iata} · {airport.name}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  className="input pl-10"
                  placeholder="LAX, Los Angeles, or Miami"
                  value={formData.destination}
                  onChange={(e) => {
                    setFormData({...formData, destination: e.target.value});
                    destAutocomplete.search(e.target.value);
                  }}
                  onFocus={() => {
                    setShowDestSuggestions(true);
                    if (formData.destination) destAutocomplete.search(formData.destination);
                  }}
                  onBlur={() => setTimeout(() => setShowDestSuggestions(false), 200)}
                />
                {destAutocomplete.loading && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 animate-spin" />
                )}
              </div>
              {showDestSuggestions && destAutocomplete.suggestions.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white rounded-lg shadow-lg border border-gray-200 max-h-60 overflow-auto">
                  {destAutocomplete.suggestions.map((airport) => (
                    <button
                      key={airport.iata}
                      type="button"
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-3 transition-colors"
                      onClick={() => {
                        setFormData({...formData, destination: airport.iata});
                        setShowDestSuggestions(false);
                        destAutocomplete.clear();
                      }}
                    >
                      <div className="flex-shrink-0 w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                        <Plane className="w-5 h-5 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{airport.city}</div>
                        <div className="text-sm text-gray-500 truncate">{airport.iata} · {airport.name}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Departure</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="date"
                  className="input pl-10"
                  value={formData.departureDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setFormData({...formData, departureDate: e.target.value})}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Return</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="date"
                  className="input pl-10"
                  value={formData.returnDate}
                  min={formData.departureDate || new Date().toISOString().split('T')[0]}
                  onChange={(e) => setFormData({...formData, returnDate: e.target.value})}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Passengers</label>
              <div className="relative">
                <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <select
                  className="input pl-10"
                  value={formData.passengers}
                  onChange={(e) => setFormData({...formData, passengers: Number(e.target.value)})}
                >
                  {[1,2,3,4,5,6,7,8,9].map(n => (
                    <option key={n} value={n}>{n} {n === 1 ? 'passenger' : 'passengers'}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        );
      case 'hotels':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Destination</label>
              <input
                type="text"
                className="input"
                placeholder="New York"
                value={formData.destination}
                onChange={(e) => setFormData({...formData, destination: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Check-in</label>
              <input
                type="date"
                className="input"
                value={formData.departureDate}
                onChange={(e) => setFormData({...formData, departureDate: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Check-out</label>
              <input
                type="date"
                className="input"
                value={formData.returnDate}
                onChange={(e) => setFormData({...formData, returnDate: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Guests</label>
              <select
                className="input"
                value={formData.guests}
                onChange={(e) => setFormData({...formData, guests: Number(e.target.value)})}
              >
                {[1,2,3,4,5,6,7,8].map(n => (
                  <option key={n} value={n}>{n} {n === 1 ? 'guest' : 'guests'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rooms</label>
              <select
                className="input"
                value={formData.rooms}
                onChange={(e) => setFormData({...formData, rooms: Number(e.target.value)})}
              >
                {[1,2,3,4,5].map(n => (
                  <option key={n} value={n}>{n} {n === 1 ? 'room' : 'rooms'}</option>
                ))}
              </select>
            </div>
          </>
        );
      case 'cars':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pickup Location</label>
              <input
                type="text"
                className="input"
                placeholder="Los Angeles Airport"
                value={formData.destination}
                onChange={(e) => setFormData({...formData, destination: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Drop-off Location</label>
              <input
                type="text"
                className="input"
                placeholder="Same as pickup"
                value={formData.origin}
                onChange={(e) => setFormData({...formData, origin: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pickup Date</label>
              <input
                type="date"
                className="input"
                value={formData.departureDate}
                onChange={(e) => setFormData({...formData, departureDate: e.target.value})}
              />
            </div>
            <div>
              <label htmlFor="return-date-car" className="block text-sm font-medium text-gray-700 mb-1">Return Date</label>
              <input
                id="return-date-car"
                type="date"
                className="input"
                value={formData.returnDate}
                onChange={(e) => setFormData({...formData, returnDate: e.target.value})}
                title="Select return date"
              />
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] gradient-bg">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="mb-8 text-center animate-fade-in">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 mb-3 text-shadow">
            Search flights, stays and cars in one place
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Flights, stays, and car rentals in one place – compare deals and build your perfect trip.
          </p>
        </div>

        <div className="search-form animate-slide-up">
          <div className="flex justify-center mb-6">
            <div className="bg-gray-100 p-1 rounded-full flex text-sm shadow-sm">
              <button
                onClick={() => selectType('flights')}
                className={`flex items-center px-6 py-2.5 rounded-full transition-all duration-300 ${
                  travelType === 'flights' 
                    ? 'bg-white shadow-md text-gray-900 transform scale-105' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Plane className="w-4 h-4 mr-2" />
                Flights
              </button>
              <button
                onClick={() => selectType('hotels')}
                className={`flex items-center px-6 py-2.5 rounded-full transition-all duration-300 ${
                  travelType === 'hotels' 
                    ? 'bg-white shadow-md text-gray-900 transform scale-105' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Hotel className="w-4 h-4 mr-2" />
                Hotels
              </button>
              <button
                onClick={() => selectType('cars')}
                className={`flex items-center px-6 py-2.5 rounded-full transition-all duration-300 ${
                  travelType === 'cars' 
                    ? 'bg-white shadow-md text-gray-900 transform scale-105' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Car className="w-4 h-4 mr-2" />
                Cars
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
            {getFormFields()}
            <div className="lg:col-span-1 md:col-span-2 flex justify-end">
              <Button type="submit" size="lg" fullWidth className="md:w-auto md:px-8">
                Search {travelType.charAt(0).toUpperCase() + travelType.slice(1)}
              </Button>
            </div>
          </form>
        </div>

        {recentSearches.length > 0 && (
          <div className="mt-8 max-w-5xl mx-auto animate-fade-in">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <TrendingUp className="w-5 h-5 mr-2 text-brand" />
              Recent Searches
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentSearches.slice(0, 3).map((search, idx) => (
                <Card
                  key={idx}
                  hover
                  padding="sm"
                  onClick={() => {
                    selectType(search.type);
                    setFormData({
                      ...formData,
                      origin: search.origin || '',
                      destination: search.destination,
                      departureDate: search.date
                    });
                  }}
                  className="cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {search.type === 'flights' && <Plane className="w-5 h-5 text-brand" />}
                      {search.type === 'hotels' && <Hotel className="w-5 h-5 text-brand" />}
                      {search.type === 'cars' && <Car className="w-5 h-5 text-brand" />}
                      <div>
                        <div className="font-medium text-sm">
                          {search.origin ? `${search.origin} → ` : ''}{search.destination}
                        </div>
                        <div className="text-xs text-gray-500">{search.date}</div>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div className="mt-12 max-w-5xl mx-auto animate-fade-in">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Popular Destinations</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {POPULAR_DESTINATIONS.map((dest) => (
              <Card
                key={dest.code}
                hover
                padding="sm"
                onClick={() => handleQuickSearch(dest.city, dest.code)}
                className="text-center cursor-pointer"
              >
                <div className="text-4xl mb-2">{dest.image}</div>
                <div className="font-medium text-sm">{dest.city}</div>
                <div className="text-xs text-gray-500">{dest.code}</div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
