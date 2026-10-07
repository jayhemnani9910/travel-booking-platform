import { Kafka, EachMessagePayload } from 'kafkajs';
import mysql from 'mysql2/promise';
import { DealEvent } from '@kayak/shared';

export class HotelDealConsumer {
  private kafka: Kafka;
  private consumer: any;
  private db: mysql.Connection;
  private redis: any;

  constructor(db: mysql.Connection, redis: any) {
    this.kafka = new Kafka({
      clientId: 'hotels-svc',
      brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
    });
    this.consumer = this.kafka.consumer({ groupId: 'hotels-deals-consumer' });
    this.db = db;
    this.redis = redis;
  }

  async start(): Promise<void> {
    try {
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: 'deal.events', fromBeginning: false });
      
      console.log('🏨 Hotel service started consuming deal events');
      
      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
          try {
            const event: DealEvent = JSON.parse(message.value?.toString() || '{}');
            
            if (event.type === 'hotel') {
              await this.handleHotelDeal(event);
            }
          } catch (error) {
            console.error('Error processing deal event:', error);
          }
        },
      });
    } catch (error) {
      console.error('Failed to start Kafka consumer:', error);
    }
  }

  private async handleHotelDeal(event: DealEvent): Promise<void> {
    try {
      console.log(`🏨 Processing hotel deal for hotel ${event.reference_id}: ${event.price.discount}% off`);
      
      // Write deal to deals table (do NOT mutate hotel_rooms or hotels table)
      await this.db.execute(
        `INSERT INTO deals (id, type, reference_id, original_price, deal_price, discount, 
         score, tags, valid_until, created_at)
         VALUES (?, 'hotel', ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
         deal_price = VALUES(deal_price),
         discount = VALUES(discount),
         score = VALUES(score),
         tags = VALUES(tags),
         valid_until = VALUES(valid_until)`,
        [
          event.deal_id,
          // reference_id is optional; mysql2 rejects undefined binds
          event.reference_id ?? null,
          event.price.original,
          event.price.deal,
          event.price.discount,
          event.score,
          JSON.stringify(event.tags),
          new Date(event.valid_until)
        ]
      );

      // Cache the deal for faster search results
      const dealCacheKey = `deal:hotel:${event.reference_id}`;
      await this.redis.setEx(dealCacheKey, 3600, JSON.stringify({
        dealId: event.deal_id,
        originalPrice: event.price.original,
        discountedPrice: event.price.deal,
        discountPercentage: event.price.discount,
        aiScore: event.score,
        validUntil: event.valid_until,
        tags: event.tags
      }));

      // Pre-warm search cache for destination
      const [roomRows] = await this.db.execute(
        'SELECT h.address_city FROM hotel_rooms hr JOIN hotels h ON hr.hotel_id = h.id WHERE hr.id = ?',
        [event.reference_id ?? null]
      );
      
      if ((roomRows as any[]).length > 0) {
        const room = (roomRows as any[])[0];
        const searchKey = `hot_deals:hotels:${room.address_city}`;
        
        // Add to hot deals list
        await this.redis.lPush(searchKey, JSON.stringify({
          roomId: event.reference_id,
          dealId: event.deal_id,
          price: event.price,
          score: event.score,
          tags: event.tags
        }));
        await this.redis.expire(searchKey, 3600);
        
        console.log(`🔥 Added deal ${event.deal_id} to hot deals cache for ${room.address_city}`);
      }
    } catch (error) {
      console.error('Error handling hotel deal:', error);
    }
  }

  async stop(): Promise<void> {
    try {
      await this.consumer.disconnect();
      console.log('🔴 Hotel deal consumer stopped');
    } catch (error) {
      console.error('Error stopping consumer:', error);
    }
  }
}
