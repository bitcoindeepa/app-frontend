# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

Releasing: bump `version` in `package.json` and add a matching `## [x.y.z] - YYYY-MM-DD` section below in the release
PR to `main`. When it merges, the Release workflow tags `vx.y.z` and publishes a GitHub release with that section as
its notes. Keep unreleased work under `## [Unreleased]` until then.

## [Unreleased]

### Changed

- New app icon: white දීප on Satoshi Orange with a slight gradient, for the home screen, PWA install and the
  Apple touch icon. The browser favicon is now just the දීප on a transparent background. The full icon kit (iOS,
  Android, macOS, Windows, web, source SVGs) is in `design/app-icon/` (#138).

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

[Unreleased]: https://github.com/bitcoindeepa/app-frontend/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/bitcoindeepa/app-frontend/compare/v1.0.0...v2.1.0
[1.0.0]: https://github.com/bitcoindeepa/app-frontend/releases/tag/v1.0.0
