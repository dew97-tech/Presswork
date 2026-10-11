import { auth } from "@/auth";
import { isEncryptionConfigured } from "@/app/lib/crypto";
import {
  buildAuthUrl,
  challengeFor,
  generateOAuthState,
  generateOAuthVerifier,
  isOAuthConfigured,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
} from "@/app/lib/google/oauth";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/auth/signin", request.url));
  }

  const settingsUrl = new URL("/admin/settings", request.url);

  if (!isEncryptionConfigured()) {
    settingsUrl.searchParams.set("google", "error");
    settingsUrl.searchParams.set("reason", "encryption");
    return NextResponse.redirect(settingsUrl);
  }

  if (!(await isOAuthConfigured())) {
    settingsUrl.searchParams.set("google", "error");
    settingsUrl.searchParams.set("reason", "config");
    return NextResponse.redirect(settingsUrl);
  }

  const state = generateOAuthState();
  const verifier = generateOAuthVerifier();

  const authUrl = await buildAuthUrl({
    state,
    codeChallenge: challengeFor(verifier),
    redirectUri: new URL("/api/google/oauth/callback", request.url).toString(),
  });

  const response = NextResponse.redirect(authUrl);
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  };

  response.cookies.set(OAUTH_STATE_COOKIE, state, cookieOptions);
  response.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, cookieOptions);

  return response;
}
