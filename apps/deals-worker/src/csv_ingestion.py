"""CSV ingestion module for real dataset feeds."""

import asyncio
import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any
import os


def _int(value, default: int) -> int:
    """int() that falls back to default on empty cells (pandas reads them as NaN)."""
    return default if pd.isna(value) else int(value)


class CSVIngestionService:
    """Handles ingestion of real datasets from CSV files."""
    
    def __init__(self, data_dir: str = "/app/data/raw"):
        self.data_dir = Path(data_dir)
        self.supported_datasets = {
            'airbnb': 'listings.csv',
            'flights': 'flight_prices.csv',
            'hotels': 'hotel_bookings.csv'
        }
        
    async def ingest_airbnb_listings(self) -> List[Dict[str, Any]]:
        """Ingest Inside Airbnb dataset."""
        file_path = self.data_dir / self.supported_datasets['airbnb']
        
        if not file_path.exists():
            print(f"⚠️  Airbnb CSV not found at {file_path}, using simulated data")
            return await self._simulate_airbnb_data()
        
        try:
            df = pd.read_csv(file_path)
            print(f"📊 Loaded {len(df)} Airbnb listings from CSV")
            
            deals = []
            # Focus on listings with good pricing
            if 'price' in df.columns:
                # Clean price column (remove $ and commas)
                df['price_clean'] = df['price'].astype(str).str.replace('$', '').str.replace(',', '').astype(float)
                
                # Calculate 30-day average price per neighborhood
                if 'neighbourhood' in df.columns:
                    df['price_avg'] = df.groupby('neighbourhood')['price_clean'].transform('mean')
                    df['discount_pct'] = ((df['price_avg'] - df['price_clean']) / df['price_avg'] * 100).fillna(0)
                    
                    # Filter deals (15%+ below average)
                    deal_df = df[df['discount_pct'] >= 15].head(100)
                    
                    for _, row in deal_df.iterrows():
                        deals.append({
                            'type': 'hotel',
                            'source': 'airbnb_csv',
                            'reference_id': str(row.get('id', np.random.randint(100000, 999999))),
                            'name': row.get('name', 'Unique Stay'),
                            'neighborhood': row.get('neighbourhood', 'Unknown'),
                            'original_price': float(row.get('price_avg', row['price_clean'] * 1.2)),
                            'deal_price': float(row['price_clean']),
                            'discount_percentage': float(row['discount_pct']),
                            'room_type': row.get('room_type', 'Entire home/apt'),
                            'accommodates': _int(row.get('accommodates'), 2),
                            'availability': _int(row.get('availability_365'), 30),
                            'rating': float(row.get('review_scores_rating', 4.5)) / 20 if 'review_scores_rating' in df.columns else 4.5,
                            'reviews_count': _int(row.get('number_of_reviews'), 10),
                            'ingested_at': datetime.now().isoformat()
                        })
            
            return deals
            
        except Exception as e:
            print(f"❌ Error reading Airbnb CSV: {e}")
            return await self._simulate_airbnb_data()
    
    async def ingest_flight_prices(self) -> List[Dict[str, Any]]:
        """Ingest flight price dataset."""
        file_path = self.data_dir / self.supported_datasets['flights']
        
        if not file_path.exists():
            print(f"⚠️  Flight CSV not found at {file_path}, using simulated data")
            return await self._simulate_flight_data()
        
        try:
            df = pd.read_csv(file_path)
            print(f"📊 Loaded {len(df)} flight records from CSV")
            
            deals = []
            
            # Expected columns: airline, source, destination, price, duration, etc.
            if 'price' in df.columns:
                # Calculate price percentiles
                df['price_pct'] = df['price'].rank(pct=True)
                
                # Filter good deals (bottom 30% pricing)
                deal_df = df[df['price_pct'] <= 0.30].head(100)
                
                for _, row in deal_df.iterrows():
                    # Simulate a baseline price (20-40% higher)
                    baseline = row['price'] * np.random.uniform(1.2, 1.4)
                    discount = ((baseline - row['price']) / baseline) * 100
                    
                    deals.append({
                        'type': 'flight',
                        'source': 'flight_csv',
                        'reference_id': str(np.random.randint(100000, 999999)),
                        'airline': row.get('airline', 'Unknown Airline'),
                        'origin': row.get('source', 'JFK'),
                        'destination': row.get('destination', 'LAX'),
                        'route': f"{row.get('source', 'JFK')}-{row.get('destination', 'LAX')}",
                        'original_price': float(baseline),
                        'deal_price': float(row['price']),
                        'discount_percentage': float(discount),
                        'duration_hours': _int(row.get('duration'), 4),
                        'stops': _int(row.get('stops'), 0),
                        'flight_class': row.get('class', 'Economy'),
                        'departure_time': (datetime.now() + timedelta(days=np.random.randint(7, 60))).isoformat(),
                        'ingested_at': datetime.now().isoformat()
                    })
            
            return deals
            
        except Exception as e:
            print(f"❌ Error reading Flight CSV: {e}")
            return await self._simulate_flight_data()
    
    async def ingest_hotel_bookings(self) -> List[Dict[str, Any]]:
        """Ingest hotel booking dataset."""
        file_path = self.data_dir / self.supported_datasets['hotels']
        
        if not file_path.exists():
            print(f"⚠️  Hotel CSV not found at {file_path}, using simulated data")
            return await self._simulate_hotel_data()
        
        try:
            df = pd.read_csv(file_path)
            print(f"📊 Loaded {len(df)} hotel records from CSV")
            
            deals = []
            
            # Expected columns: hotel, adr (average daily rate), country, market_segment
            if 'adr' in df.columns:
                # Filter valid ADR values
                df = df[df['adr'] > 0]
                
                # Calculate percentiles for pricing
                df['price_pct'] = df['adr'].rank(pct=True)
                
                # Select deals from lower price ranges
                deal_df = df[df['price_pct'] <= 0.35].sample(min(100, len(df)))
                
                for _, row in deal_df.iterrows():
                    baseline = row['adr'] * np.random.uniform(1.15, 1.35)
                    discount = ((baseline - row['adr']) / baseline) * 100
                    
                    deals.append({
                        'type': 'hotel',
                        'source': 'hotel_csv',
                        'reference_id': str(np.random.randint(100000, 999999)),
                        'hotel_type': row.get('hotel', 'City Hotel'),
                        'country': row.get('country', 'USA'),
                        'market_segment': row.get('market_segment', 'Online TA'),
                        'original_price': float(baseline),
                        'deal_price': float(row['adr']),
                        'discount_percentage': float(discount),
                        'nights': _int(row.get('stays_in_week_nights'), 2) + _int(row.get('stays_in_weekend_nights'), 1),
                        'adults': _int(row.get('adults'), 2),
                        'children': _int(row.get('children'), 0),
                        'meal': row.get('meal', 'BB'),
                        'is_repeated_guest': bool(row.get('is_repeated_guest', 0)),
                        'ingested_at': datetime.now().isoformat()
                    })
            
            return deals
            
        except Exception as e:
            print(f"❌ Error reading Hotel CSV: {e}")
            return await self._simulate_hotel_data()
    
    async def ingest_all(self) -> List[Dict[str, Any]]:
        """Ingest all available datasets."""
        print("🔄 Starting CSV ingestion from all sources...")
        
        results = await asyncio.gather(
            self.ingest_airbnb_listings(),
            self.ingest_flight_prices(),
            self.ingest_hotel_bookings(),
            return_exceptions=True
        )
        
        all_deals = []
        for result in results:
            if isinstance(result, list):
                all_deals.extend(result)
            elif isinstance(result, Exception):
                print(f"⚠️  Ingestion error: {result}")
        
        print(f"✅ Total deals ingested: {len(all_deals)}")
        return all_deals
    
    async def _simulate_airbnb_data(self) -> List[Dict[str, Any]]:
        """Simulate Airbnb data when CSV is not available."""
        print("🔧 Generating simulated Airbnb deals...")
        
        neighborhoods = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']
        deals = []
        
        for i in range(50):
            base_price = np.random.uniform(80, 300)
            discount = np.random.uniform(15, 40)
            deal_price = base_price * (1 - discount / 100)
            
            deals.append({
                'type': 'hotel',
                'source': 'airbnb_simulated',
                'reference_id': f'sim_airbnb_{i}',
                'name': f'Cozy {np.random.choice(["Apartment", "Loft", "Studio"])} in {np.random.choice(neighborhoods)}',
                'neighborhood': np.random.choice(neighborhoods),
                'original_price': round(base_price, 2),
                'deal_price': round(deal_price, 2),
                'discount_percentage': round(discount, 2),
                'room_type': 'Entire home/apt',
                'accommodates': np.random.randint(2, 6),
                'availability': np.random.randint(10, 90),
                'rating': round(np.random.uniform(4.0, 5.0), 1),
                'reviews_count': np.random.randint(5, 100),
                'ingested_at': datetime.now().isoformat()
            })
        
        return deals
    
    async def _simulate_flight_data(self) -> List[Dict[str, Any]]:
        """Simulate flight data when CSV is not available."""
        print("🔧 Generating simulated flight deals...")
        
        routes = [
            ('JFK', 'LAX'), ('SFO', 'NYC'), ('BOS', 'MIA'), 
            ('SEA', 'ORD'), ('DEN', 'ATL'), ('LAS', 'PHX')
        ]
        airlines = ['Delta', 'United', 'American', 'Southwest', 'JetBlue']
        deals = []
        
        for i in range(50):
            origin, dest = routes[i % len(routes)]
            base_price = np.random.uniform(200, 600)
            discount = np.random.uniform(15, 45)
            deal_price = base_price * (1 - discount / 100)
            
            deals.append({
                'type': 'flight',
                'source': 'flight_simulated',
                'reference_id': f'sim_flight_{i}',
                'airline': np.random.choice(airlines),
                'origin': origin,
                'destination': dest,
                'route': f'{origin}-{dest}',
                'original_price': round(base_price, 2),
                'deal_price': round(deal_price, 2),
                'discount_percentage': round(discount, 2),
                'duration_hours': np.random.randint(2, 8),
                'stops': np.random.choice([0, 1], p=[0.7, 0.3]),
                'flight_class': 'Economy',
                'departure_time': (datetime.now() + timedelta(days=np.random.randint(7, 60))).isoformat(),
                'ingested_at': datetime.now().isoformat()
            })
        
        return deals
    
    async def _simulate_hotel_data(self) -> List[Dict[str, Any]]:
        """Simulate hotel data when CSV is not available."""
        print("🔧 Generating simulated hotel deals...")
        
        hotel_types = ['City Hotel', 'Resort Hotel', 'Airport Hotel']
        countries = ['USA', 'UK', 'France', 'Spain', 'Italy']
        deals = []
        
        for i in range(50):
            base_price = np.random.uniform(100, 400)
            discount = np.random.uniform(15, 35)
            deal_price = base_price * (1 - discount / 100)
            
            deals.append({
                'type': 'hotel',
                'source': 'hotel_simulated',
                'reference_id': f'sim_hotel_{i}',
                'hotel_type': np.random.choice(hotel_types),
                'country': np.random.choice(countries),
                'market_segment': 'Online TA',
                'original_price': round(base_price, 2),
                'deal_price': round(deal_price, 2),
                'discount_percentage': round(discount, 2),
                'nights': np.random.randint(2, 7),
                'adults': np.random.randint(1, 4),
                'children': np.random.randint(0, 2),
                'meal': np.random.choice(['BB', 'HB', 'FB', 'SC']),
                'is_repeated_guest': bool(np.random.choice([0, 1], p=[0.8, 0.2])),
                'ingested_at': datetime.now().isoformat()
            })
        
        return deals
