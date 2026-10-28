import { del, list } from "@vercel/blob";
import prisma from "@/app/lib/prisma";

const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;
const SWEEP_MAX_BLOBS = 500;
const SWEEP_MAX_DELETIONS = 20;

function getStoreHostname(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;

  const storeId = token.split("_")[3];
  if (!storeId) return null;

  return `${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
}

export function isOwnBlobUrl(url: string): boolean {
  const hostname = getStoreHostname();
  if (!hostname) return false;

  try {
    return new URL(url).hostname === hostname;
  } catch {
    return false;
  }
}

export async function deleteBlobIfUnused(
  url: string | null | undefined,
): Promise<boolean> {
  if (!url || !isOwnBlobUrl(url)) return false;

  const referenced = await prisma.post.count({ where: { thumbnail: url } });
  if (referenced > 0) return false;

  try {
    await del(url);
    return true;
  } catch (error) {
    console.error("Failed to delete blob:", error);
    return false;
  }
}

export async function sweepOrphanedBlobs(): Promise<number> {
  if (!getStoreHostname()) return 0;

  try {
    const { blobs } = await list({ limit: SWEEP_MAX_BLOBS });
    const cutoff = Date.now() - SWEEP_GRACE_MS;
    let deleted = 0;

    for (const blob of blobs) {
      if (deleted >= SWEEP_MAX_DELETIONS) break;
      if (blob.uploadedAt.getTime() > cutoff) continue;

      const referenced = await prisma.post.count({
        where: { thumbnail: blob.url },
      });
      if (referenced > 0) continue;

      try {
        await del(blob.url);
        deleted += 1;
      } catch (error) {
        console.error("Failed to delete orphaned blob:", blob.url, error);
      }
    }

    return deleted;
  } catch (error) {
    console.error("Blob sweep failed:", error);
    return 0;
  }
}
