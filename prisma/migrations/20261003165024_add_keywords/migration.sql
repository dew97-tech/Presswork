-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "geo" TEXT NOT NULL DEFAULT '2840',
    "language" TEXT NOT NULL DEFAULT '1000',
    "avgMonthlySearches" INTEGER,
    "competition" TEXT,
    "competitionIndex" INTEGER,
    "lowTopOfPageBidMicros" INTEGER,
    "highTopOfPageBidMicros" INTEGER,
    "monthlyVolumes" JSONB,
    "source" TEXT NOT NULL DEFAULT 'keyword_planner',
    "status" TEXT NOT NULL DEFAULT 'new',
    "postId" TEXT,
    "usedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_keyword_key" ON "Keyword"("keyword");

-- CreateIndex
CREATE INDEX "Keyword_status_idx" ON "Keyword"("status");

-- CreateIndex
CREATE INDEX "Keyword_avgMonthlySearches_idx" ON "Keyword"("avgMonthlySearches" DESC);
