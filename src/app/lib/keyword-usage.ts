import prisma from "@/app/lib/prisma";

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

export async function markKeywordsUsedForPost(postId: string): Promise<number> {
  try {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { keywords: true },
    });
    if (!post) return 0;

    const normalized = Array.from(
      new Set(post.keywords.map(normalizeKeyword).filter(Boolean)),
    );
    if (normalized.length === 0) return 0;

    const result = await prisma.keyword.updateMany({
      where: { keyword: { in: normalized }, status: { not: "used" } },
      data: { status: "used", postId, usedAt: new Date() },
    });

    return result.count;
  } catch (error) {
    console.warn("Keyword usage sync failed:", error);
    return 0;
  }
}

export async function resetKeywordsForPost(postId: string): Promise<number> {
  try {
    const result = await prisma.keyword.updateMany({
      where: { postId },
      data: { status: "new", postId: null, usedAt: null },
    });
    return result.count;
  } catch (error) {
    console.warn("Keyword usage reset failed:", error);
    return 0;
  }
}
