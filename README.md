![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black)
![Kafka](https://img.shields.io/badge/Kafka-231F20?style=flat&logo=apachekafka&logoColor=white)
![Kubernetes](https://img.shields.io/badge/Kubernetes-326CE5?style=flat&logo=kubernetes&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat&logo=mongodb&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)

# Travel Booking Platform

**Full-stack microservices platform for travel booking — flights, hotels, cars, deals, and billing.**

14 independently deployable services communicating over Kafka, backed by MongoDB and MySQL, orchestrated with Kubernetes, and fronted by a React/Vite client with i18n support.

---

## Architecture

```
                        ┌─────────────┐
                        │   Client    │
                        │  React/Vite │
                        └──────┬──────┘
                               │
                        ┌──────▼──────┐
                        │ API Gateway │
                        └──────┬──────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
   ┌──────▼──────┐     ┌──────▼──────┐     ┌──────▼──────┐
   │  Flights    │     │   Hotels    │     │    Cars     │
   │  Service    │     │   Service   │     │   Service   │
   └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                        ┌──────▼──────┐
                        │    Kafka    │
                        └──────┬──────┘
                               │
     ┌──────────┬──────────┬───┴───┬──────────┬──────────┐
     │          │          │       │          │          │
  Booking   Billing    Deals   Notif.    Admin      User
  Service   Service   Worker  Service   Service   Service
```

---

## Services

| Service | Language | Description |
|---------|----------|-------------|
| `api-gateway` | TypeScript | Request routing and authentication |
| `flights-svc` | TypeScript | Flight search and booking (Kafka producer) |
| `hotels-svc` | TypeScript | Hotel search and availability (Kafka consumer) |
| `cars-svc` | TypeScript | Car rental search (Kafka consumer) |
| `booking-svc` | TypeScript | Booking lifecycle management |
| `billing-svc` | TypeScript | Payment processing |
| `user-svc` | TypeScript | User auth and profiles |
| `notification-svc` | TypeScript | Email/push notifications |
| `admin-svc` | TypeScript | Analytics dashboard (bookings, revenue, deals, users) |
| `deals-worker` | TypeScript | Background deal aggregation |
| `airport-resolver-svc` | TypeScript | Airport code/name resolution |
| `external-adapters` | TypeScript | Third-party API integrations |
| `concierge-svc` | Python | AI-powered travel assistant |
| `client` | React/Vite | Frontend with i18n (English) |

---

## Infrastructure

| Component | Technology |
|-----------|-----------|
| Container orchestration | Kubernetes (manifests in `infra/k8s/`) |
| Message broker | Apache Kafka |
| Primary database | MongoDB |
| Relational database | MySQL |
| Reverse proxy | Nginx |
| CI/CD | GitHub Actions (CI + CD + Pages) |
| Containerization | Docker (per-service Dockerfiles) |

---

## Testing

```
tests/
├── unit/           # Service-level unit tests
├── e2e/            # End-to-end integration tests
├── performance/    # Load testing
└── seed/           # Test data generators
```

Individual services also contain co-located tests in `src/__tests__/`.

---

## Quickstart

```bash
# Clone and install
git clone https://github.com/jayhemnani9910/travel-booking-platform.git
cd travel-booking-platform

# Copy environment config
cp .env.example .env

# Build and start all services
docker compose build
docker compose up -d

# Or deploy to Kubernetes
kubectl apply -f infra/k8s/
```

---

## Project Structure

```
├── apps/
│   ├── api-gateway/          # Express gateway
│   ├── flights-svc/          # Flight search + Kafka
│   ├── hotels-svc/           # Hotel search + Kafka
│   ├── cars-svc/             # Car rental + Kafka
│   ├── booking-svc/          # Booking management
│   ├── billing-svc/          # Payment processing
│   ├── user-svc/             # Auth and profiles
│   ├── notification-svc/     # Notifications
│   ├── admin-svc/            # Analytics API
│   ├── deals-worker/         # Deal aggregation
│   ├── airport-resolver-svc/ # Airport lookup
│   ├── external-adapters/    # Third-party APIs
│   ├── concierge-svc/        # Python AI assistant
│   └── client/               # React/Vite frontend
├── shared/                   # Shared contracts, models, validators
├── platform/                 # Kafka, MongoDB, MySQL configs
├── infra/                    # Kubernetes manifests, Nginx
├── scripts/                  # Build and deployment scripts
├── tests/                    # E2E, performance, unit, seed
└── data/                     # Raw datasets
```
