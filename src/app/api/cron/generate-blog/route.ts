import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runBlogGeneration } from "@/app/lib/ai/generate-blog";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization");
  if (!authorization || !safeEqual(authorization, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = request.nextUrl.searchParams.get("force") === "1";

  try {
    const result = await runBlogGeneration({ force });

    if (result.status === "skipped" && result.reason === "already_running") {
      return NextResponse.json(result, { status: 409 });
    }

    return NextResponse.json(
      { ...result, ...(force && { forced: true }) },
      { status: result.status === "failed" ? 500 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cron error";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
