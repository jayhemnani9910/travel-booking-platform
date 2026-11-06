# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Demo GIF, CONTRIBUTING.md, issue and pull request templates, this changelog.

### Changed
- README rewritten around what runs today.

## 2026-10-07

### Fixed
- Hosted demo rendered blank: the Pages build used the old repo name as its base path.
- Tailwind source restored in `apps/client/src/index.css`, which had been overwritten by compiled output.
- Booking and payment saga: `payment_failed` reads `booking_id`, and `payment_succeeded` only confirms bookings that are awaiting payment.
- Billing refunds use the stored payment intent id.
- Client fixes to results filters, booking summary, login and signup redirects, admin and profile pages.
- Redis, paging and connection cleanup fixes in the flights, hotels and cars services.

## 2026-02-17

### Changed
- README rewritten with the service list and infrastructure.

### Removed
- Course project PDF.

## 2025-12-19

### Added
- Client demo mode with mocked API responses, deployed to GitHub Pages.
- Vite base path and hash router option for Pages.

## 2025-11-19 to 2025-11-29

### Added
- First public version: API gateway, 12 more services, React client, Docker Compose file, Kubernetes manifests, CI and CD workflows.

### Fixed
- Dockerfile paths, database connection settings, TypeScript errors in `user-svc`, and other bug fixes.

### Removed
- Leftover notes (`kayak.txt`, `FIXES_SUMMARY.md`, `TEST_VERIFICATION_REPORT.md`).
