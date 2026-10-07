import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Plane, Clock, Calendar, Users, Briefcase, ShieldCheck, AlertCircle, Check, X as XIcon } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '../components/ui';
import { flightsApi } from '../services/api';

export function FlightDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [flight, setFlight] = useState<any>(location.state?.item || null);
  const [loading, setLoading] = useState(!flight);

  useEffect(() => {
    if (!flight && id) {
      fetchFlightDetails();
    }
  }, [id, flight]);

  const fetchFlightDetails = async () => {
    try {
      const response = await flightsApi.getFlight(id!);
      setFlight(response.data.data);
    } catch (error) {
      console.error('Failed to fetch flight details:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBookFlight = () => {
    navigate(`/booking/flights/${id}`, {
      state: {
        item: flight,
        type: 'flight',
        startDate: location.state?.startDate,
        endDate: location.state?.endDate
      }
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto mb-4" />
          <p className="text-gray-600">Loading flight details...</p>
        </div>
      </div>
    );
  }

  if (!flight) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="text-center py-12">
            <AlertCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Flight Not Found</h2>
            <p className="text-gray-600 mb-4">The flight you're looking for doesn't exist or has been removed.</p>
            <Button onClick={() => navigate('/search?type=flights')}>Search Flights</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // flights-svc returns origin/destination as airport objects; demo data uses plain codes
  const originCode = typeof flight.origin === 'object' ? flight.origin?.code : flight.origin;
  const destinationCode = typeof flight.destination === 'object' ? flight.destination?.code : flight.destination;
  const isDirect = !flight.stops || flight.stops === 0 || flight.stops === 'Direct';

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-6"
        >
          <XIcon className="w-4 h-4 mr-1" />
          Back to Results
        </button>

        {/* Flight Summary Card */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Plane className="w-6 h-6 text-brand" />
                  {flight.airline} {flight.flightNumber}
                </CardTitle>
                <p className="text-gray-600 mt-1">
                  {originCode} → {destinationCode}
                </p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-brand mb-1">${flight.price}</div>
                <p className="text-sm text-gray-600">per person</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Departure */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">Departure</span>
                </div>
                <p className="text-lg font-semibold">{flight.departureTime}</p>
                <p className="text-sm text-gray-600">{originCode}</p>
              </div>

              {/* Duration */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">Duration</span>
                </div>
                <p className="text-lg font-semibold">{flight.duration}</p>
                {isDirect ? (
                  <Badge variant="success" className="mt-1">Direct Flight</Badge>
                ) : (
                  <p className="text-sm text-gray-600">{flight.stops} stop(s)</p>
                )}
              </div>

              {/* Arrival */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">Arrival</span>
                </div>
                <p className="text-lg font-semibold">{flight.arrivalTime}</p>
                <p className="text-sm text-gray-600">{destinationCode}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Baggage Policy */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase className="w-5 h-5" />
                  Baggage Policy
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5" />
                    <div>
                      <h4 className="font-semibold mb-1">Carry-on Baggage</h4>
                      <p className="text-sm text-gray-600">
                        1 personal item and 1 carry-on bag (max 22 x 14 x 9 inches)
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5" />
                    <div>
                      <h4 className="font-semibold mb-1">Checked Baggage</h4>
                      <p className="text-sm text-gray-600">
                        First bag free (max 50 lbs). Additional bags $35 each.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                    <div>
                      <h4 className="font-semibold mb-1">Overweight Baggage</h4>
                      <p className="text-sm text-gray-600">
                        $100 fee for bags weighing 51-70 lbs. Bags over 70 lbs not permitted.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Fare Rules */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" />
                  Fare Rules & Policies
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold mb-2">Ticket Type</h4>
                    <Badge variant="info">Standard Economy</Badge>
                    <p className="text-sm text-gray-600 mt-2">
                      Advance seat selection available. Standard boarding group.
                    </p>
                  </div>
                  <div className="pt-4 border-t">
                    <h4 className="font-semibold mb-2">Restrictions</h4>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li className="flex items-start gap-2">
                        <XIcon className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                        Non-refundable ticket
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        Changes allowed for $200 fee + fare difference
                      </li>
                      <li className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        Name changes not permitted
                      </li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Cancellation Policy */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <XIcon className="w-5 h-5" />
                  Cancellation Policy
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm font-medium text-yellow-900 mb-1">24-Hour Risk-Free Cancellation</p>
                    <p className="text-sm text-yellow-700">
                      Cancel within 24 hours of booking for a full refund if booked at least 7 days before departure.
                    </p>
                  </div>
                  <div className="space-y-2 text-sm text-gray-600">
                    <p><strong>More than 14 days before departure:</strong> Cancel for travel credit minus $150 fee</p>
                    <p><strong>7-14 days before departure:</strong> Cancel for travel credit minus $250 fee</p>
                    <p><strong>Less than 7 days before departure:</strong> Non-refundable, no travel credit</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Amenities */}
            <Card>
              <CardHeader>
                <CardTitle>In-Flight Amenities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Wi-Fi Available ($)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-600" />
                    <span className="text-sm">In-Seat Power</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Streaming Entertainment</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-600" />
                    <span className="text-sm">Snacks & Beverages</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Price Summary */}
            <Card className="sticky top-24">
              <CardHeader>
                <CardTitle>Price Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Base Fare</span>
                    <span className="font-semibold">${flight.price}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Taxes & Fees</span>
                    <span className="font-semibold">${(flight.price * 0.12).toFixed(2)}</span>
                  </div>
                  <div className="border-t pt-3 flex justify-between">
                    <span className="font-bold">Total</span>
                    <span className="font-bold text-xl text-brand">${(flight.price * 1.12).toFixed(2)}</span>
                  </div>
                </div>
                <Button fullWidth className="mt-6" onClick={handleBookFlight}>
                  Continue to Booking
                </Button>
                <p className="text-xs text-center text-gray-500 mt-3">
                  Price is per person. Final price may vary based on seat selection.
                </p>
              </CardContent>
            </Card>

            {/* Important Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Important Information</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-xs text-gray-600">
                  <li className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <span>Check-in opens 24 hours before departure</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <span>Arrive at airport 2 hours before domestic flights</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <span>Valid government-issued ID required</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <span>Subject to airline's terms and conditions</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
