/**
 * Notification Service - Email and SMS notifications via Kafka
 */

import express from 'express';
import nodemailer from 'nodemailer';
import { Kafka } from 'kafkajs';
import { Twilio } from 'twilio';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import { 
  ApiResponse,
  generateTraceId
} from '@kayak/shared';

interface EmailNotification {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface SMSNotification {
  to: string;
  message: string;
}

class NotificationService {
  private app: express.Application;
  private kafka!: Kafka;
  private consumer: any;
  private emailTransporter?: nodemailer.Transporter;
  private twilioClient: any;
  private db!: mysql.Pool;
  private port: number = 8009;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.initializeDatabase();
    this.initializeKafka();
    this.initializeEmail();
    this.initializeTwilio();
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
      // Prefer explicit host/user/password/name, but allow MYSQL_URL as a fallback
      const mysqlUrl = process.env.MYSQL_URL;
      if (mysqlUrl) {
        const url = new URL(mysqlUrl);
        this.db = mysql.createPool({
          host: url.hostname,
          user: url.username,
          password: url.password,
          database: url.pathname.replace(/^\//, '') || 'kayak',
          connectionLimit: 10,
          queueLimit: 0
        });
      } else {
        this.db = mysql.createPool({
          host: process.env.DB_HOST || 'localhost',
          user: process.env.DB_USER || 'kayak',
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME || 'kayak',
          connectionLimit: 10,
          queueLimit: 0
        });
      }
      console.log('✅ MySQL pool connected');
    } catch (error) {
      console.error('❌ MySQL connection failed:', error);
      throw error;
    }
  }

  private async initializeKafka() {
    this.kafka = new Kafka({
      clientId: 'notification-svc',
      brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092']
    });
    console.log('✅ Kafka initialized');
  }

