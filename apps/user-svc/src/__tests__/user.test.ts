import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createClient } from 'redis';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'user-svc-test-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'user-svc-test-refresh-secret';

import { UserService } from '../index';

// User IDs are SSNs (###-##-####). This suite owns the 401-00-xxxx range.
const FIXTURE_USER = '401-00-0001';
const USER_TO_DELETE = '401-00-0002';
const LOGIN_USER = '401-00-0003';
const NEW_USER = '401-00-0010';
const DUPLICATE_USER = '401-00-0011';
const SSN_DUPLICATE_USER = '401-00-0012';
const MISSING_USER = '401-99-9999';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'kayak_test'
};

describe('User Service Integration Tests', () => {
  let service: UserService;
  let app: any;
  let db: mysql.Connection;

  const cleanup = async () => {
    await db.execute("DELETE FROM users WHERE id LIKE '401-%' OR email LIKE '%@user-svc.test'");
  };

  beforeAll(async () => {
    db = await mysql.createConnection(dbConfig);
    await cleanup();

    const passwordHash = await bcrypt.hash('SecurePassword123!', 4);
    const users = [
      [FIXTURE_USER, 'john.fixture@user-svc.test', 'Johnathan', 'Fixture', '+1234567890'],
      [USER_TO_DELETE, 'delete.me@user-svc.test', 'Delete', 'Me', null],
      [LOGIN_USER, 'login@user-svc.test', 'Login', 'Test', null]
    ];
    for (const [id, email, firstName, lastName, phone] of users) {
      await db.execute(
        'INSERT INTO users (id, email, password_hash, first_name, last_name, phone) VALUES (?, ?, ?, ?, ?, ?)',
        [id, email, passwordHash, firstName, lastName, phone]
      );
    }

    // Drop cached users from earlier runs
    const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await redis.connect();
    const keys = await redis.keys('user:401-*');
    if (keys.length > 0) await redis.del(keys);
    await redis.quit();

    service = new UserService();
    app = service.app;
  });

  afterAll(async () => {
    await cleanup();
    await db.end();
    await (service as any).db.end();
    const redis = (service as any).redis;
    if (redis?.isOpen) await redis.quit();
  });

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'test@user-svc.test',
        password: 'SecurePassword123!',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        ssn: NEW_USER
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data.user.email).toBe(userData.email);
      expect(response.body.data.user.id).toBe(NEW_USER);
      expect(response.body.data.user).not.toHaveProperty('password');
      expect(response.body.data.expiresIn).toBe(3600);

      const payload = jwt.verify(response.body.data.accessToken, process.env.JWT_SECRET as string) as any;
      expect(payload.userId).toBe(NEW_USER);
      expect(payload.role).toBe('user');
      expect(typeof response.body.data.refreshToken).toBe('string');

      // Stored with a bcrypt hash, never the plain password
      const [rows] = await db.execute('SELECT password_hash FROM users WHERE id = ?', [NEW_USER]);
      const stored = (rows as any[])[0].password_hash;
      expect(stored).not.toBe(userData.password);
      expect(await bcrypt.compare(userData.password, stored)).toBe(true);
    });

    it('should reject registration with duplicate email', async () => {
      const userData = {
        email: 'existing@user-svc.test',
        password: 'SecurePassword123!',
        firstName: 'Jane',
        lastName: 'Doe',
        ssn: DUPLICATE_USER
      };

      // First registration should succeed
      await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Second registration with same email should fail
      const response = await request(app)
        .post('/auth/register')
        .send({ ...userData, ssn: '401-00-0019' })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should reject registration with duplicate SSN', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'other@user-svc.test',
          password: 'SecurePassword123!',
          firstName: 'Jane',
          lastName: 'Doe',
          ssn: FIXTURE_USER
        })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('duplicate_user');
    });

    it('should reject registration without SSN', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'nossn@user-svc.test',
          password: 'SecurePassword123!',
          firstName: 'John',
          lastName: 'Doe'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('SSN is required');
    });

    it('should reject registration with malformed SSN', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'badssn@user-svc.test',
          password: 'SecurePassword123!',
          firstName: 'John',
          lastName: 'Doe',
          ssn: '123456789'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Invalid SSN format');
    });

    it('should reject registration with weak password', async () => {
      const userData = {
        email: 'weak@user-svc.test',
        password: '123',
        firstName: 'John',
        lastName: 'Doe',
        ssn: SSN_DUPLICATE_USER
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Password must be at least 8 characters');
    });

    it('should reject registration with invalid email', async () => {
      const userData = {
        email: 'invalid-email',
        password: 'SecurePassword123!',
        firstName: 'John',
        lastName: 'Doe',
        ssn: SSN_DUPLICATE_USER
      };

      const response = await request(app)
        .post('/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Invalid email format');

      const [rows] = await db.execute('SELECT id FROM users WHERE id = ?', [SSN_DUPLICATE_USER]);
      expect(rows).toHaveLength(0);
    });
  });

  describe('POST /auth/login', () => {
    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'login@user-svc.test',
          password: 'SecurePassword123!'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data.user.id).toBe(LOGIN_USER);
      const payload = jwt.verify(response.body.data.accessToken, process.env.JWT_SECRET as string) as any;
      expect(payload.userId).toBe(LOGIN_USER);
    });

    it('should reject login with wrong password', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'login@user-svc.test',
          password: 'WrongPassword'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject login for unknown email', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'nobody@user-svc.test', password: 'SecurePassword123!' })
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject login without credentials', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'login@user-svc.test' })
        .expect(400);

      expect(response.body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('GET /users/:id', () => {
    it('should get user by ID', async () => {
      const response = await request(app)
        .get(`/users/${FIXTURE_USER}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', FIXTURE_USER);
      expect(response.body.data).toHaveProperty('email', 'john.fixture@user-svc.test');
      expect(response.body.data).toHaveProperty('firstName', 'Johnathan');
      expect(response.body.data).not.toHaveProperty('password_hash');
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .get(`/users/${MISSING_USER}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PUT /users/:id', () => {
    it('should update user information', async () => {
      const updateData = {
        firstName: 'Updated',
        lastName: 'Name',
        phone: '+9876543210'
      };

      const response = await request(app)
        .put(`/users/${FIXTURE_USER}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.firstName).toBe('Updated');
      expect(response.body.data.user.lastName).toBe('Name');
      expect(response.body.data.user.phone).toBe('+9876543210');

      // The cached copy is dropped, so a read sees the update
      const read = await request(app)
        .get(`/users/${FIXTURE_USER}`)
        .expect(200);
      expect(read.body.data.firstName).toBe('Updated');
    });

    it('should reject an invalid phone number', async () => {
      const response = await request(app)
        .put(`/users/${FIXTURE_USER}`)
        .send({ phone: 'not-a-phone' })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 for updating non-existent user', async () => {
      const updateData = { firstName: 'Updated' };

      const response = await request(app)
        .put(`/users/${MISSING_USER}`)
        .send(updateData)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /users/:id', () => {
    it('should delete user successfully', async () => {
      const response = await request(app)
        .delete(`/users/${USER_TO_DELETE}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain('deleted successfully');

      await request(app)
        .get(`/users/${USER_TO_DELETE}`)
        .expect(404);
    });

    it('should return 404 for deleting non-existent user', async () => {
      const response = await request(app)
        .delete(`/users/${MISSING_USER}`)
        .expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /users', () => {
    it('should search users with pagination', async () => {
      const response = await request(app)
        .get('/users?page=1&limit=10')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data.length).toBeLessThanOrEqual(10);

      const one = await request(app)
        .get('/users?page=1&limit=1')
        .expect(200);
      expect(one.body.data).toHaveLength(1);
    });

    it('should search users by query', async () => {
      const response = await request(app)
        .get('/users?query=login@user-svc')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.map((u: any) => u.id)).toEqual([LOGIN_USER]);
    });
  });

  describe('POST /users/validate', () => {
    it('should validate user data successfully', async () => {
      const validationData = {
        email: 'valid@example.com',
        ssn: '123-45-6789',
        phone: '+1234567890'
      };

      const response = await request(app)
        .post('/users/validate')
        .send(validationData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.valid).toBe(true);
      expect(response.body.data.errors).toHaveLength(0);
    });

    it('should return validation errors for invalid data', async () => {
      const validationData = {
        email: 'invalid-email',
        ssn: 'invalid-ssn'
      };

      const response = await request(app)
        .post('/users/validate')
        .send(validationData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.valid).toBe(false);
      expect(response.body.data.errors).toHaveLength(2);
    });
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('healthy');
      expect(response.body.data.service).toBe('user-svc');
      expect(typeof response.headers['x-trace-id']).toBe('string');
    });
  });
});
