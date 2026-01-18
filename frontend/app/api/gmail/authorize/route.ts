import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import Arcade from "@arcadeai/arcadejs";
import { getArcadeApiKey, getArcadeBaseURL } from "../_arcadeEnv";

/**
 * POST /api/gmail/authorize
 * 
 * Initiates Gmail authorization via Arcade.
 * Returns the authorization URL if user needs to complete OAuth consent.
 * 
 * Uses Supabase user.id as Arcade user_id (same as voice agent).
 */
export async function POST() {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7d6d11e5-20a6-45a2-965b-f19d6ec42991',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'A',location:'frontend/app/api/gmail/authorize/route.ts:POST:entry',message:'Entered gmail authorize route',data:{nodeEnv:process.env.NODE_ENV,hasArcadeApiKey:!!process.env.ARCADE_API_KEY},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // Authenticate via Supabase session
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7d6d11e5-20a6-45a2-965b-f19d6ec42991',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'C',location:'frontend/app/api/gmail/authorize/route.ts:POST:auth',message:'Unauthorized (no supabase user)',data:{hasUser:!!user,hasAuthError:!!authError},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check for Arcade API key (server-only).
    // NOTE: We fallback-read `backend/.env.local` so the console works even if only the agent was configured.
    const arcadeApiKey = getArcadeApiKey();
    if (!arcadeApiKey) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7d6d11e5-20a6-45a2-965b-f19d6ec42991',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'C',location:'frontend/app/api/gmail/authorize/route.ts:POST:env',message:'Missing ARCADE_API_KEY in server env',data:{hasArcadeApiKey:false},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return NextResponse.json(
        { error: "Arcade not configured" },
        { status: 500 }
      );
    }

    // Arcade "Arcade.dev users only" verification expects the app's user_id to match
    // the signed-in Arcade account identity (typically email). Use email when available.
    // Fallback to user.id only if email is missing (rare).
    const arcadeUserId = user.email || user.id;

    // Initialize Arcade client
    console.log("[gmail/authorize] Initializing Arcade client for user:", arcadeUserId);
    const arcadeBaseURL = getArcadeBaseURL();
    // Arcade JS SDK defaults can drift; set baseURL explicitly to avoid 404s.
    const arcade = new Arcade({ apiKey: arcadeApiKey, baseURL: arcadeBaseURL });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7d6d11e5-20a6-45a2-965b-f19d6ec42991',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'A',location:'frontend/app/api/gmail/authorize/route.ts:POST:arcade-init',message:'Arcade client initialized',data:{toolName:'Gmail.ListEmails',userIdLen:String(arcadeUserId||'').length,toolsKeys:Object.keys((arcade as any).tools||{}),arcadeKeys:Object.keys(arcade as any)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // Request authorization for Gmail.ListEmails tool
    // This will return a URL if user needs to complete OAuth consent
    console.log("[gmail/authorize] Requesting authorization for Gmail.ListEmails");
    const authResponse = await arcade.tools.authorize({
      // NOTE: Arcade JS SDK expects snake_case keys (see @arcadeai/arcadejs types)
      tool_name: "Gmail.ListEmails",
      user_id: arcadeUserId,
    });

    // Arcade's API currently returns `url`/`id` (not `authorization_url`/`authorization_id`).
    // Keep compatibility with either shape so upgrades don't break Gmail auth.
    const responseAny: any = authResponse as any;
    const connectUrl =
      responseAny.url ||
      responseAny.authorization_url ||
      responseAny.authorizationUrl ||
      null;

    console.log("[gmail/authorize] Authorization response:", {
      status: responseAny.status,
      hasUrl: !!connectUrl,
      // Useful for debugging provider configuration; never log secrets.
      keys: Object.keys(responseAny || {}),
    });

    // If status is 'completed', user is already authorized
    if (authResponse.status === "completed") {
      // Clear any snooze since they're now connected
      await supabase
        .from("user_profiles")
        .update({
          gmail_snoozed_until: null,
          gmail_connected: true,
          gmail_token_status: "completed",
          gmail_last_checked_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      return NextResponse.json({
        status: "completed",
        url: null,
        message: "Gmail is already authorized",
      });
    }

    // Return the authorization URL for the user to complete OAuth
    return NextResponse.json({
      status: authResponse.status || "pending",
      // NOTE: Arcade returns `url` (current) or `authorization_url` (older/typed field).
      url: connectUrl,
      message: "Please complete Gmail authorization",
    });
  } catch (error) {
    // Log detailed error information
    console.error("[gmail/authorize] Error:", error);
    if (error instanceof Error) {
      console.error("[gmail/authorize] Error message:", error.message);
      console.error("[gmail/authorize] Error stack:", error.stack);
    }
    
    // #region agent log
    const errAny: any = error as any;
    fetch('http://127.0.0.1:7242/ingest/7d6d11e5-20a6-45a2-965b-f19d6ec42991',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'B',location:'frontend/app/api/gmail/authorize/route.ts:POST:catch',message:'Arcade authorize threw error',data:{name:errAny?.name,message:errAny?.message,status:errAny?.status,hasHeaders:!!errAny?.headers,errKeys:errAny?Object.keys(errAny):[],requestUrl:errAny?.url||errAny?.request?.url||errAny?.response?.url||null,code:errAny?.code||null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // Extract error details safely
    let errorMessage = "Unknown error";
    let errorDetails: any = null;
    
    if (error instanceof Error) {
      errorMessage = error.message || "Unknown error";
      errorDetails = {
        message: error.message,
        name: error.name,
        // Only include stack in development
        ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
      };
    } else if (typeof error === "string") {
      errorMessage = error;
    } else if (error && typeof error === "object") {
      // Try to extract useful info from error object
      errorMessage = (error as any).message || JSON.stringify(error);
      errorDetails = error;
    }
    
    // Always return a valid JSON response
    return NextResponse.json(
      { 
        error: "Failed to initiate Gmail authorization",
        message: errorMessage,
        details: errorDetails,
      },
      { status: 500 }
    );
  }
}
