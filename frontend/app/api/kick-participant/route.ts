import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { RoomServiceClient } from "livekit-server-sdk";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const livekitUrl = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!livekitUrl || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "LiveKit credentials not configured" },
        { status: 500 },
      );
    }

    const body = await request.json();
    const { room, identity } = body;

    if (!room || !identity) {
      return NextResponse.json(
        { error: "Missing room or identity" },
        { status: 400 },
      );
    }

    const roomService = new RoomServiceClient(livekitUrl, apiKey, apiSecret);

    console.log(`[Kick] Removing participant ${identity} from room ${room}`);
    await roomService.removeParticipant(room, identity);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing participant:", error);
    return NextResponse.json(
      { error: "Failed to remove participant" },
      { status: 500 },
    );
  }
}
