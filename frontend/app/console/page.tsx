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

  // Fetch events for the selected day - events that start on this day
  const { data: events } = await supabase
    .from("events")
    .select("id, name, description, start, end")
    .eq("owner", user.id)
    .gte("start", startOfDay.toISOString())
    .lt("start", endOfDay.toISOString())
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
