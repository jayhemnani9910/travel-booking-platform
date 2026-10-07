const request = require('supertest');
const { app } = require('../apps/user-svc/dist/index');

async function testUserService() {
  try {
    console.log('Testing user service health check...');
    
    const response = await request(app)
      .get('/health')
      .expect(200);
    
    console.log('Health check response:', response.body);
    console.log('✅ User service is working!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testUserService();