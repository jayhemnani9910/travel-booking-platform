/**
 * Main App Component
 * Routes and global layout for the application
 */

import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Header } from './components/Layout/Header';
import { Footer } from './components/Layout/Footer';
import { ToastProvider } from './components/ui';
import { SearchPage } from './pages/SearchPage';
import { ResultsPage } from './pages/ResultsPage';
import { BookingPage } from './pages/BookingPage';
import ProfilePage from './pages/ProfilePage';
import BookingsPage from './pages/BookingsPage';
import AdminDashboard from './pages/AdminDashboard';
import DealsPage from './pages/DealsPage';
import ConciergeChatPage from './pages/ConciergeChatPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { FlightDetailsPage } from './pages/FlightDetailsPage';
import { HotelDetailsPage } from './pages/HotelDetailsPage';

import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';

function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <ToastProvider>
          <div className="min-h-screen bg-gray-50 flex flex-col">
            <Header />

            <main className="flex-1">
              <Routes>
                <Route path="/" element={<SearchPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/results/:type" element={<ResultsPage />} />
                <Route path="/flights/:id" element={<FlightDetailsPage />} />
                <Route path="/hotels/:id" element={<HotelDetailsPage />} />
                <Route path="/booking/:type/:id" element={<BookingPage />} />
                <Route path="/bookings" element={<BookingsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/deals" element={<DealsPage />} />
                <Route path="/concierge" element={<ConciergeChatPage />} />
                <Route path="/admin/*" element={<AdminDashboard />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </main>

            <Footer />
          </div>
        </ToastProvider>
      </SocketProvider>
    </AuthProvider>
  );
}

export default App;
