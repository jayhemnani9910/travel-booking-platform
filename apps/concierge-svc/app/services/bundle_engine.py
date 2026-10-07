"""Bundle generation and scoring logic."""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import timedelta
from uuid import uuid4

import numpy as np

from ..config import Settings
from ..schemas import Bundle, BundleComponent, BundleRequest, BundleResponse
from . import http_clients


class BundleEngine:
    """Creates flight+hotel+car bundles and computes fit scores."""

    def __init__(self, settings: Settings, deal_cache, redis_client):
        self._settings = settings
        self._deal_cache = deal_cache
        self._redis = redis_client

    @staticmethod
    def _cache_key(request: BundleRequest) -> str:
        payload = json.dumps(request.model_dump(mode="json"), sort_keys=True)
        return hashlib.sha1(payload.encode()).hexdigest()

    async def _cached_response(self, key: str) -> BundleResponse | None:
        if not self._redis:
            return None
        cached = await self._redis.get(f"concierge:bundle:{key}")
        if not cached:
            return None
        return BundleResponse.model_validate_json(cached)

    async def _store_response(self, key: str, response: BundleResponse) -> None:
        if self._redis:
            await self._redis.setex(f"concierge:bundle:{key}", 600, response.model_dump_json())

    @staticmethod
    def _price_summary(fare, hotel, car) -> tuple[float, float]:
        hotel_total = hotel.price_per_night * hotel.nights
        car_total = car.daily_price * max(hotel.nights, 1)
        total = fare.price + hotel_total + car_total
        baseline = total * 1.15
        return total, baseline

    @staticmethod
    def _fit_score(total_price: float, baseline: float, request: BundleRequest, hotel, deal_bonus: float) -> float:
        budget_delta = max(request.budget - total_price, 0)
        budget_score = np.interp(budget_delta, [0, request.budget], [10, 35])

        hotel_score = 10
        if request.preferences.hotel_star_rating and hotel.star_rating in request.preferences.hotel_star_rating:
            hotel_score = 25

        return float(min(100, budget_score + hotel_score + deal_bonus))

    @staticmethod
    def _deal_savings(deal) -> float:
        # price.discount is a percentage, so take the dollar difference instead
        price = deal.payload.get("price", {})
        if "original" not in price or "deal" not in price:
            return 0
        return price["original"] - price["deal"]

    def _build_components(self, flight, hotel, car) -> list[BundleComponent]:
        hotel_total = hotel.price_per_night * hotel.nights
        car_total = car.daily_price * max(hotel.nights, 1)
        return [
            BundleComponent(
                type="flight",
                summary=f"{flight.airline} {flight.origin}→{flight.destination}",
                price=flight.price,
                metadata={
                    "departure": flight.departure_time.isoformat(),
                    "arrival": flight.arrival_time.isoformat(),
                    "class": flight.flight_class,
                    "duration": flight.duration_minutes,
                },
            ),
            BundleComponent(
                type="hotel",
                summary=f"{hotel.name} · {hotel.star_rating}★",
                price=hotel_total,
                metadata={
                    "nights": hotel.nights,
                    "amenities": hotel.amenities,
                    "neighborhood": hotel.neighborhood,
                },
            ),
            BundleComponent(
                type="car",
                summary=f"{car.provider} {car.car_type}",
                price=car_total,
                metadata={"transmission": car.transmission, "seats": car.seats},
            ),
        ]

    async def generate(self, request: BundleRequest, user_id: str | None = None) -> BundleResponse:
        cache_key = self._cache_key(request)
        cached = await self._cached_response(cache_key)
        if cached:
            return cached

        flights, hotels, cars = await self._gather_inventory(request)
        deals = await self._deal_cache.top_deals(destination=request.destination)

        bundles: list[Bundle] = []
        for flight in flights[:3]:
            for hotel in hotels[:3]:
                for car in cars[:2]:
                    total_price, baseline = self._price_summary(flight, hotel, car)
                    savings = max(0, baseline - total_price)
                    deal_bonus = 0
                    explanation = "Balanced itinerary with matched preferences"

                    for deal in deals:
                        if deal.destination != request.destination:
                            continue
                        if deal.payload.get("type") == "hotel" and hotel.name.lower() in deal.summary.lower():
                            savings += self._deal_savings(deal)
                            deal_bonus = max(deal_bonus, min(deal.score / 2, 25))
                            explanation = f"Hotel deal: {deal.summary}"
                            break
                        if deal.payload.get("type") == "flight" and flight.origin in deal.summary:
                            savings += self._deal_savings(deal)
                            deal_bonus = max(deal_bonus, min(deal.score / 2, 25))
                            explanation = f"Flight deal: {deal.summary}"
                            break

                    fit_score = self._fit_score(total_price, baseline, request, hotel, deal_bonus)
                    bundle = Bundle(
                        id=f"bundle_{uuid4().hex}",
                        destination=request.destination,
                        total_price=round(total_price, 2),
                        savings=round(savings, 2),
                        fit_score=round(fit_score, 2),
                        explanation=explanation,
                        valid_until=request.departure_date - timedelta(days=1),
                        components=self._build_components(flight, hotel, car),
                    )
                    bundles.append(bundle)

        bundles.sort(key=lambda b: b.fit_score, reverse=True)
        bundles = bundles[: self._settings.bundle_limit]

        response = BundleResponse(bundles=bundles, search_id=f"search_{uuid4().hex}", total_results=len(bundles))
        await self._store_response(cache_key, response)
        if user_id:
            await self._deal_cache.cache_bundles(response, user_id=user_id)
        return response

    async def _gather_inventory(self, request: BundleRequest):
        return await asyncio.gather(
            http_clients.fetch_flights(self._settings, request),
            http_clients.fetch_hotels(self._settings, request),
            http_clients.fetch_cars(self._settings, request),
        )
