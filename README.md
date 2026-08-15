# GlobalNetwork

ISP operations platform using the **SareChild Ops** four-layer architecture:

1. **Apps** — GitHub Pages marketing + TCD, Firebase Hosting staff dashboard (`ops-web`), Flutter customer app
2. **Firebase** — Auth, Firestore, Cloud Messaging, Cloud Functions, Hosting
3. **Cloudflare** — Worker, R2 (issue photos), D1, KV
4. **Hosting & admin** — GitHub Pages TCD, optional DigitalOcean droplet (not required)

Admin: `neuereatec@gmail.com`

**GitHub Pages (canonical web host)**

- Marketing: https://bbscalton.github.io/globalnetwork/
- TCD: https://bbscalton.github.io/globalnetwork/tcd.html
- Staff dashboard: https://bbscalton.github.io/globalnetwork/ops/

Use a **new Firebase project** (do not share the SareChild project) so TCD/ops can sign in.

## Local run

```bash
# Staff TCD (marketing)
cd marketing && npm install && npm run dev

# open http://localhost:5173/globalnetwork/tcd.html

# Day-to-day provider dashboard
cd ops-web && npm install && npm run dev

# Functions
cd functions && npm install && npm run build
```

Copy `.env.example` to `marketing/.env` and `ops-web/.env` with your `VITE_FIREBASE_*` keys.

## Core ISP rule — extend days on a partial fee

Callable `extendSubscription({ customerId, days, amountPaid, note })`:

- If the account is still active/grace, days stack onto `paidUntilMs`
- If expired, days start from now
- If `amountPaid < feeAmount`, status becomes `grace` and `balanceDue` is kept
- Clients cannot write `paidUntilMs` (Firestore rules)

## Cloudflare

Create an R2 bucket `globalnetwork-media`, D1 `globalnetwork-ops`, KV namespace, then fill IDs in `r2-worker/wrangler.jsonc` and:

```bash
cd r2-worker && npm install && npx wrangler deploy
```

Set Worker secret `FIREBASE_API_KEY` so signed uploads can verify ID tokens.

## Flutter

`customer-app/` is a Phase 2 skeleton (login, days remaining, chat, issue photo → R2). Run `flutterfire configure` then set `firebaseReady = true` in `lib/main.dart`.
