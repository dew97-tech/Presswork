import prisma from "@/app/lib/prisma";
import { getSiteUrl } from "@/app/lib/site";
import { caseStudies } from "@/data/case-studies";
import { resumeData } from "@/data/resume";

export async function buildLlmsTxt(): Promise<string> {
  const siteUrl = getSiteUrl();
  const { personal } = resumeData;

  let postLines = "";
  try {
    const posts = await prisma.post.findMany({
      where: { published: true },
      orderBy: [
        { publishedAt: { sort: "desc", nulls: "last" } },
        { date: "desc" },
      ],
      take: 20,
      select: { slug: true, title: true, description: true },
    });

    postLines = posts
      .map(
        (post) =>
          `- [${post.title}](${siteUrl}/blog/${post.slug}): ${post.description}`,
      )
      .join("\n");
  } catch (error) {
    console.error("llms.txt: failed to load posts", error);
  }

  const caseStudyLines = caseStudies
    .map(
      (caseStudy) =>
        `- [${caseStudy.title} case study](${siteUrl}${caseStudy.href}): ${caseStudy.description}`,
    )
    .join("\n");

  const lines = [
    `# ${personal.name}`,
    "",
    `> ${personal.role} at ${personal.company}. Based in ${personal.location}.`,
    "",
    `This site is a personal engineering portfolio. Content may be read, quoted, and cited with attribution to ${personal.name} and a link to the source URL. AI crawlers are welcome; see ${siteUrl}/robots.txt.`,
    "",
    "## Pages",
    `- [Portfolio home](${siteUrl}): experience, selected projects, skills, publications, contact.`,
    `- [Blog](${siteUrl}/blog): technical articles on Laravel, PHP, Next.js, databases, caching, queues, and testing.`,
    caseStudyLines,
    "",
    "## Recent posts",
    postLines || "No published posts yet.",
    "",
    "## Feeds",
    `- [RSS feed](${siteUrl}/feed.xml)`,
    `- [Sitemap](${siteUrl}/sitemap.xml)`,
    "",
    "## Contact",
    `- Email: ${personal.email}`,
    `- GitHub: ${personal.github}`,
    `- LinkedIn: ${personal.linkedin}`,
    "",
  ];

  return lines.join("\n");
}
