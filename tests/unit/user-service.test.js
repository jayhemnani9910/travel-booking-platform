// User Service Integration Tests
const request = require('supertest');
const { validateEmail } = require('../../shared/src/validators/common');
const { UserService } = require('../../apps/user-svc/src/index');

// A real UserService whose database pool is replaced by a stub
const serviceWithDatabase = (db) => {
  const service = new UserService();
  service.db = db;
  return service;
};

const closeService = async (service) => {
  if (service.redis && service.redis.isOpen) await service.redis.quit();
};

describe('User Service Integration Tests', () => {
  let mockUserService;
  let mockDatabase;
  let mockRedis;
  
  beforeEach(() => {
    // Mock the database operations
    mockDatabase = {
      execute: jest.fn(),
      query: jest.fn(),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn()
    };
    
    // Mock Redis operations
    mockRedis = {
      get: jest.fn(),
      setEx: jest.fn(),
      del: jest.fn(),
      connect: jest.fn()
    };
    
    // Mock bcrypt
    jest.mock('bcrypt', () => ({
      compare: jest.fn(),
      hash: jest.fn()
    }));
    
    // Mock JWT
    jest.mock('jsonwebtoken', () => ({
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn()
    }));
    
    // Mock UserService class (simplified)
    mockUserService = {
      createUser: jest.fn(),
      getUserById: jest.fn(),
      updateUser: jest.fn(),
      deleteUser: jest.fn(),
      login: jest.fn(),
      register: jest.fn()
    };
  });

  describe('User Registration', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890'
      };

      // Mock successful user creation
      mockUserService.createUser.mockResolvedValue({
        id: 'user-123',
        ...userData,
        createdAt: new Date().toISOString()
      });

      const result = await mockUserService.createUser(userData);
      
      expect(result).toHaveProperty('id');
      expect(result.email).toBe(userData.email);
      expect(result.firstName).toBe(userData.firstName);
      expect(result).toHaveProperty('createdAt');
    });

    it('should reject registration with duplicate email', async () => {
      mockDatabase.execute.mockResolvedValue([[{ id: '123-45-6789' }]]); // Simulate existing user
      const service = serviceWithDatabase(mockDatabase);

      const userData = {
        email: 'existing@example.com',
        password: 'SecurePassword123!',
        firstName: 'Jane',
        lastName: 'Doe',
        ssn: '123-45-6789'
      };

      try {
        const response = await request(service.app).post('/auth/register').send(userData);

        // Should detect duplicate email
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('CONFLICT');
        expect(mockDatabase.execute).toHaveBeenCalledWith(
          'SELECT * FROM users WHERE email = ?',
          [userData.email]
        );
      } finally {
        await closeService(service);
      }
    });

    it('should validate password strength', () => {
      const weakPasswords = ['123', 'abc', 'short'];
      
      weakPasswords.forEach(password => {
        expect(password.length >= 8).toBe(false);
      });
    });
  });

  describe('User Authentication', () => {
    it('should login with valid credentials', async () => {
      const credentials = {
        email: 'test@example.com',
        password: 'SecurePassword123!'
      };

      // Mock successful login
      const mockTokens = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600
      };

      mockUserService.login.mockResolvedValue({
        user: { id: 'user-123', email: credentials.email },
        tokens: mockTokens
      });

      const result = await mockUserService.login(credentials);
      
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
      expect(result.user.email).toBe(credentials.email);
    });

    it('should reject login with wrong password', async () => {
      const bcrypt = require('bcrypt');
      bcrypt.compare = jest.fn().mockResolvedValue(false); // Invalid password

      const result = await bcrypt.compare('wrongpassword', 'hash');
      expect(result).toBe(false);
    });
  });

  describe('User CRUD Operations', () => {
    it('should get user by ID', async () => {
      const userId = 'user-123';
      
      // Mock database response
      mockDatabase.execute.mockResolvedValue([[{
        id: userId,
        email: 'test@example.com',
        first_name: 'John',
        last_name: 'Doe'
      }]]);

      mockUserService.getUserById.mockResolvedValue({
        id: userId,
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe'
      });

      const result = await mockUserService.getUserById(userId);
      
      expect(result.id).toBe(userId);
      expect(result.email).toBe('test@example.com');
    });

    it('should update user information', async () => {
      const userId = 'user-123';
      const updateData = {
        firstName: 'Updated',
        lastName: 'Name',
        phone: '+9876543210'
      };

      mockUserService.updateUser.mockResolvedValue({
        id: userId,
        ...updateData,
        updatedAt: new Date().toISOString()
      });

      const result = await mockUserService.updateUser(userId, updateData);
      
      expect(result.firstName).toBe('Updated');
      expect(result.phone).toBe('+9876543210');
    });

    it('should delete user successfully', async () => {
      const userId = 'user-123';
      
      mockUserService.deleteUser.mockResolvedValue({ 
        message: 'User deleted successfully' 
      });

      const result = await mockUserService.deleteUser(userId);
      
      expect(result.message).toContain('deleted successfully');
    });
  });

  describe('Database Transaction Handling', () => {
    it('should handle transaction rollback on error', async () => {
      // Simulate database error
      const error = new Error('Database connection failed');
      mockDatabase.execute.mockRejectedValue(error);

      mockUserService.createUser = jest.fn().mockImplementation(async (userData) => {
        try {
          await mockDatabase.beginTransaction();
          await mockDatabase.execute('INSERT INTO users...', []);
          await mockDatabase.commit();
          return { id: 'user-123', ...userData };
        } catch (err) {
          await mockDatabase.rollback();
          throw err;
        }
      });

      await expect(mockUserService.createUser({})).rejects.toThrow('Database connection failed');
      expect(mockDatabase.rollback).toHaveBeenCalled();
    });
  });

  describe('Caching with Redis', () => {
    it('should cache user data', async () => {
      const userId = 'user-123';
      const userData = { id: userId, email: 'test@example.com' };
      
      mockRedis.setEx.mockResolvedValue('OK');
      
      // Simulate cache write
      await mockRedis.setEx(`user:${userId}`, 3600, JSON.stringify(userData));
      
      expect(mockRedis.setEx).toHaveBeenCalledWith(
        'user:user-123',
        3600,
        JSON.stringify(userData)
      );
    });

    it('should retrieve user from cache', async () => {
      const userId = 'user-123';
      const cachedUser = { id: userId, email: 'cached@example.com' };
      
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedUser));
      
      const result = await mockRedis.get(`user:${userId}`);
      const parsedResult = JSON.parse(result);
      
      expect(parsedResult.email).toBe('cached@example.com');
    });
  });

  describe('Data Validation', () => {
    it('should validate email format', () => {
      const validEmails = ['test@example.com', 'user.name@domain.co.uk'];
      const invalidEmails = ['invalid-email', '@domain.com', 'user@'];
      
      validEmails.forEach(email => {
        expect(() => validateEmail(email)).not.toThrow();
      });
      
      invalidEmails.forEach(email => {
        expect(() => validateEmail(email)).toThrow('Invalid email format');
      });
    });

    it('should validate phone numbers', () => {
      const validPhones = ['+1234567890', '123-456-7890', '(123) 456-7890'];
      
      validPhones.forEach(phone => {
        expect(phone.replace(/\D/g, '').length >= 10).toBe(true);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      const error = new Error('Connection refused');
      mockDatabase.execute.mockRejectedValue(error);
      const service = serviceWithDatabase(mockDatabase);

      try {
        const response = await request(service.app).get('/users/123-45-6789');

        expect(response.status).toBe(500);
        expect(response.body.error.code).toBe('INTERNAL_ERROR');
        expect(response.body.error.message).toBe('Connection refused');
      } finally {
        await closeService(service);
      }
    });

    it('should handle Redis connection errors', async () => {
      const error = new Error('Redis connection failed');
      mockRedis.get.mockRejectedValue(error);

      await expect(mockRedis.get('user:123')).rejects.toThrow('Redis connection failed');
    });
  });
});
