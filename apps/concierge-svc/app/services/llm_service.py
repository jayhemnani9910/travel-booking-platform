"""LLM service for natural language intent extraction using Ollama."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential


class LLMService:
    """Handles natural language processing using local Ollama models."""
    
    def __init__(self, base_url: str = "http://localhost:11434", model: str = "qwen2.5:3b"):
        self.base_url = base_url
        self.model = model
        self.client = httpx.AsyncClient(timeout=30.0)
        
    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    async def extract_intent(self, user_message: str) -> Dict[str, Any]:
        """
        Extract travel intent from natural language user message.
        
        Returns:
            Dictionary with extracted fields:
            - destination: str (IATA code or city name)
            - origin: Optional[str]
            - departure_date: Optional[datetime]
            - return_date: Optional[datetime]
            - budget: Optional[float]
            - adults: int (default 1)
            - children: int (default 0)
            - preferences: Dict (hotel_star_rating, amenities, etc.)
        """
        prompt = self._build_extraction_prompt(user_message)
        
        try:
            response = await self.client.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.1,
                        "top_p": 0.9
                    }
                }
            )
            response.raise_for_status()
            
            result = response.json()
            llm_output = result.get("response", "")
            
            # Parse LLM output to structured intent
            intent = self._parse_llm_output(llm_output, user_message)
            return intent
            
        except Exception as e:
            print(f"⚠️  LLM extraction failed: {e}, falling back to regex")
            return self._fallback_extraction(user_message)
    
    def _build_extraction_prompt(self, user_message: str) -> str:
        """Build prompt for LLM to extract travel intent."""
        return f"""You are a travel assistant. Extract structured information from the user's travel request.

User message: "{user_message}"

Extract the following information and respond ONLY with a JSON object (no other text):
{{
  "destination": "city or IATA code",
  "origin": "city or IATA code (if mentioned)",
  "departure_date": "YYYY-MM-DD or relative (e.g., 'next week')",
  "return_date": "YYYY-MM-DD or relative (if mentioned)",
  "budget": number or null,
  "adults": number (default 1),
  "children": number (default 0),
  "hotel_star_rating": [list of acceptable star ratings 1-5] or null,
  "amenities": ["list", "of", "desired", "amenities"] or null,
  "pet_friendly": true/false/null,
  "avoid_red_eye": true/false/null,
  "flight_class": "economy"/"business"/"first"/null
}}

