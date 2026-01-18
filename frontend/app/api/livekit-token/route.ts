import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { createClient } from "@/lib/supabase/server";

/**
 * API route to generate LiveKit access tokens for authenticated users.
 * * Required environment variables:
 * - LIVEKIT_URL: Your LiveKit server URL
 * - LIVEKIT_API_KEY: Your LiveKit API key
 * - LIVEKIT_API_SECRET: Your LiveKit API secret
 * * GET /api/livekit-token?room=<room_name>
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Validate user securely
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get session for access token
    // const {
    //   data: { session },
    // } = await supabase.auth.getSession();

    // Get LiveKit credentials from environment
    const livekitUrl = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!livekitUrl || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "LiveKit credentials not configured" },
        { status: 500 },
      );
    }

    // Get room name from query params (default to user ID)
    const { searchParams } = new URL(request.url);
    const roomName = searchParams.get("room") || `room-${user.id}`;
    const participantName = user.email?.split("@")[0] || `user-${user.id}`;

    console.log("Generating token for user:", user.id);
    console.log("Room:", roomName);

    // Create access token
    const token = new AccessToken(apiKey, apiSecret, {
      identity: user.id,
      name: participantName,
      // metadata: JSON.stringify({
      //   supabase_token: session?.access_token || "",
      // }),
    });

    // Explicitly set identity to ensure it's in the JWT
    token.identity = user.id;

    // Grant permissions
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: true,
    });

    // Generate token string
    const tokenString = await token.toJwt();

    return NextResponse.json({
      token: tokenString,
      url: livekitUrl,
      room: roomName,
    });
  } catch (error) {
    console.error("Error generating LiveKit token:", error);
    return NextResponse.json(
      { error: "Failed to generate token" },
      { status: 500 },
    );
  }
}
