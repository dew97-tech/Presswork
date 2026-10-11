# Deployment Guide - Portfolio with Blog Admin

## Prerequisites Completed ✅
- Prisma configured with PostgreSQL
- NextAuth.js authentication setup
- Vercel Blob storage for images
- Admin dashboard with CRUD operations
- HTML blog rendering

## Environment Variables Needed on Vercel

### Required Variables:
```
# Supabase -> Project Settings -> Database -> Connection Strings
DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&sslmode=require
DIRECT_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres?sslmode=require
AUTH_SECRET=your-secret-key-here
BLOB_READ_WRITE_TOKEN=vercel_blob_token_here
CRON_SECRET=your-cron-secret-here
```

## Deployment Steps

### 1. Push to GitHub
```bash
git add .
git commit -m "feat: Complete blog admin with HTML rendering and modern UI"
git push origin main
```

### 2. Set Up Supabase Postgres Database
1. Create a project at [supabase.com](https://supabase.com) (region: Singapore or Mumbai for lowest latency from Bangladesh)
2. Project Settings → Database → Connection Strings
3. Copy the **Transaction Mode** URL (port `6543`) → `DATABASE_URL`
4. Copy the **Session / Direct Mode** URL (port `5432`) → `DIRECT_URL`

### 3. Configure Environment Variables on Vercel
1. Go to Project Settings → Environment Variables
2. Add all variables:
   - `DATABASE_URL` (Supabase transaction pooler, port `6543`)
   - `DIRECT_URL` (Supabase direct connection, port `5432`)
   - `AUTH_SECRET` (generate with: `openssl rand -base64 32`)
   - `BLOB_READ_WRITE_TOKEN` (from Vercel Blob Storage)
   - `CRON_SECRET` (protects `/api/cron/generate-blog`)

### 4. Deploy
- Vercel will auto-deploy from GitHub
- Or manually: `vercel --prod`

### 5. Run Database Migrations
After first deployment:
```bash
# Locally, with DIRECT_URL set in .env:
npx prisma migrate deploy
```

Migrations are committed under `prisma/migrations/`.

If the database already existed before migrations were introduced (created via
`prisma db push`), mark the baseline as applied **once**, then deploy:
```bash
npx prisma migrate resolve --applied 0_init
npx prisma migrate deploy
```

### 6. First Admin Sign-In

There is no seed script and no default account.

- **Empty `User` table** → set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Vercel
  *before* your first visit to `/auth/signin`. The first matching sign-in
  creates the admin. Clear `ADMIN_PASSWORD` afterwards to close that path.
- **Populated `User` table** → sign in with your existing credentials.

## Google OAuth + Search Console (optional integration)

The admin dashboard at `/admin/search-console` reads live Search Console data
through an OAuth connection instead of the service account. The service account
above stays in place as the generation-prompt fallback; the dashboard requires
OAuth.

### 1. Google Cloud setup

1. Reuse the existing Google Cloud project (the one that owns the service
   account) or create a new one.
2. Enable the **Google Search Console API** and, for the keyword planner, the
   **Google Ads API**.
3. OAuth consent screen: External. **Publish the app (In production).** The
   `webmasters.readonly` and `adwords` scopes are sensitive, so Google shows an
   unverified-app warning; that is accepted for this single-account admin tool.
   Do not leave the screen in Testing mode: Google expires refresh tokens after
   about 7 days there.
4. Create an OAuth Client ID of type **Web application** with redirect URIs:
   - `https://davidmallick.dev/api/google/oauth/callback`
   - `http://localhost:3000/api/google/oauth/callback`
5. Copy the client ID and secret.

### 2. Environment variables

Add to Vercel (all environments) and to the local `.env`:

```
SETTINGS_ENCRYPTION_KEY=...   # openssl rand -base64 32 (also used for other stored tokens)
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

Without `SETTINGS_ENCRYPTION_KEY` the Connect button is disabled and the OAuth
start route refuses to run; tokens are never stored unencrypted.

### 3. Connect

1. Visit `/admin/settings` and use **Connect Google account**.
2. Accept the consent screens (including the unverified-app warning).
3. The card shows the account email and granted scopes. Use **Load
   properties** and save the Search Console property, then open
   `/admin/search-console`.
4. **Update access** re-runs consent to refresh tokens or pick up scope
   changes. **Disconnect** revokes the tokens and deletes the stored row.

### Preview deploys

Each Vercel preview has its own origin, so its redirect URI is not registered
by default and Google returns `redirect_uri_mismatch`. That is a setup step,
not a bug: use the production domain for the OAuth round trip, or register the
preview origin in the Google Cloud console. The rest of the dashboard works on
previews only if the connection row already exists (the stored tokens are
shared through the database).

### Rotating Google accounts

The app uses one Google account at a time, but several prepared accounts can be
stored as backups and switched without redoing the browser consent:

1. Keep the accounts (client id/secret, refresh token, developer token, customer
   id, optional MCC) in the local, gitignored handover file.
2. Import them into the encrypted stored set from the repo root:
   `npx tsx plans/import-google-accounts.mts` (add `--check` to preview; the
   script never prints secrets).
3. In `/admin/settings`, the Google card lists the stored accounts with masked
   customer ids and a **Switch** button. Switching re-seeds the connection from
   the chosen account's refresh token and aligns the Keyword Planner customer
   id. The previous account stays stored as a backup.
4. After a browser reconnect (**Update access**), click **Store current token**
   so the stored account keeps the new refresh token; otherwise a later switch
   could restore the older token.

Secrets are encrypted at rest with `SETTINGS_ENCRYPTION_KEY` and never sent to
the browser; the UI only receives masked summaries and labels. If that key
changes, stored accounts must be re-imported. Rotation is manual only; a
failing account does not switch automatically.

### Keyword Planner identity

Search Console and Keyword Planner may belong to different Google users. By
default both use the live connection, but one stored account can be flagged
**Use for Ads** in the same card: Keyword Planner calls then mint their bearer
from that account's own client pair and refresh token, without touching the
Search Console connection. Use **Use live connection** to revert. If Ads calls
fail with "the caller does not have permission", the live Google user lacks
access to the Ads customer: either grant it in Google Ads (Account access) or
flag the account that has access.

### Troubleshooting

- Reconnect banner on the dashboard: the refresh token was revoked or expired;
  use **Update access**.
- `redirect_uri_mismatch`: add the exact callback URI to the OAuth client.
- Data ends 3 days ago by design; Search Console reporting lags.

## Keyword Planner (optional integration)

The keywords dashboard at `/admin/keywords` pulls keyword ideas, search volume,
competition, and bid ranges from the Google Ads Keyword Planner API. It reuses the
OAuth connection from the Search Console setup above: one consent requests
`webmasters.readonly` and `adwords` together.

### 1. Google Ads access

1. Request a **developer token** in the manager account (Tools, API Center).
   Keyword Planning requires **Basic access** or higher; a test account token
   returns no real metrics.
2. Note the **customer ID** (10 digits) of the account to read, and the manager
   account ID when that account sits under an MCC.

### 2. Environment variable

Add to Vercel (all environments) and to the local `.env`:

```
GOOGLE_ADS_DEVELOPER_TOKEN=...
```

Without it, `/admin/keywords` shows the "Keyword Planner is not configured"
notice and disables syncing and metric refreshes.

### 3. Configure and sync

1. Open `/admin/settings`, Keyword Planner card: customer ID, optional login
   customer ID (the MCC), geo target (`2840`, United States), language (`1000`,
   English), and network. Values are stored under the `keywords.planner` setting.
2. Open `/admin/keywords` and use **Sync ideas**. A sync makes at most three API
   calls and is refused within 30 seconds of the previous one.
3. When the connected Google account cannot reach the customer ID, the Google
   message is shown verbatim with a permission hint. A missing or wrong
   `login-customer-id` is the usual cause.

## Post-Deployment Checklist
- [ ] Database connected successfully
- [ ] Admin login works at `/auth/signin`
- [ ] Can create/edit/delete blog posts
- [ ] Image uploads work
- [ ] Blog posts display correctly
- [ ] Dark mode works properly
- [ ] Google Search Console connected at `/admin/settings` and dashboard data loads (optional)
- [ ] Keyword Planner configured at `/admin/settings` and a sync returns keyword ideas (optional)

## Troubleshooting

### Prisma Client Not Generated
Run: `npx prisma generate`

### Database Connection Issues
- Check `DATABASE_URL` format
- Ensure SSL mode is enabled
- Verify database is accessible

### Build Failures
- Check Vercel build logs
- Ensure all dependencies are in `package.json`
- Verify `postinstall` script runs

## Files Modified for Deployment
- `package.json` - Added postinstall script
- `vercel.json` - Build configuration
- `prisma/schema.prisma` - Database schema
