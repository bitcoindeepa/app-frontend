# CLAUDE.md

Telegram Mini App + web/PWA (Next.js 16 App Router) for Sri Lankan Bitcoin DCA: PayHere plans in LKR, KYC, wallet, P2P sends, sells. Backend: BitcoinDeepa-DCA-BE.

## Commands

bun (`bun.lockb` committed). `bun dev` / `bun start` (port 3347), `bun run build`, `bun run lint`, `bun run format`, `bun run init-git-hooks` (pre-commit runs `prettier --check`). No test suite: run `format` and `build` before committing.

## API

- All client HTTP goes through `fetchy` (`src/lib/fetchy.ts`), never raw `fetch`. Non-`/api/` paths go to `NEXT_PUBLIC_API_BASE_URL` with `credentials: "include"` (web session cookie) plus the Mini App's Bearer token: don't pass either by hand. No HTTP cache (TanStack owns caching); throws `FetchyError` (`.status`, `.code`).
- The only Next API route is `src/app/api/user/route.ts` (Mongo user count/registration; loose `User` model in `src/db/schema.ts`, real shapes in `src/lib/types.ts`).

## Auth (`src/lib/auth.ts`, read via `useSession`)

- Backend sessions. **Mini App:** `useRegisterUser` exchanges raw launch `initData` (never `initDataUnsafe`, max 15 min old) once via `POST /auth/telegram/miniapp`; the token lives in memory + `sessionStorage`, never `localStorage` or a URL. After a 401 it re-exchanges while it can, else `useAuthGuard` asks the user to reopen the app.
- **Web:** "Log In with Telegram" is a full-page redirect to the backend's `/auth/telegram/start?return_to=` (OIDC), which returns with an HttpOnly cookie. JS never sees a token; `GET /auth/me` says who's signed in. Errors come back as `/?login_error=<code>` (`loginErrorMessage`). No Telegram login script on our pages.
- Cookie across sites: prod app/API share `bitcoindeepa.com` (`SameSite=Lax`). Dev (vercel.app + railway.app) needs the backend's `APP_COOKIE_SAME_SITE=none`; Safari and the iOS WebView still block it, so test web login in Chrome.
- Each login links the bot wallet (backend calls the bot's `/api/v1/init`). Wallet calls (`/p2p/*`, `/sell/orders/:id/pay`) send no Telegram credential. `403 relogin_required` opens `ReloginPrompt` and must never sign the user out (401 does).
- Logout / "Log out of all devices" throw unless the backend confirms (settings shows a toast).
- **Sign in with passkey (web)**: `PasskeyLoginButton` on `BrowserLoginScreen` (hidden where the browser can't do WebAuthn): `POST /auth/passkey/options` → browser prompt (it lists this site's passkeys) → `POST /auth/passkey/login` sets the session cookie, already unlocked, so the button calls `unlockApp()` before `refreshWebSession()` (no second prompt from the lock). Closing the prompt shows nothing; other failures show under the buttons.
- `bitcoin-deepa-is-existing-user` (localStorage) is only a UX flag for the launch redirect. The old `bitcoin-deepa-auth-token` is deleted on load.
- **Passkey lock** (optional, web/PWA only; backend `/passkey`, `@simplewebauthn/browser`): `useAppLock` (via `AppLockGate`, mounted once in the root providers so it covers every route, not only `/dashboard`) puts `PasskeyLock` over the app on every launch and after 60 s in the background **only while the member's "Ask when opening the app" is on** (`GET /passkey` `lock_on_open`, on by default, set again by the first passkey; toggled in Settings › App lock via `PATCH /passkey/settings`, which unlocks first when turning it off), and always when fetchy sees `403 passkey_required` (`lib/app-lock.ts`), e.g. a bank account change with that off; it opens the passkey prompt at once and on each refocus with only the logo showing; the locked screen (unlock button, help, log out) appears only when the prompt is cancelled or fails. Unlocking also unlocks the session on the backend (money-moving routes need that). **Logging in doesn't ask for it**: `startWebLogin` (every "Log In with Telegram" redirect, incl. `ReloginPrompt`) marks `bitcoin-deepa-login-started` in sessionStorage (only when the backend had confirmed this browser was signed out: a 401 from `/auth/me` or another call, or a confirmed logout; never while the probe is loading or failed, or from `ReloginPrompt`, otherwise a cancelled login would return to the old session unlocked), and the page the login returns to (read once on load, 10 min max) starts unlocked and acts as if "Ask when opening the app" were off until it relocks (60 s in the background, or the next launch). The backend session stays locked, so passkey-gated actions still ask (a Telegram login never unlocks it: that would let a stolen Telegram account change passkeys). Never in the Telegram Mini App: its webview can't run WebAuthn for our domain, so settings there point to Telegram's own passcode lock. `bitcoin-deepa-passkey-on` (localStorage) only lets the lock show before `GET /passkey` answers (set when there's a passkey and the prompt on open is on). Settings › App lock (`PasskeySection`) adds/removes passkeys. **Every send and sale payment on the web needs a passkey approval** (mandatory; backend binds it to that send/order): `useP2pSend` / `usePaySell` call `usePasskeyApproval()` first, which offers passkey setup when there's none, then sends the assertion in `X-Passkey-Assertion`. Inside Telegram it adds nothing. A step that doesn't finish throws `PasskeyStepError` (nothing was sent: show its message, not "checking whether it went through"). Failed passkeys are 400/403, never 401; lost passkeys are removed by support.
- Protected pages live under `src/app/dashboard/` (gated by `useAuthGuard` in its layout). `src/app/verification/` (KYC) is outside it.
- Changing account (signed out, a 401, or signing in as someone else in the same tab, e.g. passkey sign-in) clears the query cache synchronously before the new session renders (`onIdentityChange` in `lib/auth.ts`, registered in `providers.tsx`), so cached private data never crosses accounts.

## State and structure

- Providers (`src/app/context/providers.tsx`): Platform → Theme → QueryClient (60 s default `staleTime`) → Toast.
- Server state: TanStack Query. Each `src/hooks/query/*` file exports a `queryOptions` factory plus a hook; keys in `src/lib/query-keys.ts`. Client state: small `useSyncExternalStore` hooks (`useSession`, `useBalanceVisible`), no global store. Forms: React state + Zod (`src/lib/validations.ts`).
- Plan picker `ChoosePlanView` is both the Plans tab (no active plan) and `/dashboard/plans/choose`. `/plans/choose` only redirects.
- UI: `src/components/ui/` shadcn-style (`cva`, `cn` from the `cn` package, Base UI for Dialog/Toast/Collapsible). Feature components in `src/components/dashboard/<feature>/`. Use semantic color tokens from `src/styles/theme.css`, not raw hex. Light/dark = `<html data-theme>`, set pre-paint by `src/lib/theme-boot.ts`.
- Don't reintroduce `@telegram-apps/telegram-ui`. `@tma.js/sdk` is imported only in `src/platform/` (ESLint-enforced); `setupTelegram()` must run first.
- React 19: `ref` as a prop, `<Context value>` + `use()`, server data via TanStack (not `use(promise)`/`useActionState`/`useOptimistic`). React Compiler is deliberately off (+7% JS, no gain).

## Telegram / PWA gotchas

- Mobile-first, `max-w-md` single column.
- Rupees: every displayed LKR value has two decimals (`fmtLkr` / `fmtLkrCurrency` / `fmtLkrExact` in `src/lib/formatters.ts`); don't `Math.round` before formatting. Only typed amount inputs and whole-rupee preset chips (`fmtLkrPreset`, calculator and Buy) stay whole, and compact chart/price labels (`fmtLkrCurrencyCompact`, `29.5M`) stay abbreviated.
- Send confirms with a normal button (no press-and-hold); Sell still uses `HoldButton`.
- Fast launch (`src/lib/launch-redirect.ts`): a `<head>` script sends returning members straight to `/dashboard`; `web_app_ready` is sent from the end of `<body>`.
- `next.config.mjs` forces `Cache-Control: no-store` on non-static routes (Telegram Desktop caches stale HTML): don't remove. `allowedDevOrigins` allows `*.sats.day` / `*.ngrok-free.app` tunnels.
- Service worker: edit `src/sw.template.js`, never `public/sw.js` (generated by `scripts/stamp-sw.mjs` with the commit sha). It caches only `/_next/static/` and `/icons/`, never HTML or API. Registers in production builds only. Auto-update reloads are deferred on checkout/KYC/payment paths (`src/pwa/`).
- Deploy: Vercel; the build stamps the worker with `VERCEL_GIT_COMMIT_SHA`.
