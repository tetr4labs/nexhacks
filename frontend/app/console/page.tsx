import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import ImportButton from "./ImportButton";
import EventCard from "./EventCard";

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

/**
 * Console Dashboard Page (Server Component)
 * Main user dashboard displaying today's events and tasks.
 * Protected route - redirects to /auth if not authenticated.
 */
export default async function ConsolePage() {
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

  // Get start and end of today in UTC for querying
  const today = new Date();
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  // Fetch user profile for timezone and preferences
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("handle, timezone, working_hours_start, working_hours_end")
    .eq("id", user.id)
    .single();

  // Fetch today's events for this user
  const { data: events } = await supabase
    .from("events")
    .select("id, name, description, start, end")
    .eq("owner", user.id)
    .gte("start", startOfDay.toISOString())
    .lt("start", endOfDay.toISOString())
    .order("start", { ascending: true });

  // Fetch today's tasks for this user (due today or no due date)
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, name, description, due, done")
    .eq("owner", user.id)
    .or(`due.gte.${startOfDay.toISOString()},due.is.null`)
    .order("due", { ascending: true, nullsFirst: false });

  // Filter tasks to only include those due today or with no due date
  const todaysTasks = (tasks || []).filter((task: Task) => {
    if (!task.due) return true; // Include tasks with no due date
    const dueDate = new Date(task.due);
    return dueDate <= endOfDay;
  });

  // User display name (handle or email fallback)
  const userHandle = profile?.handle || user.email?.split("@")[0] || "User";

  return (
    <div className="relative min-h-screen bg-[#0a0a0a] cyber-grid overflow-hidden">
      {/* Background gradient effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#00ffff] opacity-10 blur-[120px] rounded-full" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#ff00ff] opacity-10 blur-[120px] rounded-full" />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 md:px-8 border-b border-zinc-800/50">
          {/* Logo and branding */}
          <div className="flex items-center gap-3">
            <Image
              src="/tetra.png"
              alt="Tetra Logo"
              width={40}
              height={40}
              className="animate-pulse-glow"
            />
            <div className="flex flex-col">
              <span className="font-mono text-lg font-bold text-[#00ffff] tracking-wider">
                TETRA OS
              </span>
              <span className="font-mono text-xs text-zinc-500">
                v0.1.0 // {userHandle}
              </span>
            </div>
          </div>

          {/* Center: Talk to Tetra button with tetrahedron */}
          <Link
            href="/talk"
            className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 group"
          >
            <div className="w-12 h-12 relative group-hover:scale-110 transition-transform duration-300">
              <TetrahedronIcon />
            </div>
            <span className="font-mono text-xs text-[#00ffff] uppercase tracking-wider opacity-70 group-hover:opacity-100 transition-opacity">
              Talk to Tetra
            </span>
          </Link>

          {/* Right: Import button with modal */}
          <div className="flex items-center gap-3">
            <ImportButton />
          </div>
        </header>

        {/* Status bar */}
        <div className="px-6 py-2 md:px-8 border-b border-zinc-800/30 bg-zinc-900/30">
          <div className="flex items-center gap-4 text-xs font-mono text-zinc-500">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
              System Online
            </span>
            <span className="text-zinc-700">|</span>
            <span>
              {today.toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
            <span className="text-zinc-700">|</span>
            <span className="text-[#00ffff]/60">
              {events?.length || 0} events • {todaysTasks.length} tasks
            </span>
          </div>
        </div>

        {/* Main dashboard content */}
        <main className="flex-1 p-6 md:p-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
            {/* Timeline Panel (2/3 width on large screens) */}
            <div className="lg:col-span-2 glass-panel p-6 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-mono text-sm uppercase tracking-wider text-[#00ffff]">
                  Today&apos;s Timeline
                </h2>
                <span className="text-xs font-mono text-zinc-500">
                  {profile?.timezone || "UTC"}
                </span>
              </div>

              {/* Timeline view */}
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                <Timeline events={events || []} />
              </div>
            </div>

            {/* Right sidebar */}
            <div className="flex flex-col gap-6">
              {/* Tasks Panel */}
              <div className="glass-panel p-6 flex-1">
                <h2 className="font-mono text-sm uppercase tracking-wider text-[#ff00ff] mb-4">
                  Tasks
                </h2>
                <TasksList tasks={todaysTasks} />
              </div>

              {/* System Feed Panel (placeholder) */}
              <div className="glass-panel p-6 h-48">
                <h2 className="font-mono text-sm uppercase tracking-wider text-zinc-500 mb-4">
                  System Feed
                </h2>
                <div className="space-y-2 text-xs font-mono text-zinc-600">
                  <p className="flex items-center gap-2">
                    <span className="text-zinc-700">
                      [{formatTime(new Date())}]
                    </span>
                    <span className="text-[#22c55e]">SESSION_INIT</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="text-zinc-700">
                      [{formatTime(new Date())}]
                    </span>
                    <span className="text-zinc-500">Dashboard loaded</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="text-zinc-700">[--:--:--]</span>
                    <span className="text-zinc-600 italic">
                      Awaiting voice input...
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="px-6 py-3 md:px-8 border-t border-zinc-800/50">
          <div className="flex items-center justify-between text-xs font-mono text-zinc-600">
            <span>TETRA OS // Hackathon Build</span>
            <span className="text-[#00ffff]/40">Connection: Secure</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Timeline component displaying events as blocks in hourly slots.
 * Shows a 24-hour view with events positioned by their start time.
 */
function Timeline({ events }: { events: Event[] }) {
  // Generate hours for the timeline (6 AM to 11 PM for better visibility)
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);

  // Calculate event position and height based on time
  const getEventStyle = (event: Event) => {
    if (!event.start) return {};

    const start = new Date(event.start);
    const end = event.end
      ? new Date(event.end)
      : new Date(start.getTime() + 60 * 60 * 1000);

    // Calculate position from 6 AM baseline
    const startHour = start.getHours() + start.getMinutes() / 60;
    const endHour = end.getHours() + end.getMinutes() / 60;
    const duration = endHour - startHour;

    // Each hour is 60px tall
    const hourHeight = 60;
    const top = (startHour - 6) * hourHeight;
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
    <div className="relative">
      {/* Hour slots */}
      <div className="relative">
        {hours.map((hour) => (
          <div
            key={hour}
            className="flex items-start h-[60px] border-t border-zinc-800/30"
          >
            {/* Time label */}
            <div className="w-16 pr-3 text-right text-xs font-mono text-zinc-600 -mt-2">
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
            <p className="text-zinc-600 font-mono text-sm">
              No events scheduled
            </p>
            <p className="text-zinc-700 text-xs mt-2">
              Say &quot;Talk to Tetra&quot; to add events
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
      <CurrentTimeIndicator />
    </div>
  );
}

/**
 * Current time indicator line that shows the present moment on the timeline.
 */
function CurrentTimeIndicator() {
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;

  // Only show if within visible range (6 AM - 11 PM)
  if (currentHour < 6 || currentHour > 24) return null;

  const top = (currentHour - 6) * 60;

  return (
    <div
      className="absolute left-0 right-0 flex items-center z-10 pointer-events-none"
      style={{ top: `${top}px` }}
    >
      <div className="w-16 pr-2 flex justify-end">
        <div className="w-2 h-2 rounded-full bg-[#ff00ff] glow-magenta" />
      </div>
      <div className="flex-1 h-[2px] bg-gradient-to-r from-[#ff00ff] to-transparent" />
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
        <p className="text-zinc-600 font-mono text-sm">No tasks for today</p>
        <p className="text-zinc-700 text-xs mt-2">
          Add tasks with voice commands
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <div
          key={task.id}
          className={`p-3 rounded border transition-colors cursor-pointer ${
            task.done
              ? "border-zinc-800/30 bg-zinc-900/30 opacity-60"
              : "border-[#ff00ff]/20 bg-[#ff00ff]/5 hover:bg-[#ff00ff]/10"
          }`}
        >
          <div className="flex items-start gap-3">
            {/* Status checkbox (visual only) */}
            <div
              className={`w-4 h-4 rounded border mt-0.5 flex-shrink-0 flex items-center justify-center ${
                task.done
                  ? "border-[#22c55e] bg-[#22c55e]/20"
                  : "border-[#ff00ff]/50"
              }`}
            >
              {task.done && (
                <svg
                  className="w-3 h-3 text-[#22c55e]"
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
                className={`font-mono text-sm ${
                  task.done ? "text-zinc-500 line-through" : "text-white"
                }`}
              >
                {task.name || "Untitled Task"}
              </p>
              {task.due && (
                <p className="text-xs text-zinc-600 mt-1">
                  Due:{" "}
                  {new Date(task.due).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </p>
              )}
              {task.description && (
                <p className="text-xs text-zinc-600 mt-1 truncate">
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
    <svg viewBox="0 0 100 100" className="w-full h-full">
      {/* Outer triangle */}
      <polygon
        points="50,10 10,90 90,90"
        fill="none"
        stroke="#00ffff"
        strokeWidth="2"
        className="animate-pulse-glow"
      />
      {/* Inner 3D face - left */}
      <polygon
        points="50,10 50,60 10,90"
        fill="rgba(0,255,255,0.1)"
        stroke="#00ffff"
        strokeWidth="1"
      />
      {/* Inner 3D face - right */}
      <polygon
        points="50,10 50,60 90,90"
        fill="rgba(0,255,255,0.05)"
        stroke="#00ffff"
        strokeWidth="1"
      />
      {/* Bottom edge */}
      <line
        x1="50"
        y1="60"
        x2="10"
        y2="90"
        stroke="#00ffff"
        strokeWidth="1"
        opacity="0.5"
      />
      <line
        x1="50"
        y1="60"
        x2="90"
        y2="90"
        stroke="#00ffff"
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
