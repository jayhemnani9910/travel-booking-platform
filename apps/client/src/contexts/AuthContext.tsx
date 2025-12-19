import React, { createContext, useContext, useState, useEffect } from 'react';

export interface User {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    role: 'user' | 'admin';
}

const isDemoMode = (import.meta.env.VITE_DEMO_MODE as string | undefined)?.toLowerCase() === 'true';

const demoUser: User = {
    id: 'demo-user',
    email: 'demo@kayak.local',
    firstName: 'Demo',
    lastName: 'User',
    role: 'user',
};

const demoAccessToken = 'demo-access-token';
const demoRefreshToken = 'demo-refresh-token';

interface AuthContextType {
    user: User | null;
    token: string | null;
    login: (token: string, user: User, refreshToken?: string | null) => void;
    logout: () => void;
    updateUser: (user: User) => void;
    isAuthenticated: boolean;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Demo-mode: auto-seed a fake session so the UI is usable on GitHub Pages.
        if (isDemoMode) {
            const storedToken = localStorage.getItem('accessToken');
            const storedUser = localStorage.getItem('user');

            if (storedToken && storedUser) {
                setToken(storedToken);
                try {
                    setUser(JSON.parse(storedUser));
                } catch {
                    setUser(demoUser);
                }
            } else {
                setToken(demoAccessToken);
                setUser(demoUser);
                localStorage.setItem('accessToken', demoAccessToken);
                localStorage.setItem('refreshToken', demoRefreshToken);
                localStorage.setItem('user', JSON.stringify(demoUser));
            }

            setLoading(false);
            return;
        }

        // Normal mode: check local storage on load
        const storedToken = localStorage.getItem('accessToken');
        const storedUser = localStorage.getItem('user');
        if (storedToken && storedUser) {
            setToken(storedToken);
            setUser(JSON.parse(storedUser));
        }
        setLoading(false);
    }, []);

    const login = (newToken: string, newUser: User, refreshToken?: string | null) => {
        setToken(newToken);
        setUser(newUser);
        localStorage.setItem('accessToken', newToken);
        localStorage.setItem('user', JSON.stringify(newUser));
        if (refreshToken) {
            localStorage.setItem('refreshToken', refreshToken);
        }
    };

    const updateUser = (updatedUser: User) => {
        setUser(updatedUser);
        localStorage.setItem('user', JSON.stringify(updatedUser));
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        localStorage.removeItem('refreshToken');
    };

    return (
        <AuthContext.Provider value={{ user, token, login, logout, updateUser, isAuthenticated: !!user, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
