import { NextRequest, NextResponse } from "next/server";
import {
  anthropicConfigured,
  extractProfileFromScreenshot,
  SCREENSHOT_MEDIA_TYPES,
  type ScreenshotMediaType,
} from "@/lib/anthropic";
import { buildReviewModel, field, type ExtractedProfile } from "@/lib/screenshot";
import { DEFAULT_RELATIONSHIP_TIER } from "@/lib/relationship";
import { getEnv } from "@/lib/env";

/**
 * Extract a REVIEWABLE profile from an uploaded screenshot. This NEVER writes to
 * the database, never creates a creator, and never infers outreach/replies — it
 * only suggests field values for the confirmation screen. In demo mode (MOCK or
 * Anthropic unconfigured) it returns an empty, all-null profile so the operator
 * can fill fields manually rather than seeing a fake value.
 */
function emptyProfile(): ExtractedProfile {
  const none = () => field<never>(null, 0);
  return {
    handle: none(),
    platform: none(),
    displayName: none(),
    email: none(),
    followerCount: none(),
    bio: none(),
    profileUrl: none(),
  };
}

function isMock(): boolean {
  try {
    return getEnv().MOCK === "1";
  } catch {
    return true;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64.replace(/^data:[^;]+;base64,/, "") : "";
  const mediaType = body.mediaType as ScreenshotMediaType | undefined;

  const demo = isMock() || !anthropicConfigured();
  if (demo) {
    const profile = emptyProfile();
    return NextResponse.json({
      demo: true,
      message: "Vision extraction is not live — fill the fields from the screenshot manually, then review.",
      profile,
      review: buildReviewModel(profile, DEFAULT_RELATIONSHIP_TIER),
    });
  }

  if (!imageBase64) return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
  if (!mediaType || !SCREENSHOT_MEDIA_TYPES.includes(mediaType))
    return NextResponse.json({ error: `mediaType must be one of ${SCREENSHOT_MEDIA_TYPES.join(", ")}` }, { status: 400 });

  try {
    const profile = await extractProfileFromScreenshot(imageBase64, mediaType);
    return NextResponse.json({
      demo: false,
      profile,
      review: buildReviewModel(profile, DEFAULT_RELATIONSHIP_TIER),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Extraction failed." }, { status: 502 });
  }
}
