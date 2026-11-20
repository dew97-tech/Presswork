-- Supabase exposes the public schema through its Data API (PostgREST) to the
-- anon and authenticated roles. This app never uses that API: Prisma connects
-- as the table owner, which bypasses RLS. Enabling RLS with no policies denies
-- every Data API role while leaving Prisma's access unchanged.

ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ArticleReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GenerationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GoogleConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Keyword" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoginAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Post" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VerificationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
