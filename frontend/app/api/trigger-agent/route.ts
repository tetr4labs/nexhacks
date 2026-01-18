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

    // Explicitly dispatch the agent "Tetra" to the room (must match agent_name in agent.py)
    try {
      console.log("=".repeat(60));
      console.log(`[Trigger Agent] Dispatching agent "Tetra" to room "${roomName}"...`);
      console.log(`[Trigger Agent] LiveKit URL: ${livekitUrl}`);
      console.log(`[Trigger Agent] API Key present: ${!!apiKey}`);
      console.log(`[Trigger Agent] API Secret present: ${!!apiSecret}`);
      
      const dispatch = await agentClient.createDispatch(roomName, "Tetra");
      console.log("[Trigger Agent] Agent dispatch successful!");
      console.log("[Trigger Agent] Dispatch details:", JSON.stringify(dispatch, null, 2));
      console.log("=".repeat(60));
    } catch (err: any) {
      console.error("=".repeat(60));
      console.error("[Trigger Agent] ERROR dispatching agent:");
      console.error("[Trigger Agent] Error message:", err?.message);
      console.error("[Trigger Agent] Error stack:", err?.stack);
      console.error("[Trigger Agent] Full error:", err);
      console.error("=".repeat(60));
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
