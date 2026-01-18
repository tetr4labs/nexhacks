import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";

/**
 * API route to manually trigger the LiveKit agent to join a room.
 * This creates a job that the agent worker will pick up.
 *
 * Required environment variables:
 * - LIVEKIT_URL: Your LiveKit server URL
 * - LIVEKIT_API_KEY: Your LiveKit API key
 * - LIVEKIT_API_SECRET: Your LiveKit API secret
 *
 * POST /api/trigger-agent
 * Body: { room: string }
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get LiveKit credentials
    const livekitUrl = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!livekitUrl || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "LiveKit credentials not configured" },
        { status: 500 },
      );
    }

    // Get room name from request body
    const body = await request.json().catch(() => ({}));
    const roomName = body.room || `room-${user.id}`;

    // Create RoomServiceClient to interact with LiveKit
    const roomService = new RoomServiceClient(livekitUrl, apiKey, apiSecret);
    const agentClient = new AgentDispatchClient(livekitUrl, apiKey, apiSecret);

    // Create a room if it doesn't exist
    try {
      await roomService.createRoom({
        name: roomName,
        emptyTimeout: 300, // 5 minutes
        maxParticipants: 10,
      });
    } catch (err: any) {
      // Room might already exist, that's okay
      if (!err.message?.includes("already exists")) {
        console.error("Error creating room:", err);
      }
    }

    // Explicitly dispatch the agent "tetra" to the room
    try {
      console.log(`Dispatching agent "tetra" to room "${roomName}"...`);
      const dispatch = await agentClient.createDispatch(roomName, "tetra");
      console.log("Agent dispatched:", dispatch);
    } catch (err) {
      console.error("Error dispatching agent:", err);
      // We don't fail the request here because implicit dispatch might still work
      // or the agent might already be there.
    }

    return NextResponse.json({
      success: true,
      room: roomName,
      message: "Agent dispatched to join the room",
    });
  } catch (error) {
    console.error("Error triggering agent:", error);
    return NextResponse.json(
      { error: "Failed to trigger agent" },
      { status: 500 },
    );
  }
}
