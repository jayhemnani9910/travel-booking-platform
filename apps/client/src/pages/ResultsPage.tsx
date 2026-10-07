import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { flightsApi, hotelsApi, carsApi } from '../services/api';
import { Filter, Star, MapPin, Clock, Heart, ArrowUpDown, Grid, List, Hotel } from 'lucide-react';
import { Button, Badge, Skeleton, SkeletonCard, Pagination, useToast } from '../components/ui';

export function ResultsPage() {
  const { type } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [sortBy, setSortBy] = useState('recommended');
  const [currentPage, setCurrentPage] = useState(1);
  const resultsPerPage = 10;
  const emptyFilters = {
    priceRange: [0, 1000],
    maxPrice: '',
    directOnly: false,
    starRating: [] as number[],
    amenities: [] as string[],
    carType: [] as string[],
    transmission: [] as string[],
    departureTime: '',
    arrivalTime: ''
  };
  const [filters, setFilters] = useState(emptyFilters);
  const displayTypeName = type ? `${type.charAt(0).toUpperCase()}${type.slice(1)}` : 'Travel';
  const typeLabel = type ?? 'options';

  useEffect(() => {
    search();
    const storedFavorites = localStorage.getItem('favorites');
    if (storedFavorites) {
      try {
        setFavorites(new Set(JSON.parse(storedFavorites)));
      } catch {
        // Ignore parse errors
      }
    }
  }, [type, searchParams]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  const toggleFavorite = (id: string) => {
    setFavorites(prev => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(id)) {
        newFavorites.delete(id);
        showToast('info', 'Removed from favorites');
      } else {
        newFavorites.add(id);
        showToast('success', 'Added to favorites');
      }
      localStorage.setItem('favorites', JSON.stringify(Array.from(newFavorites)));
      return newFavorites;
    });
  };

  const sortResults = (data: any[]) => {
    const sorted = [...data];
    switch (sortBy) {
      case 'price-low':
        return sorted.sort((a, b) => {
          const priceA = a.price || a.pricePerNight || a.dailyRate || 0;
          const priceB = b.price || b.pricePerNight || b.dailyRate || 0;
          return priceA - priceB;
        });
      case 'price-high':
        return sorted.sort((a, b) => {
          const priceA = a.price || a.pricePerNight || a.dailyRate || 0;
          const priceB = b.price || b.pricePerNight || b.dailyRate || 0;
          return priceB - priceA;
        });
      case 'rating':
        return sorted.sort((a, b) => (b.starRating || 0) - (a.starRating || 0));
      case 'duration':
        return sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0));
      default:
        return sorted;
    }
  };

  const search = async (activeFilters = filters) => {
    setLoading(true);
    setCurrentPage(1);
    try {
      const params = Object.fromEntries(searchParams.entries());
      
      let response;
      if (type === 'flights') {
        response = await flightsApi.searchFlights({
          origin: params.origin,
          destination: params.destination,
          departureDate: params.departureDate,
          returnDate: params.returnDate,
          passengers: Number(params.passengers) || 1,
          maxPrice: activeFilters.maxPrice ? Number(activeFilters.maxPrice) : undefined,
          directOnly: activeFilters.directOnly
        });
        setResults(response.data.data.flights || []);
      } else if (type === 'hotels') {
        response = await hotelsApi.searchHotels({
          destination: params.destination || params.location,
          checkIn: params.checkIn || params.departureDate,
          checkOut: params.checkOut || params.returnDate,
          guests: Number(params.guests) || 1,
          rooms: Number(params.rooms) || 1,
          maxPrice: activeFilters.maxPrice ? Number(activeFilters.maxPrice) : undefined,
          minStarRating: activeFilters.starRating.length > 0 ? Math.min(...activeFilters.starRating) : undefined
        });
        setResults(response.data.data.hotels || []);
      } else if (type === 'cars') {
        response = await carsApi.searchCars({
          location: params.location || params.destination,
          pickupDate: params.pickupDate || params.departureDate,
          returnDate: params.returnDate,
          maxPrice: activeFilters.maxPrice ? Number(activeFilters.maxPrice) : undefined
        });
        setResults(response.data.data.cars || []);
      }
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const timeBuckets: Record<string, [number, number]> = {
    morning: [6, 12],
    afternoon: [12, 18],
    evening: [18, 24],
    night: [0, 6]
  };

  const inTimeBucket = (value: string | undefined, bucket: string) => {
    if (!bucket) return true;
    const hour = value ? new Date(value).getHours() : NaN;
    const [from, to] = timeBuckets[bucket];
    return hour >= from && hour < to;
  };

  const matchesAny = (value: string | undefined, selected: string[]) =>
    selected.length === 0 || selected.some(s => s.toLowerCase() === (value || '').toLowerCase());

  // These filters are not supported by the search APIs, so they run on the loaded results
  const applyClientFilters = (data: any[]) => data.filter(item => {
    if (type === 'flights') {
      return inTimeBucket(item.departureTime, filters.departureTime) &&
        inTimeBucket(item.arrivalTime, filters.arrivalTime);
    }
    if (type === 'hotels') {
      const amenities: string[] = (item.amenities || []).map((a: string) => a.toLowerCase());
      return filters.amenities.every(a => amenities.includes(a.toLowerCase()));
    }
    if (type === 'cars') {
      return matchesAny(item.vehicleType || item.carType || item.category, filters.carType) &&
        matchesAny(item.transmission, filters.transmission);
    }
    return true;
  });

  const visibleResults = sortResults(applyClientFilters(results));
  const totalPages = Math.ceil(visibleResults.length / resultsPerPage);

  const getPaginatedResults = () => {
    const start = (currentPage - 1) * resultsPerPage;
    const end = start + resultsPerPage;
    return visibleResults.slice(start, end);
  };

  const renderFlight = (flight: any) => {
    const flightId = flight.id || flight._id;
    const isFavorite = favorites.has(flightId);
    return (
      <div
        key={flightId}
        className="bg-white rounded-lg shadow-sm hover:shadow-md transition-all p-6 border border-gray-200"
      >
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-lg font-semibold text-gray-900">{flight.airline}</h3>
              <Badge variant="default" size="sm">
                {flight.flightNumber}
              </Badge>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                <span>{typeof flight.origin === 'object' ? flight.origin.code : flight.origin} → {typeof flight.destination === 'object' ? flight.destination.code : flight.destination}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>{flight.duration || 'N/A'}</span>
              </div>
              {flight.stops === 0 && <Badge variant="success" size="sm">Direct</Badge>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-brand">${flight.price}</div>
            <div className="text-sm text-gray-500">per person</div>
          </div>
        </div>
        <div className="flex justify-between items-center pt-4 border-t border-gray-100">
          <button
            onClick={() => toggleFavorite(flightId)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
              isFavorite ? 'text-red-500 bg-red-50' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`} />
            <span className="text-sm">{isFavorite ? 'Saved' : 'Save'}</span>
          </button>
          <Button
            onClick={() =>
              navigate(`/flights/${flightId}`, {
                state: {
                  item: flight,
                  type: 'flight',
                  // Preserve search dates so booking can derive trip window
                  startDate: searchParams.get('departureDate'),
                  endDate: searchParams.get('returnDate') || searchParams.get('departureDate')
                }
              })
            }
          >
            View Details
          </Button>
        </div>
      </div>
    );
  };

  const renderHotel = (hotel: any) => {
    const hotelId = hotel.id || hotel._id;
    const isFavorite = favorites.has(hotelId);
    return (
      <div
        key={hotelId}
        className="bg-white rounded-lg shadow-sm hover:shadow-md transition-all overflow-hidden border border-gray-200"
      >
        <div className="flex flex-col md:flex-row">
          <div className="md:w-1/3 h-48 md:h-auto bg-gradient-to-br from-orange-100 to-orange-200 flex items-center justify-center">
            <Hotel className="w-16 h-16 text-orange-400" />
          </div>
          <div className="flex-1 p-6">
            <div className="flex justify-between items-start mb-3">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">{hotel.name}</h3>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex items-center">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className={`w-4 h-4 ${
                          i < hotel.starRating ? 'text-yellow-400 fill-current' : 'text-gray-300'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-sm text-gray-500">({hotel.starRating} stars)</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <MapPin className="w-4 h-4" />
                  <span>{hotel.location}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-brand">${hotel.pricePerNight}</div>
                <div className="text-sm text-gray-500">per night</div>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-4 line-clamp-2">
              {hotel.description || 'Comfortable accommodation with great amenities'}
            </p>
            <div className="flex justify-between items-center pt-4 border-t border-gray-100">
              <button
                onClick={() => toggleFavorite(hotelId)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
                  isFavorite ? 'text-red-500 bg-red-50' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`} />
                <span className="text-sm">{isFavorite ? 'Saved' : 'Save'}</span>
              </button>
              <Button
                onClick={() =>
                  navigate(`/hotels/${hotelId}`, {
                    state: {
                      item: hotel,
                      type: 'hotel',
                      startDate: searchParams.get('checkIn') || searchParams.get('departureDate'),
                      endDate: searchParams.get('checkOut') || searchParams.get('returnDate')
                    }
                  })
                }
              >
                View Details
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCar = (car: any) => {
    const carId = car.id || car._id;
    const isFavorite = favorites.has(carId);
    return (
      <div
        key={carId}
        className="bg-white rounded-lg shadow-sm hover:shadow-md transition-all p-6 border border-gray-200"
      >
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {car.make} {car.model}
            </h3>
            <div className="flex flex-wrap gap-2 mb-3">
              <Badge variant="default" size="sm">{car.category}</Badge>
              <Badge variant="default" size="sm">{car.transmission}</Badge>
              <Badge variant="default" size="sm">{car.seats} seats</Badge>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MapPin className="w-4 h-4" />
              <span>{typeof car.location === 'object' ? (car.location.code || car.location.name || JSON.stringify(car.location)) : car.location}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-brand">${car.dailyRate}</div>
            <div className="text-sm text-gray-500">per day</div>
          </div>
        </div>
        <div className="flex justify-between items-center pt-4 border-t border-gray-100">
          <button
            onClick={() => toggleFavorite(carId)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
              isFavorite ? 'text-red-500 bg-red-50' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`} />
            <span className="text-sm">{isFavorite ? 'Saved' : 'Save'}</span>
          </button>
          <Button
            onClick={() =>
              navigate(`/booking/cars/${carId}`, {
                state: {
                  item: car,
                  type: 'car',
                  startDate: searchParams.get('pickupDate') || searchParams.get('departureDate'),
                  endDate: searchParams.get('returnDate')
                }
              })
            }
          >
            Rent Car
          </Button>
        </div>
      </div>
    );
  };

  const renderResult = (result: any) => {
    if (type === 'flights') return renderFlight(result);
    if (type === 'hotels') return renderHotel(result);
    if (type === 'cars') return renderCar(result);
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {displayTypeName} Results
            </h1>
            <p className="text-gray-600">
              {loading ? 'Searching...' : `${visibleResults.length} ${typeLabel} found`}
            </p>
          </div>
          <Button variant="ghost" onClick={() => navigate('/')}>
            New Search
          </Button>
        </div>

        <div className="flex gap-6">
          {/* Filters Sidebar */}
          <div className="hidden lg:block w-64 flex-shrink-0">
            <div className="bg-white rounded-lg shadow-sm p-6 sticky top-4">
              <div className="flex items-center gap-2 mb-4">
                <Filter className="w-5 h-5 text-gray-700" />
                <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Max Price
                  </label>
                  <input
                    type="number"
                    className="input"
                    placeholder="Any"
                    value={filters.maxPrice}
                    onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
                  />
                </div>

                {type === 'flights' && (
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.directOnly}
                        onChange={(e) => setFilters({ ...filters, directOnly: e.target.checked })}
                        className="rounded border-gray-300 text-brand focus:ring-brand"
                      />
                      <span className="text-sm text-gray-700">Direct flights only</span>
                    </label>
                  </div>
                )}

                {type === 'flights' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Departure Time
                      </label>
                      <select
                        value={filters.departureTime}
                        onChange={(e) => setFilters({ ...filters, departureTime: e.target.value })}
                        className="input text-sm"
                        title="Select departure time"
                      >
                        <option value="">Any time</option>
                        <option value="morning">Morning (6am - 12pm)</option>
                        <option value="afternoon">Afternoon (12pm - 6pm)</option>
                        <option value="evening">Evening (6pm - 12am)</option>
                        <option value="night">Night (12am - 6am)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Arrival Time
                      </label>
                      <select
                        value={filters.arrivalTime}
                        onChange={(e) => setFilters({ ...filters, arrivalTime: e.target.value })}
                        className="input text-sm"
                        title="Select arrival time"
                      >
                        <option value="">Any time</option>
                        <option value="morning">Morning (6am - 12pm)</option>
                        <option value="afternoon">Afternoon (12pm - 6pm)</option>
                        <option value="evening">Evening (6pm - 12am)</option>
                        <option value="night">Night (12am - 6am)</option>
                      </select>
                    </div>
                  </>
                )}

                {type === 'hotels' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Star Rating
                      </label>
                      <div className="space-y-2">
                        {[5, 4, 3, 2, 1].map(rating => (
                          <label key={rating} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={filters.starRating.includes(rating)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setFilters({
                                    ...filters,
                                    starRating: [...filters.starRating, rating]
                                  });
                                } else {
                                  setFilters({
                                    ...filters,
                                    starRating: filters.starRating.filter(r => r !== rating)
                                  });
                                }
                              }}
                              className="rounded border-gray-300 text-brand focus:ring-brand"
                            />
                            <div className="flex items-center gap-1">
                              {[...Array(rating)].map((_, i) => (
                                <Star key={i} className="w-3 h-3 text-yellow-400 fill-current" />
                              ))}
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Amenities
                      </label>
                      <div className="space-y-2">
                        {['WiFi', 'Parking', 'Pool', 'Gym', 'Restaurant', 'Spa'].map(amenity => (
                          <label key={amenity} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={filters.amenities.includes(amenity)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setFilters({
                                    ...filters,
                                    amenities: [...filters.amenities, amenity]
                                  });
                                } else {
                                  setFilters({
                                    ...filters,
                                    amenities: filters.amenities.filter(a => a !== amenity)
                                  });
                                }
                              }}
                              className="rounded border-gray-300 text-brand focus:ring-brand"
                            />
                            <span className="text-sm text-gray-700">{amenity}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {type === 'cars' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Car Type
                      </label>
                      <div className="space-y-2">
                        {['Sedan', 'SUV', 'Luxury', 'Van', 'Convertible'].map(carType => (
                          <label key={carType} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={filters.carType.includes(carType)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setFilters({
                                    ...filters,
                                    carType: [...filters.carType, carType]
                                  });
                                } else {
                                  setFilters({
                                    ...filters,
                                    carType: filters.carType.filter(c => c !== carType)
                                  });
                                }
                              }}
                              className="rounded border-gray-300 text-brand focus:ring-brand"
                            />
                            <span className="text-sm text-gray-700">{carType}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Transmission
                      </label>
                      <div className="space-y-2">
                        {['Automatic', 'Manual'].map(trans => (
                          <label key={trans} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={filters.transmission.includes(trans)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setFilters({
                                    ...filters,
                                    transmission: [...filters.transmission, trans]
                                  });
                                } else {
                                  setFilters({
                                    ...filters,
                                    transmission: filters.transmission.filter(t => t !== trans)
                                  });
                                }
                              }}
                              className="rounded border-gray-300 text-brand focus:ring-brand"
                            />
                            <span className="text-sm text-gray-700">{trans}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <Button variant="secondary" fullWidth onClick={() => search()}>
                    Apply Filters
                  </Button>
                  <Button 
                    variant="ghost" 
                    fullWidth 
                    onClick={() => {
                      setFilters(emptyFilters);
                      search(emptyFilters);
                    }}
                  >
                    Clear All Filters
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="flex-1">
            <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <ArrowUpDown className="w-5 h-5 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">Sort by:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="input py-1.5 text-sm"
                  >
                    <option value="recommended">Recommended</option>
                    <option value="price-low">Price: Low to High</option>
                    <option value="price-high">Price: High to Low</option>
                    {type === 'hotels' && <option value="rating">Star Rating</option>}
                    {type === 'flights' && <option value="duration">Duration</option>}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-2 rounded-lg transition-colors ${
                      viewMode === 'list' ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <List className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-2 rounded-lg transition-colors ${
                      viewMode === 'grid' ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <Grid className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : visibleResults.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm p-12 text-center">
                <p className="text-gray-500 text-lg">No results found. Try adjusting your filters.</p>
              </div>
            ) : (
              <>
                <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'space-y-4'}>
                  {getPaginatedResults().map(renderResult)}
                </div>

                {totalPages > 1 && (
                  <div className="mt-8 flex justify-center">
                    <Pagination
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={setCurrentPage}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
