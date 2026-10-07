import React, { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Input, Button, Card } from '../components/ui';

export function SignupPage() {
    const navigate = useNavigate();
    const { login, isAuthenticated } = useAuth();
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        firstName: '',
        lastName: '',
        ssn: '',
        phone: '',
        dateOfBirth: '',
        address: {
            street: '',
            city: '',
            state: '',
            zipCode: '',
            country: 'USA'
        }
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [generalError, setGeneralError] = useState('');
    const [loading, setLoading] = useState(false);

    const getPasswordStrength = (password: string) => {
        if (!password) return { strength: 0, label: '', color: '' };
        
        let strength = 0;
        if (password.length >= 8) strength++;
        if (password.length >= 12) strength++;
        if (/[a-z]/.test(password)) strength++;
        if (/[A-Z]/.test(password)) strength++;
        if (/[0-9]/.test(password)) strength++;
        if (/[^A-Za-z0-9]/.test(password)) strength++;

        if (strength <= 2) return { strength: 1, label: 'Weak', color: 'bg-red-500' };
        if (strength <= 4) return { strength: 2, label: 'Medium', color: 'bg-yellow-500' };
        return { strength: 3, label: 'Strong', color: 'bg-green-500' };
    };

    const passwordStrength = getPasswordStrength(formData.password);

    const validate = () => {
        const newErrors: Record<string, string> = {};

        // Email Validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!formData.email) {
            newErrors.email = 'Email is required';
        } else if (!emailRegex.test(formData.email)) {
            newErrors.email = 'Please enter a valid email address';
        }

        // Password Validation
        if (!formData.password) {
            newErrors.password = 'Password is required';
        } else if (formData.password.length < 8) {
            newErrors.password = 'Password must be at least 8 characters';
        } else if (!/[A-Z]/.test(formData.password)) {
            newErrors.password = 'Password must contain at least one uppercase letter';
        } else if (!/[a-z]/.test(formData.password)) {
            newErrors.password = 'Password must contain at least one lowercase letter';
        } else if (!/[0-9]/.test(formData.password)) {
            newErrors.password = 'Password must contain at least one number';
        }

        // First Name Validation
        if (!formData.firstName || formData.firstName.trim().length === 0) {
            newErrors.firstName = 'First name is required';
        }

        // Last Name Validation
        if (!formData.lastName || formData.lastName.trim().length === 0) {
            newErrors.lastName = 'Last name is required';
        }

        // SSN Validation (XXX-XX-XXXX)
        const ssnRegex = /^\d{3}-\d{2}-\d{4}$/;
        if (!ssnRegex.test(formData.ssn)) {
            newErrors.ssn = 'SSN must be in format XXX-XX-XXXX';
        }

        // Phone Validation (10 digits, optional dashes/dots)
        const phoneRegex = /^(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;
        if (formData.phone && !phoneRegex.test(formData.phone)) {
            newErrors.phone = 'Invalid phone number format';
        }

        // ZIP Code Validation (5 digits)
        const zipRegex = /^\d{5}(-\d{4})?$/;
        if (formData.address.zipCode && !zipRegex.test(formData.address.zipCode)) {
            newErrors.zipCode = 'Invalid ZIP code';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        if (name.startsWith('address.')) {
            const addressField = name.split('.')[1];
            setFormData(prev => ({
                ...prev,
                address: { ...prev.address, [addressField]: value }
            }));
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
        // Clear error when user types
        if (errors[name] || (name.startsWith('address.') && errors[name.split('.')[1]])) {
            const fieldName = name.startsWith('address.') ? name.split('.')[1] : name;
            setErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[fieldName];
                return newErrors;
            });
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setGeneralError('');

        if (!validate()) {
            return;
        }

        setLoading(true);

        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error?.message || 'Registration failed');
            }

            const { accessToken, refreshToken, user } = data.data || {};
            if (!accessToken || !user) {
                throw new Error('Registration failed: unexpected response from server');
            }
            login(accessToken, user, refreshToken);
            navigate('/');
        } catch (err: any) {
            setGeneralError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (isAuthenticated) {
        return <Navigate to="/" replace />;
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="flex justify-center">
                    <div className="flex items-center gap-2">
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
                    </div>
                </div>
                <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
                    Create a new account
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600">
                    Or{' '}
                    <Link to="/login" className="font-medium text-brand hover:text-brand-dark" style={{ color: '#FF690F' }}>
                        sign in to existing account
                    </Link>
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <Card className="py-8 px-4 shadow sm:rounded-lg sm:px-10">
                    <form className="space-y-6" onSubmit={handleSubmit}>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">First Name</label>
                                <Input id="firstName" name="firstName" required value={formData.firstName} onChange={handleChange} className={errors.firstName ? 'border-red-500' : ''} />
                                {errors.firstName && <p className="mt-1 text-xs text-red-600">{errors.firstName}</p>}
                            </div>
                            <div>
                                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">Last Name</label>
                                <Input id="lastName" name="lastName" required value={formData.lastName} onChange={handleChange} className={errors.lastName ? 'border-red-500' : ''} />
                                {errors.lastName && <p className="mt-1 text-xs text-red-600">{errors.lastName}</p>}
                            </div>
                        </div>

                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email address</label>
                            <Input id="email" name="email" type="email" required value={formData.email} onChange={handleChange} className={errors.email ? 'border-red-500' : ''} />
                            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
                            <Input id="password" name="password" type="password" required value={formData.password} onChange={handleChange} />
                            {errors.password && <p className="mt-1 text-sm text-red-600">{errors.password}</p>}
                            {formData.password && (
                                <div className="mt-2">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden flex">
                                            {passwordStrength.strength >= 1 && <div className={`h-full flex-1 ${passwordStrength.color}`} />}
                                            {passwordStrength.strength >= 2 && <div className={`h-full flex-1 ${passwordStrength.color}`} />}
                                            {passwordStrength.strength >= 3 && <div className={`h-full flex-1 ${passwordStrength.color}`} />}
                                        </div>
                                        <span className={`text-xs font-medium ${
                                            passwordStrength.strength === 1 ? 'text-red-600' :
                                            passwordStrength.strength === 2 ? 'text-yellow-600' :
                                            'text-green-600'
                                        }`}>{passwordStrength.label}</span>
                                    </div>
                                    <p className="text-xs text-gray-500">
                                        Password must be at least 8 characters with uppercase, lowercase, and numbers
                                    </p>
                                </div>
                            )}
                        </div>

                        <div>
                            <label htmlFor="ssn" className="block text-sm font-medium text-gray-700">SSN (XXX-XX-XXXX)</label>
                            <Input
                                id="ssn"
                                name="ssn"
                                required
                                value={formData.ssn}
                                onChange={handleChange}
                                placeholder="000-00-0000"
                                className={errors.ssn ? 'border-red-500' : ''}
                            />
                            {errors.ssn && <p className="mt-1 text-xs text-red-600">{errors.ssn}</p>}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="phone" className="block text-sm font-medium text-gray-700">Phone</label>
                                <Input
                                    id="phone"
                                    name="phone"
                                    value={formData.phone}
                                    onChange={handleChange}
                                    className={errors.phone ? 'border-red-500' : ''}
                                />
                                {errors.phone && <p className="mt-1 text-xs text-red-600">{errors.phone}</p>}
                            </div>
                            <div>
                                <label htmlFor="dateOfBirth" className="block text-sm font-medium text-gray-700">Date of Birth</label>
                                <Input id="dateOfBirth" name="dateOfBirth" type="date" value={formData.dateOfBirth} onChange={handleChange} />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">Address</label>
                            <div className="space-y-2 mt-1">
                                <Input placeholder="Street" name="address.street" value={formData.address.street} onChange={handleChange} />
                                <div className="grid grid-cols-2 gap-2">
                                    <Input placeholder="City" name="address.city" value={formData.address.city} onChange={handleChange} />
                                    <Input placeholder="State" name="address.state" value={formData.address.state} onChange={handleChange} />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <Input
                                            placeholder="ZIP Code"
                                            name="address.zipCode"
                                            value={formData.address.zipCode}
                                            onChange={handleChange}
                                            className={errors.zipCode ? 'border-red-500' : ''}
                                        />
                                        {errors.zipCode && <p className="mt-1 text-xs text-red-600">{errors.zipCode}</p>}
                                    </div>
                                    <Input placeholder="Country" name="address.country" value={formData.address.country} onChange={handleChange} disabled />
                                </div>
                            </div>
                        </div>

                        {generalError && (
                            <div className="text-red-600 text-sm">{generalError}</div>
                        )}

                        <div>
                            <Button
                                type="submit"
                                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand hover:bg-brand-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand"
                                style={{ backgroundColor: '#FF690F' }}
                                disabled={loading}
                            >
                                {loading ? 'Creating account...' : 'Create Account'}
                            </Button>
                        </div>
                    </form>
                </Card>
            </div>
        </div>
    );
}
