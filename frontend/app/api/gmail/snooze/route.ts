import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/gmail/snooze
 * 
 * Snoozes the Gmail connection prompt for 14 days.
 * User won't be prompted again until the snooze expires.
 * The voice agent will also respect this snooze and not attempt Gmail tools.
 */
export async function POST() {
  try {
    // Authenticate via Supabase session
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Calculate snooze end date (14 days from now)
    const snoozeDays = 14;
    const snoozeUntil = new Date();
    snoozeUntil.setDate(snoozeUntil.getDate() + snoozeDays);

    // Update user profile with snooze timestamp
    const { error: updateError } = await supabase
      .from("user_profiles")
      .update({
        gmail_snoozed_until: snoozeUntil.toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("[gmail/snooze] Update error:", updateError);
      return NextResponse.json(
        { error: "Failed to snooze Gmail prompt" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      snoozed_until: snoozeUntil.toISOString(),
      message: `Gmail prompt snoozed for ${snoozeDays} days`,
    });
  } catch (error) {
    console.error("[gmail/snooze] Error:", error);
    return NextResponse.json(
      { error: "Failed to snooze Gmail prompt" },
      { status: 500 }
    );
  }
}
