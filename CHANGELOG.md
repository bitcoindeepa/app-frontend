# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

Releasing: bump `version` in `package.json` and add a matching `## [x.y.z] - YYYY-MM-DD` section below in the release
PR to `main`. When it merges, the Release workflow tags `vx.y.z` and publishes a GitHub release with that section as
its notes. Keep unreleased work under `## [Unreleased]

## [Unreleased]

### Changed

- **Change plan without cancelling first.** "Change plan" now opens the plan picker. The member picks a new plan and
  pays for it in one checkout (`switch: true`); the old plan keeps running until that first payment goes through, so
  an abandoned checkout no longer leaves them without a plan. Needs the backend's plan-switch release.

## [2.2.0] - 2026-11-26

### Added

- BTC / LKR / USD calculator, opened from a button on the Total value card as a bottom sheet. Type in LKR, USD, BTC
  or sats and the others follow, using our buy price before fees (#131, #139).
- Settings › App lock has an "Ask when opening the app" switch. Sends and sale payments still ask for a passkey every
  time. Needs app-backend v2.1.0; against an older backend the app always asks on open (#140).
- Hand-drawn animated logo, a glow and loading bar on the start screen, and a theme switch that spreads from the tap
  (#129).
- GitBook-ready user guide in `docs/user-guide/` (#105).
- OpenSSF Scorecard workflow (#130).

### Changed

- New app icon: white දීප on Satoshi Orange with a slight gradient, for the home screen, PWA install and the
  Apple touch icon. The browser favicon is now just the දීප on a transparent background. The full icon kit (iOS,
  Android, macOS, Windows, web, source SVGs) is in `design/app-icon/` (#138).
- Logging in with Telegram on the web returns to the app unlocked, without the passkey lock screen. The backend
  session stays locked, so sends, sale payments, bank account and passkey changes still ask (#141).
- The Send confirm button is a plain button instead of press-and-hold. Sell still uses press-and-hold (#141).
- Rupee amounts always show two decimals, for example `රු. 45,700.00` (#141).
- White text on the Total value card has a soft shadow so it reads on the photo (#141).

### Fixed

- On the landing screen of the installed PWA, the status bar, bottom bar and `theme-color` now match the card, and
  the page no longer scrolls to show a dark band at the bottom (#129).
- "Prefer Telegram?" and the error page's "Open this in Telegram" open the Mini App instead of the bot chat (#129).

## [2.1.0] - 2026-11-25

### Added

- Sign in with a passkey on the web (#137).
- Optional passkey app lock for the web/PWA, managed in Settings › App lock. Every send and sale payment on the web
  now needs a passkey approval (#136).
- Wallet balances split spendable sats from savings-pot funds, with pot balances in sats and LKR (#132).
- Balance hints open a breakdown sheet of spendable funds, savings pots and amounts tied up in payments; sell and
  send say "movable sats" (#134).

### Changed

- Send and sell limits and presets use the spendable balance, and validation explains the breakdown when
  savings-pot funds affect a limit (#132, #134).
- Sheet animations, sell label, plan icon preload, chart ranges and a CeyFi-style tab bar (#126).
- Refreshed news, buy/sell/send, sheets, plans, wallet and result screens (#123).
- Updated README and added a markdownlint config (#124).

### Fixed

- The wallet summary refetches after 10 s instead of 5 min, and selling refreshes related balances (#133).
- Haptics, activity drawer, buy amount and result screen fixes (#125).
- Plans say PayHere takes bank payments only, not cards (#127).

## [2.0.1] - 2026-11-20

### Added

- Sales show and deduct the bank charge (#121).

## [2.0.0] - 2026-11-20

A ground-up revamp of the app.

### Added

- Web and installable PWA support alongside the Telegram Mini App (#97).
- Backend sessions: cookie login on the web, token exchange in the Mini App (#116).
- Send sats to other users and by `@username`, with claimable Bitcoin Deepa usernames (#107, #113).
- Sell sats to a bank account, with the fee in LKR and sales in the activity history (#101, #102, #110, #111).
- One-time buy screen and payment return status (#103).
- Profile page, DiceBear profile pictures and a News tab (#101, #112, #119).
- Pull-to-refresh, payment confetti and an offline banner.

### Changed

- v3 UI revamp on our own Base UI components, replacing `telegram-ui` (#108).
- React 19, Tailwind 4 and a faster Mini App launch.
- The browser calls the backend directly; Next.js proxy routes removed (#94, #96).
- Plan picker shown in the Plans tab (#114).

### Fixed

- Activity shows each purchase once and no longer lists chargebacks as rewards (#104, #106).
- Swipe down dismisses sheets without scrolling the sheet behind (#115).

## [1.0.0] - 2025-06-30

First release. See the [v1.0.0 release notes](https://github.com/bitcoindeepa/app-frontend/releases/tag/v1.0.0).

[Unreleased]: https://github.com/bitcoindeepa/app-frontend/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/bitcoindeepa/app-frontend/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/bitcoindeepa/app-frontend/compare/v1.0.0...v2.1.0
[1.0.0]: https://github.com/bitcoindeepa/app-frontend/releases/tag/v1.0.0