JSON response:"""
    
    def _parse_llm_output(self, llm_output: str, original_message: str) -> Dict[str, Any]:
        """Parse LLM JSON output into structured intent."""
        try:
            # Try to extract JSON from LLM response
            json_match = re.search(r'\{.*\}', llm_output, re.DOTALL)
            if json_match:
                extracted = json.loads(json_match.group(0))
            else:
                extracted = json.loads(llm_output)
            
            # Parse dates
            departure_date = self._parse_date(extracted.get("departure_date"))
            return_date = self._parse_date(extracted.get("return_date"))
            
            # Build intent object
            intent = {
                "destination": self._normalize_location(extracted.get("destination")),
                "origin": self._normalize_location(extracted.get("origin")),
                "departure_date": departure_date,
                "return_date": return_date or (departure_date + timedelta(days=3) if departure_date else None),
                "budget": self._parse_budget(extracted.get("budget")),
                "adults": int(extracted.get("adults", 1)),
                "children": int(extracted.get("children", 0)),
                "preferences": {
                    "hotel_star_rating": extracted.get("hotel_star_rating"),
                    "amenities": extracted.get("amenities"),
                    "pet_friendly": extracted.get("pet_friendly"),
                    "avoid_red_eye": extracted.get("avoid_red_eye"),
                    "flight_class": extracted.get("flight_class", "economy")
                }
            }
            
            return intent
            
        except Exception as e:
            print(f"⚠️  Failed to parse LLM output: {e}")
            return self._fallback_extraction(original_message)
    
    def _fallback_extraction(self, message: str) -> Dict[str, Any]:
        """Regex-based fallback extraction when LLM fails."""
        message_lower = message.lower()
        
        # Extract destination (common patterns)
        destinations = {
            'paris': 'CDG', 'london': 'LHR', 'new york': 'JFK', 'tokyo': 'NRT',
            'los angeles': 'LAX', 'san francisco': 'SFO', 'miami': 'MIA',
            'chicago': 'ORD', 'seattle': 'SEA', 'boston': 'BOS'
        }
        
        destination = None
        for city, code in destinations.items():
            if city in message_lower:
                destination = code
                break
        
        # Extract budget (patterns like $1000, 1000 dollars, etc.); a bare number is not a budget
        budget_match = re.search(
            r'\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)|(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:dollars?|usd)\b',
            message_lower,
        )
        budget = float((budget_match.group(1) or budget_match.group(2)).replace(',', '')) if budget_match else 1000.0
        
        # Extract date hints
        departure_date = None
        if 'next week' in message_lower:
            departure_date = datetime.now() + timedelta(days=7)
        elif 'next month' in message_lower:
            departure_date = datetime.now() + timedelta(days=30)
        elif 'tomorrow' in message_lower:
            departure_date = datetime.now() + timedelta(days=1)
        else:
            # Default to 2 weeks from now
            departure_date = datetime.now() + timedelta(days=14)
        
        # Extract preferences
        preferences = {
            "hotel_star_rating": [4, 5] if any(word in message_lower for word in ['luxury', '5 star', 'premium']) else None,
            "amenities": ['wifi', 'breakfast'] if 'wifi' in message_lower or 'breakfast' in message_lower else None,
            "pet_friendly": True if 'pet' in message_lower else None,
            "avoid_red_eye": True if 'red eye' in message_lower or 'night flight' in message_lower else None,
            "flight_class": "business" if 'business' in message_lower else "economy"
        }
        
        return {
            "destination": destination,
            "origin": None,
            "departure_date": departure_date,
            "return_date": departure_date + timedelta(days=3) if departure_date else None,
            "budget": budget,
            "adults": 1,
            "children": 0,
            "preferences": preferences
        }
    
    def _normalize_location(self, location: Optional[str]) -> Optional[str]:
        """Normalize location to IATA code."""
        if not location:
            return None
        
        # Simple mapping (extend as needed)
        location_map = {
            'paris': 'CDG', 'london': 'LHR', 'new york': 'JFK', 'nyc': 'JFK',
            'tokyo': 'NRT', 'los angeles': 'LAX', 'la': 'LAX', 'san francisco': 'SFO',
            'sf': 'SFO', 'miami': 'MIA', 'chicago': 'ORD', 'seattle': 'SEA',
            'boston': 'BOS', 'las vegas': 'LAS', 'orlando': 'MCO'
        }
        
        location_lower = location.lower().strip()
        
        # Check if already IATA code (3 letters)
        if len(location_lower) == 3 and location_lower.isalpha():
            return location.upper()
        
        return location_map.get(location_lower, location.upper()[:3])
    
    def _parse_date(self, date_str: Optional[str]) -> Optional[datetime]:
        """Parse date from various formats."""
        if not date_str:
            return None
        
        date_str = str(date_str).strip().lower()
        
        # Handle relative dates
        if 'next week' in date_str:
            return datetime.now() + timedelta(days=7)
        elif 'next month' in date_str:
            return datetime.now() + timedelta(days=30)
        elif 'tomorrow' in date_str:
            return datetime.now() + timedelta(days=1)
        elif 'today' in date_str:
            return datetime.now()
        
        # Try ISO format
        try:
            return datetime.fromisoformat(date_str)
        except:
            pass
        
        # Try common formats
        for fmt in ['%Y-%m-%d', '%m/%d/%Y', '%d/%m/%Y', '%B %d, %Y']:
            try:
                return datetime.strptime(date_str, fmt)
            except:
                continue
        
        return None
    
    def _parse_budget(self, budget: Any) -> float:
        """Parse budget value."""
        if budget is None:
            return 1000.0
        
        try:
            if isinstance(budget, str):
                # Remove currency symbols and commas
                budget = budget.replace('$', '').replace(',', '').strip()
            return float(budget)
        except:
            return 1000.0
    
    async def generate_explanation(self, bundle_data: Dict[str, Any]) -> str:
        """Generate natural language explanation for a bundle."""
        prompt = f"""Generate a brief, friendly explanation (max 25 words) for this travel bundle:

Destination: {bundle_data.get('destination')}
Total Price: ${bundle_data.get('total_price')}
Savings: ${bundle_data.get('savings')}
Components: {', '.join([c.get('type', '') for c in bundle_data.get('components', [])])}

Explanation:"""
        
        try:
            response = await self.client.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.7, "max_tokens": 50}
                }
            )
            
            result = response.json()
            explanation = result.get("response", "").strip()
            
            # Truncate to 25 words
            words = explanation.split()[:25]
            return ' '.join(words)
            
        except Exception as e:
            print(f"⚠️  Explanation generation failed: {e}")
            return f"Great value trip to {bundle_data.get('destination')} with ${bundle_data.get('savings')} savings!"
