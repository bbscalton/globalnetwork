# GlobalNetwork

Internet service in **Antigua**, billed in **East Caribbean dollars (EC$ / XCD)**.

Two identities only: the **owner** (`neuereatec@gmail.com`) on the web desk, and **customers** on iOS/Android.

- Marketing: https://bbscalton.github.io/globalnetwork/
- Owner desk: https://bbscalton.github.io/globalnetwork/ops/

## Local run

```bash
cd marketing && npm install && npm run dev
cd ops-web && npm install && npm run dev
cd functions && npm install && npm run build
```

Copy Firebase `VITE_FIREBASE_*` keys into `marketing/.env` and `ops-web/.env`.

`extendSubscription({ customerId, days, amountPaid, note })` grants extra days. If they pay less than the plan fee, status becomes `grace`.

## Flutter

In `customer-app/`, run `flutterfire configure`, then set `kFirebaseOptionsReady = true` in `lib/firebase_options.dart`.
