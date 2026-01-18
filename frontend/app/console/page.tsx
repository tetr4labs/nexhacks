import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ConsoleClient from "./ConsoleClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Type definitions for database entities
interface Event {
  id: number;
  name: string | null;
  description: string | null;
  start: string | null;
  end: string | null;
}

interface Task {
  id: number;
  name: string | null;
  description: string | null;
  due: string | null;
  done: boolean | null;
}

/**
 * Helper: Convert a Date to a "YYYY-MM-DD" string for URL params / comparisons.
 */
function toDayString(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Helper: Parse a "YYYY-MM-DD" day param from the URL, return null if invalid.
 */
function parseDayParam(day?: string) {
  if (!day) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Console Dashboard Page (Server Component)
 * 
 * This is the main user dashboard. It remains a Server Component to:
 * - Handle authentication via Supabase (redirects to /auth if not logged in)
 * - Fetch events and tasks from the database
 * - Pass the fetched data to the client component (ConsoleClient) for rendering
 * 
 * All interactive UI (voice connection, transcript, layout toggling) is handled
 * by ConsoleClient, which is a "use client" component.
 */
export default async function ConsolePage({
  searchParams,
}: {
  searchParams?: { day?: string };
}) {
  // Create Supabase client for server-side operations
  const supabase = await createClient();

  // Check authentication status
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // Redirect to auth page if not authenticated
  if (authError || !user) {
    redirect("/auth");
  }

  // Next.js may provide `searchParams` as a plain object or a Promise (version-dependent).
  // `Promise.resolve` safely normalizes both cases so day navigation via `?day=` works reliably.
  const resolvedSearchParams = await Promise.resolve(searchParams);

  // Get start and end of selected day in UTC for querying
  const today = new Date();
  const selectedDay = parseDayParam(resolvedSearchParams?.day) || today;
  const selectedDayString = toDayString(selectedDay);
  const startOfDay = new Date(selectedDay);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(selectedDay);
  endOfDay.setHours(23, 59, 59, 999);
  const isToday = toDayString(today) === selectedDayString;

  // Fetch user profile for timezone and preferences
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("handle, timezone, working_hours_start, working_hours_end")
    .eq("id", user.id)
    .single();

  // Determine timezone-aware start/end of day
  // If no timezone is set, we fallback to UTC/Server time, but ideally we should use the user's preference.
  // Note: We need to manipulate strings because JS Date is messy with timezones on the server.
  // Ideally, use a library like date-fns-tz or luxon, but standard JS is requested.
  // We'll calculate the offsets manually or use the simple "naive" approach if assuming inputs are YYYY-MM-DD in user time.
  
  // Actually, to correctly filter events stored in UTC that correspond to "2026-01-18" in "America/New_York",
  // we need to know the UTC range corresponding to that local day.
  // e.g. 2026-01-18 00:00 EST -> 2026-01-18 05:00 UTC
  //      2026-01-18 23:59 EST -> 2026-01-19 04:59 UTC
  
  // Since we don't have a timezone library handy in this file easily without installing one, 
  // and we want to keep it simple:
  // We will assume `selectedDay` (parsed from YYYY-MM-DD) represents the Local Midnight.
  
  // A robust way without libraries in Node 16+ is using Intl.DateTimeFormat
  const userTimezone = profile?.timezone || "America/New_York";
  
  // Create a date object that represents the start of the day in the user's timezone
  // We do this by creating a UTC date, then formatting it to parts in the user timezone, 
  // calculating the shift, and adjusting.
  // OR simpler: Query a wider range and filter in memory? No, pagination/performance.
  
  // Let's use a simpler heuristic for now: 
  // 1. Construct the naive string "YYYY-MM-DDT00:00:00"
  // 2. Append the likely offset? No, offsets change (DST).
  
  // Let's try to stick to UTC if possible or use a simplified offset if we know it.
  // Given we are in a hackathon context:
  // We will simply expand the search range by +/- 24 hours to catch everything, 
  // then let the Client Component (which has browser timezone smarts) or the Server filter strictly.
  // But wait, we render server side.
  
  // Let's rely on the fact that `selectedDay` is `new Date(YYYY-MM-DD)` which is UTC midnight if parsed as ISO.
  // If the user is EST (UTC-5), their day starts at 05:00 UTC.
  // If we query `gte startOfDay` (00:00 UTC), we get events from 19:00 Previous Day EST.
  // This is "safe" (over-fetching).
  // The `ConsoleClient` needs to filter/display correctly.
  
  // HOWEVER, the user complaint is about consistency.
  // Let's try to be precise if possible.
  // We will use the `ConsoleClient` to do the precise rendering, but we must ensure we fetch enough data.
  // The current `startOfDay` and `endOfDay` are UTC midnights.
  // For EST (UTC-5), we need 05:00 UTC to 05:00 UTC+1.
  // Current fetch: 00:00 UTC to 23:59 UTC.
  // We miss the evening events (00:00 UTC to 05:00 UTC next day)!
  
  // FIX: Extend the query range to cover all possible timezones (UTC-12 to UTC+14).
  // We'll fetch from `selectedDay - 1 day` to `selectedDay + 2 days` to be safe,
  // OR just `startOfDay` (UTC) to `endOfDay + 24 hours`.
  
  const queryStart = new Date(startOfDay);
  // Go back 14 hours to cover furthest west (UTC-12 approx)
  queryStart.setHours(queryStart.getHours() - 14);
  
  const queryEnd = new Date(endOfDay);
  // Go forward 14 hours to cover furthest east (UTC+14)
  queryEnd.setHours(queryEnd.getHours() + 14);

  // Fetch events for the selected day - events that start on this day
  const { data: events } = await supabase
    .from("events")
    .select("id, name, description, start, end")
    .eq("owner", user.id)
    .gte("start", queryStart.toISOString())
    .lt("start", queryEnd.toISOString())
    .order("start", { ascending: true });

  // Fetch selected day tasks for this user (due that day or no due date)
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, name, description, due, done")
    .eq("owner", user.id)
    .or(`due.gte.${startOfDay.toISOString()},due.is.null`)
    .order("due", { ascending: true, nullsFirst: false });

  // Filter tasks to only include those due that day or with no due date
  const dayTasks = (tasks || []).filter((task: Task) => {
    if (!task.due) return true; // Include tasks with no due date
    const dueDate = new Date(task.due);
    return dueDate <= endOfDay;
  });

  // User display name (handle or email fallback)
  const userHandle = profile?.handle || user.email?.split("@")[0] || "User";

  // Render the client component with all the fetched data
  // The client component handles all interactive UI (voice, transcript, layout)
  return (
    <ConsoleClient
      userHandle={userHandle}
      selectedDayString={selectedDayString}
      selectedDay={selectedDay}
      isToday={isToday}
      events={(events as Event[]) || []}
      dayTasks={dayTasks}
      profileTimezone={profile?.timezone}
    />
  );
}
