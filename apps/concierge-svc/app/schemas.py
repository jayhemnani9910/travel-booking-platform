"""Pydantic schemas shared across the concierge codebase."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, conlist


class Address(BaseModel):
    model_config = ConfigDict(extra="forbid")

    city: str
    state: str
    country: str = "USA"


class FlightOption(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=str)
    origin: str
    destination: str
    departure_time: datetime
    arrival_time: datetime
    airline: str
    flight_class: Literal["economy", "premium", "business", "first"] = "economy"
    price: float
    duration_minutes: int
    seats_available: int | None = None


class HotelOption(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    star_rating: float
    price_per_night: float
    nights: int
    amenities: list[str] = Field(default_factory=list)
    neighborhood: str | None = None


class CarOption(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    provider: str
    car_type: str
    daily_price: float
    seats: int
    transmission: Literal["automatic", "manual"] | None = None


class BundlePreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    flight_class: Literal["economy", "premium", "business", "first"] = "economy"
    hotel_star_rating: conlist(int, min_length=1, max_length=3) | None = None
    amenities: list[str] | None = None
    pet_friendly: bool | None = None
    avoid_red_eye: bool | None = None


class BundleConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    adults: int = Field(default=1, ge=1)
    children: int = Field(default=0, ge=0)
    rooms: int = Field(default=1, ge=1)


class BundleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    origin: str | None = Field(default=None, max_length=3, description="IATA code")
    destination: str = Field(max_length=3, description="Destination IATA code")
    departure_date: datetime
    return_date: datetime | None = None
    budget: float = Field(gt=0)
    preferences: BundlePreferences = Field(default_factory=BundlePreferences)
    constraints: BundleConstraints = Field(default_factory=BundleConstraints)


class BundleComponent(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["flight", "hotel", "car"]
    summary: str
    price: float
    metadata: dict = Field(default_factory=dict)


class Bundle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    destination: str
    total_price: float
    savings: float
    fit_score: float
    explanation: str
    valid_until: datetime
    components: list[BundleComponent]


class BundleResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bundles: list[Bundle]
    search_id: str
    total_results: int


class WatchRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str
    destination: str
    budget_ceiling: float
    min_fit_score: float = Field(default=60, ge=0, le=100)
    notify_on_inventory_below: int | None = Field(default=5, ge=1)


class WatchEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    watch_id: str
    user_id: str
    destination: str
    message: str
    triggered_at: datetime = Field(default_factory=datetime.utcnow)
    bundle: Bundle | None = None


class DealEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    deal_id: str
    type: Literal["flight", "hotel", "car"]
    destination: str
    route: str | None = None
    summary: str
    price: dict
    tags: list[str] = Field(default_factory=list)
    score: float
    valid_until: datetime
    inventory: int | None = None


class ApiResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: bool = True
    data: dict | None = None
    error: dict | None = None
    trace_id: str | None = None


class ChatRequest(BaseModel):
    """Request body for /concierge/chat endpoint."""

    model_config = ConfigDict(extra="forbid")

    message: str
    user_id: str | None = None