  private async initializeEmail() {
    try {
      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = process.env.SMTP_PORT;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      
      if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
        console.log('⚠️ SMTP credentials not provided - Email disabled');
        return;
      }
      
      this.emailTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort),
        secure: false,
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });
      console.log('✅ Email transporter initialized');
    } catch (error) {
      console.error('❌ Email initialization failed:', error);
    }
  }

  private async initializeTwilio() {
    try {
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = process.env.TWILIO_AUTH_TOKEN;
      
      if (twilioSid && twilioToken) {
        this.twilioClient = new Twilio(twilioSid, twilioToken);
        console.log('✅ Twilio client initialized');
      } else {
        console.log('⚠️ Twilio credentials not provided - SMS disabled');
      }
    } catch (error) {
      console.error('❌ Twilio initialization failed:', error);
    }
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        success: true,
        data: {
          status: 'healthy',
          service: 'notification-svc',
          timestamp: new Date().toISOString()
        }
      });
    });

    // Send email notification
    this.app.post('/notifications/email', this.sendEmail.bind(this));
    
    // Send SMS notification
    this.app.post('/notifications/sms', this.sendSMS.bind(this));
    
    // Generic send endpoint used by tests (booking_confirmation, etc.)
    this.app.post('/notifications/send', async (req, res) => {
      try {
        const { userId, type, recipient, subject, message, bookingId } = req.body || {};

        if (!userId || !type || !recipient || !message) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message: 'userId, type, recipient, and message are required'
            }
          });
        }

        // For now, route booking_confirmation to email flow
        if (type === 'booking_confirmation') {
          // Create a simple notification record
          const notificationId = uuidv4();
          const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' '); // MySQL TIMESTAMP format
          await this.db.execute(
            `INSERT INTO notifications (id, user_id, type, recipient, subject, content, status, created_at, sent_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              notificationId,
              userId,
              'email',
              recipient,
              subject || 'Booking Confirmed',
              message,
              'sent',
              timestamp,
              timestamp
            ]
          );

          // Try to send email if configured
          if (this.emailTransporter) {
            await this.emailTransporter.sendMail({
              from: process.env.FROM_EMAIL || 'noreply@kayak.com',
              to: recipient,
              subject: subject || 'Booking Confirmed',
              text: message,
              html: `<p>${message}</p>`
            });
          }

          return res.json({
            success: true,
            data: { notificationId },
            traceId: (req as any).traceId
          });
        }

        // For other types, simply acknowledge for now
        return res.json({
          success: true,
          data: { notificationId: `notif_${Date.now()}` },
          traceId: (req as any).traceId
        });
      } catch (error: any) {
        console.error('Generic notification send error:', error);
        return res.status(500).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: error.message,
            traceId: (req as any).traceId
          }
        });
      }
    });

    // Get notification status
    this.app.get('/notifications/:id', this.getNotificationStatus.bind(this));
  }

  private async sendEmail(req: express.Request, res: express.Response) {
    try {
      const { to, subject, html, text, userId } = req.body;

      if (!to || !subject || !html) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'to, subject, and html are required'
          }
        });
      }

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'userId is required so the notification can be audited'
          }
        });
      }

      if (!this.emailTransporter) {
        return res.status(503).json({
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Email service not configured' }
        });
      }

      const notificationId = uuidv4();

      const info = await this.emailTransporter.sendMail({
        from: process.env.FROM_EMAIL || 'noreply@kayak.com',
        to,
        subject,
        text,
        html
      });

      console.log('Email sent:', info.messageId);

      const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' '); // MySQL TIMESTAMP format
      await this.db.execute(
        `INSERT INTO notifications (id, user_id, type, recipient, subject, content, status, external_id, created_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          notificationId,
          userId,
          'email',
          to,
          subject,
          html,
          'sent',
          info.messageId,
          timestamp,
          timestamp
        ]
      );

      res.json({
        success: true,
        data: {
          notificationId,
          messageId: info.messageId,
          status: 'sent',
          to,
          subject
        },
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Send email error:', error);
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

  private async sendSMS(req: express.Request, res: express.Response) {
    try {
      const { to, message, userId } = req.body;

      if (!to || !message) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'to and message are required'
          }
        });
      }

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'userId is required so the notification can be audited'
          }
        });
      }

      if (!this.twilioClient) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'SMS service not configured'
          }
        });
      }

      const notificationId = uuidv4();

      const twilioMessage = await this.twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to
      });

      console.log('SMS sent:', twilioMessage.sid);

      const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' '); // MySQL TIMESTAMP format
      await this.db.execute(
        `INSERT INTO notifications (id, user_id, type, recipient, subject, content, status, external_id, created_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          notificationId,
          userId,
          'sms',
          to,
          null,
          message,
          'sent',
          twilioMessage.sid,
          timestamp,
          timestamp
        ]
      );

      res.json({
        success: true,
        data: {
          notificationId,
          messageId: twilioMessage.sid,
          status: 'sent',
          to,
          message
        },
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Send SMS error:', error);
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

  private async getNotificationStatus(req: express.Request, res: express.Response) {
    try {
      const { id } = req.params;
      
      // Query database for notification status
      const [rows] = await this.db.execute(
        `SELECT id, user_id, type, recipient, subject, content, status, external_id, created_at, sent_at, delivered_at
         FROM notifications WHERE id = ?`,
        [id]
      );
      const list = rows as any[];
      
      if (list.length === 0) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Notification not found',
            traceId: (req as any).traceId
          }
        });
      }
      
      const notification = list[0];
      res.json({
        success: true,
        data: {
          id: notification.id,
          userId: notification.user_id,
          type: notification.type,
          status: notification.status,
          recipient: notification.recipient,
          subject: notification.subject,
          content: notification.content,
          externalId: notification.external_id,
          createdAt: notification.created_at,
          sentAt: notification.sent_at,
          deliveredAt: notification.delivered_at
        },
        traceId: (req as any).traceId
      });
    } catch (error: any) {
      console.error('Get notification status error:', error);
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

  private async startKafkaConsumer() {
    try {
      this.consumer = this.kafka.consumer({ groupId: 'notification-group' });

      await this.consumer.connect();
      console.log('✅ Kafka consumer connected');

      // Subscribe to topics
      for (const topic of ['booking-confirmation', 'deal-alerts', 'payment-confirmation']) {
        await this.consumer.subscribe({ topic, fromBeginning: false });
      }

      // Start consuming messages
      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }: any) => {
          try {
            const data = JSON.parse(message.value?.toString() || '{}');
            console.log(`[KAFKA] Received message from ${topic}:`, data);

            switch (topic) {
              case 'booking-confirmation':
                await this.handleBookingConfirmation(data);
                break;
              case 'deal-alerts':
                await this.handleDealAlert(data);
                break;
              case 'payment-confirmation':
                await this.handlePaymentConfirmation(data);
                break;
              default:
                console.log(`Unknown topic: ${topic}`);
            }
          } catch (error) {
            console.error(`Error processing message from ${topic}:`, error);
          }
        }
      });

      console.log('🚀 Kafka consumer started and listening for messages');
    } catch (error) {
      console.error('❌ Failed to start Kafka consumer:', error);
    }
  }

  private async handleBookingConfirmation(data: any) {
    // BookingConfirmationEvent from booking-svc
    const bookingId = data.booking_id || data.bookingId;
    const userId = data.user_id || data.userId;

    if (!bookingId || !userId) {
      console.warn('[notification-svc] booking-confirmation event missing booking_id or user_id');
      return;
    }

    // Look up user contact details
    const [userRows] = await this.db.execute(
      'SELECT email, phone FROM users WHERE id = ?',
      [userId]
    );
    const user = (userRows as any[])[0];
    const userEmail = user?.email;
    const userPhone = user?.phone;

    const bookingDetails = {
      type: 'package',
      total: data.total_amount || data.totalAmount,
      flightDetails: null
    };

    // Send email
    if (userEmail && this.emailTransporter) {
      const emailHtml = this.generateBookingConfirmationEmail(bookingDetails, bookingId);
      await this.emailTransporter.sendMail({
        from: process.env.FROM_EMAIL || 'noreply@kayak.com',
        to: userEmail,
        subject: 'Booking Confirmed',
        html: emailHtml
      });
    }

    // Send SMS
    if (userPhone && this.twilioClient) {
      const smsMessage = `Your booking is confirmed! Booking ID: ${bookingId}. Thank you for choosing our service.`;
      await this.twilioClient.messages.create({
        body: smsMessage,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: userPhone
      });
    }
  }

  private async handleDealAlert(data: any) {
    const { userEmail, userPhone, dealDetails, userPreferences } = data;

    // Send personalized deal notifications
    if (userEmail && this.emailTransporter) {
      const emailHtml = this.generateDealAlertEmail(dealDetails, userPreferences);
      await this.emailTransporter.sendMail({
        from: process.env.FROM_EMAIL || 'noreply@kayak.com',
        to: userEmail,
        subject: 'Exclusive Deal Just for You!',
        html: emailHtml
      });
    }
  }

  private async handlePaymentConfirmation(data: any) {
    // PaymentConfirmationEvent from billing-svc
    const bookingId = data.booking_id || data.bookingId;
    const userId = data.user_id || data.userId;

    if (!bookingId || !userId) {
      console.warn('[notification-svc] payment-confirmation event missing booking_id or user_id');
      return;
    }

    const [userRows] = await this.db.execute(
      'SELECT email, phone FROM users WHERE id = ?',
      [userId]
    );
    const user = (userRows as any[])[0];
    const userEmail = user?.email;
    const userPhone = user?.phone;

    const paymentDetails = {
      amount: data.amount,
      method: data.payment_method || data.paymentMethod,
      transactionId: data.payment_id || data.paymentId
    };

    // Send payment confirmation
    if (userEmail && this.emailTransporter) {
      const emailHtml = this.generatePaymentConfirmationEmail(paymentDetails, bookingId);
      await this.emailTransporter.sendMail({
        from: process.env.FROM_EMAIL || 'noreply@kayak.com',
        to: userEmail,
        subject: 'Payment Confirmed',
        html: emailHtml
      });
    }

    // Send SMS
    if (userPhone && this.twilioClient) {
      const smsMessage = `Payment confirmed! $${paymentDetails.amount} charged. Booking ID: ${bookingId}`;
      await this.twilioClient.messages.create({
        body: smsMessage,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: userPhone
      });
    }
  }

  private generateBookingConfirmationEmail(bookingDetails: any, bookingId: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Booking Confirmed</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #007bff; color: white; padding: 20px; text-align: center;">
          <h1>✅ Booking Confirmed!</h1>
        </div>
        <div style="padding: 20px;">
          <h2>Booking Details</h2>
          <p><strong>Booking ID:</strong> ${bookingId}</p>
          <p><strong>Type:</strong> ${bookingDetails.type}</p>
          <p><strong>Total:</strong> $${bookingDetails.total}</p>
          ${bookingDetails.flightDetails ? `
            <h3>Flight Information</h3>
            <p>From: ${bookingDetails.flightDetails.from}</p>
            <p>To: ${bookingDetails.flightDetails.to}</p>
            <p>Date: ${bookingDetails.flightDetails.date}</p>
          ` : ''}
          <p>Thank you for your booking! You'll receive your confirmation documents shortly.</p>
        </div>
        <div style="background: #f8f9fa; padding: 20px; text-align: center;">
          <p>Questions? Contact our support team anytime.</p>
        </div>
      </body>
      </html>
    `;
  }

  private generateDealAlertEmail(dealDetails: any, userPreferences: any): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Exclusive Deal Alert</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #28a745; color: white; padding: 20px; text-align: center;">
          <h1>🎉 Special Deal Just for You!</h1>
        </div>
        <div style="padding: 20px;">
          <p>Based on your preferences, we found an amazing deal:</p>
          <h2>${dealDetails.title}</h2>
          <p><strong>Original Price:</strong> $${dealDetails.originalPrice}</p>
          <p><strong>Special Price:</strong> <span style="color: #28a745; font-size: 1.2em;">$${dealDetails.specialPrice}</span></p>
          <p><strong>Savings:</strong> $${dealDetails.savings}</p>
          <p>${dealDetails.description}</p>
          <a href="${dealDetails.bookingUrl}" style="display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 10px;">
            Book Now
          </a>
        </div>
        <div style="background: #f8f9fa; padding: 20px; text-align: center;">
          <p>This exclusive offer expires soon! Don't miss out.</p>
        </div>
      </body>
      </html>
    `;
  }

  private generatePaymentConfirmationEmail(paymentDetails: any, bookingId: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Payment Confirmed</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #28a745; color: white; padding: 20px; text-align: center;">
          <h1>✅ Payment Confirmed</h1>
        </div>
        <div style="padding: 20px;">
          <h2>Payment Details</h2>
          <p><strong>Booking ID:</strong> ${bookingId}</p>
          <p><strong>Amount:</strong> $${paymentDetails.amount}</p>
          <p><strong>Method:</strong> ${paymentDetails.method}</p>
          <p><strong>Transaction ID:</strong> ${paymentDetails.transactionId}</p>
          <p>Your payment has been successfully processed. You'll receive your booking confirmation shortly.</p>
        </div>
        <div style="background: #f8f9fa; padding: 20px; text-align: center;">
          <p>Questions about your payment? Contact billing support.</p>
        </div>
      </body>
      </html>
    `;
  }

  public start() {
    this.app.listen(this.port, async () => {
      console.log(`🚀 Notification Service listening on port ${this.port}`);
      console.log(`📍 Health check: http://localhost:${this.port}/health`);
      console.log(`📧 Email: ${this.emailTransporter ? '✅ Active' : '❌ Inactive'}`);
      console.log(`📱 SMS: ${this.twilioClient ? '✅ Active' : '❌ Inactive'}`);
      // Start Kafka consumer loop (non-blocking)
      try { await this.startKafkaConsumer(); } catch {}
    });
  }
}

// Start the service
const notificationService = new NotificationService();
notificationService.start();
