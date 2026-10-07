import React, { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js';
import { bookingApi } from '../services/api';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks';

const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripeKey ? loadStripe(stripeKey) : null;

interface BookingData {
  type: 'flight' | 'hotel' | 'car';
  item: any;
  unitPrice: number;
  // Nights (hotel) or days (car); 1 for flights. booking-svc charges (price + extras) x this.
  units: number;
  startDate?: string | null;
  endDate?: string | null;
}

interface PassengerInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

function PaymentForm({
  bookingData,
  userId,
  onSuccess,
  useStripePayment = !!stripePromise
}: {
  bookingData: BookingData;
  userId: string;
  onSuccess: (ctx: { paymentIntent: any; booking: any }) => void;
  useStripePayment?: boolean;
}) {
  const stripe = useStripePayment ? useStripe() : null;
  const elements = useStripePayment ? useElements() : null;
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<any | null>(null);
  const [passengerInfo, setPassengerInfo] = useState<PassengerInfo>({
    firstName: '',
    lastName: '',
    email: '',
    phone: ''
  });

  // Booking extras state
  const [extras, setExtras] = useState({
    // Flight extras
    seatSelection: 'standard' as 'standard' | 'extra-legroom' | 'premium',
    checkedBag: false,
    carryOnBag: false,
    priorityBoarding: false,
    // Hotel extras
    roomUpgrade: false,
    breakfast: false,
    lateCheckout: false,
    specialRequests: '',
    // Car extras
    insurance: false,
    gps: false,
    childSeat: false,
    additionalDriver: false
  });

  // Calculate extras cost
  const calculateExtrasTotal = () => {
    let extrasTotal = 0;
    
    if (bookingData.type === 'flight') {
      if (extras.seatSelection === 'extra-legroom') extrasTotal += 35;
      if (extras.seatSelection === 'premium') extrasTotal += 75;
      if (extras.checkedBag) extrasTotal += 30;
      if (extras.carryOnBag) extrasTotal += 15;
      if (extras.priorityBoarding) extrasTotal += 20;
    } else if (bookingData.type === 'hotel') {
      if (extras.roomUpgrade) extrasTotal += 50;
      if (extras.breakfast) extrasTotal += 25;
      if (extras.lateCheckout) extrasTotal += 30;
    } else if (bookingData.type === 'car') {
      if (extras.insurance) extrasTotal += 25;
      if (extras.gps) extrasTotal += 15;
      if (extras.childSeat) extrasTotal += 10;
      if (extras.additionalDriver) extrasTotal += 12;
    }
    
    return extrasTotal;
  };

  const extrasPerUnit = calculateExtrasTotal();
  const extrasTotal = extrasPerUnit * bookingData.units;
  const totalWithExtras = (bookingData.unitPrice + extrasPerUnit) * bookingData.units;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate passenger info
    if (!passengerInfo.firstName || !passengerInfo.lastName || !passengerInfo.email) {
      setError('Please fill in all required passenger information');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      // Ensure we have a backend booking before taking payment
      let currentBooking = booking;
      if (!currentBooking) {
        const payload = {
          userId,
          type: bookingData.type,
          currency: 'USD',
          items: [
            {
              type: bookingData.type,
              referenceId: bookingData.item.id,
              quantity: 1,
              unitPrice: bookingData.unitPrice + extrasPerUnit,
              startDate: bookingData.startDate,
              endDate: bookingData.endDate,
              extras: extras
            }
          ]
        };

        const bookingRes = await bookingApi.createBooking(payload);
        currentBooking = bookingRes.data.data;
        setBooking(currentBooking);
      }

      // If Stripe is available, process with Stripe
      if (useStripePayment && stripe && elements) {
        const cardElement = elements.getElement(CardElement);

        if (!cardElement) {
          setError('Card element not found');
          setProcessing(false);
          return;
        }

        // Use the clientSecret returned from the booking creation (Saga)
        const clientSecret = currentBooking.clientSecret;

        if (!clientSecret) {
          throw new Error('No payment client secret returned from booking service');
        }

        // Handle Mock Payment
        if (clientSecret.startsWith('pi_mock_secret_')) {
          console.log('[MOCK] Skipping Stripe confirmation for mock secret');
          // Simulate a delay
          setTimeout(() => {
            onSuccess({
              paymentIntent: { id: 'mock_pi_' + Date.now(), status: 'succeeded' },
              booking: currentBooking
            });
          }, 1000);
          return;
        }

        // Confirm payment with Stripe
        const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
          clientSecret,
          {
            payment_method: {
              card: cardElement,
              billing_details: {
                name: `${passengerInfo.firstName} ${passengerInfo.lastName}`,
                email: passengerInfo.email,
                phone: passengerInfo.phone
              }
            }
          }
        );

        if (stripeError) {
          setError(stripeError.message || 'Payment failed');
          setProcessing(false);
          return;
        }

        if (paymentIntent.status === 'succeeded') {
          onSuccess({ paymentIntent, booking: currentBooking });
        } else {
          setProcessing(false);
        }
      } else {
        // Simplified payment flow for testing (without Stripe)
        // Simulate payment processing but still ensure booking exists
        setTimeout(() => {
          onSuccess({
            paymentIntent: {
              id: `payment_${Date.now()}`,
              amount: totalWithExtras,
              status: 'succeeded',
              customer: passengerInfo
            },
            booking: currentBooking
          });
        }, 1500);
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Payment processing failed');
      setProcessing(false);
    }
  };

  const cardElementOptions = {
    style: {
      base: {
        fontSize: '16px',
        color: '#424770',
        '::placeholder': {
          color: '#aab7c4',
        },
        fontFamily: 'system-ui, -apple-system, sans-serif'
      },
      invalid: {
        color: '#9e2146',
      },
    },
  };

  // Show simple form without Stripe when Stripe is not available
  if (!useStripePayment) {
    return (
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Passenger Information */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Passenger Information</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                <input
                  type="text"
                  className="input"
                  title="First Name"
                  value={passengerInfo.firstName}
                  onChange={(e) => setPassengerInfo({ ...passengerInfo, firstName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                <input
                  type="text"
                  className="input"
                  title="Last Name"
                  value={passengerInfo.lastName}
                  onChange={(e) => setPassengerInfo({ ...passengerInfo, lastName: e.target.value })}
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
              <input
                type="email"
                className="input"
                title="Email Address"
                value={passengerInfo.email}
                onChange={(e) => setPassengerInfo({ ...passengerInfo, email: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                className="input"
                title="Phone Number"
                value={passengerInfo.phone}
                onChange={(e) => setPassengerInfo({ ...passengerInfo, phone: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Payment Info - Simplified */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Payment (Demo Mode)</h2>
          <p className="text-gray-600 mb-4">
            Stripe payment is not configured. This is a demo booking.
          </p>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={processing}
          className="w-full bg-brand hover:bg-orange-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processing ? 'Processing...' : 'Complete Booking'}
        </button>
      </form>
    );
  }

  if (!stripeKey || !stripePromise) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">Payments Disabled</h2>
        <p className="text-gray-700 mb-2">
          Card payments are currently unavailable because the Stripe publishable key is not configured.
        </p>
        <p className="text-gray-500 text-sm">
          Please set <code>VITE_STRIPE_PUBLISHABLE_KEY</code> in the client environment to enable payments.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Passenger Information */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">Passenger Information</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
              <input
                type="text"
                className="input"
                title="First Name"
                value={passengerInfo.firstName}
                onChange={(e) => setPassengerInfo({ ...passengerInfo, firstName: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
              <input
                type="text"
                className="input"
                title="Last Name"
                value={passengerInfo.lastName}
                onChange={(e) => setPassengerInfo({ ...passengerInfo, lastName: e.target.value })}
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input
              type="email"
              className="input"
              title="Email Address"
              value={passengerInfo.email}
              onChange={(e) => setPassengerInfo({ ...passengerInfo, email: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              className="input"
              title="Phone Number"
              value={passengerInfo.phone}
              onChange={(e) => setPassengerInfo({ ...passengerInfo, phone: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Booking Extras */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">Customize Your Booking</h2>
        
        {bookingData.type === 'flight' && (
          <div className="space-y-4">
            <div>
              <label htmlFor="seat-selection" className="block text-sm font-medium text-gray-700 mb-2">
                Seat Selection
              </label>
              <select
                id="seat-selection"
                className="input"
                value={extras.seatSelection}
                onChange={(e) => setExtras({ ...extras, seatSelection: e.target.value as any })}
              >
                <option value="standard">Standard Seat - Included</option>
                <option value="extra-legroom">Extra Legroom - +$35</option>
                <option value="premium">Premium Seat - +$75</option>
              </select>
            </div>

            <div className="space-y-3">
              <div className="flex items-center">
                <input
                  id="checked-bag"
                  type="checkbox"
                  className="h-4 w-4 text-brand focus:ring-brand border-gray-300 rounded"
                  checked={extras.checkedBag}
                  onChange={(e) => setExtras({ ...extras, checkedBag: e.target.checked })}
                />
                <label htmlFor="checked-bag" className="ml-2 text-sm text-gray-700">
                  Add Checked Bag (+$30)
                </label>
              </div>

              <div className="flex items-center">
                <input
                  id="carry-on-bag"
                  type="checkbox"
                  className="h-4 w-4 text-brand focus:ring-brand border-gray-300 rounded"
                  checked={extras.carryOnBag}
                  onChange={(e) => setExtras({ ...extras, carryOnBag: e.target.checked })}
                />
                <label htmlFor="carry-on-bag" className="ml-2 text-sm text-gray-700">
                  Add Carry-On Bag (+$15)
                </label>
              </div>

              <div className="flex items-center">
                <input
                  id="priority-boarding"
                  type="checkbox"
                  className="h-4 w-4 text-brand focus:ring-brand border-gray-300 rounded"
                  checked={extras.priorityBoarding}
                  onChange={(e) => setExtras({ ...extras, priorityBoarding: e.target.checked })}
                />
                <label htmlFor="priority-boarding" className="ml-2 text-sm text-gray-700">
                  Priority Boarding (+$20)
                </label>
              </div>
            </div>
          </div>
        )}

        {bookingData.type === 'hotel' && (
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center">
                <input
                  id="room-upgrade"
                  type="checkbox"
                  className="h-4 w-4 text-brand focus:ring-brand border-gray-300 rounded"
                  checked={extras.roomUpgrade}
                  onChange={(e) => setExtras({ ...extras, roomUpgrade: e.target.checked })}
                />
                <label htmlFor="room-upgrade" className="ml-2 text-sm text-gray-700">
                  Upgrade to Suite (+$50/night)
                </label>
              </div>

              <div className="flex items-center">
                <input
                  id="breakfast"
                  type="checkbox"
                  className="h-4 w-4 text-brand focus:ring-brand border-gray-300 rounded"
                  checked={extras.breakfast}
                  onChange={(e) => setExtras({ ...extras, breakfast: e.target.checked })}
                />
                <label htmlFor="breakfast" className="ml-2 text-sm text-gray-700">
                  Add Breakfast (+$25/day)
                </label>
              </div>

              <div className="flex items-center">
                <input
                  id="late-checkout"
                  type="checkbox"
                  className="h-4 w-4 text-brand focus:ring-brand border-gray-300 rounded"
                  checked={extras.lateCheckout}
                  onChange={(e) => setExtras({ ...extras, lateCheckout: e.target.checked })}
                />
                <label htmlFor="late-checkout" className="ml-2 text-sm text-gray-700">
                  Late Checkout (+$30/night)
                </label>
              </div>
            </div>

            <div>
              <label htmlFor="special-requests" className="block text-sm font-medium text-gray-700 mb-2">
                Special Requests
              </label>
              <textarea
                id="special-requests"
                rows={3}
                className="input"
                placeholder="E.g., High floor, quiet room, early check-in..."
                value={extras.specialRequests}
                onChange={(e) => setExtras({ ...extras, specialRequests: e.target.value })}
              />
            </div>
          </div>
        )}

        {bookingData.type === 'car' && (
          <div className="space-y-3">
            <div className="flex items-center">
              <input
                id="car-insurance"
                type="checkbox"
                className="h-4 w-4 text-brand focus:ring-brand border-gray-300 rounded"
                checked={extras.insurance}
                onChange={(e) => setExtras({ ...extras, insurance: e.target.checked })}
              />
              <label htmlFor="car-insurance" className="ml-2 text-sm text-gray-700">
                Full Coverage Insurance (+$25/day)
              </label>
            </div>

            <div className="flex items-center">
              <input
                id="gps"
                type="checkbox"
                className="h-4 w-4 text-brand focus:ring-brand border-gray-300 rounded"
                checked={extras.gps}
                onChange={(e) => setExtras({ ...extras, gps: e.target.checked })}
              />
              <label htmlFor="gps" className="ml-2 text-sm text-gray-700">
                GPS Navigation System (+$15/day)
              </label>
            </div>

            <div className="flex items-center">
              <input
                id="child-seat"
                type="checkbox"
                className="h-4 w-4 text-brand focus:ring-brand border-gray-300 rounded"
                checked={extras.childSeat}
                onChange={(e) => setExtras({ ...extras, childSeat: e.target.checked })}
              />
              <label htmlFor="child-seat" className="ml-2 text-sm text-gray-700">
                Child Safety Seat (+$10/day)
              </label>
            </div>

            <div className="flex items-center">
              <input
                id="additional-driver"
                type="checkbox"
                className="h-4 w-4 text-brand focus:ring-brand border-gray-300 rounded"
                checked={extras.additionalDriver}
                onChange={(e) => setExtras({ ...extras, additionalDriver: e.target.checked })}
              />
              <label htmlFor="additional-driver" className="ml-2 text-sm text-gray-700">
                Additional Driver (+$12/day)
              </label>
            </div>
          </div>
        )}

        {extrasTotal > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex justify-between text-lg font-semibold">
              <span>Extras Total:</span>
              <span className="text-brand">${extrasTotal.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Payment Information */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">Payment Information</h2>
        <div className="p-4 border border-gray-300 rounded-md">
          <CardElement options={cardElementOptions} />
        </div>
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">
            {error}
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={!stripe || processing}
        className="btn-primary w-full"
      >
        {processing ? 'Processing...' : `Pay $${totalWithExtras.toFixed(2)}`}
      </button>
    </form>
  );
}

export function BookingPage() {
  const params = useParams();
  const location = useLocation() as any;
  const navigate = useNavigate();
  const { user, checkAuth } = useAuth();

  const routeType = (params.type as 'flights' | 'hotels' | 'cars') || 'flights';
  const selected = location.state?.item;
  const stateStartDate = location.state?.startDate as string | undefined;
  const stateEndDate = location.state?.endDate as string | undefined;
  const logicalType: BookingData['type'] =
    routeType === 'flights' ? 'flight' : routeType === 'hotels' ? 'hotel' : 'car';

  const [bookingData, setBookingData] = useState<BookingData | null>(null);
  const [bookingComplete, setBookingComplete] = useState(false);
  const [paymentContext, setPaymentContext] = useState<{ paymentIntent: any; booking: any } | null>(null);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!selected) {
      // If no selection was passed, redirect back to search
      navigate('/');
      return;
    }

    let basePrice = 0;
    if (logicalType === 'flight') {
      basePrice = selected.price || 0;
    } else if (logicalType === 'hotel') {
      basePrice = selected.pricePerNight || selected.base_price || 0;
    } else if (logicalType === 'car') {
      basePrice = selected.dailyRate || selected.daily_rate || 0;
    }

    let units = 1;
    if (logicalType !== 'flight' && stateStartDate && stateEndDate) {
      const days = Math.ceil((new Date(stateEndDate).getTime() - new Date(stateStartDate).getTime()) / (1000 * 60 * 60 * 24));
      if (Number.isFinite(days) && days > 0) units = days;
    }

    setBookingData({
      type: logicalType,
      item: { id: selected.id },
      unitPrice: basePrice,
      units,
      startDate: stateStartDate || null,
      endDate: stateEndDate || null
    });
  }, [selected, logicalType, navigate, stateStartDate, stateEndDate]);

  const handlePaymentSuccess = (ctx: { paymentIntent: any; booking: any }) => {
    setPaymentContext(ctx);
    setBookingComplete(true);
  };

  if (!bookingData || !user) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-gray-50 flex items-center justify-center">
        <div className="card max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Sign in required</h2>
          <p className="text-gray-600 mb-4">
            Please sign in and start your booking from the search results page.
          </p>
          <button
            onClick={() => navigate('/')}
            className="btn-primary mt-4"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  if (bookingComplete && paymentContext) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-gray-50 flex items-center justify-center">
        <div className="card max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Booking Confirmed!</h2>
          <p className="text-gray-600 mb-4">Your payment has been processed successfully.</p>
          <p className="text-sm text-gray-500 mb-6">
            Payment ID: {paymentContext.paymentIntent.id}
          </p>
          <p className="text-sm text-gray-500 mb-2">
            Booking ID: {paymentContext.booking.id}
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Confirmation: {paymentContext.booking.confirmationNumber || 'Pending'}
          </p>
          <button
            onClick={() => window.location.href = '/'}
            className="btn-primary mt-4"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Complete Your Booking</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            {stripePromise ? (
              <Elements stripe={stripePromise}>
                <PaymentForm
                  bookingData={bookingData}
                  userId={user.id}
                  onSuccess={handlePaymentSuccess}
                  useStripePayment={true}
                />
              </Elements>
            ) : (
              <PaymentForm
                bookingData={bookingData}
                userId={user.id}
                onSuccess={handlePaymentSuccess}
                useStripePayment={false}
              />
            )}
          </div>

          <div className="lg:col-span-1">
            <div className="card sticky top-24">
              <h2 className="text-xl font-semibold mb-4">Booking Summary</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Price:</span>
                  <span>
                    ${bookingData.unitPrice.toFixed(2)}
                    {bookingData.type !== 'flight' && ` x ${bookingData.units} ${bookingData.type === 'hotel' ? 'night' : 'day'}${bookingData.units === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div className="border-t pt-3 flex justify-between font-semibold">
                  <span>Total before extras:</span>
                  <span>${(bookingData.unitPrice * bookingData.units).toFixed(2)}</span>
                </div>
              </div>
              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800">
                  🔒 Your payment information is secure and encrypted
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
