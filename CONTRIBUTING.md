# Contributing

## Setup

You need Node 20 and Docker. Python 3.12 only if you work on `concierge-svc` or `deals-worker`.

```bash
git clone https://github.com/jayhemnani9910/travel-booking-platform.git
cd travel-booking-platform
npm ci
npm run build:shared
```

Run the client alone, with mocked API data:

```bash
cd apps/client
VITE_DEMO_MODE=true npx vite --host
```

Run everything with `docker compose up -d --build` (see the README).

## Tests

```bash
npm test                       # all Jest suites
cd apps/client && npm run build    # type check and build the client
cd apps/concierge-svc && pip install -r requirements.txt && python -m pytest
```

Not all of this is green yet. Today `npm test` fails in 9 of its 10 suites (61 of 106 tests), `npm run typecheck` fails, and `npm run lint` can't load `@typescript-eslint`. The booking and billing tests build an empty Express app instead of the real service. Fixing any of that is welcome. Please don't skip or loosen a test to make it pass.

## Style

Match the code around you. TypeScript for Node services, Python for `concierge-svc` and `deals-worker`. Keep changes small and on one topic.

## Branches and pull requests

Branch from `main`, open a pull request against `main`. Say what you changed and how you tested it. Keep commit messages short and plain, like the ones in `git log`.

## Bugs

Open an issue with the steps to reproduce, what you expected, what happened, the commit or branch, and your OS. Say whether you ran demo mode or the full stack.

I try to reply to issues within a few days.
