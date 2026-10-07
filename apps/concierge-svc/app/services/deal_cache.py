"""Persistence helpers for deals, bundles, and watch requests."""

from __future__ import annotations

import asyncio
from datetime import datetime
from uuid import uuid4

from redis.asyncio import Redis
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..models import BundleRecord, CachedDeal, WatchRequest
from ..schemas import Bundle, BundleResponse, DealEvent, WatchEvent, WatchRequestCreate
from .websocket_manager import WebSocketManager


class DealCache:
    """Coordinates persistence between SQLite and Redis."""

    def __init__(self, session_factory, redis_client: Redis | None = None):
        self._session_factory = session_factory
        self._redis = redis_client

    async def cache_bundles(self, bundles: BundleResponse, user_id: str | None = None) -> None:
        async with self._session_factory() as session:
            for bundle in bundles.bundles:
                record = BundleRecord(
                    id=bundle.id,
                    search_id=bundles.search_id,
                    user_id=user_id,
                    destination=bundle.destination,
                    total_price=bundle.total_price,
                    savings=bundle.savings,
                    fit_score=bundle.fit_score,
                    explanation=bundle.explanation,
                    components=[component.model_dump() for component in bundle.components],
                    valid_until=bundle.valid_until,
                )
                session.add(record)
            await session.commit()

        if self._redis and user_id:
            key = f"bundles:{user_id}:{bundles.search_id}"
            await self._redis.setex(key, 900, bundles.model_dump_json())

    async def bundles_for_user(self, user_id: str, limit: int = 10) -> list[Bundle]:
        if self._redis:
            pattern = f"bundles:{user_id}:*"
            keys = await self._redis.keys(pattern)
            bundles: list[Bundle] = []
            for key in keys[:limit]:
                raw = await self._redis.get(key)
                if raw:
                    parsed = BundleResponse.model_validate_json(raw)
                    bundles.extend(parsed.bundles)
            if bundles:
                return bundles[:limit]

        async with self._session_factory() as session:
            stmt = (
                select(BundleRecord)
                .where(BundleRecord.user_id == user_id)
                .order_by(BundleRecord.created_at.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [
                Bundle(
                    id=row.id,
                    destination=row.destination,
                    total_price=row.total_price,
                    savings=row.savings,
                    fit_score=row.fit_score,
                    explanation=row.explanation,
                    valid_until=row.valid_until,
                    components=row.components,
                )
                for row in rows
            ]

    async def upsert_deal_event(self, event: DealEvent) -> None:
        async with self._session_factory() as session:
            db_deal = await session.get(CachedDeal, event.deal_id)
            # mode="json": valid_until is a datetime, which the JSON column cannot store.
            payload = event.model_dump(mode="json")
            if db_deal:
                db_deal.payload = payload
                db_deal.score = event.score
                db_deal.price_value = event.price["deal"] if isinstance(event.price, dict) else event.price
                db_deal.inventory = event.inventory
                db_deal.valid_until = event.valid_until
                db_deal.updated_at = datetime.utcnow()
            else:
                session.add(
                    CachedDeal(
                        deal_id=event.deal_id,
                        type=event.type,
                        destination=event.destination,
                        summary=event.summary,
                        payload=payload,
                        score=event.score,
                        price_value=event.price["deal"] if isinstance(event.price, dict) else event.price,
                        inventory=event.inventory,
                        valid_until=event.valid_until,
                    )
                )
            await session.commit()

    async def top_deals(self, destination: str | None = None, limit: int = 5) -> list[CachedDeal]:
        async with self._session_factory() as session:
            stmt = select(CachedDeal).order_by(CachedDeal.score.desc()).limit(limit)
            if destination:
                stmt = stmt.where(CachedDeal.destination == destination)
            result = await session.execute(stmt)
            return result.scalars().all()

    async def create_watch(self, payload: WatchRequestCreate) -> WatchRequest:
        watch = WatchRequest(
            id=f"watch_{uuid4().hex}",
            user_id=payload.user_id,
            destination=payload.destination,
            budget_ceiling=payload.budget_ceiling,
            min_fit_score=payload.min_fit_score,
            notify_on_inventory_below=payload.notify_on_inventory_below,
        )
        async with self._session_factory() as session:
            session.add(watch)
            await session.commit()
            await session.refresh(watch)
            return watch

    async def evaluate_watches(self, ws_manager: WebSocketManager) -> None:
        async with self._session_factory() as session:
            stmt = select(WatchRequest).where(WatchRequest.active.is_(True))
            watches_result = await session.execute(stmt)
            watches = watches_result.scalars().all()
            if not watches:
                return

        triggered: list[tuple[WatchRequest, CachedDeal]] = []
        for watch in watches:
            for deal in await self.top_deals(destination=watch.destination):
                if deal.price_value <= watch.budget_ceiling:
                    triggered.append((watch, deal))
                    break

        if not triggered:
            return

        async with self._session_factory() as session:
            for watch, _ in triggered:
                watch.active = False
                watch.last_triggered_at = datetime.utcnow()
                await session.merge(watch)
            await session.commit()

        for watch, deal in triggered:
            event = WatchEvent(
                watch_id=watch.id,
                user_id=watch.user_id,
                destination=watch.destination,
                message=f"Deal {deal.deal_id} now ${deal.price_value:.2f}",
                bundle=None,
            )
            # Wrap payload with a type field so frontend can route by message type.
            await ws_manager.broadcast(
                {"type": "deal_alert", "data": event.model_dump()},
                user_id=watch.user_id,
            )

    async def periodic_watch_runner(self, ws_manager: WebSocketManager, interval_seconds: int) -> None:
        while True:
            try:
                await self.evaluate_watches(ws_manager)
            except Exception as exc:  # pragma: no cover - logged only
                print(f"[watch-runner] error: {exc}")
            await asyncio.sleep(interval_seconds)
