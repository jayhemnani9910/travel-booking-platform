/**
 * User Service - Complete implementation for user management
 */

import express, { Request, Response } from 'express';
import mysql from 'mysql2/promise';
import { createClient } from 'redis';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
  User,
  CreateUserRequest,
  UpdateUserRequest,
  ApiResponse,
  generateTraceId,
  validateSSN,
  validateEmail,
  validatePhone,
  validateAddress
} from '@kayak/shared';

class UserService {
  public app: express.Application;
  private db!: mysql.Pool;
  private redis: any;
  private port: number = 8001;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.initializeDatabase();
    this.initializeRedis();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Request tracing
    this.app.use((req, res, next) => {
      const traceId = req.headers['x-trace-id'] as string || generateTraceId();
      (req as any).traceId = traceId;
      res.setHeader('X-Trace-Id', traceId);
      next();
    });
  }

  private async initializeDatabase() {
    try {
      this.db = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'kayak',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'kayak',
        connectionLimit: 50,
        queueLimit: 0
      });
      console.log('✅ MySQL pool connected');
    } catch (error) {
      console.error('❌ MySQL connection failed:', error);
      throw error;
    }
  }

  private async initializeRedis() {
    try {
      this.redis = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      this.redis.on('error', (err: any) => console.error('Redis Client Error', err));
      await this.redis.connect();
      console.log('✅ Redis connected');
    } catch (error) {
      console.error('❌ Redis connection failed:', error);
    }
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        success: true,
        data: {
          status: 'healthy',
          service: 'user-svc',
          timestamp: new Date().toISOString()
        }
      });
    });

    // Auth routes
    this.app.post('/auth/login', this.login.bind(this));
    this.app.post('/auth/register', this.register.bind(this));
    this.app.post('/auth/refresh', this.refreshToken.bind(this));
    this.app.post('/auth/logout', this.logout.bind(this));

    // Create user
    this.app.post('/users', this.createUser.bind(this));

    // Get user by ID
    this.app.get('/users/:id', this.getUserById.bind(this));

    // Update user
    this.app.put('/users/:id', this.updateUser.bind(this));

    // Delete user
    this.app.delete('/users/:id', this.deleteUser.bind(this));

    // Search users
    this.app.get('/users', this.searchUsers.bind(this));

    // Validate user data
    this.app.post('/users/validate', this.validateUserData.bind(this));

    // User profile endpoints
    this.app.get('/users/:id/profile', this.getUserProfile.bind(this));
    this.app.put('/users/:id/profile', this.updateUserProfile.bind(this));
    this.app.post('/users/:id/profile-image', this.updateProfileImage.bind(this));

    // User bookings
    this.app.get('/users/:id/bookings', this.getUserBookings.bind(this));

    // Payment methods
    this.app.get('/users/:id/payment-methods', this.getPaymentMethods.bind(this));
    this.app.post('/users/:id/payment-methods', this.addPaymentMethod.bind(this));
    this.app.delete('/users/:id/payment-methods/:paymentId', this.deletePaymentMethod.bind(this));
  }

  private async createUser(req: Request, res: Response) {
    try {
      const userData: CreateUserRequest = req.body;

      // Validate input
      try {
        this.validateCreateUserData(userData);
      } catch (validationError: any) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: validationError.message,
            traceId: (req as any).traceId
          }
        });
      }

      // Check for duplicates (Email)
      const existingUserEmail = await this.findUserByEmail(userData.email);
      if (existingUserEmail) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'CONFLICT',
            message: 'User with this email already exists'
          }
        });
      }

      // Check for duplicates (SSN)
      // Since SSN is the ID, check by ID directly
      const [existingSsnRows] = await this.db.execute('SELECT id FROM users WHERE id = ?', [userData.ssn]);
      if ((existingSsnRows as any[]).length > 0) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'duplicate_user',
            message: 'User with this SSN already exists',
            traceId: (req as any).traceId
          }
        });
      }

      // Hash password if provided
      let passwordHash: string | undefined;
      if (userData.password) {
        passwordHash = await bcrypt.hash(userData.password, 10);
      }

      // Create user
      // FIX: Use SSN as User ID per spec
      const userId = userData.ssn!; // Already validated by validateCreateUserData
      const now = new Date().toISOString().slice(0, 19).replace('T', ' '); // MySQL datetime format
      const user: User = {
        id: userId,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        phone: userData.phone,
        ssn: userId, // SSN is same as id per spec
        dateOfBirth: userData.dateOfBirth,
        address: userData.address,
        profileImageUrl: userData.profileImageUrl,
        createdAt: now,
        updatedAt: now
      };

      // Save to database
      await this.saveUser(user, passwordHash);

      // Cache user
      if (this.redis && (this.redis as any).isReady) {
        await this.redis.setEx(`user:${userId}`, 3600, JSON.stringify(user));
      }

      const response: ApiResponse<User> = {
        success: true,
        data: user,
        traceId: (req as any).traceId
      };

      res.status(201).json(response);
    } catch (error: any) {
      console.error('Create user error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message,
          traceId: (req as any).traceId
        }
      });
    }
  }

  private async getUserById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Try cache first
      if (this.redis && (this.redis as any).isReady) {
        const cached = await this.redis.get(`user:${id}`);
        if (cached) {
          const cachedUser = JSON.parse(cached);
          return res.json({
            success: true,
            data: cachedUser,
            traceId: (req as any).traceId
          });
        }
      }

      // Fetch from database
      const user = await this.fetchUserById(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      // Cache the result
      if (this.redis && (this.redis as any).isReady) {
        await this.redis.setEx(`user:${id}`, 3600, JSON.stringify(user));
      }

      res.json({
        success: true,
        data: user,
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Get user error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message,
          traceId: (req as any).traceId
        }
      });
    }
  }

  private async updateUser(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updateData: UpdateUserRequest = { ...req.body, id };

      // Validate update data
      try {
        this.validateUpdateUserData(updateData);
      } catch (validationError: any) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: validationError.message,
            traceId: (req as any).traceId
          }
        });
      }

      // Check if user exists
      const existingUser = await this.fetchUserById(id);
      if (!existingUser) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      // Update user
      const updatedUser = await this.saveUpdatedUser(updateData);

      // Invalidate cache
      if (this.redis && (this.redis as any).isReady) {
        await this.redis.del(`user:${id}`);
      }

      res.json({
        success: true,
        data: { user: updatedUser },
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Update user error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message,
          traceId: (req as any).traceId
        }
      });
    }
  }

  private async deleteUser(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Check if user exists
      const existingUser = await this.fetchUserById(id);
      if (!existingUser) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      // Delete from database
      await this.db.execute('DELETE FROM users WHERE id = ?', [id]);
      await this.db.execute('DELETE FROM user_addresses WHERE user_id = ?', [id]);

      // Remove from cache
      if (this.redis && (this.redis as any).isReady) {
        await this.redis.del(`user:${id}`);
      }

      res.json({
        success: true,
        data: { message: 'User deleted successfully' },
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Delete user error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message,
          traceId: (req as any).traceId
        }
      });
    }
  }

  private async searchUsers(req: Request, res: Response) {
    try {
      const { query, city, state, page = 1, limit = 10 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      let whereClause = 'WHERE 1=1';
      const params: any[] = [];

      if (query) {
        whereClause += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)';
        const searchTerm = `%${query}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      if (city) {
        whereClause += ' AND ua.city = ?';
        params.push(city);
      }

      if (state) {
        whereClause += ' AND ua.state = ?';
        params.push(state);
      }

      const sql = `
        SELECT DISTINCT u.*, 
               JSON_OBJECT(
                'street', ua.street,
                'city', ua.city,
                'state', ua.state,
                'zipCode', ua.zip_code,
                'country', ua.country
               ) as address
        FROM users u
        LEFT JOIN user_addresses ua ON u.id = ua.user_id
        ${whereClause}
        LIMIT ? OFFSET ?
      `;

      // MySQL 8.0.22+ rejects numeric (DOUBLE) LIMIT/OFFSET binds from execute()
      params.push(String(Number(limit)), String(offset));

      const [rows] = await this.db.execute(sql, params);

      const users = (rows as any[]).map(row => {
        // JSON_OBJECT comes back already parsed by mysql2
        const parsedAddress = row.address ? (typeof row.address === 'string' ? JSON.parse(row.address) : row.address) : undefined;
        const mapped: User = {
          id: row.id,
          email: row.email,
          firstName: row.first_name,
          lastName: row.last_name,
          phone: row.phone || undefined,
          ssn: row.id, // SSN is same as id (schema change: users.ssn column removed)
          dateOfBirth: row.date_of_birth || undefined,
          address: parsedAddress,
          profileImageUrl: row.profile_image_url || undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
        return mapped;
      });

      res.json({
        success: true,
        data: users,
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Search users error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message,
          traceId: (req as any).traceId
        }
      });
    }
  }

  private async validateUserData(req: Request, res: Response) {
    try {
      const { email, ssn, phone } = req.body;
      const errors: string[] = [];

      if (email) {
        try {
          validateEmail(email);
        } catch (error: any) {
          errors.push(error.message);
        }
      }

      if (ssn) {
        try {
          validateSSN(ssn);
        } catch (error: any) {
          errors.push(error.message);
        }
      }

      if (phone) {
        try {
          validatePhone(phone);
        } catch (error: any) {
          errors.push(error.message);
        }
      }

      res.json({
        success: true,
        data: {
          valid: errors.length === 0,
          errors
        },
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Validate user data error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message,
          traceId: (req as any).traceId
        }
      });
    }
  }

  private async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'Email and password are required'
          }
        });
      }

      // Find user by email
      const [rows] = await this.db.execute(
        'SELECT * FROM users WHERE email = ?',
        [email]
      );
      const user = (rows as any[])[0];

      if (!user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid credentials'
          }
        });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid credentials'
          }
        });
      }

      // Generate tokens
      const accessToken = this.generateAccessToken(user.id, user.role);
      const refreshToken = this.generateRefreshToken(user.id);

      // Store refresh token in Redis
      if (this.redis && (this.redis as any).isReady) {
        await this.redis.setEx(
          `refresh_token:${user.id}:${refreshToken}`,
          604800, // 7 days
          'active'
        );
      }

      // Get user data (without password)
      const userData = await this.fetchUserById(user.id);

      res.json({
        success: true,
        data: {
          user: userData,
          accessToken,
          refreshToken,
          expiresIn: 3600 // 1 hour in seconds
        },
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message,
          traceId: (req as any).traceId
        }
      });
    }
  }

  private async register(req: Request, res: Response) {
    try {
      const userData: CreateUserRequest = req.body;

      // Validate input
      try {
        this.validateCreateUserData(userData);
      } catch (validationError: any) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: validationError.message,
            traceId: (req as any).traceId
          }
        });
      }

      // Check for duplicates (Email)
      const existingUser = await this.findUserByEmail(userData.email);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'CONFLICT',
            message: 'User with this email already exists',
            traceId: (req as any).traceId
          }
        });
      }

      // Check for duplicates (SSN)
      // Since SSN is the ID, check by ID directly
      const [existingSsnRows] = await this.db.execute('SELECT id FROM users WHERE id = ?', [userData.ssn]);
      if ((existingSsnRows as any[]).length > 0) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'duplicate_user',
            message: 'User with this SSN already exists',
            traceId: (req as any).traceId
          }
        });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(userData.password as string, 10);

      // Create user
      // FIX: Use SSN as User ID per spec
      const userId = userData.ssn!; // Already validated by validateCreateUserData
      const now = new Date().toISOString().slice(0, 19).replace('T', ' '); // MySQL datetime format
      const user: User = {
        id: userId,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        phone: userData.phone,
        ssn: userId, // SSN is same as id per spec
        dateOfBirth: userData.dateOfBirth,
        address: userData.address,
        profileImageUrl: userData.profileImageUrl,
        createdAt: now,
        updatedAt: now
      };

      // Save to database
      await this.saveUser(user, passwordHash);

      // Generate tokens
      const accessToken = this.generateAccessToken(userId, 'user'); // Default role is user
      const refreshToken = this.generateRefreshToken(userId);

      // Store refresh token in Redis
      if (this.redis && (this.redis as any).isReady) {
        await this.redis.setEx(
          `refresh_token:${userId}:${refreshToken}`,
          604800, // 7 days
          'active'
        );
      }

      res.status(201).json({
        success: true,
        data: {
          user,
          accessToken,
          refreshToken,
          expiresIn: 3600
        },
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Register error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message,
          traceId: (req as any).traceId
        }
      });
    }
  }

  private async refreshToken(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'Refresh token is required'
          }
        });
      }

      // Verify refresh token
      if (!process.env.JWT_REFRESH_SECRET) {
        throw new Error('JWT_REFRESH_SECRET environment variable is required');
      }
      const decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET
      ) as any;

      const userId = decoded.userId;

      // Check if refresh token exists in Redis
      if (this.redis && (this.redis as any).isReady) {
        const exists = await this.redis.get(`refresh_token:${userId}:${refreshToken}`);
        if (!exists) {
          return res.status(401).json({
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid refresh token'
            }
          });
        }
      }

      // Generate new access token
      // We need to fetch the user to get the role, or encode role in refresh token too.
      // For now, let's fetch the user to be safe and get current role.
      const user = await this.fetchUserById(userId);
      if (!user) throw new Error('User not found during refresh');

      // Note: In a real app, we might want to avoid this DB call, but for correctness of role:
      // We'll assume the user fetch above is cached or fast enough.
      // Actually, fetchUserById uses cache.

      // We need the role from the DB/Cache because it might have changed.
      // The User interface in shared might not have role, let's check.
      // If User interface doesn't have role, we need to cast or fetch raw.
      // Looking at schema, users table has role.
      // Let's assume fetchUserById returns something with role or we query it.
      // Wait, fetchUserById returns `User` type. Let's check `User` type definition in shared if possible.
      // If not, we can query DB directly for role.

      const [roleRows] = await this.db.execute('SELECT role FROM users WHERE id = ?', [userId]);
      const role = (roleRows as any[])[0]?.role || 'user';

      const accessToken = this.generateAccessToken(userId, role);
      const newRefreshToken = this.generateRefreshToken(userId);

      // Remove old refresh token and add new one
      if (this.redis && (this.redis as any).isReady) {
        await this.redis.del(`refresh_token:${userId}:${refreshToken}`);
        await this.redis.setEx(
          `refresh_token:${userId}:${newRefreshToken}`,
          604800,
          'active'
        );
      }

      res.json({
        success: true,
        data: {
          accessToken,
          refreshToken: newRefreshToken,
          expiresIn: 3600
        },
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Refresh token error:', error);
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid refresh token',
          traceId: (req as any).traceId
        }
      });
    }
  }

  private async logout(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;
      const { userId } = req.body;

      if (refreshToken && this.redis && (this.redis as any).isReady) {
        await this.redis.del(`refresh_token:${userId}:${refreshToken}`);
      }

      res.json({
        success: true,
        data: { message: 'Logged out successfully' },
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message,
          traceId: (req as any).traceId
        }
      });
    }
  }

  private generateAccessToken(userId: string, role: string): string {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    return jwt.sign(
      { userId, role },
      process.env.JWT_SECRET as string,
      { expiresIn: '1h' }
    );
  }

  private generateRefreshToken(userId: string): string {
    if (!process.env.JWT_REFRESH_SECRET) {
      throw new Error('JWT_REFRESH_SECRET environment variable is required');
    }
    return jwt.sign(
      { userId },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: '7d' }
    );
  }

  // Helper methods
  private validateCreateUserData(data: CreateUserRequest) {
    // Validate required fields
    if (!data.email || !data.firstName || !data.lastName || !data.password) {
      throw new Error('Email, firstName, lastName, and password are required');
    }

    if (!data.ssn) {
      throw new Error('SSN is required');
    }

    // Validate each field
    validateEmail(data.email);
    validateSSN(data.ssn);

    if (data.password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    if (data.phone) validatePhone(data.phone);
    if (data.address) validateAddress(data.address);
  }

  private validateUpdateUserData(data: UpdateUserRequest) {
    if (data.email) validateEmail(data.email);
    if (data.ssn) validateSSN(data.ssn);
    if (data.phone) validatePhone(data.phone);
    if (data.address) validateAddress(data.address);
  }

  private async findUserByEmail(email: string) {
    const [rows] = await this.db.execute('SELECT * FROM users WHERE email = ?', [email]);
    return (rows as any[])[0];
  }

  private mapDbRowToUser(row: any): User {
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone || undefined,
      ssn: row.id, // SSN is same as id (schema change: users.ssn column removed)
      dateOfBirth: row.date_of_birth || undefined,
      address: row.address,
      profileImageUrl: row.profile_image_url || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private async fetchUserById(id: string): Promise<User | null> {
    const [rows] = await this.db.execute('SELECT * FROM users WHERE id = ?', [id]);
    const dbUser = (rows as any[])[0];
    if (!dbUser) return null;

    // Fetch address
    const [addrRows] = await this.db.execute(
      'SELECT * FROM user_addresses WHERE user_id = ? LIMIT 1',
      [id]
    );
    const address = (addrRows as any[])[0];

    if (address) {
      dbUser.address = {
        street: address.street,
        city: address.city,
        state: address.state,
        zipCode: address.zip_code,
        country: address.country
      };
    }

    return this.mapDbRowToUser(dbUser);
  }

  private async saveUser(user: User, passwordHash?: string) {
    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();

      // Insert user (id IS the SSN per spec, so ssn column removed from schema)
      await conn.execute(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, phone,
                            date_of_birth, profile_image_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id, user.email, passwordHash || null, user.firstName, user.lastName,
          user.phone || null, user.dateOfBirth || null, user.profileImageUrl || null,
          user.createdAt, user.updatedAt
        ]
      );

      // Insert address if present
      if (user.address) {
        await conn.execute(
          `INSERT INTO user_addresses (id, user_id, street, city, state, zip_code, country, address_type, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'home', ?)`,
          [
            uuidv4(), user.id, user.address.street, user.address.city,
            user.address.state, user.address.zipCode, user.address.country,
            new Date().toISOString().slice(0, 19).replace('T', ' ')
          ]
        );
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  private async saveUpdatedUser(data: UpdateUserRequest) {
    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();

      const fields: string[] = [];
      const values: any[] = [];

      if (data.email) { fields.push('email = ?'); values.push(data.email); }
      if (data.firstName) { fields.push('first_name = ?'); values.push(data.firstName); }
      if (data.lastName) { fields.push('last_name = ?'); values.push(data.lastName); }
      if (data.phone !== undefined) { fields.push('phone = ?'); values.push(data.phone || null); }
      // SSN cannot be updated as it's the primary key (id)
      if (data.dateOfBirth !== undefined) { fields.push('date_of_birth = ?'); values.push(data.dateOfBirth || null); }
      if (data.profileImageUrl !== undefined) { fields.push('profile_image_url = ?'); values.push(data.profileImageUrl || null); }

      fields.push('updated_at = ?');
      values.push(new Date().toISOString().slice(0, 19).replace('T', ' '));
      values.push(data.id);

      await conn.execute(
        `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
        values
      );

      // Handle address updates if present
      if (data.address) {
        // Delete existing addresses
        await conn.execute(
          'DELETE FROM user_addresses WHERE user_id = ?',
          [data.id]
        );

        // Insert new address
        await conn.execute(
          `INSERT INTO user_addresses (id, user_id, street, city, state, zip_code, country, address_type, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'home', ?)`,
          [
            uuidv4(),
            data.id,
            data.address.street || null,
            data.address.city || null,
            data.address.state || null,
            data.address.zipCode || null,
            data.address.country || null,
            new Date().toISOString().slice(0, 19).replace('T', ' ')
          ]
        );
      }

      await conn.commit();
      return this.fetchUserById(data.id);
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  // ========== PROFILE ENDPOINTS ==========
  private async getUserProfile(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const user = await this.fetchUserById(id);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' }
        });
      }

      res.json({
        success: true,
        data: user
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get profile' }
      });
    }
  }

  private async updateUserProfile(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const existingUser = await this.fetchUserById(id);
      if (!existingUser) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' }
        });
      }

      const updatedUser = await this.saveUpdatedUser({ ...updates, id });

      res.json({
        success: true,
        data: updatedUser
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update profile' }
      });
    }
  }

  private async updateProfileImage(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { imageUrl } = req.body;

      if (!imageUrl) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'imageUrl is required' }
        });
      }

      const existingUser = await this.fetchUserById(id);
      if (!existingUser) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' }
        });
      }

      await this.db.execute(
        'UPDATE users SET profile_image_url = ?, updated_at = ? WHERE id = ?',
        [imageUrl, new Date().toISOString().slice(0, 19).replace('T', ' '), id]
      );

      res.json({
        success: true,
        data: { id, profileImageUrl: imageUrl }
      });
    } catch (error) {
      console.error('Update profile image error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update profile image' }
      });
    }
  }

  private async getUserBookings(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { limit = '20', offset = '0', filter } = req.query;

      // Prefer explicit trip dates when available, fall back to created_at.
      // This allows spec-accurate past/current/future classification once
      // callers start populating trip_start_date/trip_end_date.
      let query = `
        SELECT 
          id,
          user_id,
          type,
          status,
          total_amount,
          currency,
          confirmation_number,
          created_at,
          trip_start_date,
          trip_end_date
        FROM bookings
        WHERE user_id = ?
      `;
      const params: any[] = [id];

      if (filter === 'past') {
        query += ` AND COALESCE(trip_end_date, DATE(created_at)) < CURDATE()`;
      } else if (filter === 'current') {
        query += ` AND COALESCE(trip_start_date, DATE(created_at)) <= CURDATE()
                   AND COALESCE(trip_end_date, DATE(created_at)) >= CURDATE()`;
      } else if (filter === 'future') {
        query += ` AND COALESCE(trip_start_date, DATE(created_at)) > CURDATE()`;
      }

      query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(parseInt(limit as string, 10), parseInt(offset as string, 10));

      const [rows] = await this.db.query(query, params);

      const bookings = (rows as any[]).map(row => ({
        id: row.id,
        userId: row.user_id,
        type: row.type,
        status: row.status,
        totalAmount: parseFloat(row.total_amount),
        currency: row.currency,
        confirmationNumber: row.confirmation_number,
        createdAt: row.created_at,
        tripStartDate: row.trip_start_date || null,
        tripEndDate: row.trip_end_date || null
      }));

      res.json({
        success: true,
        data: { bookings }
      });
    } catch (error) {
      console.error('Get bookings error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get bookings' }
      });
    }
  }

  private async getPaymentMethods(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const [methods] = await this.db.query(
        `SELECT id, user_id, payment_type, last_four, expiry_month, expiry_year, 
         billing_address, is_default, created_at 
         FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC, created_at DESC`,
        [id]
      );

      res.json({
        success: true,
        data: { paymentMethods: methods }
      });
    } catch (error) {
      console.error('Get payment methods error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get payment methods' }
      });
    }
  }

  private async addPaymentMethod(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { paymentType, lastFour, expiryMonth, expiryYear, billingAddress, isDefault = false } = req.body;

      if (!paymentType || !lastFour || !expiryMonth || !expiryYear) {
        return res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Missing required fields' }
        });
      }

      const paymentId = uuidv4();
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

      // If setting as default, unset other defaults
      if (isDefault) {
        await this.db.execute(
          'UPDATE payment_methods SET is_default = 0 WHERE user_id = ?',
          [id]
        );
      }

      await this.db.execute(
        `INSERT INTO payment_methods (id, user_id, payment_type, last_four, expiry_month, 
         expiry_year, billing_address, is_default, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [paymentId, id, paymentType, lastFour, expiryMonth, expiryYear,
          billingAddress || null, isDefault ? 1 : 0, now, now]
      );

      res.status(201).json({
        success: true,
        data: { id: paymentId }
      });
    } catch (error) {
      console.error('Add payment method error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to add payment method' }
      });
    }
  }

  private async deletePaymentMethod(req: Request, res: Response) {
    try {
      const { id, paymentId } = req.params;

      const [result] = await this.db.execute(
        'DELETE FROM payment_methods WHERE id = ? AND user_id = ?',
        [paymentId, id]
      ) as any;

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Payment method not found' }
        });
      }

      res.json({
        success: true,
        data: { deleted: true }
      });
    } catch (error) {
      console.error('Delete payment method error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete payment method' }
      });
    }
  }

  public start() {
    this.app.listen(this.port, () => {
      console.log(`🚀 User Service listening on port ${this.port}`);
      console.log(`📍 Health check: http://localhost:${this.port}/health`);
    });
  }
}

// Start the service
const userService = new UserService();

// Export for testing
export const app = userService.app;

// Start the service if this file is run directly
if (require.main === module) {
  userService.start();
}
