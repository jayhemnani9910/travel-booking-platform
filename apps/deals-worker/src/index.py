import asyncio
import json
import aiomysql
from datetime import datetime, timedelta
import numpy as np
from typing import List, Dict, Any
from aiokafka import AIOKafkaProducer, AIOKafkaConsumer
import os
from pymongo import MongoClient
from csv_ingestion import CSVIngestionService

class DealsWorker:
    def __init__(self):
        self.mysql_config = {
            'host': os.getenv('MYSQL_HOST', 'mysql'),
            'user': os.getenv('MYSQL_USER', 'kayak'),
            'password': os.getenv('MYSQL_PASSWORD', 'change_me_db_password'),
            'db': os.getenv('MYSQL_DATABASE', 'kayak'),
            'charset': 'utf8mb4'
        }
        self.db_pool = None
        self.kafka_producer = None
        self.kafka_consumer = None
        self.mongo_client = None
        self.mongo_db = None
        self.csv_ingestion = CSVIngestionService(data_dir=os.getenv('DATA_DIR', '/app/data/raw'))
        
    async def initialize(self):
        """Initialize database connections and Kafka producer"""
        print("🔧 Initializing Deals Worker...")
        
        # Create async MySQL connection pool
        self.db_pool = await aiomysql.create_pool(**self.mysql_config, minsize=1, maxsize=10)
        print("✅ MySQL async pool connected")

        # Initialize MongoDB
        mongo_url = os.getenv('MONGODB_URL', 'mongodb://root:change_me_mongo_root_password@mongodb:27017/kayak')
        self.mongo_client = MongoClient(mongo_url)
        self.mongo_db = self.mongo_client.kayak
        print("✅ MongoDB connected")

        # Initialize Kafka Producer with retry and graceful degradation
        max_retries = 5
        kafka_available = True
        for attempt in range(max_retries):
            try:
                self.kafka_producer = AIOKafkaProducer(
                    bootstrap_servers=os.getenv('KAFKA_BROKERS', 'kafka:29092'),
                    value_serializer=lambda v: json.dumps(v, default=str).encode('utf-8')
                )
                await self.kafka_producer.start()
                print("✅ Kafka producer connected")
                break
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_time = 5 * (attempt + 1)
                    print(f"⚠️  Kafka connection attempt {attempt + 1} failed, retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                else:
                    print(f"⚠️  Failed to connect to Kafka after {max_retries} attempts - running without Kafka")
                    kafka_available = False
                    self.kafka_producer = None

        # Initialize Kafka Consumer for raw feeds with retry and graceful degradation
        if kafka_available:
            for attempt in range(max_retries):
                try:
                    self.kafka_consumer = AIOKafkaConsumer(
                        'deals.raw',
                        bootstrap_servers=os.getenv('KAFKA_BROKERS', 'kafka:29092'),
                        group_id='deals-worker-cg',
                        value_deserializer=lambda v: json.loads(v.decode('utf-8'))
                    )
                    await self.kafka_consumer.start()
                    print("✅ Kafka consumer connected")
                    break
                except Exception as e:
                    if attempt < max_retries - 1:
                        wait_time = 5 * (attempt + 1)
                        print(f"⚠️  Kafka consumer attempt {attempt + 1} failed, retrying in {wait_time}s...")
                        await asyncio.sleep(wait_time)
                    else:
                        print(f"⚠️  Failed to connect Kafka consumer after {max_retries} attempts - running without consumer")
                        self.kafka_consumer = None
        else:
            print("⚠️  Skipping Kafka consumer initialization")
            self.kafka_consumer = None
        
    async def process_deals_pipeline(self):
        """Main pipeline: raw → normalized → scored → tagged"""
        try:
            # Step 1: Ingest raw deals (simulate external feeds)
            raw_deals = await self.ingest_raw_deals()
            
            # Step 2: Normalize deals
            normalized_deals = await self.normalize_deals(raw_deals)
            
            # Step 3: Score deals
            scored_deals = await self.score_deals(normalized_deals)
            
            # Step 4: Tag deals
            tagged_deals = await self.tag_deals(scored_deals)
            
            # Step 5: Store and emit events
            await self.persist_deals(tagged_deals)
            await self.emit_deal_events(tagged_deals)
            
            print(f"✅ Processed {len(raw_deals)} deals through pipeline")
            
        except Exception as e:
            print(f"❌ Pipeline error: {e}")
            
    async def ingest_raw_deals(self) -> List[Dict[str, Any]]:
        """Ingest deals from CSV datasets and database"""
        deals = []
        
        # First, try to ingest from real CSV datasets
        print("📥 Ingesting from CSV datasets...")
        csv_deals = await self.csv_ingestion.ingest_all()
        deals.extend(csv_deals)
        print(f"✅ Ingested {len(csv_deals)} deals from CSV")
        
        # Get flights, hotels, cars from database using async pool
        async with self.db_pool.acquire() as conn:
            cursor = await conn.cursor(aiomysql.cursors.DictCursor)
            
            # Get total count of flights
            await cursor.execute("SELECT COUNT(*) as count FROM flights WHERE available_seats > 0")
            flight_count = (await cursor.fetchone())['count']
            
            # Use offset-based sampling instead of RAND() for better performance
            offset = np.random.randint(0, max(1, flight_count - 100))
            
            # Fetch sample flights
            await cursor.execute("""
                SELECT * FROM flights 
                WHERE available_seats > 0 
                LIMIT 100 OFFSET %s
            """, (offset,))
            flights = await cursor.fetchall()
        
            for flight in flights:
                # Simulate price variations (deals)
                if np.random.random() < 0.3:  # 30% chance of being a deal
                    original_price = float(flight['price'])  # Convert Decimal to float
                    deal_price = original_price * (0.7 + np.random.random() * 0.25)  # 25-70% discount
                
                    deals.append({
                        'type': 'flight',
                        'reference_id': flight['id'],
                        'airline': flight['airline'],
                        'route': f"{flight['origin_airport_code']}-{flight['destination_airport_code']}",
                        'departure_time': flight['departure_time'],
                        'original_price': float(original_price),
                        'deal_price': round(deal_price, 2),
                        'currency': flight['currency'],
                        'source': 'airline_feed',
                        'raw_data': flight
                    })
        
            # Fetch sample hotels
            
            # Get total count of hotel rooms
            await cursor.execute("""
                SELECT COUNT(*) as count 
                FROM hotel_rooms hr
                JOIN hotels h ON hr.hotel_id = h.id
                WHERE hr.available = 1
            """)
            hotel_count = (await cursor.fetchone())['count']
            
            # Use offset-based sampling instead of RAND() for better performance
            hotel_offset = np.random.randint(0, max(1, hotel_count - 100))
            
            await cursor.execute("""
                SELECT hr.*, h.name as hotel_name, h.star_rating 
                FROM hotel_rooms hr
                JOIN hotels h ON hr.hotel_id = h.id
                WHERE hr.available = 1
                LIMIT 100 OFFSET %s
            """, (hotel_offset,))
            hotels = await cursor.fetchall()
            
            for hotel in hotels:
                if np.random.random() < 0.4:  # 40% chance of being a deal
                    original_price = float(hotel['price_per_night'])  # Convert Decimal to float
                    deal_price = original_price * (0.6 + np.random.random() * 0.3)  # 30-70% discount
                    
                    deals.append({
                        'type': 'hotel',
                        'reference_id': hotel['id'],
                        'hotel_name': hotel['hotel_name'],
                        'room_type': hotel['type'],
                        'star_rating': hotel['star_rating'],
                        'original_price': float(original_price),
                        'deal_price': round(deal_price, 2),
                        'currency': hotel['currency'],
                        'source': 'hotel_feed',
                        'raw_data': hotel
                    })
                    
        return deals
    
    async def normalize_deals(self, raw_deals: List[Dict]) -> List[Dict]:
        """Normalize deals data"""
        normalized = []
        
        for deal in raw_deals:
            # Normalize currency and pricing
            deal['discount_percentage'] = round(
                ((deal['original_price'] - deal['deal_price']) / deal['original_price']) * 100, 2
            )
            
            # Normalize dates
            if 'departure_time' in deal:
                # DB flights carry a datetime (DATETIME column), CSV ones an ISO string
                departure = deal['departure_time']
                if not isinstance(departure, datetime):
                    departure = datetime.fromisoformat(departure.replace('Z', '+00:00'))
                deal['valid_until'] = (departure - timedelta(days=1)).isoformat()
            else:
                deal['valid_until'] = (datetime.now() + timedelta(days=7)).isoformat()
            
            # Add metadata
            deal['normalized_at'] = datetime.now().isoformat()
            deal['confidence'] = 0.8 if deal['discount_percentage'] > 30 else 0.6
            
            normalized.append(deal)
            
        return normalized
    
    async def score_deals(self, normalized_deals: List[Dict]) -> List[Dict]:
        """AI-powered deal scoring"""
        scored = []
        
        for deal in normalized_deals:
            score = await self.calculate_deal_score(deal)
            deal['ai_score'] = score
            deal['scored_at'] = datetime.now().isoformat()
            scored.append(deal)
            
        # Sort by score
        scored.sort(key=lambda x: x['ai_score'], reverse=True)
        return scored
    
    async def calculate_deal_score(self, deal: Dict) -> float:
        """Calculate AI-powered deal score"""
        score = 0.0
        
        # Price drop factor (40% weight)
        discount = deal['discount_percentage']
        if discount > 50:
            score += 40
        elif discount > 30:
            score += 30
        elif discount > 20:
            score += 20
        else:
            score += discount * 0.5
            
        # Timing factor (20% weight)
        time_until_valid = (
            datetime.fromisoformat(deal['valid_until'].replace('Z', '+00:00')) - datetime.now()
        ).total_seconds() / 3600  # hours
        
        if time_until_valid < 24:  # Less than 24 hours
            score += 20
        elif time_until_valid < 72:  # Less than 3 days
            score += 15
        elif time_until_valid < 168:  # Less than a week
            score += 10
        else:
            score += 5
            
        # Availability factor (20% weight)
        if deal['type'] == 'flight':
            # CSV and simulated flights have no raw_data
            available_seats = (deal.get('raw_data') or {}).get('available_seats', 0)
            if available_seats > 50:
                score += 15
            elif available_seats > 20:
                score += 10
            else:
                score += 5
        elif deal['type'] == 'hotel':
            score += 15  # Hotels generally more available
            
        # Popularity factor (20% weight)
        # In real implementation, this would use historical data
        popularity_boost = np.random.uniform(0, 20)
        score += popularity_boost
        
        return round(score, 2)
    
    async def tag_deals(self, scored_deals: List[Dict]) -> List[Dict]:
        """Tag deals with metadata"""
        tagged = []
        
        for deal in scored_deals:
            tags = []
            
            # Price-based tags
            if deal['discount_percentage'] > 50:
                tags.append('flash_deal')
            if deal['discount_percentage'] < 15:
                tags.append('minor_discount')
                
            # Time-based tags
            time_until_valid = (
                datetime.fromisoformat(deal['valid_until'].replace('Z', '+00:00')) - datetime.now()
            ).total_seconds() / 3600
            
            if time_until_valid < 24:
                tags.append('expires_soon')
            elif time_until_valid < 168:
                tags.append('limited_time')
                
            # Type-based tags
            if deal['type'] == 'flight':
                tags.append('last_minute') if time_until_valid < 48 else tags.append('advance_booking')
            elif deal['type'] == 'hotel':
                tags.append('weekend_getaway')
                
            # Quality tags
            if deal['ai_score'] > 80:
                tags.append('top_pick')
            elif deal['ai_score'] > 60:
                tags.append('good_value')
                
            deal['tags'] = tags
            
            # Add conditions
            conditions = []
            if deal['type'] == 'flight':
                conditions.append('non-refundable')
                if (deal.get('raw_data') or {}).get('changeable'):
                    conditions.append('changeable with fee')
                    
            deal['conditions'] = conditions
            deal['tagged_at'] = datetime.now().isoformat()
            
            tagged.append(deal)
            
        return tagged
    
    async def persist_deals(self, deals: List[Dict]):
        """Store deals in MongoDB for fast retrieval and analytics"""
        deals_collection = self.mongo_db.deals
        
        for deal in deals:
            deal_doc = {
                'dealId': f"deal_{deal['reference_id']}_{int(datetime.now().timestamp())}",
                'type': deal['type'],
                'referenceId': deal['reference_id'],
                'originalPrice': deal['original_price'],
                'dealPrice': deal['deal_price'],
                'discountPercentage': deal['discount_percentage'],
                'currency': deal.get('currency', 'USD'),
                'validUntil': deal['valid_until'],
                'conditions': deal['conditions'],
                'tags': deal['tags'],
                'aiScore': deal['ai_score'],
                'createdAt': datetime.now(),
                'updatedAt': datetime.now(),
                'metadata': {
                    'source': deal.get('source', 'internal'),
                    'confidence': deal.get('confidence', 0.8)
                }
            }
            
            deals_collection.update_one(
                {'referenceId': deal['reference_id'], 'type': deal['type']},
                {'$set': deal_doc},
                upsert=True
            )
        
        print(f"💾 Persisted {len(deals)} deals to MongoDB")
        
    async def emit_deal_events(self, deals: List[Dict]):
        """Emit deal events to Kafka"""
        if not self.kafka_producer:
            print("⚠️  Kafka producer not available, skipping event emission")
            return
            
        print("📡 Emitting deal events...")
        
        for deal in deals[:10]:  # Top 10 deals
            # Derive destination, route, summary, and inventory for concierge consumers
            destination = None
            route = None
            summary = ""
            inventory = None

            raw = deal.get('raw_data', {})

            if deal['type'] == 'flight':
                origin_code = raw.get('origin_airport_code')
                dest_code = raw.get('destination_airport_code')
                destination = dest_code or deal.get('route', '')[-3:]
                route = deal.get('route') or (f"{origin_code}-{dest_code}" if origin_code and dest_code else None)
                airline = deal.get('airline') or raw.get('airline', 'Flight')
                summary = f"{airline} {route}" if route else airline
                inventory = raw.get('available_seats')
            elif deal['type'] == 'hotel':
                hotel_name = deal.get('hotel_name') or raw.get('hotel_name', 'Hotel deal')
                destination = raw.get('address_city') or deal.get('neighborhood') or 'Unknown'
                summary = hotel_name
                inventory = raw.get('available_rooms')
            else:
                # cars or other types
                destination = raw.get('location_code') or 'Unknown'
                summary = f"Car rental {raw.get('vehicle_type', '')}".strip()
                inventory = raw.get('available')

            event = {
                'event_type': 'deal_created',
                'deal_id': f"deal_{deal['type']}_{deal['reference_id']}",
                'type': deal['type'],
                'destination': destination or 'Unknown',
                'route': route,
                'summary': summary,
                'price': {
                    'original': deal['original_price'],
                    'deal': deal['deal_price'],
                    'discount': deal['discount_percentage']
                },
                'score': deal['ai_score'],
                'tags': deal['tags'],
                'valid_until': deal['valid_until'],
                'inventory': inventory,
                'timestamp': datetime.now().isoformat()
            }
            
            try:
                # value_serializer already JSON-encodes the event
                await self.kafka_producer.send_and_wait('deal.events', event)
                print(f"📤 Published: {event['event_type']} - {event['type']} - Score: {event['score']}")
            except Exception as e:
                print(f"⚠️  Failed to publish event: {e}")
            
    async def run_continuous(self):
        """Run the deals worker continuously"""
        print("🚀 Starting Deals Worker continuous mode...")
        
        while True:
            try:
                await self.process_deals_pipeline()
                await asyncio.sleep(300)  # Process every 5 minutes
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"Worker error: {e}")
                await asyncio.sleep(60)  # Wait 1 minute on error
                
    async def close(self):
        """Close connections"""
        if self.db_pool:
            self.db_pool.close()
            await self.db_pool.wait_closed()
        if self.kafka_producer:
            await self.kafka_producer.stop()
        if self.kafka_consumer:
            await self.kafka_consumer.stop()
        if self.mongo_client:
            self.mongo_client.close()

    async def consume_raw_deals(self):
        """Consume raw deals from Kafka"""
        if not self.kafka_consumer:
            print("⚠️  Kafka consumer not available, skipping raw deal consumption")
            return []
            
        print("📡 Consuming raw deals from Kafka...")
        
        deals = []
        
        async for message in self.kafka_consumer:
            try:
                deal = message.value
                deal['source'] = 'kafka_feed'
                deal['ingested_at'] = datetime.now().isoformat()
                deals.append(deal)
                print(f"📥 Received deal: {deal.get('type', 'unknown')} from Kafka")
            except Exception as e:
                print(f"❌ Error processing message: {e}")
                
        return deals

async def main():
    worker = DealsWorker()
    
    try:
        await worker.initialize()
        await worker.run_continuous()
    except KeyboardInterrupt:
        print("Shutting down...")
    finally:
        await worker.close()

if __name__ == "__main__":
    asyncio.run(main())
