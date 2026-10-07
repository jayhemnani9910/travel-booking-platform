import React, { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import {
  Users, Package, DollarSign, TrendingUp, Activity,
  Search, Filter, Calendar, Download, CheckCircle, XCircle, Clock, AlertCircle
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, Input, Pagination, useToast, Modal } from '../components/ui';
import { adminApi, userApi } from '../services/api';

import { useAuth } from '../contexts/AuthContext';

const AdminDashboard: React.FC = () => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="flex justify-center items-center min-h-screen">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.role !== 'admin') {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-gray-50 flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-12">
            <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Admins only</h2>
            <p className="text-gray-600">You are signed in as {user.email}, which is not an admin account.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Navigation */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Admin Dashboard</h1>
          <nav className="flex space-x-4 border-b border-gray-200 overflow-x-auto">
            <NavLink
              to="/admin"
              end
              className={({ isActive }) =>
                `px-4 py-2 font-medium transition-colors whitespace-nowrap ${isActive
                  ? 'border-b-2 border-brand text-brand'
                  : 'text-gray-600 hover:text-gray-900'
                }`
              }
            >
              Overview
            </NavLink>
            <NavLink
              to="/admin/users"
              className={({ isActive }) =>
                `px-4 py-2 font-medium transition-colors whitespace-nowrap ${isActive
                  ? 'border-b-2 border-brand text-brand'
                  : 'text-gray-600 hover:text-gray-900'
                }`
              }
            >
              Users
            </NavLink>
            <NavLink
              to="/admin/bookings"
              className={({ isActive }) =>
                `px-4 py-2 font-medium transition-colors whitespace-nowrap ${isActive
                  ? 'border-b-2 border-brand text-brand'
                  : 'text-gray-600 hover:text-gray-900'
                }`
              }
            >
              Bookings
            </NavLink>
            <NavLink
              to="/admin/analytics"
              className={({ isActive }) =>
                `px-4 py-2 font-medium transition-colors whitespace-nowrap ${isActive
                  ? 'border-b-2 border-brand text-brand'
                  : 'text-gray-600 hover:text-gray-900'
                }`
              }
            >
              Analytics
            </NavLink>
          </nav>
        </div>

        <Routes>
          <Route index element={<Overview />} />
          <Route path="users" element={<UsersManagement />} />
          <Route path="bookings" element={<BookingsManagement />} />
          <Route path="analytics" element={<Analytics />} />
        </Routes>
      </div>
    </div>
  );
};

