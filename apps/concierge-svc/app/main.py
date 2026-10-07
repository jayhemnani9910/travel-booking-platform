"""FastAPI entrypoint for the Agentic Concierge service."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import ORJSONResponse
from redis.asyncio import Redis, from_url as redis_from_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from datetime import timedelta

from .config import settings
from .models import BundleRecord, CachedDeal, UserPreference, WatchRequest
from .schemas import ApiResponse, BundleRequest, BundlePreferences, BundleConstraints, WatchRequestCreate, ChatRequest
from .services.bundle_engine import BundleEngine
from .services.deal_cache import DealCache
from .services.kafka import DealEventConsumer
from .services.websocket_manager import WebSocketManager
from .services.llm_service import LLMService


async def init_db(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine = create_async_engine(settings.sqlite_url, echo=False, future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    redis_client: Redis | None = None
    try:
        redis_client = await redis_from_url(settings.redis_url, decode_responses=False)
        # from_url does not connect, so ping to find out if Redis is really up
        await redis_client.ping()
    except Exception:
        redis_client = None

    deal_cache = DealCache(session_factory, redis_client)
    bundle_engine = BundleEngine(settings, deal_cache, redis_client)
    websocket_manager = WebSocketManager()
    kafka_consumer = DealEventConsumer(settings, deal_cache)
    
    # Initialize LLM service
    llm_service = LLMService(
        base_url=settings.ollama_url,
        model=settings.ollama_model
    )

    background_tasks: list[asyncio.Task] = []
    await init_db(engine)
    if kafka_consumer.enabled:
        try:
            await kafka_consumer.start()
        except Exception as e:
            print(f"Warning: Failed to start Kafka consumer: {e}. Continuing without Kafka.")
    background_tasks.append(
        asyncio.create_task(deal_cache.periodic_watch_runner(websocket_manager, settings.watch_poll_interval_seconds))
    )

    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.redis = redis_client
    app.state.deal_cache = deal_cache
    app.state.bundle_engine = bundle_engine
    app.state.kafka_consumer = kafka_consumer
    app.state.websocket_manager = websocket_manager
    app.state.background_tasks = background_tasks
    app.state.llm_service = llm_service

    yield

    for task in background_tasks:
        task.cancel()
    await asyncio.gather(*background_tasks, return_exceptions=True)
    await kafka_consumer.stop()
    if llm_service:
        await llm_service.close()
    if redis_client:
        await redis_client.aclose()
    await engine.dispose()


from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Concierge Service",
    version=settings.version,
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_bundle_engine() -> BundleEngine:
    return app.state.bundle_engine


def get_deal_cache() -> DealCache:
    return app.state.deal_cache


def _response(data: dict | None = None, trace_id: str | None = None) -> ApiResponse:
    return ApiResponse(success=True, data=data, trace_id=trace_id or uuid4().hex)


@app.get("/health", response_model=ApiResponse)
async def healthcheck() -> ApiResponse:
    trace_id = uuid4().hex
    return _response(
        {
            "status": "healthy",
            "service": "concierge-svc",
        },
        trace_id,
    )


@app.post("/concierge/bundles", response_model=ApiResponse)
async def create_bundles(
    request: BundleRequest,
    user_id: str | None = None,
    bundle_engine: BundleEngine = Depends(get_bundle_engine),
):
    bundles = await bundle_engine.generate(request, user_id=user_id)
    return _response(bundles.model_dump())


@app.get("/concierge/bundles/user/{user_id}", response_model=ApiResponse)
async def bundles_for_user(user_id: str, deal_cache: DealCache = Depends(get_deal_cache)):
    bundles = await deal_cache.bundles_for_user(user_id)
    return _response({"bundles": [bundle.model_dump() for bundle in bundles], "totalResults": len(bundles)})


@app.post("/concierge/watch", response_model=ApiResponse)
async def create_watch(request: WatchRequestCreate, deal_cache: DealCache = Depends(get_deal_cache)):
    watch = await deal_cache.create_watch(request)
    return _response({"watchId": watch.id})


@app.get("/concierge/deals", response_model=ApiResponse)
async def get_deals(destination: str | None = None, deal_cache: DealCache = Depends(get_deal_cache)):
    """
    Return deals in a UI-friendly shape expected by the frontend:
    {
      id, type, title, description, originalPrice, discountedPrice,
      discountPercentage, expiresAt, score, tags
    }
    """
    deals = await deal_cache.top_deals(destination=destination)
    ui_deals: list[dict] = []
    for d in deals:
      payload = d.payload or {}
      price = payload.get("price") or {}
      ui_deals.append(
        {
          "id": payload.get("deal_id") or d.deal_id,
          "type": payload.get("type") or d.type,
          "title": payload.get("summary") or f"Deal {d.deal_id}",
          "description": "",
          "originalPrice": price.get("original") or d.price_value,
          "discountedPrice": price.get("deal") or d.price_value,
          "discountPercentage": price.get("discount") or 0,
           "destination": payload.get("destination") or d.destination,
          "expiresAt": payload.get("valid_until") or d.valid_until.isoformat(),
          "score": payload.get("score") or d.score,
          "tags": payload.get("tags") or d.payload.get("tags") if isinstance(d.payload, dict) else [],
        }
      )
    return _response({"deals": ui_deals})


@app.post("/concierge/chat", response_model=ApiResponse)
async def chat_with_concierge(
    payload: ChatRequest,
    bundle_engine: BundleEngine = Depends(get_bundle_engine),
):
    """Natural language chat endpoint - extracts intent and generates bundles."""
    llm_service: LLMService = app.state.llm_service

    message = payload.message
    user_id = payload.user_id

    # Extract intent from user message
    intent = await llm_service.extract_intent(message)
    
    # Convert intent to BundleRequest
    if not intent.get("destination") or not intent.get("departure_date"):
        return _response({
            "error": "Could not understand destination or travel dates. Please specify where and when you'd like to go.",
            "extracted_intent": intent
        })
    
    bundle_request = BundleRequest(
        origin=intent.get("origin"),
        destination=intent["destination"],
        departure_date=intent["departure_date"],
        return_date=intent.get("return_date") or intent["departure_date"] + timedelta(days=3),
        budget=intent.get("budget", 1000.0),
        preferences=BundlePreferences(
            flight_class=intent["preferences"].get("flight_class", "economy"),
            hotel_star_rating=intent["preferences"].get("hotel_star_rating"),
            amenities=intent["preferences"].get("amenities"),
            pet_friendly=intent["preferences"].get("pet_friendly"),
            avoid_red_eye=intent["preferences"].get("avoid_red_eye")
        ),
        constraints=BundleConstraints(
            adults=intent.get("adults", 1),
            children=intent.get("children", 0),
            rooms=1
        )
    )
    
    # Generate bundles
    bundles = await bundle_engine.generate(bundle_request, user_id=user_id)
    
    return _response(
        {
            "message": f"Found {len(bundles.bundles)} travel packages for you!",
            "extracted_intent": intent,
            "bundles": bundles.model_dump(),
        }
    )


@app.websocket("/events")
async def websocket_endpoint(websocket: WebSocket, userId: str | None = None):
    manager: WebSocketManager = app.state.websocket_manager
    await manager.connect(websocket, user_id=userId)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket, user_id=userId)
