import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plane, Hotel, Car, TrendingDown, Clock, Bell, Tag, Filter } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, useToast } from '../components/ui';
import { useDeals, useWebSocket, useAuth } from '../hooks';

interface Deal {
  id: string;
  type: 'flight' | 'hotel' | 'car';
  title: string;
  description: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercentage: number;
  destination?: string;
  expiresAt: string;
  score?: number;
  tags?: string[];
}

const DealsPage: React.FC = () => {
  const { deals, loading, createPriceWatch } = useDeals();
  const { isConnected, lastMessage } = useWebSocket();
  const { showToast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [filter, setFilter] = useState<'all' | 'flight' | 'hotel' | 'car'>('all');
  const [sortBy, setSortBy] = useState<'discount' | 'expiry' | 'price'>('discount');
  const [liveDeals, setLiveDeals] = useState<Deal[]>(deals as Deal[]);

  useEffect(() => {
    setLiveDeals(deals as Deal[]);
  }, [deals]);

  useEffect(() => {
    // Update deals in real-time from WebSocket
    if (lastMessage && lastMessage.type === 'deal_alert') {
      const alert = lastMessage.data || {};
      // Price-watch alerts share this message type but are not deals; only list real deal payloads
      const isDeal = alert.id && typeof alert.discountedPrice === 'number' && typeof alert.originalPrice === 'number';
      if (isDeal) {
        setLiveDeals(prev => [alert as Deal, ...prev]);
      }
      showToast('info', `New deal alert: ${alert.title || alert.message || 'check your deals'}`);
    }
  }, [lastMessage, showToast]);

  const getTimeRemaining = (expiresAt: string) => {
    const now = new Date().getTime();
    const expiry = new Date(expiresAt).getTime();
    const diff = expiry - now;
    
    if (diff <= 0) return 'Expired';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'flight':
        return <Plane className="w-5 h-5" />;
      case 'hotel':
        return <Hotel className="w-5 h-5" />;
      case 'car':
        return <Car className="w-5 h-5" />;
      default:
        return null;
    }
  };

  const handlePriceWatch = async (deal: Deal) => {
    if (!user) {
      showToast('error', 'Please sign in to create a price watch');
      // redirect to login for convenience
      window.location.href = '/login';
      return;
    }

    const alertPrice = Math.max(1, Math.round(deal.discountedPrice || deal.originalPrice || 1));
    const result = await createPriceWatch({
      dealId: deal.id,
      userId: user.id,
      alertPrice,
      destination: deal.destination
    });

    if (result.success) {
      showToast('success', 'Price watch created! We\'ll notify you of any changes.');
    } else {
      showToast('error', result.error || 'Failed to create price watch');
    }
  };

  // Deals do not carry a bookable listing id, so start the search for that destination
  const handleBookNow = (deal: Deal) => {
    const params = new URLSearchParams({ type: `${deal.type}s` });
    if (deal.destination) params.set('destination', deal.destination);
    navigate(`/search?${params}`);
  };

  const filteredDeals = liveDeals.filter(deal => 
    filter === 'all' || deal.type === filter
  );

  const sortedDeals = [...filteredDeals].sort((a, b) => {
    switch (sortBy) {
      case 'discount':
        return b.discountPercentage - a.discountPercentage;
      case 'price':
        return a.discountedPrice - b.discountedPrice;
      case 'expiry':
        return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
      default:
        return 0;
    }
  });

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center">
                <TrendingDown className="w-10 h-10 text-brand mr-3" />
                Hot Deals
              </h1>
              <p className="text-gray-600">
                Limited-time offers on flights, hotels, and car rentals
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isConnected ? (
                <Badge variant="success" size="sm" className="flex items-center">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
                  Live Updates
                </Badge>
              ) : (
                <Badge variant="default" size="sm">Offline</Badge>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white rounded-lg shadow-sm p-4">
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={filter === 'all' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setFilter('all')}
              >
                All Deals ({liveDeals.length})
              </Button>
              <Button
                variant={filter === 'flight' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setFilter('flight')}
                icon={<Plane className="w-4 h-4" />}
              >
                Flights
              </Button>
              <Button
                variant={filter === 'hotel' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setFilter('hotel')}
                icon={<Hotel className="w-4 h-4" />}
              >
                Hotels
              </Button>
              <Button
                variant={filter === 'car' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setFilter('car')}
                icon={<Car className="w-4 h-4" />}
              >
                Cars
              </Button>
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="input py-2 px-3 text-sm"
            >
              <option value="discount">Highest Discount</option>
              <option value="price">Lowest Price</option>
              <option value="expiry">Ending Soon</option>
            </select>
          </div>
        </div>

        {/* Deals Grid */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-500">Loading deals...</p>
          </div>
        ) : sortedDeals.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <TrendingDown className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">No deals available</p>
              <p className="text-gray-400 text-sm mt-2">Check back soon for new offers!</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedDeals.map((deal) => {
              const timeRemaining = getTimeRemaining(deal.expiresAt);
              const isExpiringSoon = timeRemaining.includes('h') && !timeRemaining.includes('d');
              
              return (
                <Card key={deal.id} hover className="flex flex-col animate-fade-in">
                  <CardContent className="flex-1">
                    {/* Type Icon & Badge */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-brand">
                        {getTypeIcon(deal.type)}
                        <span className="font-medium capitalize">{deal.type}</span>
                      </div>
                      <Badge 
                        variant={isExpiringSoon ? 'danger' : 'warning'}
                        size="sm"
                        className="flex items-center"
                      >
                        <Clock className="w-3 h-3 mr-1" />
                        {timeRemaining}
                      </Badge>
                    </div>

                    {/* Title & Description */}
                    <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">
                      {deal.title}
                    </h3>
                    <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                      {deal.description}
                    </p>

                    {/* Tags */}
                    {deal.tags && deal.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {deal.tags.slice(0, 3).map((tag, idx) => (
                          <span key={idx} className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                            <Tag className="w-3 h-3 mr-1" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Pricing */}
                    <div className="mb-4">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-3xl font-bold text-brand">
                          ${deal.discountedPrice.toFixed(0)}
                        </span>
                        <span className="text-lg text-gray-400 line-through">
                          ${deal.originalPrice.toFixed(0)}
                        </span>
                      </div>
                      <Badge variant="success" size="lg">
                        Save {deal.discountPercentage}%
                      </Badge>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 mt-auto">
                      <Button
                        fullWidth
                        size="sm"
                        onClick={() => handleBookNow(deal)}
                      >
                        Book Now
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Bell className="w-4 h-4" />}
                        onClick={() => handlePriceWatch(deal)}
                        className="flex-shrink-0"
                      >
                        Watch
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default DealsPage;
