import { isAiConfigured } from "@/app/lib/ai/availability";
import { MAX_AUTO_DRAFTS } from "@/app/lib/ai/constants";
import prisma from "@/app/lib/prisma";
import AdminPostsManager from "@/app/ui/admin-posts-manager";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function AdminPage() {
  const posts = await prisma.post.findMany({
    orderBy: { date: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      published: true,
      date: true,
      readTime: true,
      tags: true,
      thumbnail: true,
      source: true,
      aiModel: true,
      topic: true,
      keywords: true,
    },
  });

  return (
    <div className="w-full">
      <AdminPostsManager
        maxAutoDrafts={MAX_AUTO_DRAFTS}
        aiConfigured={isAiConfigured()}
        initialPosts={posts.map((p) => ({
          id: p.id,
          slug: p.slug,
          title: p.title,
          description: p.description,
          published: p.published,
          date: p.date.toISOString(),
          readTime: p.readTime,
          tags: p.tags,
          thumbnail: p.thumbnail,
          source: p.source,
          aiModel: p.aiModel,
          topic: p.topic,
          keywords: p.keywords,
        }))}
      />
    </div>
  );
}
