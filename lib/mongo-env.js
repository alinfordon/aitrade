import { NextResponse } from "next/server";

/**
 * Next.js loads `.env.local` automatically (not `.env.example`).
 * Call at the start of API routes that need MongoDB.
 */
export function respondIfMongoMissing() {
  if (process.env.MONGODB_URI?.trim()) {
    return null;
  }
  return NextResponse.json(
    {
      error:
        "MONGODB_URI is not set. Create a file named `.env.local` in the project root (next to package.json), add MONGODB_URI=… (see .env.example), then restart `npm run dev`.",
    },
    { status: 503 }
  );
}
