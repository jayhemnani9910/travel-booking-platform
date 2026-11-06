import { Kafka } from 'kafkajs';
import type { Connection } from 'mysql2/promise';
import type { DealEvent } from '@kayak/shared';
import { HotelDealConsumer } from '../kafkaConsumer';

jest.mock('kafkajs', () => ({ Kafka: jest.fn() }));

type EachMessage = (payload: { topic: string; partition: number; message: { value: Buffer | null } }) => Promise<void>;

const MockedKafka = Kafka as unknown as jest.Mock;

const deal: DealEvent = {
  event_type: 'deal_created',
  deal_id: 'deal-1',
  type: 'hotel',
  reference_id: 'ref-42',
  price: { original: 200, deal: 150, discount: 25 },
  score: 88,
  tags: ['popular', 'limited-time'],
  valid_until: '2030-01-01T00:00:00.000Z',
  timestamp: '2029-12-01T00:00:00.000Z'
};

describe('HotelDealConsumer', () => {
  let consumer: { connect: jest.Mock; subscribe: jest.Mock; run: jest.Mock; disconnect: jest.Mock };
  let kafkaConsumerFactory: jest.Mock;
  let db: { execute: jest.Mock };
  let redis: { setEx: jest.Mock; lPush: jest.Mock; expire: jest.Mock };
  let errorSpy: jest.SpyInstance;
  const originalBrokers = process.env.KAFKA_BROKERS;

  const build = () => new HotelDealConsumer(db as unknown as Connection, redis);

  const startAndGetHandler = async (): Promise<EachMessage> => {
    await build().start();
    return consumer.run.mock.calls[0][0].eachMessage;
  };

  const send = (handler: EachMessage, value: Buffer | null) =>
    handler({ topic: 'deal.events', partition: 0, message: { value } });

  const asMessage = (event: object) => Buffer.from(JSON.stringify(event));

  beforeEach(() => {
    consumer = {
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined)
    };
    kafkaConsumerFactory = jest.fn().mockReturnValue(consumer);
    MockedKafka.mockReset();
    MockedKafka.mockImplementation(() => ({ consumer: kafkaConsumerFactory }));

    db = { execute: jest.fn() };
    redis = {
      setEx: jest.fn().mockResolvedValue('OK'),
      lPush: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1)
    };
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    delete process.env.KAFKA_BROKERS;
  });

  afterEach(() => {
    errorSpy.mockRestore();
    if (originalBrokers === undefined) {
      delete process.env.KAFKA_BROKERS;
    } else {
      process.env.KAFKA_BROKERS = originalBrokers;
    }
  });

  describe('constructor', () => {
    it('creates a Kafka client on localhost by default and a consumer in its group', () => {
      build();
      expect(MockedKafka).toHaveBeenCalledWith({ clientId: 'hotels-svc', brokers: ['localhost:9092'] });
      expect(kafkaConsumerFactory).toHaveBeenCalledWith({ groupId: 'hotels-deals-consumer' });
    });

    it('uses KAFKA_BROKERS when set', () => {
      process.env.KAFKA_BROKERS = 'kafka:29092';
      build();
      expect(MockedKafka).toHaveBeenCalledWith({ clientId: 'hotels-svc', brokers: ['kafka:29092'] });
    });
  });

  describe('start', () => {
    it('connects, subscribes to deal events from the latest offset and starts consuming', async () => {
      await build().start();
      expect(consumer.connect).toHaveBeenCalledTimes(1);
      expect(consumer.subscribe).toHaveBeenCalledWith({ topic: 'deal.events', fromBeginning: false });
      expect(consumer.run).toHaveBeenCalledWith({ eachMessage: expect.any(Function) });
      expect(consumer.connect.mock.invocationCallOrder[0]).toBeLessThan(consumer.subscribe.mock.invocationCallOrder[0]);
      expect(consumer.subscribe.mock.invocationCallOrder[0]).toBeLessThan(consumer.run.mock.invocationCallOrder[0]);
    });

    it('logs and does not throw when connecting fails', async () => {
      const failure = new Error('broker down');
      consumer.connect.mockRejectedValue(failure);
      await expect(build().start()).resolves.toBeUndefined();
      expect(consumer.subscribe).not.toHaveBeenCalled();
      expect(consumer.run).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith('Failed to start Kafka consumer:', failure);
    });
  });

  describe('handling messages', () => {
    it('stores the hotel deal, caches it and adds it to the hot deals list', async () => {
      db.execute.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[{ address_city: 'Chicago' }]]);
      const handler = await startAndGetHandler();

      await send(handler, asMessage(deal));

      expect(db.execute).toHaveBeenCalledTimes(2);
      const [insertSql, insertParams] = db.execute.mock.calls[0];
      expect(insertSql).toContain('INSERT INTO deals');
      expect(insertSql).toContain("VALUES (?, 'hotel',");
      expect(insertSql).toContain('ON DUPLICATE KEY UPDATE');
      expect(insertParams).toEqual([
        'deal-1',
        'ref-42',
        200,
        150,
        25,
        88,
        JSON.stringify(['popular', 'limited-time']),
        new Date('2030-01-01T00:00:00.000Z')
      ]);

      expect(redis.setEx).toHaveBeenCalledTimes(1);
      const [cacheKey, ttl, cached] = redis.setEx.mock.calls[0];
      expect(cacheKey).toBe('deal:hotel:ref-42');
      expect(ttl).toBe(3600);
      expect(JSON.parse(cached)).toEqual({
        dealId: 'deal-1',
        originalPrice: 200,
        discountedPrice: 150,
        discountPercentage: 25,
        aiScore: 88,
        validUntil: '2030-01-01T00:00:00.000Z',
        tags: ['popular', 'limited-time']
      });

      expect(db.execute).toHaveBeenNthCalledWith(2, 'SELECT h.address_city FROM hotel_rooms hr JOIN hotels h ON hr.hotel_id = h.id WHERE hr.id = ?', ['ref-42']);

      expect(redis.lPush).toHaveBeenCalledTimes(1);
      const [hotKey, hotValue] = redis.lPush.mock.calls[0];
      expect(hotKey).toBe('hot_deals:hotels:Chicago');
      expect(JSON.parse(hotValue)).toEqual({
        roomId: 'ref-42',
        dealId: 'deal-1',
        price: { original: 200, deal: 150, discount: 25 },
        score: 88,
        tags: ['popular', 'limited-time']
      });
      expect(redis.expire).toHaveBeenCalledWith('hot_deals:hotels:Chicago', 3600);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('binds null instead of undefined when the deal has no reference_id', async () => {
      db.execute.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[]]);
      const handler = await startAndGetHandler();
      const { reference_id: _omit, ...withoutReference } = deal;

      await send(handler, asMessage(withoutReference));

      expect(db.execute.mock.calls[0][1][1]).toBeNull();
      expect(db.execute.mock.calls[1][1]).toEqual([null]);
    });

    it('skips the hot deals list when the referenced item is not found', async () => {
      db.execute.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[]]);
      const handler = await startAndGetHandler();

      await send(handler, asMessage(deal));

      expect(redis.setEx).toHaveBeenCalledTimes(1);
      expect(redis.lPush).not.toHaveBeenCalled();
      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('ignores deals for other types', async () => {
      const handler = await startAndGetHandler();

      await send(handler, asMessage({ ...deal, type: 'car' }));

      expect(db.execute).not.toHaveBeenCalled();
      expect(redis.setEx).not.toHaveBeenCalled();
    });

    it('ignores messages with no value', async () => {
      const handler = await startAndGetHandler();

      await send(handler, null);

      expect(db.execute).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('logs and swallows messages that are not valid JSON', async () => {
      const handler = await startAndGetHandler();

      await expect(send(handler, Buffer.from('not json'))).resolves.toBeUndefined();

      expect(db.execute).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith('Error processing deal event:', expect.any(SyntaxError));
    });

    it('logs and swallows database failures without touching the cache', async () => {
      const failure = new Error('db down');
      db.execute.mockRejectedValueOnce(failure);
      const handler = await startAndGetHandler();

      await expect(send(handler, asMessage(deal))).resolves.toBeUndefined();

      expect(redis.setEx).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith('Error handling hotel deal:', failure);
    });
  });

  describe('stop', () => {
    it('disconnects the consumer', async () => {
      await build().stop();
      expect(consumer.disconnect).toHaveBeenCalledTimes(1);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('logs and does not throw when disconnecting fails', async () => {
      const failure = new Error('already closed');
      consumer.disconnect.mockRejectedValue(failure);
      await expect(build().stop()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith('Error stopping consumer:', failure);
    });
  });
});
