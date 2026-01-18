import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import ImportButton from "./ImportButton";
import EventCard from "./EventCard";
import DayNavigator from "./DayNavigator";
import TimezoneDisplay from "./TimezoneDisplay";

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

interface UserProfile {
  handle: string | null;
  timezone: string;
  working_hours_start: string;
  working_hours_end: string;
}

function toDayString(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDayParam(day?: string) {
  if (!day) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Console Dashboard Page (Server Component)
 * Main user dashboard displaying selected day events and tasks.
 * Protected route - redirects to /auth if not authenticated.
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
  // Note: This is a server component, so it will re-render when searchParams.day changes
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

  // Use `h-screen` so the page itself doesn't become scrollable; internal panels own scrolling.
  return (
    <div className="relative h-screen bg-black cyber-grid overflow-hidden">
      {/* High contrast grid overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-30">
        <div className="absolute inset-0" style={{
          backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.1) 39px, rgba(255,255,255,0.1) 40px),
                           repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(255,255,255,0.1) 39px, rgba(255,255,255,0.1) 40px)`
        }} />
      </div>

      {/* Main content */}
      {/* `min-h-0` is important so children can shrink and their internal scroll areas work. */}
      <div className="relative z-10 flex flex-col h-full min-h-0">
        {/* Header - angular borders */}
        {/* Extra bottom padding keeps the centered "Talk to Tetra" CTA from feeling cramped */}
        <header className="flex items-center justify-between px-6 pt-4 pb-8 md:px-12 md:pt-6 md:pb-10 border-b-2 border-white">
          {/* Logo and branding */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 relative border-2 border-white">
              <Image
                src="/tetra.png"
                alt="Tetra Logo"
                width={40}
                height={40}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-lg font-bold text-white tracking-[0.2em] uppercase">
                TETRA OS
              </span>
              <span className="font-mono text-xs text-white opacity-60">
                v0.1.0 // {userHandle}
              </span>
            </div>
          </div>

          {/* Center: Talk to Tetra button with special color */}
          <Link
            href="/talk"
            className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 group pt-12 pb-4"
            style={{ color: 'rgb(253, 247, 228)' }}
          >
            <div className="w-12 h-12 relative group-hover:scale-110 transition-transform duration-300">
              <TetrahedronIcon />
            </div>
            <span className="font-mono text-xs uppercase tracking-[0.2em] opacity-90 group-hover:opacity-100 transition-opacity">
              Talk to Tetra
            </span>
          </Link>

          {/* Right: Import button with modal */}
          <div className="flex items-center gap-3">
            <ImportButton />
          </div>
        </header>

        {/* Status bar - high contrast */}
        <div className="px-6 py-3 md:px-12 border-b-2 border-white bg-black">
          <div className="flex items-center gap-4 text-xs font-mono text-white">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 bg-white" />
              SYSTEM ONLINE
            </span>
            <span className="opacity-50">|</span>
            <span className="uppercase tracking-wider">
              {selectedDay.toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              }).toUpperCase()}
            </span>
            <span className="opacity-50">|</span>
            <span className="opacity-80">
              {events?.length || 0} EVENTS • {dayTasks.length} TASKS
            </span>
          </div>
        </div>

        {/* Main dashboard content - with padding adjustments */}
        {/* `overflow-hidden` prevents the whole page from scrolling; the timeline scrolls instead. */}
        <main className="flex-1 p-8 md:p-12 min-h-0 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-full min-h-0 max-w-[1600px] mx-auto">
            {/* Timeline Panel (2/3 width on large screens) - narrower with padding */}
            {/* `min-h-0` is critical here so the timeline scroller can actually scroll inside this flex column */}
            <div className="lg:col-span-2 glass-panel p-8 flex flex-col border-2 border-white min-h-0">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-white">
                    TIMELINE
                  </h2>
                  <DayNavigator currentDay={selectedDayString} />
                </div>
                <TimezoneDisplay profileTimezone={profile?.timezone} />
              </div>

              {/* Timeline view */}
              {/* Avoid nested scroll containers; Timeline owns the scroll. `min-h-0` enables scrolling. */}
              <div className="flex-1 min-h-0">
                <Timeline events={events || []} showCurrentTime={isToday} />
              </div>
            </div>

            {/* Right sidebar - narrower with padding */}
            <div className="flex flex-col gap-8 min-h-0">
              {/* Tasks Panel */}
              <div className="glass-panel p-8 flex-1 border-2 border-white min-h-0">
                <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-white mb-6">
                  TASKS
                </h2>
                <TasksList tasks={dayTasks} />
              </div>

              {/* System Feed Panel (placeholder) */}
              <div className="glass-panel p-8 h-48 border-2 border-white">
                <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-white opacity-60 mb-6">
                  SYSTEM FEED
                </h2>
                <div className="space-y-2 text-xs font-mono text-white opacity-80">
                  <p className="flex items-center gap-2">
                    <span className="opacity-50">
                      [{formatTime(new Date())}]
                    </span>
                    <span className="text-white">SESSION_INIT</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="opacity-50">
                      [{formatTime(new Date())}]
                    </span>
                    <span className="opacity-70">Dashboard loaded</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="opacity-50">[--:--:--]</span>
                    <span className="opacity-60 italic">
                      Awaiting voice input...
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Footer - angular */}
        <footer className="px-6 py-4 md:px-12 border-t-2 border-white">
          <div className="flex items-center justify-between text-xs font-mono text-white">
            <span className="uppercase tracking-wider">TETRA OS // HACKATHON BUILD</span>
            <span className="opacity-60 uppercase tracking-wider">CONNECTION: SECURE</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Timeline component displaying events as blocks in hourly slots.
 * Shows a full 24-hour view with events positioned by their start time.
 */
function Timeline({
  events,
  showCurrentTime,
}: {
  events: Event[];
  showCurrentTime: boolean;
}) {
  // Generate hours for the timeline (full 24 hours: 0-23)
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Calculate event position and height based on time
  const getEventStyle = (event: Event) => {
    if (!event.start) return {};

    const start = new Date(event.start);
    const end = event.end
      ? new Date(event.end)
      : new Date(start.getTime() + 60 * 60 * 1000);

    // Calculate position from midnight (0:00) baseline
    const startHour = start.getHours() + start.getMinutes() / 60;
    const endHour = end.getHours() + end.getMinutes() / 60;
    const duration = endHour - startHour;

    // Each hour is 60px tall
    const hourHeight = 60;
    const top = startHour * hourHeight;
    const height = Math.max(duration * hourHeight, 30); // Minimum 30px height

    return {
      top: `${top}px`,
      height: `${height}px`,
    };
  };

  // Format time for display
  const formatEventTime = (dateString: string | null) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  return (
    <div className="relative h-full">
      {/* Scrollable container for 24-hour timeline */}
      <div className="h-full overflow-y-auto custom-scrollbar">
        <div className="relative min-h-[1440px]">
          {/* Hour slots - high contrast, full 24 hours */}
          <div className="relative">
            {hours.map((hour) => (
              <div
                key={hour}
                className="flex items-start h-[60px] border-t border-white/20"
              >
                {/* Time label */}
                <div className="w-16 pr-3 text-right text-xs font-mono text-white opacity-60 -mt-2">
                  {hour.toString().padStart(2, "0")}:00
                </div>
                {/* Hour slot area */}
                <div className="flex-1 relative" />
              </div>
            ))}
          </div>

          {/* Events layer */}
          <div className="absolute top-0 left-16 right-0">
            {events.length === 0 ? (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center py-12">
                <p className="text-white font-mono text-sm opacity-80">
                  NO EVENTS SCHEDULED
                </p>
                <p className="text-white text-xs mt-2 opacity-60">
                  SAY &quot;TALK TO TETRA&quot; TO ADD EVENTS
                </p>
              </div>
            ) : (
              events.map((event) => (
                <EventCard
                  key={event.id}
                  id={event.id}
                  name={event.name}
                  description={event.description}
                  start={event.start}
                  end={event.end}
                  style={getEventStyle(event)}
                />
              ))
            )}
          </div>

          {/* Current time indicator */}
          {showCurrentTime && <CurrentTimeIndicator />}
        </div>
      </div>
    </div>
  );
}

/**
 * Current time indicator line that shows the present moment on the timeline.
 */
function CurrentTimeIndicator() {
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;

  // Show for all 24 hours (0-23)
  const top = currentHour * 60;

  return (
    <div
      className="absolute left-0 right-0 flex items-center z-10 pointer-events-none"
      style={{ top: `${top}px` }}
    >
      <div className="w-16 pr-2 flex justify-end">
        <div className="w-2 h-2 bg-white" />
      </div>
      <div className="flex-1 h-[2px] bg-white" />
    </div>
  );
}

/**
 * Tasks list component displaying today's tasks with status indicators.
 */
function TasksList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-white font-mono text-sm opacity-80">NO TASKS FOR TODAY</p>
        <p className="text-white text-xs mt-2 opacity-60">
          ADD TASKS WITH VOICE COMMANDS
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <div
          key={task.id}
          className={`p-4 border-2 transition-colors cursor-pointer ${
            task.done
              ? "border-white/20 bg-black/40 opacity-60"
              : "border-white/40 bg-black/20 hover:bg-white/5"
          }`}
        >
          <div className="flex items-start gap-3">
            {/* Status checkbox (visual only) - angular */}
            <div
              className={`w-4 h-4 border-2 mt-0.5 flex-shrink-0 flex items-center justify-center ${
                task.done
                  ? "border-white bg-white/20"
                  : "border-white/60"
              }`}
            >
              {task.done && (
                <svg
                  className="w-3 h-3 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              )}
            </div>

            {/* Task content */}
            <div className="min-w-0 flex-1">
              <p
                className={`font-mono text-sm uppercase tracking-wider ${
                  task.done ? "text-white/50 line-through" : "text-white"
                }`}
              >
                {task.name || "UNTITLED TASK"}
              </p>
              {task.due && (
                <p className="text-xs text-white/60 mt-1 font-mono">
                  DUE:{" "}
                  {new Date(task.due).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  }).toUpperCase()}
                </p>
              )}
              {task.description && (
                <p className="text-xs text-white/60 mt-1 truncate font-mono">
                  {task.description}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Tetrahedron icon for Talk to Tetra button.
 * Animated SVG with glowing effect on hover.
 */
function TetrahedronIcon() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" style={{ color: 'rgb(253, 247, 228)' }}>
      {/* Outer triangle */}
      <polygon
        points="50,10 10,90 90,90"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      {/* Inner 3D face - left */}
      <polygon
        points="50,10 50,60 10,90"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="1"
      />
      {/* Inner 3D face - right */}
      <polygon
        points="50,10 50,60 90,90"
        fill="currentColor"
        fillOpacity="0.05"
        stroke="currentColor"
        strokeWidth="1"
      />
      {/* Bottom edge */}
      <line
        x1="50"
        y1="60"
        x2="10"
        y2="90"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.5"
      />
      <line
        x1="50"
        y1="60"
        x2="90"
        y2="90"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.5"
      />
    </svg>
  );
}

/**
 * Format time for system feed display.
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
