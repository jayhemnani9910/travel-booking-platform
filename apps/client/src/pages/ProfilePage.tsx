import React, { useState, useEffect } from 'react';
import { User, Mail, Phone, MapPin, CreditCard, Settings, Package, Heart, Save } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Tabs, Badge, Button, Input, useToast } from '../components/ui';
import { useAuth, useBookings } from '../hooks';
import { useNavigate } from 'react-router-dom';
import { userApi } from '../services/api';

const ProfilePage: React.FC = () => {
  const { user, updateProfile, logout, loading: authLoading } = useAuth();
  const { bookings, loading: bookingsLoading } = useBookings(user?.id);
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [profileData, setProfileData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
    phone: user?.phone || '',
    address: user?.address?.street || '',
    city: user?.address?.city || '',
    state: user?.address?.state || '',
    zip: user?.address?.zipCode || ''
  });

  useEffect(() => {
    if (user) {
      setProfileData({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        phone: user.phone || '',
        address: user.address?.street || '',
        city: user.address?.city || '',
        state: user.address?.state || '',
        zip: user.address?.zipCode || ''
      });
    }
  }, [user]);

  const handleSaveProfile = async () => {
    // Map flat address fields into the nested address shape expected by the API
    const payload: any = {
      firstName: profileData.firstName,
      lastName: profileData.lastName,
      email: profileData.email,
      phone: profileData.phone
    };

    if (profileData.address || profileData.city || profileData.state || profileData.zip) {
      payload.address = {
        street: profileData.address,
        city: profileData.city,
        state: profileData.state,
        zipCode: profileData.zip,
        country: 'US'
      };
    }

    const result = await updateProfile(payload);
    if (result.success) {
      showToast('success', 'Profile updated successfully');
    } else {
      showToast('error', result.error || 'Failed to update profile');
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    if (window.confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
      try {
        await userApi.deleteUser(user.id);
        showToast('success', 'Account deleted successfully');
        logout();
        navigate('/');
      } catch (error) {
        showToast('error', 'Failed to delete account');
      }
    }
  };

  const handleAddPaymentMethod = () => {
    // In a real app, this would open a Stripe Elements modal or redirect to a payment setup page
    showToast('info', 'Redirecting to secure payment provider...');
    // Simulate redirect
    setTimeout(() => {
      showToast('success', 'Payment method added (Simulated)');
    }, 1500);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
      confirmed: 'success',
      pending: 'warning',
      cancelled: 'danger',
      completed: 'info'
    };
    return <Badge variant={variants[status] || 'default'}>{status.toUpperCase()}</Badge>;
  };

  const profileTab = (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="First Name"
              value={profileData.firstName}
              onChange={(e) => setProfileData({ ...profileData, firstName: e.target.value })}
              icon={<User className="w-5 h-5" />}
            />
            <Input
              label="Last Name"
              value={profileData.lastName}
              onChange={(e) => setProfileData({ ...profileData, lastName: e.target.value })}
              icon={<User className="w-5 h-5" />}
            />
            <Input
              label="Email"
              type="email"
              value={profileData.email}
              onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
              icon={<Mail className="w-5 h-5" />}
            />
            <Input
              label="Phone"
              type="tel"
              value={profileData.phone}
              onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
              icon={<Phone className="w-5 h-5" />}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Address</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Input
              label="Street Address"
              value={profileData.address}
              onChange={(e) => setProfileData({ ...profileData, address: e.target.value })}
              icon={<MapPin className="w-5 h-5" />}
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="City"
                value={profileData.city}
                onChange={(e) => setProfileData({ ...profileData, city: e.target.value })}
              />
              <Input
                label="State"
                value={profileData.state}
                onChange={(e) => setProfileData({ ...profileData, state: e.target.value })}
              />
              <Input
                label="ZIP Code"
                value={profileData.zip}
                onChange={(e) => setProfileData({ ...profileData, zip: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSaveProfile} loading={authLoading} icon={<Save className="w-4 h-4" />}>
          Save Changes
        </Button>
      </div>
    </div>
  );

  const bookingsTab = (
    <div className="space-y-4">
      {bookingsLoading ? (
        <p className="text-center text-gray-500 py-8">Loading bookings...</p>
      ) : bookings.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">No bookings yet</p>
            <p className="text-gray-400 text-sm mt-2">Start planning your next adventure!</p>
          </CardContent>
        </Card>
      ) : (
        bookings.map((booking: any) => (
          <Card key={booking.id} hover>
            <CardContent>
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold">
                      {booking.type.charAt(0).toUpperCase() + booking.type.slice(1)} Booking
                    </h3>
                    {getStatusBadge(booking.status)}
                  </div>
                  <p className="text-sm text-gray-600 mb-2">
                    Booking ID: {booking.id}
                  </p>
                  <p className="text-sm text-gray-600">
                    Booked on: {new Date(booking.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right ml-4">
                  <div className="text-2xl font-bold text-brand">
                    ${booking.totalAmount.toFixed(2)}
                  </div>
                  <Button size="sm" className="mt-2">View Details</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );

  const paymentMethodsTab = (
    <div className="space-y-4">
      <Card>
        <CardContent className="text-center py-12">
          <CreditCard className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">No payment methods saved</p>
          <Button className="mt-4" onClick={handleAddPaymentMethod}>Add Payment Method</Button>
        </CardContent>
      </Card>
    </div>
  );

  const favoritesTab = (
    <div className="space-y-4">
      <Card>
        <CardContent className="text-center py-12">
          <Heart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">No favorites yet</p>
          <p className="text-gray-400 text-sm mt-2">Save your favorite flights, hotels, and cars</p>
        </CardContent>
      </Card>
    </div>
  );

  const settingsTab = (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer p-3 hover:bg-gray-50 rounded-lg">
              <span className="text-gray-700">Email notifications</span>
              <input type="checkbox" className="w-5 h-5 rounded border-gray-300" defaultChecked />
            </label>
            <label className="flex items-center justify-between cursor-pointer p-3 hover:bg-gray-50 rounded-lg">
              <span className="text-gray-700">SMS notifications</span>
              <input type="checkbox" className="w-5 h-5 rounded border-gray-300" />
            </label>
            <label className="flex items-center justify-between cursor-pointer p-3 hover:bg-gray-50 rounded-lg">
              <span className="text-gray-700">Deal alerts</span>
              <input type="checkbox" className="w-5 h-5 rounded border-gray-300" defaultChecked />
            </label>
            <label className="flex items-center justify-between cursor-pointer p-3 hover:bg-gray-50 rounded-lg">
              <span className="text-gray-700">Price drop notifications</span>
              <input type="checkbox" className="w-5 h-5 rounded border-gray-300" defaultChecked />
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Button variant="secondary" fullWidth>Change Password</Button>
            <Button variant="danger" fullWidth onClick={handleDeleteAccount}>Delete Account</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">My Profile</h1>
          <p className="text-gray-600">Manage your account settings and preferences</p>
        </div>

        <Tabs
          tabs={[
            {
              id: 'profile',
              label: 'Profile',
              icon: <User className="w-4 h-4" />,
              content: profileTab
            },
            {
              id: 'bookings',
              label: 'My Bookings',
              icon: <Package className="w-4 h-4" />,
              content: bookingsTab
            },
            {
              id: 'payments',
              label: 'Payment Methods',
              icon: <CreditCard className="w-4 h-4" />,
              content: paymentMethodsTab
            },
            {
              id: 'favorites',
              label: 'Favorites',
              icon: <Heart className="w-4 h-4" />,
              content: favoritesTab
            },
            {
              id: 'settings',
              label: 'Settings',
              icon: <Settings className="w-4 h-4" />,
              content: settingsTab
            }
          ]}
        />
      </div>
    </div>
  );
};

export default ProfilePage;
