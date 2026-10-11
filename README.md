# Presswork

A portfolio site that runs its own blog pipeline. It drafts articles with selectable AI models, checks them for accuracy, researches keywords, and measures what ranks, all from an admin dashboard wired to live Google data.

**Live:** [davidmallick.dev](https://davidmallick.dev) · **License:** MIT, see [LICENSE](./LICENSE)

## Intention

Publishing regularly is easy. Publishing accurately is not. This project automates the draft but keeps verification human: every article is reviewed claim by claim before it ships, and Search Console data decides what to write next instead of guesswork. It is built to be forked. Strip the personal content and the same pipeline runs any blog.

## What you get

**If you write content**, at `/admin`:

- New post editor with rich text, cover image upload, and image-prompt generation.
- Article review: AI checks accuracy with web search, you apply fixes per field. Nothing changes until you approve it.
- Keywords page (`/admin/keywords`): real search volume, competition, and bid ranges from Google Ads. Pick a keyword, generate a draft from it, and the row tracks whether it is written.
- Search Console dashboard (`/admin/search-console`): clicks, impressions, CTR, and position with compare mode, index status per post, and AI analysis with priorities and quick wins.
- Settings (`/admin/settings`) and Prompts (`/admin/prompts`): change AI models and rewrite the generation, review, and analysis prompts without touching code.

**If you build software**, in the code:

- Next.js 16 App Router with React 19, TypeScript 5, Tailwind CSS v4, Prisma 5 on Supabase Postgres.
- One `callModel` facade over three AI endpoint families (chat, responses, messages), so every catalog model is selectable.
- Typed settings store with zod validation, AES-256-GCM encryption for stored tokens, and additive-only migrations that are safe to deploy against a shared database.
- Google OAuth with PKCE and refresh-token rotation, Search Console and Keyword Planner REST clients with typed errors, Auth.js credentials auth, Vercel Blob uploads, and a cron-driven generation pipeline.

**If you own the site**: the dashboard answers what to write next from your own search data, with no SEO tool subscription for the basics.

## Reuse

MIT licensed. Use it as a portfolio, a blog engine, an AI writing pipeline, or a Search Console plus Keyword Planner admin. Forks commonly keep `src/app/lib`, `src/app/admin`, and `prisma/` and replace `src/data` and `src/components` with their own content.

## Setup

Requires Node.js 20.9 or newer, a PostgreSQL database, and optionally a Google Cloud project.

```bash
git clone https://github.com/dew97-tech/Presswork.git
cd Presswork
npm install
cp .env.example .env
```

Fill in `.env` (table below), then migrate and run:

```bash
npx prisma migrate deploy
npm run dev
```

Open http://localhost:3000. There is no default account. While the user table is empty, the first sign-in creates the admin only when the credentials match `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Clear `ADMIN_PASSWORD` afterwards.

Then, in `/admin/settings`: choose AI models, connect the Google account, pick the Search Console property, and add the Keyword Planner customer ID.

## Environment variables

| Variable | Needed for | Without it |
| --- | --- | --- |
| `DATABASE_URL` | Runtime database access (pooler, port 6543) | Nothing runs |
| `DIRECT_URL` | Prisma CLI migrations (port 5432) | Cannot migrate |
| `AUTH_SECRET` | Session signing | Sign-in fails |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First-admin bootstrap | No admin can be created |
| `NEXT_PUBLIC_SITE_URL` | Canonical URL, no trailing slash | Wrong canonical links |
| `BLOB_READ_WRITE_TOKEN` | Cover image uploads | Uploads fail, URL paste still works |
| `OPENCODE_GO_API_KEY` | All AI calls | No generation, review, prompts, or analysis |
| `CRON_SECRET` | Protects the daily generation endpoint | Endpoint rejects requests |
| `SETTINGS_ENCRYPTION_KEY` | Decrypts stored Google tokens | Google connection unusable |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google sign-in for Search Console and Ads | Cannot connect Google |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Keyword Planner metrics | Keyword sync and refresh fail |
| `GSC_PROPERTY` | Default Search Console property | Property picker starts empty |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` | Search demand fallback for generation | Generation runs without demand data |
| `WEB_SEARCH_PROVIDER`, `WEB_SEARCH_API_KEY` | Web verification for reviews | Claims stay unverifiable |

`DEPLOYMENT.md` covers where each Google value comes from and the production procedure.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check without emitting |
| `npm run check:dashes` | Fails on em or en dashes in source |
| `npm run og` | Regenerates the Open Graph image |

## Structure

```
src/
  app/
    (site)/       Public pages: home, blog, case studies
    admin/        Dashboard, editor, keywords, Search Console, settings, prompts
    api/          Auth, upload, cron, and Google OAuth routes
    lib/          AI pipeline, prompts, Google clients, server actions
    ui/           Client components for blog and admin
  components/     Portfolio sections
  data/           Typed resume and case study content (replace on fork)
prisma/           Schema and migrations
scripts/          Maintenance scripts
```

## Docs

| Document | Contents |
| --- | --- |
| `DEPLOYMENT.md` | Production deploy, Google setup, troubleshooting |
| `DESIGN.md` | Design system: palette, typography, shape, copy rules |
| `LICENSE` | MIT License |