const Overview: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await adminApi.getStats();
      const data = response.data.data || {};
      setStats({
        totalUsers: data.users ?? 0,
        totalBookings: data.bookings ?? 0,
        totalRevenue: data.totalRevenue ?? 0,
        activeDeals: data.activeDeals ?? 0
      });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
      setStats({
        totalUsers: 0,
        totalBookings: 0,
        totalRevenue: 0,
        activeDeals: 0
      });
    } finally {
      setLoading(false);
    }
  };

  const revenueData = [
    { month: 'Jan', revenue: 98000 },
    { month: 'Feb', revenue: 112000 },
    { month: 'Mar', revenue: 125000 },
    { month: 'Apr', revenue: 134000 },
    { month: 'May', revenue: 145000 },
    { month: 'Jun', revenue: 158000 }
  ];

  const bookingsData = [
    { type: 'Flights', count: 234 },
    { type: 'Hotels', count: 187 },
    { type: 'Cars', count: 156 }
  ];

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Users</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {stats.totalUsers.toLocaleString()}
                </p>
                <p className="text-sm text-green-600 mt-2 flex items-center">
                  <TrendingUp className="w-4 h-4 mr-1" />
                  +12.5% from last month (sample data)
                </p>
              </div>
              <div className="p-3 bg-blue-100 rounded-lg">
                <Users className="w-8 h-8 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Bookings</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {stats.totalBookings.toLocaleString()}
                </p>
                <p className="text-sm text-green-600 mt-2 flex items-center">
                  <TrendingUp className="w-4 h-4 mr-1" />
                  +8.3% from last month (sample data)
                </p>
              </div>
              <div className="p-3 bg-green-100 rounded-lg">
                <Package className="w-8 h-8 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Revenue</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  ${(stats.totalRevenue / 1000000).toFixed(2)}M
                </p>
                <p className="text-sm text-green-600 mt-2 flex items-center">
                  <TrendingUp className="w-4 h-4 mr-1" />
                  +15.7% from last month (sample data)
                </p>
              </div>
              <div className="p-3 bg-purple-100 rounded-lg">
                <DollarSign className="w-8 h-8 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Deals</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {stats.activeDeals}
                </p>
                <p className="text-sm text-gray-600 mt-2 flex items-center">
                  <Activity className="w-4 h-4 mr-1" />
                  Updated 5 min ago
                </p>
              </div>
              <div className="p-3 bg-orange-100 rounded-lg">
                <TrendingUp className="w-8 h-8 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Revenue Trend <Badge variant="warning" size="sm">Sample data</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="revenue" stroke="#ff6d00" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Bookings by Type <Badge variant="warning" size="sm">Sample data</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={bookingsData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="type" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" fill="#ff6d00" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const UsersManagement: React.FC = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const { showToast } = useToast();
  const usersPerPage = 10;

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await adminApi.getUsers({ limit: 100 });
      const data = response.data.data;
      setUsers(Array.isArray(data) ? data : data?.users || []);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewUser = (user: any) => {
    setSelectedUser(user);
    setIsViewModalOpen(true);
  };

  const handleEditUser = (user: any) => {
    setSelectedUser(user);
    setIsEditModalOpen(true);
  };

  const handleSaveUser = async () => {
    try {
      const { firstName, lastName, email } = selectedUser;
      const response = await userApi.updateUser(selectedUser.id, { firstName, lastName, email });
      const updated = response.data.data?.user || selectedUser;
      setUsers(prev => prev.map(u => (u.id === selectedUser.id ? { ...u, ...updated } : u)));
      showToast('success', 'User updated successfully');
      setIsEditModalOpen(false);
    } catch (error: any) {
      showToast('error', error.response?.data?.error?.message || 'Failed to update user');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (window.confirm('Are you sure you want to delete this user?')) {
      try {
        await userApi.deleteUser(userId);
        setUsers(prev => prev.filter(u => u.id !== userId));
        showToast('success', 'User deleted successfully');
      } catch (error: any) {
        showToast('error', error.response?.data?.error?.message || 'Failed to delete user');
      }
    }
  };

  const filteredUsers = users.filter(user =>
    user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.lastName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredUsers.length / usersPerPage);
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * usersPerPage,
    currentPage * usersPerPage
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>User Management</CardTitle>
            <Button>Add User</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Input
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              icon={<Search className="w-5 h-5" />}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-4 text-center text-gray-500">Loading...</td>
                  </tr>
                ) : paginatedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-4 text-center text-gray-500">No users found</td>
                  </tr>
                ) : (
                  paginatedUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900">
                          {user.firstName} {user.lastName}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{user.email}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge variant={user.role === 'admin' ? 'info' : 'default'}>
                          {user.role || 'user'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge variant="success">Active</Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => handleViewUser(user)}>View</Button>
                          <Button size="sm" variant="secondary" onClick={() => handleEditUser(user)}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => handleDeleteUser(user.id)}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* View User Modal */}
      {isViewModalOpen && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-4">User Details</h3>
            <div className="space-y-3">
              <p><strong>ID:</strong> {selectedUser.id}</p>
              <p><strong>Name:</strong> {selectedUser.firstName} {selectedUser.lastName}</p>
              <p><strong>Email:</strong> {selectedUser.email}</p>
              <p><strong>Role:</strong> {selectedUser.role}</p>
              <p><strong>Phone:</strong> {selectedUser.phone || 'N/A'}</p>
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={() => setIsViewModalOpen(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {isEditModalOpen && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-4">Edit User</h3>
            <div className="space-y-4">
              <Input 
                label="First Name" 
                defaultValue={selectedUser.firstName} 
                onChange={(e) => setSelectedUser({...selectedUser, firstName: e.target.value})}
              />
              <Input 
                label="Last Name" 
                defaultValue={selectedUser.lastName}
                onChange={(e) => setSelectedUser({...selectedUser, lastName: e.target.value})}
              />
              <Input 
                label="Email" 
                defaultValue={selectedUser.email}
                onChange={(e) => setSelectedUser({...selectedUser, email: e.target.value})}
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveUser}>Save Changes</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const BookingsManagement: React.FC = () => {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const bookingsPerPage = 10;

  useEffect(() => {
    fetchBookings();
  }, []);

  const fetchBookings = async () => {
    try {
      const response = await adminApi.getBookings({ limit: 100 });
      // admin-svc returns the rows array directly
      const data = response.data.data;
      setBookings(Array.isArray(data) ? data : data?.bookings || []);
    } catch (error) {
      console.error('Failed to fetch bookings:', error);
      setLoadError('Could not load bookings. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
      confirmed: 'success',
      pending: 'warning',
      cancelled: 'danger',
      completed: 'info'
    };
    const icons: Record<string, any> = {
      confirmed: CheckCircle,
      pending: Clock,
      cancelled: XCircle,
      completed: CheckCircle
    };
    const Icon = icons[status] || AlertCircle;

    return (
      <Badge variant={variants[status] || 'default'} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {status.toUpperCase()}
      </Badge>
    );
  };

  const filteredBookings = bookings.filter(booking =>
    booking.id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    String(booking.userId ?? '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredBookings.length / bookingsPerPage);
  const paginatedBookings = filteredBookings.slice(
    (currentPage - 1) * bookingsPerPage,
    currentPage * bookingsPerPage
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Bookings Management</CardTitle>
            <div className="flex gap-2">
              <Button variant="secondary" icon={<Download className="w-4 h-4" />}>Export</Button>
              <Button icon={<Filter className="w-4 h-4" />}>Filter</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Input
              placeholder="Search bookings by ID or User..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              icon={<Search className="w-5 h-5" />}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Booking ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-4 text-center text-gray-500">Loading...</td>
                  </tr>
                ) : loadError ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-4 text-center text-red-600">{loadError}</td>
                  </tr>
                ) : paginatedBookings.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-4 text-center text-gray-500">No bookings found</td>
                  </tr>
                ) : (
                  paginatedBookings.map((booking) => (
                    <tr key={booking.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                        {booking.id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap capitalize">
                        {booking.type}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                        {booking.userId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-600">
                        {booking.createdAt ? new Date(booking.createdAt).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap font-medium">
                        ${Number(booking.totalAmount || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(booking.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <Button size="sm" variant="ghost">Details</Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const Analytics: React.FC = () => {
  const bookingTypeData = [
    { name: 'Flights', value: 45, bookings: 1250 },
    { name: 'Hotels', value: 35, bookings: 980 },
    { name: 'Cars', value: 20, bookings: 560 },
  ];
  const COLORS = ['#FF690F', '#00C49F', '#0088FE'];

  const revenueByYear = [
    { year: '2021', revenue: 125000, bookings: 3200 },
    { year: '2022', revenue: 178000, bookings: 4500 },
    { year: '2023', revenue: 245000, bookings: 6100 },
    { year: '2024', revenue: 312000, bookings: 7800 },
    { year: '2025', revenue: 398000, bookings: 9500 },
  ];

  const revenueByCity = [
    { city: 'New York', revenue: 58000, bookings: 1450 },
    { city: 'Los Angeles', revenue: 49000, bookings: 1280 },
    { city: 'London', revenue: 45000, bookings: 1150 },
    { city: 'Paris', revenue: 38000, bookings: 950 },
    { city: 'Tokyo', revenue: 35000, bookings: 890 },
    { city: 'Dubai', revenue: 32000, bookings: 780 },
  ];

  const topProperties = [
    { name: 'Luxury Hotel NYC', revenue: 28500, rating: 4.8, bookings: 234 },
    { name: 'Beach Resort Miami', revenue: 25800, rating: 4.7, bookings: 198 },
    { name: 'City Hotel LA', revenue: 23200, rating: 4.6, bookings: 267 },
    { name: 'Resort Paris', revenue: 21900, rating: 4.9, bookings: 189 },
    { name: 'Downtown Tokyo', revenue: 19500, rating: 4.5, bookings: 223 },
  ];

  const topProviders = [
    { name: 'Delta Airlines', bookings: 1250, revenue: 125000, rating: 4.7 },
    { name: 'United Airlines', bookings: 1080, revenue: 108000, rating: 4.6 },
    { name: 'Hertz Rentals', bookings: 890, revenue: 44500, rating: 4.5 },
    { name: 'Enterprise', bookings: 780, revenue: 39000, rating: 4.8 },
    { name: 'American Airlines', bookings: 720, revenue: 72000, rating: 4.4 },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg px-4 py-3 text-sm">
        Sample data: the charts and tables on this tab use fixed example numbers, not live analytics.
      </div>

      {/* Revenue by Year */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue by Year</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={revenueByYear}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis />
              <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
              <Legend />
              <Line type="monotone" dataKey="revenue" stroke="#FF690F" strokeWidth={3} name="Revenue ($)" />
              <Line type="monotone" dataKey="bookings" stroke="#0088FE" strokeWidth={2} name="Bookings" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by City */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by City (Top 6)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={revenueByCity}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="city" />
                <YAxis />
                <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                <Legend />
                <Bar dataKey="revenue" fill="#FF690F" name="Revenue ($)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Booking Type Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Booking Type Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={bookingTypeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  fill="#8884d8"
                  paddingAngle={5}
                  dataKey="value"
                  label={(entry) => `${entry.name}: ${entry.value}%`}
                >
                  {bookingTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Properties */}
      <Card>
        <CardHeader>
          <CardTitle>Top 5 Properties by Revenue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Property</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Revenue</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Bookings</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {topProperties.map((property, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{property.name}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900">${property.revenue.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{property.bookings}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      <Badge variant="success">{property.rating} ★</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top Providers */}
      <Card>
        <CardHeader>
          <CardTitle>Top 5 Providers by Bookings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Bookings</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Revenue</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {topProviders.map((provider, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{provider.name}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900">{provider.bookings}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">${provider.revenue.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      <Badge variant="info">{provider.rating} ★</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Platform Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Performance Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 border rounded-lg">
              <p className="text-sm text-gray-500">Avg. Response Time</p>
              <p className="text-2xl font-bold text-gray-900">124ms</p>
              <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
                <div className="bg-green-600 h-2.5 rounded-full w-4/5"></div>
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <p className="text-sm text-gray-500">Uptime (30 days)</p>
              <p className="text-2xl font-bold text-gray-900">99.98%</p>
              <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
                <div className="bg-green-600 h-2.5 rounded-full w-full"></div>
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <p className="text-sm text-gray-500">Error Rate</p>
              <p className="text-2xl font-bold text-gray-900">0.02%</p>
              <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
                <div className="bg-red-600 h-2.5 rounded-full w-1/12"></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminDashboard;
