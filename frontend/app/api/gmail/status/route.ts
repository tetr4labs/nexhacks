import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Arcade from "@arcadeai/arcadejs";
import { getArcadeApiKey, getArcadeBaseURL } from "../_arcadeEnv";

/**
 * GET /api/gmail/status
 * 
 * Returns the Gmail integration status for the authenticated user:
 * - connected: whether Gmail is authorized via Arcade
 * - token_status: Arcade token status ('not_started' | 'pending' | 'completed' | 'failed')
 * - snoozed_until: timestamp if user snoozed the Gmail prompt
 * 
 * Uses Arcade JS SDK to check authorization status for Gmail.ListEmails tool.
 * Scopes to Supabase user.id as the Arcade user_id (same as voice agent).
 */
export async function GET() {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7d6d11e5-20a6-45a2-965b-f19d6ec42991',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'A',location:'frontend/app/api/gmail/status/route.ts:GET:entry',message:'Entered gmail status route',data:{nodeEnv:process.env.NODE_ENV,hasArcadeApiKey:!!process.env.ARCADE_API_KEY},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // Authenticate via Supabase session
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check for Arcade API key (server-only).
    // NOTE: We fallback-read `backend/.env.local` so the console works even if only the agent was configured.
    const arcadeApiKey = getArcadeApiKey();
    if (!arcadeApiKey) {
      // If Arcade isn't configured, return a default "not configured" response
      return NextResponse.json({
        connected: false,
        token_status: null,
        authorization_status: null,
        snoozed_until: null,
        arcade_configured: false,
      });
    }

    // Fetch user profile to get snooze status
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("gmail_snoozed_until, gmail_connected, gmail_token_status, gmail_last_checked_at")
      .eq("id", user.id)
      .single();

    // Arcade "Arcade.dev users only" verification expects the app's user_id to match
    // the signed-in Arcade account identity (typically email). Use email when available.
    // Fallback to user.id only if email is missing (rare).
    const arcadeUserId = user.email || user.id;

    // Initialize Arcade client
    const arcadeBaseURL = getArcadeBaseURL();
    // Arcade JS SDK defaults can drift; set baseURL explicitly to avoid 404s.
    const arcade = new Arcade({ apiKey: arcadeApiKey, baseURL: arcadeBaseURL });

    // Check authorization status for a Gmail tool
    // We use Gmail.ListEmails as it's a read-only tool that requires Gmail auth
    let tokenStatus: string | null = null;
    let authorizationStatus: string | null = null;
    let connected = false;

    try {
      // Use authorize() to check current authorization status
      // This will return status "completed" if already authorized, or "pending" if not
      const authResponse = await arcade.tools.authorize({
        // NOTE: Arcade JS SDK expects snake_case keys (see @arcadeai/arcadejs types)
        tool_name: "Gmail.ListEmails",
        user_id: arcadeUserId,
      });

      // Extract authorization status from the response
      const responseAny: any = authResponse as any;
      authorizationStatus = responseAny.status || null;
      connected = responseAny.status === "completed";
      
      // Arcade JS SDK response doesn't expose tokenStatus; cache status as token_status.
      tokenStatus = responseAny.status ?? null;
    } catch (arcadeError) {
      // Log but don't fail - Arcade might be temporarily unavailable
      console.error("[gmail/status] Error checking Arcade auth:", arcadeError);
      // #region agent log
      const errAny: any = arcadeError as any;
      fetch('http://127.0.0.1:7242/ingest/7d6d11e5-20a6-45a2-965b-f19d6ec42991',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'B',location:'frontend/app/api/gmail/status/route.ts:GET:arcade-catch',message:'Arcade authorize threw in status route',data:{name:errAny?.name,message:errAny?.message,status:errAny?.status,errKeys:errAny?Object.keys(errAny):[],requestUrl:errAny?.url||errAny?.request?.url||errAny?.response?.url||null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }

    // Update cached status in user_profiles (fire-and-forget)
    supabase
      .from("user_profiles")
      .update({
        gmail_connected: connected,
        gmail_token_status: tokenStatus,
        gmail_last_checked_at: new Date().toISOString(),
      })
      .eq("id", user.id)
      .then(() => {})
      .catch((err) => console.error("[gmail/status] Failed to update cache:", err));

    // Check if snooze is active
    const snoozedUntil = profile?.gmail_snoozed_until || null;
    const isSnoozed = snoozedUntil && new Date(snoozedUntil) > new Date();

    return NextResponse.json({
      connected,
      token_status: tokenStatus,
      authorization_status: authorizationStatus,
      snoozed_until: snoozedUntil,
      is_snoozed: isSnoozed,
      arcade_configured: true,
    });
  } catch (error) {
    console.error("[gmail/status] Error:", error);
    return NextResponse.json(
      { error: "Failed to check Gmail status" },
      { status: 500 }
    );
  }
}
