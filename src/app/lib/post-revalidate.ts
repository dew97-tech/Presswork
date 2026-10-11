import { revalidatePath } from "next/cache";

export function revalidatePostSurfaces(...slugs: string[]) {
  revalidatePath("/blog");
  revalidatePath("/blog/tag/[tag]", "page");
  revalidatePath("/admin");
  revalidatePath("/sitemap.xml");
  revalidatePath("/feed.xml");

  for (const slug of slugs) {
    if (slug) revalidatePath(`/blog/${slug}`);
  }
}
