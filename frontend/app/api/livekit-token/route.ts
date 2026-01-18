import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { createClient } from '@/lib/supabase/server';

/**
 * API route to generate LiveKit access tokens for authenticated users.
 * 
 * Required environment variables:
 * - LIVEKIT_URL: Your LiveKit server URL
 * - LIVEKIT_API_KEY: Your LiveKit API key
 * - LIVEKIT_API_SECRET: Your LiveKit API secret
 * 
 * GET /api/livekit-token?room=<room_name>
 */
export async function GET(request: NextRequest) {
  try {
    // Get authenticated user (auth check handled by middleware)
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Safety check (should never happen due to middleware, but TypeScript needs it)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get LiveKit credentials from environment
    const livekitUrl = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!livekitUrl || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'LiveKit credentials not configured' },
        { status: 500 }
      );
    }

    // Get room name from query params (default to user ID)
    const { searchParams } = new URL(request.url);
    const roomName = searchParams.get('room') || `room-${user.id}`;
    const participantName = user.email?.split('@')[0] || `user-${user.id}`;

    console.log("Generating token for user:", user.id);
    console.log("Room:", roomName);

    // Create access token
    const token = new AccessToken(apiKey, apiSecret, {
      identity: user.id,
      name: participantName,
    });

    // Grant permissions
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    // Generate token string
    const tokenString = await token.toJwt();

    return NextResponse.json({
      token: tokenString,
      url: livekitUrl,
      room: roomName,
    });
  } catch (error) {
    console.error('Error generating LiveKit token:', error);
    return NextResponse.json(
      { error: 'Failed to generate token' },
      { status: 500 }
    );
  }
}
