# GlobalNetwork deploy

## Firebase

1. Create project `globalnetwork-isp` (or your id) under neuereatec@gmail.com
2. Enable Auth (email/password + Google), Firestore, Cloud Functions (Blaze), Hosting, FCM
3. `firebase login` then `firebase use --add`
4. Deploy rules + functions + ops-web:

```bash
cd ops-web && npm ci && npm run build
cd ../functions && npm ci && npm run build
cd ..
firebase deploy
```

## Public site (GitHub Pages)

Live URLs after this repo is on `main` (Actions → Pages):

| Page | URL |
|------|-----|
| Marketing | https://bbscalton.github.io/globalnetwork/ |
| TCD ops console | https://bbscalton.github.io/globalnetwork/tcd.html |
| Staff dashboard | https://bbscalton.github.io/globalnetwork/ops/ |

Enable **Settings → Pages → GitHub Actions**. Optional Firebase secrets (`VITE_FIREBASE_*`) make TCD/ops sign-in work; the marketing landing still deploys without them.

Workflow: [`.github/workflows/deploy-marketing-pages.yml`](../.github/workflows/deploy-marketing-pages.yml)

## Staff bootstrap

After Auth sign-in as neuereatec@gmail.com, open TCD and click **Run auto-repair**. That seeds:

- `orgs/globalnetwork`
- `staffProfiles/{uid}`
- default 15 / 30 / 90 day GYD plans
