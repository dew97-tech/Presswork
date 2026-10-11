import { auth } from "@/auth";
import {
  exchangeCodeForTokens,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  storeConnection,
} from "@/app/lib/google/oauth";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/auth/signin", request.url));
  }

  const finish = (status: "connected" | "error", reason?: string) => {
    const settingsUrl = new URL("/admin/settings", request.url);
    settingsUrl.searchParams.set("google", status);
    if (reason) settingsUrl.searchParams.set("reason", reason);

    const response = NextResponse.redirect(settingsUrl);
    response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/" });
    response.cookies.delete({ name: OAUTH_VERIFIER_COOKIE, path: "/" });
    return response;
  };

  const params = request.nextUrl.searchParams;

  const googleError = params.get("error");
  if (googleError) {
    return finish("error", googleError === "access_denied" ? "denied" : "google");
  }

  const code = params.get("code");
  const state = params.get("state");
  const cookieState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;

  if (!code || !state || !cookieState || !verifier || state !== cookieState) {
    return finish("error", "state");
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: verifier,
      redirectUri: new URL("/api/google/oauth/callback", request.url).toString(),
    });
    await storeConnection(tokens);
    return finish("connected");
  } catch (error) {
    console.error(
      "Google OAuth callback failed:",
      error instanceof Error ? error.message : error,
    );
    return finish("error", "exchange");
  }
}
