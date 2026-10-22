# ER7206 data usage + speed control

## Router facts (read-only probe, 2026-10-22)
- `POST /admin/ipstats?form=setting` (get) → `{"status":"on","ip":"11.11.11.0","mask":"255.255.255.0"}` — IP Statistics already enabled (not changed).
- `POST /admin/ipstats?form=list` (get) → per-IP `rx_bytes, tx_bytes, rx_pkts, tx_pkts, rx_bps, tx_bps` (56 IPs). Cumulative; reset on reboot/clear. No per-username counters.
- `sessmngr` (portal sessions) has `username → ip` (its `indata/outdata` are always 0, so unused).
- Local user object (`/admin/usermngr?form=usermngr`) has `upBand` / `downBand` ("Upstream/Downstream Bandwidth for the user. 0 means no limit"; UI range 0 or 10–1000000). All 61 users are `0/0` today.
- Bandwidth Control rules exist as a separate feature; NOT used and NOT touched.

## Flow
- VPS `sync.py` (5 min, shares the queue worker's flock → single router session) calls `usage_sync.run`:
  username → IP (session, else bound MAC via session/ARP) → ipstats bytes → deltas (counter-reset safe) →
  `customers/{id}/usage/current` with monthly buckets `months[YYYY-MM]` (America/Guyana). rx = download.
- Desk: Data (month) column on the board, Data panel on the customer page (limit stored on the customer doc:
  `dataLimitGb`, `dataLimitAction` alert|throttle|cap, `dataThrottleUpKbps/DownKbps`).
- Drop speed / Restore → callable `er7206SetSpeed` → `er7206Queue` job `throttle|restore` → worker sets
  `upBand/downBand` with the same get-then-set as enable/expiry (verified on throwaway user `gnthrottletest`, deleted).
- Customer app: "My usage this month" card (rules: only that customer's uid or desk staff).
- Auto action at the limit: `USAGE_ENFORCE=1` in `/etc/gn-er7206/connector.env` (OFF by default).
