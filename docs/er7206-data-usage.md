# ER7206 data usage + speed control

## Router facts (read-only probe, 2026-10-22)
- `POST /admin/ipstats?form=setting` (get) → `{"status":"on","ip":"11.11.11.0","mask":"255.255.255.0"}` — IP Statistics already enabled (not changed).
- `POST /admin/ipstats?form=list` (get) → per-IP `rx_bytes, tx_bytes, rx_pkts, tx_pkts, rx_bps, tx_bps`. Cumulative; reset on reboot/clear. No per-username counters.
- `sessmngr` (portal sessions) has `username → ip` (its `indata/outdata` are always 0, so unused).
- Local user object (`/admin/usermngr?form=usermngr`) has `upBand` / `downBand` ("Upstream/Downstream Bandwidth for the user. 0 means no limit"; UI range 0 or 10–1000000).
- Bandwidth Control rules exist as a separate feature; NOT used and NOT touched.

## Paid windows (not calendar months)
Usage is measured from the moment a client pays, renews, extends, or is reactivated, until that paid window ends (`paidUntilMs`) or the desk data cap is hit (throttle/cut-off). The next grant starts a fresh counter. Past windows stay readable.

- Cloud Functions write `usagePeriodId`, `usagePeriodStartMs`, `usagePeriodEndMs`, `usagePeriodKind` on `customers/{id}` from `extendSubscription`, `grantDayExtension`, `collectPayment` (when days are granted), `processExtensionRequest` (approved), `adjustSubscription` (reactivation or added days), and `unsuspendCustomer` (while still paid).
- VPS `usage_sync.py` (every 5 min, shares the queue worker's flock → single router session):
  username → IP (session, else bound MAC via session/ARP) → ipstats bytes → deltas (counter-reset safe) →
  `customers/{id}/usage/current` (live snapshot) and `customers/{id}/usage/{periodId}` (one history doc per window).
  If the customer fields are not yet set (functions not deployed, or migration), the connector dates the open window from the latest grant payment (`kind=full`, or `extension`/`adjust` with `daysGranted > 0`).
- Period counters start at 0 when a window is first seen (router counters are baselined; no jump is attributed). Pre-migration use inside an already-open window is not backfilled; legacy `months[YYYY-MM]` calendar buckets (America/Guyana) remain on `current` for history. `periodCountedFromMs` is when counting for that window actually began.
- Desk: Data (period) column on the board, Data panel on the customer page (limit stored on the customer doc: `dataLimitGb`, `dataLimitAction` alert|throttle|cap, `dataThrottleUpKbps/DownKbps`). The limit applies to the current paid window.
- Drop speed / Restore → callable `er7206SetSpeed` → `er7206Queue` job `throttle|restore`.
- Customer app: "My usage this period" card (rules: only that customer's uid or desk staff).
- Auto action at the limit: `USAGE_ENFORCE=1` in `/etc/gn-er7206/connector.env`. Enforcement is per paid window, not per calendar month. A new grant undoes the previous window's throttle/cap. Migration rekeys existing enforcement onto the new period id and does not undo or re-fire it.
