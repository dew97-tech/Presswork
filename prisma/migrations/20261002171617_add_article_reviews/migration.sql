-- CreateTable
CREATE TABLE "ArticleReview" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "usedWebSearch" BOOLEAN NOT NULL DEFAULT false,
    "claims" JSONB,
    "findings" JSONB,
    "seoNotes" JSONB,
    "suggested" JSONB,
    "sources" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cost" DOUBLE PRECISION,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "ArticleReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArticleReview_postId_createdAt_idx" ON "ArticleReview"("postId", "createdAt" DESC);
