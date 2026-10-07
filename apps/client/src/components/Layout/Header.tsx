import React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Plane, Hotel, Car, Heart, User } from 'lucide-react';

const productLinks = [
  { type: 'flights', label: 'Flights', icon: Plane },
  { type: 'hotels', label: 'Stays', icon: Hotel },
  { type: 'cars', label: 'Cars', icon: Car },
];

import { useAuth } from '../../contexts/AuthContext';

export function Header() {
  const location = useLocation();
  const { user, logout } = useAuth();
  // The search page shows flights unless ?type= says otherwise
  const onSearchPage = location.pathname === '/' || location.pathname === '/search';
  const activeType = new URLSearchParams(location.search).get('type') || 'flights';

  return (
    <header className="bg-white/90 backdrop-blur border-b border-gray-100 sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16 gap-4">
          <div className="flex items-center">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex">
                {['K', 'A', 'Y', 'A', 'K'].map((letter) => (
                  <span
                    key={letter}
                    className="px-1.5 py-0.5 text-xs font-extrabold tracking-[0.15em] bg-brand text-white rounded-sm mx-[1px]"
                    style={{ backgroundColor: '#FF690F' }}
                  >
                    {letter}
                  </span>
                ))}
              </div>
              <span className="sr-only">KayakClone</span>
            </Link>
          </div>

          <nav className="hidden md:flex items-center bg-gray-100 rounded-full p-1 text-sm">
            {productLinks.map(({ type, label, icon: Icon }) => (
              <Link
                key={type}
                to={`/search?type=${type}`}
                className={`flex items-center px-4 py-1.5 rounded-full transition-colors ${onSearchPage && activeType === type
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-600 hover:text-gray-900'
                  }`}
              >
                <Icon className="w-4 h-4 mr-1.5" />
                {label}
              </Link>
            ))}
            <NavLink
              to="/deals"
              className={({ isActive }) =>
                `flex items-center px-4 py-1.5 rounded-full transition-colors ${isActive ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900'
                }`
              }
            >
              <Heart className="w-4 h-4 mr-1.5" />
              Deals
            </NavLink>
          </nav>

          <div className="flex items-center gap-3 text-sm">
            <Link
              to="/bookings"
              className="hidden sm:inline-flex text-gray-700 hover:text-gray-900"
            >
              Trips
            </Link>
            <button
              className="hidden sm:inline-flex text-gray-700 hover:text-gray-900"
              onClick={() => alert('Help center coming soon!')}
            >
              Help
            </button>

            {user ? (
              <div className="flex items-center gap-2">
                <Link
                  to="/profile"
                  className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50"
                  title="Profile"
                >
                  <User className="w-4 h-4" />
                </Link>
                <button
                  onClick={logout}
                  className="text-gray-700 hover:text-gray-900 text-xs"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand hover:bg-brand-dark"
                style={{ backgroundColor: '#FF690F' }}
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
