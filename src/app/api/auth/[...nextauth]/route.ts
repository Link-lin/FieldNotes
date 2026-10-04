import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { appleReturn } from "@/server/auth/apple-return";
import { handlers } from "@/server/auth/auth";

export const { GET } = handlers;

/** Apple's callback is a cross-site POST that `appleReturn` carries back to the app first; everything else is Auth.js's. */
export async function POST(request: NextRequest) {
  return (await appleReturn(request, (await headers()).get("x-nonce"))) ?? handlers.POST(request);
}
