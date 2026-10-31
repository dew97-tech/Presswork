import prisma from "@/app/lib/prisma";
import {
  clearLoginFailures,
  loginAttemptKey,
  loginBlockedUntil,
  registerLoginFailure,
} from "@/app/lib/login-guard";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";

async function getUser(email: string) {
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    return user;
  } catch (error) {
    console.error("Failed to fetch user:", error);
    throw new Error("Failed to fetch user.");
  }
}

async function bootstrapAdmin(email: string, password: string) {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.error(
      "Refusing to bootstrap an admin: ADMIN_EMAIL and ADMIN_PASSWORD must both be set.",
    );
    return null;
  }

  if (email !== adminEmail || password !== adminPassword) {
    console.error("Rejected an admin bootstrap attempt from a non-matching email.");
    return null;
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  return prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name: "Admin",
    },
  });
}

export const { auth, signIn, signOut, handlers: { GET, POST } } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);

        if (!parsedCredentials.success) {
          return null;
        }

        const { email, password } = parsedCredentials.data;
        const key = await loginAttemptKey(email);

        if (await loginBlockedUntil(key)) {
          return null;
        }

        const userCount = await prisma.user.count();

        if (userCount === 0) {
          const admin = await bootstrapAdmin(email, password);
          if (!admin) {
            await registerLoginFailure(key);
            return null;
          }

          await clearLoginFailures(key);
          return admin;
        }

        const user = await getUser(email);
        if (!user?.password) {
          await registerLoginFailure(key);
          return null;
        }

        const passwordsMatch = await bcrypt.compare(password, user.password);
        if (!passwordsMatch) {
          await registerLoginFailure(key);
          return null;
        }

        await clearLoginFailures(key);
        return user;
      },
    }),
  ],
});
