import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { JobContext } from "@livekit/agents";

// Define the shape of the tools for the LLM
export const createTetraTools = (url: string, key: string, userJwt: string) => {
  // Initialize Supabase with the specific User JWT for RLS
  const supabase = createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${userJwt}`,
      },
    },
  });

  return {
    get_day_context: {
      description:
        "Get the user's schedule, tasks, and commitments for a specific date range.",
      parameters: z.object({
        date: z.string().describe("The target date in YYYY-MM-DD format"),
      }),
      execute: async ({ date }: { date: string }) => {
        console.log(`[TetraTools] Fetching context for ${date}`);
        try {
          // Fetch Events
          // Note: Mimicking Python's string-based ISO comparison
          const { data: events } = await supabase
            .from("events")
            .select("*")
            .gte("start", `${date}T00:00:00`)
            .lte("start", `${date}T23:59:59`)
            .order("start");

          // Fetch Tasks
          const { data: tasks } = await supabase
            .from("tasks")
            .select("*")
            .eq("done", false);

          let contextStr = `## Agenda for ${date}\n`;

          if (!events || events.length === 0) {
            contextStr += "- No fixed events scheduled.\n";
          } else {
            for (const e of events) {
              const dt = new Date(e.start);
              // Simple HH:MM format
              const timeStr = dt.toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
              });
              contextStr += `- [${timeStr}] ${e.name || "Untitled"} (ID: ${e.id})\n`;
            }
          }

          contextStr += `\n## Active Tasks / Commitments\n`;
          if (!tasks || tasks.length === 0) {
            contextStr += "- No active tasks.\n";
          } else {
            for (const t of tasks) {
              const due = t.due ? ` (Due: ${t.due})` : "";
              contextStr += `- [ ] ${t.name || "Untitled"}${due} (ID: ${t.id})\n`;
            }
          }

          return contextStr;
        } catch (error: any) {
          console.error(`[TetraTools] Error: ${error}`);
          return `Error accessing database: ${error.message}`;
        }
      },
    },

    schedule_event: {
      description: "Schedule a new calendar event.",
      parameters: z.object({
        title: z.string().describe("Title of the event"),
        start_iso: z
          .string()
          .describe("Start time in ISO 8601 format (e.g. 2023-10-27T14:00:00)"),
        duration_minutes: z
          .number()
          .default(60)
          .describe("Duration in minutes"),
        notes: z.string().optional().describe("Optional description or notes"),
      }),
      execute: async ({
        title,
        start_iso,
        duration_minutes,
        notes,
      }: {
        title: string;
        start_iso: string;
        duration_minutes: number;
        notes?: string;
      }) => {
        console.log(`[TetraTools] Scheduling: ${title} at ${start_iso}`);
        try {
          const startDt = new Date(start_iso);
          const endDt = new Date(startDt.getTime() + duration_minutes * 60000);

          const { error } = await supabase.from("events").insert({
            name: title,
            start: start_iso,
            end: endDt.toISOString(),
            description: notes || "",
          });

          if (error) throw error;
          return `Confirmed. Scheduled '${title}' for ${startDt.toLocaleTimeString()}.`;
        } catch (error: any) {
          console.error(`[TetraTools] Error scheduling: ${error}`);
          return `Failed to schedule event. System reported: ${error.message}`;
        }
      },
    },

    create_task: {
      description: "Log a new task or commitment.",
      parameters: z.object({
        name: z.string().describe("The content of the task/commitment"),
        due_iso: z
          .string()
          .optional()
          .describe("Optional due date/time in ISO 8601"),
      }),
      execute: async ({
        name,
        due_iso,
      }: {
        name: string;
        due_iso?: string;
      }) => {
        console.log(`[TetraTools] Creating task: ${name}`);
        try {
          const { error } = await supabase.from("tasks").insert({
            name,
            done: false,
            due: due_iso || null,
          });
          if (error) throw error;
          return `Commitment logged: ${name}`;
        } catch (error: any) {
          return `Error logging commitment: ${error.message}`;
        }
      },
    },

    mark_task_done: {
      description: "Mark a task or commitment as complete.",
      parameters: z.object({
        task_id: z.number().describe("The numerical ID of the task"),
      }),
      execute: async ({ task_id }: { task_id: number }) => {
        console.log(`[TetraTools] Completing task ID: ${task_id}`);
        try {
          const { error } = await supabase
            .from("tasks")
            .update({ done: true })
            .eq("id", task_id);
          if (error) throw error;
          return "Task marked as done. Good job.";
        } catch (error: any) {
          return `Error updating task: ${error.message}`;
        }
      },
    },
  };
};
