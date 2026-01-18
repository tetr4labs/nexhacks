"use client";

/**
 * ConsoleClient.tsx
 *
 * This is the main client-side wrapper for the /console page.
 * We split this from the server component (page.tsx) because:
 * - Server components handle auth + data fetching (Supabase queries)
 * - Client components handle interactivity (LiveKit connection, UI state, audio playback)
 *
 * The tetrahedron CTA in the header starts the voice connection when clicked,
 * which also expands the transcript panel on the right side.
 */

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  DataPacket_Kind,
} from "livekit-client";
import Image from "next/image";
import ImportButton from "./ImportButton";
import EventCard from "./EventCard";
import DayNavigator from "./DayNavigator";
import TimezoneDisplay from "./TimezoneDisplay";
import TaskModal from "./TaskModal";
import { createClient } from "@/lib/supabase/client";

// =============================================
// Type definitions for props passed from server
// =============================================

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

interface ConsoleClientProps {
  userHandle: string;
  selectedDayString: string;
  selectedDay: Date;
  isToday: boolean;
  events: Event[];
  dayTasks: Task[];
  profileTimezone: string | null | undefined;
}

// =============================================
// Main ConsoleClient component
// =============================================

export default function ConsoleClient({
  userHandle,
  selectedDayString,
  selectedDay,
  isToday,
  events,
  dayTasks,
  profileTimezone,
}: ConsoleClientProps) {
  const supabase = useMemo(() => createClient(), []);

  // State for tasks and events - will be updated via Realtime subscriptions
  const [tasks, setTasks] = useState<Task[]>(dayTasks);
  const [localEvents, setLocalEvents] = useState<Event[]>(events || []);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalMode, setTaskModalMode] = useState<"create" | "edit">(
    "create",
  );
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [isTaskSaving, setIsTaskSaving] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);

  // Helper to check if a task belongs to the selected day
  const isTaskInSelectedDay = useCallback(
    (task: Task) => {
      if (!task.due) return true; // Include tasks with no due date
      const dueDate = new Date(task.due);
      const endOfDay = new Date(selectedDay);
      endOfDay.setHours(23, 59, 59, 999);
      return dueDate <= endOfDay;
    },
    [selectedDay],
  );

  // Helper to check if an event belongs to the selected day
  const isEventInSelectedDay = useCallback(
    (event: Event) => {
      if (!event.start) return false;
      const startOfDay = new Date(selectedDay);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(selectedDay);
      endOfDay.setHours(23, 59, 59, 999);
      const eventStart = new Date(event.start);
      return eventStart >= startOfDay && eventStart < endOfDay;
    },
    [selectedDay],
  );

  // Ref to track selected day for LiveKit handlers (which are closed over)
  const selectedDayRef = useRef(selectedDay);
  useEffect(() => {
    selectedDayRef.current = selectedDay;
  }, [selectedDay]);

  // Update state when props change (e.g., day navigation)
  useEffect(() => {
    setTasks(dayTasks);
    setLocalEvents(events || []);
    setIsTaskModalOpen(false);
    setActiveTask(null);
    setTaskError(null);
    setIsTaskSaving(false);
    setTaskModalMode("create");
  }, [dayTasks, events, selectedDayString]);

  const getUserId = useCallback(async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw new Error("Unable to load user session.");
    }
    return data.user.id;
  }, [supabase]);

  // Task sorting function - defined early so it can be used in subscriptions
  const sortTasks = useCallback((list: Task[]) => {
    return [...list].sort((a, b) => {
      if (!a.due && !b.due) return a.id - b.id;
      if (!a.due) return 1;
      if (!b.due) return -1;
      const aTime = new Date(a.due).getTime();
      const bTime = new Date(b.due).getTime();
      if (aTime === bTime) return a.id - b.id;
      return aTime - bTime;
    });
  }, []);

  // =============================================
  // Supabase Realtime Subscriptions
  // Listen for changes to tasks and events in real-time
  // =============================================
  useEffect(() => {
    let tasksChannel: ReturnType<typeof supabase.channel> | null = null;
    let eventsChannel: ReturnType<typeof supabase.channel> | null = null;
    let userId: string | null = null;

    const setupSubscriptions = async () => {
      try {
        // Get current user ID
        const { data: userData, error: userError } =
          await supabase.auth.getUser();
        if (userError || !userData.user) {
          console.error(
            "Failed to get user for Realtime subscriptions:",
            userError,
          );
          return;
        }
        userId = userData.user.id;

        // Subscribe to tasks table changes
        tasksChannel = supabase
          .channel("tasks-changes")
          .on(
            "postgres_changes",
            {
              event: "*", // Listen for INSERT, UPDATE, DELETE
              schema: "public",
              table: "tasks",
            },
            (payload) => {
              console.log("Task change received:", payload.eventType, payload);

              if (payload.eventType === "INSERT") {
                const newTask = payload.new as Task;
                // Only add if it belongs to the selected day
                if (isTaskInSelectedDay(newTask)) {
                  setTasks((prev) => {
                    // Check if task already exists (avoid duplicates)
                    if (prev.some((t) => t.id === newTask.id)) {
                      return prev;
                    }
                    return sortTasks([...prev, newTask]);
                  });
                }
              } else if (payload.eventType === "UPDATE") {
                const updatedTask = payload.new as Task;
                setTasks((prev) => {
                  const existingIndex = prev.findIndex(
                    (t) => String(t.id) === String(updatedTask.id),
                  );
                  if (existingIndex >= 0) {
                    // Task exists - update it if it's still in the selected day, otherwise remove it
                    if (isTaskInSelectedDay(updatedTask)) {
                      const updated = [...prev];
                      updated[existingIndex] = updatedTask;
                      return sortTasks(updated);
                    } else {
                      // Task moved out of selected day - remove it
                      return prev.filter(
                        (t) => String(t.id) !== String(updatedTask.id),
                      );
                    }
                  } else {
                    // Task doesn't exist in current list - add it if it belongs to selected day
                    if (isTaskInSelectedDay(updatedTask)) {
                      return sortTasks([...prev, updatedTask]);
                    }
                    return prev;
                  }
                });
              } else if (payload.eventType === "DELETE") {
                const deletedTask = payload.old as Partial<Task>;
                console.log("Delete task payload:", deletedTask);
                setTasks((prev) =>
                  prev.filter((t) => String(t.id) !== String(deletedTask.id)),
                );
              }
            },
          )
          .subscribe((status) => {
            console.log("Tasks subscription status:", status);
          });

        // Subscribe to events table changes
        eventsChannel = supabase
          .channel("events-changes")
          .on(
            "postgres_changes",
            {
              event: "*", // Listen for INSERT, UPDATE, DELETE
              schema: "public",
              table: "events",
            },
            (payload) => {
              console.log("Event change received:", payload.eventType, payload);

              if (payload.eventType === "INSERT") {
                const newEvent = payload.new as Event;
                // Only add if it belongs to the selected day
                if (isEventInSelectedDay(newEvent)) {
                  setLocalEvents((prev) => {
                    // Check if event already exists (avoid duplicates)
                    if (prev.some((e) => e.id === newEvent.id)) {
                      return prev;
                    }
                    // Sort by start time
                    return [...prev, newEvent].sort((a, b) => {
                      if (!a.start || !b.start) return 0;
                      return (
                        new Date(a.start).getTime() -
                        new Date(b.start).getTime()
                      );
                    });
                  });
                }
              } else if (payload.eventType === "UPDATE") {
                const updatedEvent = payload.new as Event;
                setLocalEvents((prev) => {
                  const existingIndex = prev.findIndex(
                    (e) => String(e.id) === String(updatedEvent.id),
                  );
                  if (existingIndex >= 0) {
                    // Event exists - update it if it's still in the selected day, otherwise remove it
                    if (isEventInSelectedDay(updatedEvent)) {
                      const updated = [...prev];
                      updated[existingIndex] = updatedEvent;
                      // Re-sort by start time
                      return updated.sort((a, b) => {
                        if (!a.start || !b.start) return 0;
                        return (
                          new Date(a.start).getTime() -
                          new Date(b.start).getTime()
                        );
                      });
                    } else {
                      // Event moved out of selected day - remove it
                      return prev.filter(
                        (e) => String(e.id) !== String(updatedEvent.id),
                      );
                    }
                  } else {
                    // Event doesn't exist in current list - add it if it belongs to selected day
                    if (isEventInSelectedDay(updatedEvent)) {
                      const updated = [...prev, updatedEvent];
                      return updated.sort((a, b) => {
                        if (!a.start || !b.start) return 0;
                        return (
                          new Date(a.start).getTime() -
                          new Date(b.start).getTime()
                        );
                      });
                    }
                    return prev;
                  }
                });
              } else if (payload.eventType === "DELETE") {
                const deletedEvent = payload.old as Partial<Event>;
                console.log("Delete event payload:", deletedEvent);
                setLocalEvents((prev) =>
                  prev.filter((e) => String(e.id) !== String(deletedEvent.id)),
                );
              }
            },
          )
          .subscribe((status) => {
            console.log("Events subscription status:", status);
          });
      } catch (error) {
        console.error("Error setting up Realtime subscriptions:", error);
      }
    };

    setupSubscriptions();

    // Cleanup function - unsubscribe when component unmounts or dependencies change
    return () => {
      if (tasksChannel) {
        supabase.removeChannel(tasksChannel);
      }
      if (eventsChannel) {
        supabase.removeChannel(eventsChannel);
      }
    };
  }, [
    supabase,
    selectedDayString,
    isTaskInSelectedDay,
    isEventInSelectedDay,
    sortTasks,
  ]);

  // =============================================
  // Timezone Sync
  // Sync browser timezone to user profile if missing
  // =============================================
  useEffect(() => {
    const syncTimezone = async () => {
      // If profile timezone is missing or generic UTC, try to update it with browser's local timezone
      if (
        !profileTimezone ||
        profileTimezone === "UTC" ||
        profileTimezone === "Etc/UTC"
      ) {
        const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (browserTz && browserTz !== profileTimezone) {
          console.log("Syncing timezone to profile:", browserTz);
          try {
            const {
              data: { user },
            } = await supabase.auth.getUser();
            if (user) {
              await supabase
                .from("user_profiles")
                .update({ timezone: browserTz })
                .eq("id", user.id);
            }
          } catch (err) {
            console.error("Error syncing timezone:", err);
          }
        }
      }
    };

    syncTimezone();
  }, [profileTimezone, supabase]);

  const openCreateTaskModal = useCallback(() => {
    setTaskError(null);
    setTaskModalMode("create");
    setActiveTask(null);
    setIsTaskModalOpen(true);
  }, []);

  const openEditTaskModal = useCallback((task: Task) => {
    setTaskError(null);
    setTaskModalMode("edit");
    setActiveTask(task);
    setIsTaskModalOpen(true);
  }, []);

  const closeTaskModal = useCallback(() => {
    if (isTaskSaving) return;
    setIsTaskModalOpen(false);
    setActiveTask(null);
    setTaskError(null);
  }, [isTaskSaving]);

  const handleSaveTask = useCallback(
    async (payload: {
      name: string;
      description: string;
      due: string | null;
    }) => {
      setIsTaskSaving(true);
      setTaskError(null);
      try {
        const userId = await getUserId();

        if (taskModalMode === "create") {
          const { data, error } = await supabase
            .from("tasks")
            .insert({
              owner: userId,
              name: payload.name,
              description: payload.description,
              due: payload.due,
            })
            .select("id, name, description, due, done")
            .single();

          if (error) throw error;
          if (data) {
            setTasks((prev) => sortTasks([...prev, data as Task]));
          }
        } else if (activeTask) {
          const { data, error } = await supabase
            .from("tasks")
            .update({
              name: payload.name,
              description: payload.description,
              due: payload.due,
            })
            .eq("id", activeTask.id)
            .eq("owner", userId)
            .select("id, name, description, due, done")
            .single();

          if (error) throw error;
          if (data) {
            setTasks((prev) =>
              sortTasks(
                prev.map((task) =>
                  task.id === activeTask.id ? (data as Task) : task,
                ),
              ),
            );
          }
        }

        setIsTaskModalOpen(false);
        setActiveTask(null);
      } catch (err) {
        setTaskError(
          err instanceof Error ? err.message : "Failed to save task.",
        );
      } finally {
        setIsTaskSaving(false);
      }
    },
    [activeTask, getUserId, sortTasks, supabase, taskModalMode],
  );

  const handleDeleteTask = useCallback(async () => {
    if (!activeTask) return;
    setIsTaskSaving(true);
    setTaskError(null);
    try {
      const userId = await getUserId();
      const { error } = await supabase
        .from("tasks")
        .delete()
        .eq("id", activeTask.id)
        .eq("owner", userId);

      if (error) throw error;

      setTasks((prev) => prev.filter((task) => task.id !== activeTask.id));
      setIsTaskModalOpen(false);
      setActiveTask(null);
    } catch (err) {
      setTaskError(
        err instanceof Error ? err.message : "Failed to delete task.",
      );
    } finally {
      setIsTaskSaving(false);
    }
  }, [activeTask, getUserId, supabase]);

  const handleToggleTaskDone = useCallback(
    async (task: Task) => {
      setTaskError(null);
      try {
        const userId = await getUserId();
        const nextDone = !task.done;
        const { data, error } = await supabase
          .from("tasks")
          .update({ done: nextDone })
          .eq("id", task.id)
          .eq("owner", userId)
          .select("id, name, description, due, done")
          .single();

        if (error) throw error;
        if (data) {
          setTasks((prev) =>
            prev.map((item) => (item.id === task.id ? (data as Task) : item)),
          );
        }
      } catch (err) {
        setTaskError(
          err instanceof Error ? err.message : "Failed to update task.",
        );
      }
    },
    [getUserId, supabase],
  );
  // =============================================
  // Transcript/Voice panel state
  // =============================================

  // Controls whether the transcript column is visible (collapsed by default)
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);

  // Session start time - initialized client-side to avoid hydration mismatch
  // (server renders one timestamp, client hydrates with another causing errors)
  const [sessionTime, setSessionTime] = useState<string>("--:--:--");

  // Set the session time after hydration to avoid mismatch
  useEffect(() => {
    setSessionTime(formatTime(new Date()));
  }, []);

  // =============================================
  // LiveKit connection state (ported from /talk)
  // =============================================

  const [room, setRoom] = useState<Room | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<
    Array<{ speaker: string; text: string; timestamp: Date }>
  >([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [isWaitingForAgent, setIsWaitingForAgent] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // =============================================
  // Gmail integration state (Arcade MCP)
  // =============================================

  // Whether to show the bottom-right Gmail prompt
  const [showGmailPrompt, setShowGmailPrompt] = useState(false);
  // Whether Gmail is connected via Arcade
  const [gmailConnected, setGmailConnected] = useState(false);
  // Whether we're currently authorizing Gmail
  const [isGmailAuthorizing, setIsGmailAuthorizing] = useState(false);
  // Whether Arcade is configured on the backend
  const [arcadeConfigured, setArcadeConfigured] = useState(false);

  // Transcript buffering and debouncing refs
  const transcriptBufferRef = useRef<
    Map<string, { text: string; timestamp: Date; timer: NodeJS.Timeout | null }>
  >(new Map());

  // =============================================
  // Gmail integration - check status on mount
  // =============================================

  /**
   * Fetches Gmail integration status from /api/gmail/status.
   * Optionally shows the prompt (when explicitly requested by the agent/UI).
   */
  const checkGmailStatus = useCallback(
    async (opts?: { allowPrompt?: boolean }) => {
      try {
        const response = await fetch("/api/gmail/status");
        if (!response.ok) {
          // If status can't be fetched (e.g. user is not authed), don't leave a stale prompt stuck on.
          setArcadeConfigured(false);
          setShowGmailPrompt(false);
          return;
        }

        const data = await response.json();

        // Track whether Arcade is configured
        setArcadeConfigured(data.arcade_configured === true);

        // Track connection status
        const connected = data.connected === true;
        setGmailConnected(connected);

        // Only show the prompt when explicitly requested (e.g. agent needs Gmail right now).
        // This avoids the "always-on" bottom-right widget vibe.
        const shouldShow =
          opts?.allowPrompt === true &&
          data.arcade_configured &&
          !connected &&
          !data.is_snoozed;
        setShowGmailPrompt(shouldShow);
      } catch (err) {
        console.error("[Gmail] Error checking status:", err);
        // Avoid sticky prompt if the status check throws.
        setShowGmailPrompt(false);
      }
    },
    [],
  );

  // Check Gmail status on mount
  useEffect(() => {
    checkGmailStatus();
  }, [checkGmailStatus]);

  /**
   * Initiates Gmail authorization via Arcade.
   * Opens the OAuth URL in a new tab and polls for completion.
   */
  const handleGmailConnect = useCallback(async () => {
    setIsGmailAuthorizing(true);

    // IMPORTANT: open a popup synchronously on the click event.
    // Browsers often block `window.open()` if it's called after an `await`/promise tick.
    // We open a blank window immediately, then navigate it once we receive the Arcade URL.
    const popup = window.open("about:blank", "_blank", "width=600,height=700");
    if (popup) {
      // Prevent reverse-tabnabbing once we navigate to a third-party OAuth page.
      // (We keep a reference so we can set `location`, so we can't rely on `noopener` here.)
      try {
        popup.opener = null;
      } catch {
        // Some browsers may disallow setting opener; safe to ignore.
      }
    }

    try {
      const response = await fetch("/api/gmail/authorize", { method: "POST" });
      if (!response.ok) {
        // Get the actual error message from the response
        let errorData: any;
        try {
          const text = await response.text();
          errorData = text ? JSON.parse(text) : { error: "Empty response" };
        } catch (e) {
          errorData = {
            error: `Failed to parse response: ${await response.text()}`,
          };
        }
        console.error("[Gmail] Authorization request failed:", {
          status: response.status,
          statusText: response.statusText,
          error: errorData.error || errorData,
          details: errorData.details,
        });
        // Close the blank popup if we couldn't get a URL.
        try {
          popup?.close();
        } catch {
          // ignore
        }
        setIsGmailAuthorizing(false);
        return;
      }

      const data = await response.json();

      // If already completed, just refresh status
      if (data.status === "completed") {
        setGmailConnected(true);
        setShowGmailPrompt(false);
        try {
          popup?.close();
        } catch {
          // ignore
        }
        setIsGmailAuthorizing(false);
        return;
      }

      // Navigate the popup to the authorization URL
      if (data.url) {
        if (popup && !popup.closed) {
          popup.location.href = data.url;
        } else {
          // Fallback: if popup was blocked, fall back to a full-page redirect.
          window.location.href = data.url;
        }
      } else {
        // No URL returned (misconfigured provider / Arcade issue) — close the blank popup.
        try {
          popup?.close();
        } catch {
          // ignore
        }
      }

      // Poll for completion (up to 2 minutes, every 3 seconds)
      const maxAttempts = 40;
      let attempts = 0;

      const pollInterval = setInterval(async () => {
        attempts++;

        try {
          const statusResponse = await fetch("/api/gmail/status");
          if (statusResponse.ok) {
            const statusData = await statusResponse.json();

            if (statusData.connected) {
              // Success! User completed OAuth
              clearInterval(pollInterval);
              setGmailConnected(true);
              setShowGmailPrompt(false);
              setIsGmailAuthorizing(false);
            }
          }
        } catch {
          // Ignore poll errors
        }

        // Stop polling after max attempts
        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          setIsGmailAuthorizing(false);
        }
      }, 3000);
    } catch (err) {
      console.error("[Gmail] Error initiating authorization:", err);
      setIsGmailAuthorizing(false);
    }
  }, []);

  /**
   * Snoozes the Gmail prompt for 14 days.
   */
  const handleGmailSnooze = useCallback(async () => {
    try {
      const response = await fetch("/api/gmail/snooze", { method: "POST" });
      if (response.ok) {
        setShowGmailPrompt(false);
      }
    } catch (err) {
      console.error("[Gmail] Error snoozing:", err);
    }
  }, []);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // =============================================
  // Transcript handling functions (ported from /talk)
  // =============================================

  // Simple similarity calculation (Jaccard similarity on words)
  // Used to detect duplicate transcript entries
  const calculateSimilarity = useCallback(
    (text1: string, text2: string): number => {
      const words1 = new Set(text1.toLowerCase().trim().split(/\s+/));
      const words2 = new Set(text2.toLowerCase().trim().split(/\s+/));

      const intersection = new Set([...words1].filter((x) => words2.has(x)));
      const union = new Set([...words1, ...words2]);

      return intersection.size / union.size;
    },
    [],
  );

  // Commit buffered transcripts to the main transcript array
  // Only commits after a pause in speech (debounced)
  const commitBufferedTranscripts = useCallback(() => {
    const buffers = Array.from(transcriptBufferRef.current.entries());

    if (buffers.length === 0) {
      return;
    }

    setTranscript((prev) => {
      // Get the last entry to check for duplicates
      const lastEntry = prev.length > 0 ? prev[prev.length - 1] : null;

      // Process each buffered transcript
      const newEntries = buffers
        .map(([speaker, buffer]) => {
          // Check if this is a duplicate of the last entry
          if (
            lastEntry &&
            lastEntry.speaker === speaker &&
            lastEntry.text.toLowerCase().trim() ===
              buffer.text.toLowerCase().trim()
          ) {
            return null; // Skip duplicate
          }

          // Check if this is very similar to the last entry (fuzzy duplicate)
          if (lastEntry && lastEntry.speaker === speaker) {
            const similarity = calculateSimilarity(lastEntry.text, buffer.text);
            if (similarity > 0.85) {
              // 85% similar = likely duplicate
              return null;
            }
          }

          return {
            speaker,
            text: buffer.text,
            timestamp: buffer.timestamp,
          };
        })
        .filter(
          (
            entry,
          ): entry is { speaker: string; text: string; timestamp: Date } =>
            entry !== null,
        );

      // Clear the buffers
      transcriptBufferRef.current.clear();

      // Return updated transcript
      return [...prev, ...newEntries];
    });
  }, [calculateSimilarity]);

  // Add transcript entry with buffering and debouncing
  // This prevents duplicate entries and waits until the user is done speaking
  const addTranscript = useCallback(
    (speaker: string, text: string) => {
      // Normalize speaker name
      const normalizedSpeaker =
        speaker === "agent" || speaker.includes("agent") ? "Tetra" : "You";

      // Skip empty or very short text
      if (!text || text.trim().length < 2) {
        return;
      }

      // Get or create buffer entry for this speaker
      const bufferKey = normalizedSpeaker;
      const existingBuffer = transcriptBufferRef.current.get(bufferKey);

      // Check if this is a duplicate or very similar to existing text
      if (existingBuffer) {
        const existingText = existingBuffer.text.toLowerCase().trim();
        const newText = text.toLowerCase().trim();

        // If the new text is contained in existing text, skip it
        if (
          existingText.includes(newText) &&
          existingText.length > newText.length
        ) {
          return;
        }

        // If existing text is contained in new text, replace it
        if (
          newText.includes(existingText) &&
          newText.length > existingText.length
        ) {
          transcriptBufferRef.current.set(bufferKey, {
            text: text.trim(),
            timestamp: existingBuffer.timestamp,
            timer: existingBuffer.timer,
          });
        } else {
          // Merge texts if they're different (partial updates)
          const timeDiff = Date.now() - existingBuffer.timestamp.getTime();
          if (timeDiff < 3000) {
            const existingWords = existingText.split(/\s+/);
            const newWords = newText.split(/\s+/);
            const additionalWords = newWords.filter(
              (word) => word.length > 0 && !existingWords.includes(word),
            );

            if (additionalWords.length > 0) {
              transcriptBufferRef.current.set(bufferKey, {
                text: existingBuffer.text + " " + additionalWords.join(" "),
                timestamp: existingBuffer.timestamp,
                timer: existingBuffer.timer,
              });
            }
          } else {
            transcriptBufferRef.current.set(bufferKey, {
              text: text.trim(),
              timestamp: new Date(),
              timer: null,
            });
          }
        }
      } else {
        // New buffer entry
        transcriptBufferRef.current.set(bufferKey, {
          text: text.trim(),
          timestamp: new Date(),
          timer: null,
        });
      }

      // Clear existing debounce timer
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      // Set new debounce timer - wait 1.5 seconds of silence before committing
      debounceTimeoutRef.current = setTimeout(() => {
        commitBufferedTranscripts();
      }, 1500);
    },
    [commitBufferedTranscripts],
  );

  // Render transcript text with clickable links (e.g., Arcade OAuth authorization URLs).
  // We intentionally do NOT use `dangerouslySetInnerHTML` here to avoid XSS risks.
  const renderTranscriptText = useCallback((text: string) => {
    // A conservative URL matcher: good enough for OAuth links shown by Arcade/LiveKit.
    // We avoid trailing punctuation like ")" or "," which often surrounds URLs in text.
    const urlRegex = /https?:\/\/[^\s),]+/g;

    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;

    for (const match of text.matchAll(urlRegex)) {
      const url = match[0];
      const start = match.index ?? 0;
      const end = start + url.length;

      // Push any plain text before the URL
      if (start > lastIndex) {
        nodes.push(text.slice(lastIndex, start));
      }

      // Push the URL as a clickable link
      nodes.push(
        <a
          key={`url-${start}-${end}`}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-cyan-300 underline break-all hover:text-cyan-200"
        >
          {url}
        </a>,
      );

      lastIndex = end;
    }

    // Push any trailing plain text after the last URL
    if (lastIndex < text.length) {
      nodes.push(text.slice(lastIndex));
    }

    return <>{nodes}</>;
  }, []);

  // =============================================
  // Audio track handling (ported from /talk)
  // =============================================

  const handleTrack = useCallback(
    (track: RemoteTrack, participantIdentity: string) => {
      if (track.kind === Track.Kind.Audio) {
        console.log("Handling audio track from:", participantIdentity, track);

        if (!audioRef.current) {
          console.error("Audio element not available");
          return;
        }

        // Stop any existing tracks
        if (audioRef.current.srcObject) {
          const existingStream = audioRef.current.srcObject as MediaStream;
          existingStream.getTracks().forEach((t) => {
            t.stop();
            existingStream.removeTrack(t);
          });
        }

        // Create new media stream and attach track
        const stream = new MediaStream();
        if (track.mediaStreamTrack) {
          stream.addTrack(track.mediaStreamTrack);
          audioRef.current.srcObject = stream;

          // Ensure audio element is ready
          audioRef.current.volume = 1.0;
          audioRef.current.muted = false;

          // Play audio with error handling
          const playPromise = audioRef.current.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                console.log(
                  "Audio track playing successfully from:",
                  participantIdentity,
                );
              })
              .catch((err) => {
                console.error("Error playing audio:", err);
                if (err.name === "NotAllowedError") {
                  setError(
                    "Please allow audio playback in your browser settings",
                  );
                }
              });
          }
        } else {
          console.warn("Track has no mediaStreamTrack:", track);
        }
      }
    },
    [],
  );

  // =============================================
  // LiveKit connection function (ported from /talk)
  // This is triggered when the user clicks "Talk to Tetra" or the tetrahedron
  // =============================================

  const connectToRoom = useCallback(async () => {
    if (isConnecting || isConnected) return;

    setIsConnecting(true);
    setError(null);

    try {
      // Get access token from API
      const response = await fetch("/api/livekit-token");
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to get access token");
      }

      const { token, url, room: roomName } = await response.json();
      console.log("Connecting to room:", roomName);

      // Import LiveKit client dynamically (client-side only)
      const { Room } = await import("livekit-client");

      // Create room instance
      const newRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      // Helper to cleanup duplicate agents
      const cleanupDuplicateAgents = async (currentRoom: Room) => {
        const agents = Array.from(
          currentRoom.remoteParticipants.values(),
        ).filter(
          (p) =>
            p.identity === "agent" ||
            p.identity.includes("agent") ||
            p.identity === "Tetra",
        );

        if (agents.length > 1) {
          console.log(
            "Found multiple agents, cleaning up...",
            agents.map((a) => a.identity),
          );

          const sortedAgents = agents.sort((a, b) => {
            const timeA = a.joinedAt?.getTime() || 0;
            const timeB = b.joinedAt?.getTime() || 0;
            return timeA - timeB;
          });

          const agentsToRemove = sortedAgents.slice(0, sortedAgents.length - 1);

          for (const agent of agentsToRemove) {
            console.log("Removing duplicate agent:", agent.identity);
            try {
              await fetch("/api/kick-participant", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  room: currentRoom.name,
                  identity: agent.identity,
                }),
              });
            } catch (err) {
              console.error("Failed to remove agent:", err);
            }
          }
        }
      };

      // Set up event listeners
      newRoom.on(RoomEvent.Connected, () => {
        console.log("Connected to room:", newRoom.name);
        setIsConnected(true);
        setIsConnecting(false);

        cleanupDuplicateAgents(newRoom);

        const allParticipants = Array.from(newRoom.remoteParticipants.values());
        console.log(
          "Remote participants:",
          allParticipants.map((p) => p.identity),
        );
        setParticipants(allParticipants.map((p) => p.identity));

        if (allParticipants.length > 0) {
          setError(null);
          setIsWaitingForAgent(false);
        } else {
          setIsWaitingForAgent(true);
        }
      });

      newRoom.on(RoomEvent.Disconnected, (reason) => {
        console.log("Disconnected from room:", reason);
        setIsConnected(false);
        setRoom(null);
        setParticipants([]);
        setIsWaitingForAgent(false);
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
      });

      newRoom.on(
        RoomEvent.ParticipantConnected,
        (participant: RemoteParticipant) => {
          console.log(
            "Participant connected:",
            participant.identity,
            participant,
          );

          cleanupDuplicateAgents(newRoom);

          setParticipants((prev) => {
            const updated = [...prev, participant.identity];
            if (updated.length > 0) {
              setError(null);
              setIsWaitingForAgent(false);
            }
            return updated;
          });

          // Set up track listeners for this participant
          participant.on(
            RoomEvent.TrackSubscribed,
            (track: RemoteTrack, publication: RemoteTrackPublication) => {
              console.log(
                "Track subscribed:",
                track.kind,
                publication.trackSid,
                "from",
                participant.identity,
              );
              handleTrack(track, participant.identity);
            },
          );

          // Check for existing tracks
          participant.trackPublications.forEach((publication) => {
            if (publication.track) {
              console.log(
                "Existing track:",
                publication.kind,
                publication.trackSid,
              );
              handleTrack(
                publication.track as RemoteTrack,
                participant.identity,
              );
            }
          });
        },
      );

      newRoom.on(
        RoomEvent.ParticipantDisconnected,
        (participant: RemoteParticipant) => {
          console.log("Participant disconnected:", participant.identity);
          setParticipants((prev) =>
            prev.filter((id) => id !== participant.identity),
          );
        },
      );

      // Handle data messages (for transcripts)
      newRoom.on(
        RoomEvent.DataReceived,
        (
          payload: Uint8Array,
          participant?: RemoteParticipant,
          kind?: DataPacket_Kind,
        ) => {
          try {
            const text = new TextDecoder().decode(payload);
            console.log("Data received:", text, "from", participant?.identity);

            try {
              const data = JSON.parse(text);
              // UI events sent by the voice agent (via LiveKit data messages).
              // This lets the agent reliably "nudge" the user to connect Gmail by
              // showing the bottom-right Gmail Integration prompt.
              if (
                data?.type === "ui_event" &&
                data?.event === "gmail_connect_required"
              ) {
                // Reconcile against server truth; only show if Arcade is configured and not snoozed.
                // If `/api/gmail/status` fails, we intentionally do NOT force a sticky prompt.
                checkGmailStatus({ allowPrompt: true });
              }

              // Handle Agent State Updates (Event/Task CUD)
              if (data.type === "event_update" || data.type === "task_update") {
                const action = data.action; // INSERT, UPDATE, DELETE
                const entity = data.data; // The record or {id}
                const currentDay = selectedDayRef.current;

                // Helper checks using ref (to avoid stale closures)
                const isInDayTask = (t: Task) => {
                  if (!t.due) return true;
                  const d = new Date(t.due);
                  const end = new Date(currentDay);
                  end.setHours(23, 59, 59, 999);
                  return d <= end;
                };

                const isInDayEvent = (e: Event) => {
                  if (!e.start) return false;
                  const s = new Date(e.start);
                  const start = new Date(currentDay);
                  start.setHours(0, 0, 0, 0);
                  const end = new Date(currentDay);
                  end.setHours(23, 59, 59, 999);
                  return s >= start && s < end;
                };

                if (data.type === "task_update") {
                  if (action === "INSERT") {
                    if (isInDayTask(entity)) {
                      setTasks((prev) => {
                        if (
                          prev.some((t) => String(t.id) === String(entity.id))
                        )
                          return prev;
                        return sortTasks([...prev, entity]);
                      });
                    }
                  } else if (action === "UPDATE") {
                    setTasks((prev) => {
                      const idx = prev.findIndex(
                        (t) => String(t.id) === String(entity.id),
                      );
                      if (idx >= 0) {
                        if (isInDayTask(entity)) {
                          const newArr = [...prev];
                          newArr[idx] = entity;
                          return sortTasks(newArr);
                        } else {
                          return prev.filter(
                            (t) => String(t.id) !== String(entity.id),
                          );
                        }
                      } else {
                        if (isInDayTask(entity)) {
                          return sortTasks([...prev, entity]);
                        }
                        return prev;
                      }
                    });
                  } else if (action === "DELETE") {
                    setTasks((prev) =>
                      prev.filter((t) => String(t.id) !== String(entity.id)),
                    );
                  }
                } else if (data.type === "event_update") {
                  if (action === "INSERT") {
                    if (isInDayEvent(entity)) {
                      setLocalEvents((prev) => {
                        if (
                          prev.some((e) => String(e.id) === String(entity.id))
                        )
                          return prev;
                        return [...prev, entity].sort((a, b) =>
                          a.start && b.start
                            ? new Date(a.start).getTime() -
                              new Date(b.start).getTime()
                            : 0,
                        );
                      });
                    }
                  } else if (action === "UPDATE") {
                    setLocalEvents((prev) => {
                      const idx = prev.findIndex(
                        (e) => String(e.id) === String(entity.id),
                      );
                      if (idx >= 0) {
                        if (isInDayEvent(entity)) {
                          const newArr = [...prev];
                          newArr[idx] = entity;
                          return newArr.sort((a, b) =>
                            a.start && b.start
                              ? new Date(a.start).getTime() -
                                new Date(b.start).getTime()
                              : 0,
                          );
                        } else {
                          return prev.filter(
                            (e) => String(e.id) !== String(entity.id),
                          );
                        }
                      } else {
                        if (isInDayEvent(entity)) {
                          const newArr = [...prev, entity];
                          return newArr.sort((a, b) =>
                            a.start && b.start
                              ? new Date(a.start).getTime() -
                                new Date(b.start).getTime()
                              : 0,
                          );
                        }
                        return prev;
                      }
                    });
                  } else if (action === "DELETE") {
                    setLocalEvents((prev) =>
                      prev.filter((e) => String(e.id) !== String(entity.id)),
                    );
                  }
                }
              }
              // Handle Transcripts
              else if (data.text || data.transcript) {
                addTranscript(
                  participant?.identity || "system",
                  data.text || data.transcript,
                );
              }
            } catch {
              addTranscript(participant?.identity || "system", text);
            }
          } catch (err) {
            console.error("Error processing data:", err);
          }
        },
      );

      // Register text stream handler for transcripts
      try {
        newRoom.registerTextStreamHandler(
          "lk.transcription",
          async (reader, participantInfo) => {
            console.log("Text stream handler registered for transcription");
            try {
              const text = await reader.readAll();
              console.log(
                "Transcript received:",
                text,
                "from",
                participantInfo?.identity,
              );
              if (text) {
                addTranscript(participantInfo?.identity || "system", text);
              }
            } catch (err) {
              console.error("Error reading transcript stream:", err);
            }
          },
        );
      } catch (err) {
        console.warn(
          "Could not register text stream handler (may not be available in this version):",
          err,
        );
      }

      // Also listen for transcription events if available
      newRoom.on(RoomEvent.TranscriptionReceived, (transcription: any) => {
        console.log("Transcription event received:", transcription);
        if (transcription.text) {
          addTranscript(
            transcription.participant?.identity || "system",
            transcription.text,
          );
        }
      });

      // Handle local track published
      newRoom.localParticipant.on(RoomEvent.TrackPublished, (publication) => {
        console.log(
          "Local track published:",
          publication.kind,
          publication.trackSid,
        );
      });

      // Listen for all track subscriptions
      newRoom.on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          publication: RemoteTrackPublication,
          participant: RemoteParticipant,
        ) => {
          console.log(
            "Track subscribed event:",
            track.kind,
            "from",
            participant.identity,
          );
          handleTrack(track, participant.identity);
        },
      );

      // Connect to room FIRST
      await newRoom.connect(url, token);
      console.log("Room connection initiated");

      // Wait a moment for the room to be fully established
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log("Room connection stabilized");

      // Trigger agent to join AFTER we're connected, with retry logic
      const dispatchAgentWithRetry = async (retries = 3, delay = 1000) => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            console.log(
              `[Dispatch] Attempt ${attempt}/${retries} to dispatch agent...`,
            );
            const triggerResponse = await fetch("/api/trigger-agent", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ room: roomName }),
            });
            if (triggerResponse.ok) {
              console.log("[Dispatch] Agent trigger sent successfully");
              return true;
            } else {
              console.warn(
                `[Dispatch] Attempt ${attempt} failed with status:`,
                triggerResponse.status,
              );
            }
          } catch (triggerErr) {
            console.warn(`[Dispatch] Attempt ${attempt} failed:`, triggerErr);
          }
          if (attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
        console.warn(
          "[Dispatch] All dispatch attempts failed, agent may need to join automatically",
        );
        return false;
      };

      await dispatchAgentWithRetry();

      // Enable microphone after connection
      try {
        await newRoom.localParticipant.setMicrophoneEnabled(true);
        console.log("Microphone enabled");

        const micPublication = newRoom.localParticipant.audioTrackPublications
          .values()
          .next().value;
        if (micPublication) {
          console.log("Microphone track published:", micPublication.trackSid);
        } else {
          console.warn("Microphone track not found after enabling");
        }
      } catch (micError) {
        console.error("Failed to enable microphone:", micError);
        setError("Failed to enable microphone. Please check permissions.");
      }

      setRoom(newRoom);

      // Periodically check for agent
      let checkCount = 0;
      const maxChecks = 5;
      const checkInterval = setInterval(() => {
        checkCount++;

        if (newRoom.state === "connected") {
          const allParticipants = Array.from(
            newRoom.remoteParticipants.values(),
          );
          console.log(
            `[Check ${checkCount}/${maxChecks}] Participants:`,
            allParticipants.map((p) => p.identity),
          );

          if (allParticipants.length > 0) {
            setError(null);
            setIsWaitingForAgent(false);
            clearInterval(checkInterval);
          } else if (checkCount >= maxChecks) {
            console.warn("Agent not detected after waiting period");
            setIsWaitingForAgent(true);
            clearInterval(checkInterval);
          }
        } else {
          clearInterval(checkInterval);
        }
      }, 2000);
    } catch (err) {
      console.error("Connection error:", err);
      setError(err instanceof Error ? err.message : "Failed to connect");
      setIsConnecting(false);
    }
  }, [isConnecting, isConnected, handleTrack, addTranscript]);

  // =============================================
  // Disconnect from room
  // =============================================

  const disconnect = useCallback(async () => {
    if (room) {
      room.disconnect();
      setRoom(null);
      setIsConnected(false);
      setTranscript([]);
    }
  }, [room]);

  // =============================================
  // Main CTA handler: opens transcript panel AND starts connection
  // =============================================

  const startTalking = useCallback(() => {
    // Open the transcript panel first (so user sees feedback immediately)
    setIsTranscriptOpen(true);
    // Then initiate the LiveKit connection
    connectToRoom();
  }, [connectToRoom]);

  // =============================================
  // Cleanup on unmount
  // =============================================

  useEffect(() => {
    return () => {
      if (room) {
        room.disconnect();
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      commitBufferedTranscripts();
      transcriptBufferRef.current.forEach((buffer) => {
        if (buffer.timer) {
          clearTimeout(buffer.timer);
        }
      });
    };
  }, [room, commitBufferedTranscripts]);

  // =============================================
  // Render
  // =============================================

  return (
    <div className="relative h-screen bg-black cyber-grid overflow-hidden">
      {/* High contrast grid overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-30">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.1) 39px, rgba(255,255,255,0.1) 40px),
                           repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(255,255,255,0.1) 39px, rgba(255,255,255,0.1) 40px)`,
          }}
        />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col h-full min-h-0">
        {/* Header - angular borders */}
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

          {/* Center: Talk to Tetra button - clicking this starts the voice connection */}
          <button
            onClick={startTalking}
            disabled={isConnecting}
            className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 group pt-12 pb-4 cursor-pointer disabled:cursor-wait"
            style={{ color: "rgb(253, 247, 228)" }}
          >
            {/* Tetrahedron icon with glow effect */}
            <div
              className={`w-14 h-14 relative group-hover:scale-110 transition-transform duration-300 ${isConnected ? "tetra-glow-active" : "tetra-glow"}`}
            >
              <TetrahedronIcon isConnected={isConnected} />
            </div>
            <span className="font-mono text-xs uppercase tracking-[0.2em] opacity-90 group-hover:opacity-100 transition-opacity">
              {isConnecting
                ? "Connecting..."
                : isConnected
                  ? "Connected"
                  : "Talk to Tetra"}
            </span>
          </button>

          {/* Right: Import button with modal */}
          <div className="flex items-center gap-3">
            <ImportButton />
          </div>
        </header>

        {/* Status bar - high contrast */}
        <div className="px-6 py-3 md:px-12 border-b-2 border-white bg-black">
          <div className="flex items-center gap-4 text-xs font-mono text-white">
            <span className="flex items-center gap-2">
              <span
                className={`w-2 h-2 ${isConnected ? "bg-green-400" : "bg-white"}`}
              />
              {isConnected ? "AGENT CONNECTED" : "SYSTEM ONLINE"}
            </span>
            <span className="opacity-50">|</span>
            <span className="uppercase tracking-wider">
              {selectedDay
                .toLocaleDateString("en-US", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })
                .toUpperCase()}
            </span>
            <span className="opacity-50">|</span>
            <span className="opacity-80">
              {localEvents?.length || 0} EVENTS • {tasks.length} TASKS
            </span>
          </div>
        </div>

        {/* Main dashboard content */}
        <main className="flex-1 p-8 md:p-12 min-h-0 overflow-hidden">
          {/* 
            Layout grid:
            - When transcript is closed: 2 equal columns (calendar + tasks)
            - When transcript is open: 2fr 2fr 1fr (calendar + tasks + transcript)
            - Mobile: stacks vertically
          */}
          <div
            className={`grid gap-8 h-full min-h-0 max-w-[1800px] mx-auto ${
              isTranscriptOpen
                ? "grid-cols-1 lg:grid-cols-[2fr_2fr_1fr]"
                : "grid-cols-1 lg:grid-cols-2"
            }`}
          >
            {/* Timeline Panel (Calendar) */}
            <div className="glass-panel p-8 flex flex-col border-2 border-white min-h-0">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-white">
                    TIMELINE
                  </h2>
                  <DayNavigator currentDay={selectedDayString} />
                </div>
                <TimezoneDisplay profileTimezone={profileTimezone} />
              </div>

              {/* Timeline view */}
              <div className="flex-1 min-h-0">
                <Timeline
                  events={localEvents || []}
                  showCurrentTime={isToday}
                />
              </div>
            </div>

            {/* Tasks + System Feed Panel (middle column) */}
            <div className="flex flex-col gap-8 min-h-0">
              {/* Tasks Panel */}
              <div className="glass-panel p-8 flex-1 border-2 border-white min-h-0">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-white">
                    TASKS
                  </h2>
                  <button
                    onClick={openCreateTaskModal}
                    className="btn-neon-secondary text-xs px-4 py-2"
                  >
                    ADD TASK
                  </button>
                </div>
                <TasksList
                  tasks={tasks}
                  onEditTask={openEditTaskModal}
                  onToggleDone={handleToggleTaskDone}
                />
              </div>

              {/* System Feed Panel - kept under tasks as requested */}
              <div className="glass-panel p-8 h-48 border-2 border-white order-last md:order-none">
                <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-white opacity-60 mb-6">
                  SYSTEM FEED
                </h2>
                <div className="space-y-2 text-xs font-mono text-white opacity-80">
                  <p className="flex items-center gap-2">
                    <span className="opacity-50">[{sessionTime}]</span>
                    <span className="text-white">SESSION_INIT</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="opacity-50">[{sessionTime}]</span>
                    <span className="opacity-70">Dashboard loaded</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="opacity-50">[--:--:--]</span>
                    <span className="opacity-60 italic">
                      {isConnected
                        ? "Voice agent active"
                        : "Awaiting voice input..."}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Transcript/Voice Panel (right column) - only shown when open */}
            {isTranscriptOpen && (
              <div className="glass-panel p-6 flex flex-col border-2 border-white min-h-0 animate-fade-in">
                {/* Header with controls */}
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-white">
                    TRANSCRIPT
                  </h2>
                  <div className="flex items-center gap-2">
                    {/* Connection status indicator */}
                    <span
                      className={`font-mono text-xs px-2 py-1 border ${
                        isConnected
                          ? "border-green-500 text-green-400 bg-green-500/10"
                          : isConnecting
                            ? "border-yellow-500 text-yellow-400 bg-yellow-500/10"
                            : "border-zinc-700 text-zinc-500"
                      }`}
                    >
                      {isConnected ? "LIVE" : isConnecting ? "..." : "OFF"}
                    </span>
                    {/* Collapse button */}
                    <button
                      onClick={() => setIsTranscriptOpen(false)}
                      className="text-white/60 hover:text-white transition-colors p-1"
                      aria-label="Collapse transcript"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Error display */}
                {error && (
                  <div className="text-red-400 font-mono text-xs mb-4 p-2 border border-red-500/30 bg-red-500/10">
                    {error}
                  </div>
                )}

                {/* Waiting for agent indicator */}
                {isConnected &&
                  isWaitingForAgent &&
                  participants.length === 0 && (
                    <p className="text-yellow-400 font-mono text-xs mb-4 animate-pulse">
                      ⏳ Waiting for agent to join...
                    </p>
                  )}

                {/* Connect/Disconnect controls */}
                <div className="mb-4">
                  {!isConnected && !isConnecting ? (
                    <button
                      onClick={connectToRoom}
                      className="btn-neon-primary text-xs w-full py-2"
                    >
                      Connect
                    </button>
                  ) : isConnecting ? (
                    <button
                      disabled
                      className="btn-neon-secondary text-xs w-full py-2 opacity-50 cursor-not-allowed"
                    >
                      Connecting...
                    </button>
                  ) : (
                    <button
                      onClick={disconnect}
                      className="btn-neon-secondary text-xs w-full py-2"
                    >
                      Disconnect
                    </button>
                  )}
                </div>

                {/* Participants info */}
                {isConnected && participants.length > 0 && (
                  <div className="mb-4 text-xs font-mono text-zinc-500">
                    Active: {participants.join(", ")}
                  </div>
                )}

                {/* Transcript list */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {transcript.length === 0 ? (
                    <p className="text-zinc-600 font-mono text-xs italic">
                      {isConnected
                        ? "Waiting for conversation..."
                        : "Click Connect to start"}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {transcript.map((entry, i) => (
                        <div
                          key={i}
                          className="border-l-2 border-white/30 pl-3"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className={`font-mono text-xs uppercase ${
                                entry.speaker === "Tetra"
                                  ? "text-cyan-400"
                                  : "text-fuchsia-400"
                              }`}
                            >
                              {entry.speaker}:
                            </span>
                            <span className="text-xs text-zinc-600">
                              {entry.timestamp.toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-zinc-300 font-mono text-xs">
                            {renderTranscriptText(entry.text)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Gmail Connection Prompt - bottom-right toast */}
        {showGmailPrompt && arcadeConfigured && (
          <div className="fixed bottom-20 right-6 z-50 animate-fade-in">
            <div className="glass-panel border-2 border-white p-4 max-w-xs">
              {/* Header */}
              <div className="flex items-center gap-2 mb-3">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                <span className="font-mono text-xs uppercase tracking-wider text-white">
                  Gmail Integration
                </span>
              </div>

              {/* Message */}
              <p className="font-mono text-xs text-white/80 mb-4">
                Connect Gmail to let Tetra summarize your emails.
              </p>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={handleGmailConnect}
                  disabled={isGmailAuthorizing}
                  className="flex-1 btn-neon-primary text-xs py-2 disabled:opacity-50 disabled:cursor-wait"
                >
                  {isGmailAuthorizing ? "Connecting..." : "Connect"}
                </button>
                <button
                  onClick={handleGmailSnooze}
                  disabled={isGmailAuthorizing}
                  className="btn-neon-secondary text-xs py-2 px-3 disabled:opacity-50"
                  title="Snooze for 14 days"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer - angular */}
        <footer className="px-6 py-4 md:px-12 border-t-2 border-white">
          <div className="flex items-center justify-between text-xs font-mono text-white">
            <span className="uppercase tracking-wider">
              TETRA OS // HACKATHON BUILD
            </span>
            <span className="opacity-60 uppercase tracking-wider">
              CONNECTION: {isConnected ? "ACTIVE" : "SECURE"}
            </span>
          </div>
        </footer>
      </div>

      {/* Hidden audio element for agent audio playback */}
      <audio ref={audioRef} autoPlay playsInline style={{ display: "none" }} />

      <TaskModal
        isOpen={isTaskModalOpen}
        mode={taskModalMode}
        task={activeTask}
        selectedDayString={selectedDayString}
        onClose={closeTaskModal}
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
        isSaving={isTaskSaving}
        errorMessage={taskError}
      />
    </div>
  );
}

// =============================================
// Timeline component (moved from page.tsx)
// =============================================

function Timeline({
  events,
  showCurrentTime,
}: {
  events: Event[];
  showCurrentTime: boolean;
}) {
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const getEventStyle = (event: Event) => {
    if (!event.start) return {};

    const start = new Date(event.start);
    const end = event.end
      ? new Date(event.end)
      : new Date(start.getTime() + 60 * 60 * 1000);

    const startHour = start.getHours() + start.getMinutes() / 60;
    const endHour = end.getHours() + end.getMinutes() / 60;
    const duration = endHour - startHour;

    const hourHeight = 60;
    const top = startHour * hourHeight;
    const height = Math.max(duration * hourHeight, 30);

    return {
      top: `${top}px`,
      height: `${height}px`,
    };
  };

  return (
    <div className="relative h-full">
      <div className="h-full overflow-y-auto custom-scrollbar">
        <div className="relative min-h-[1440px]">
          {/* Hour slots */}
          <div className="relative">
            {hours.map((hour) => (
              <div
                key={hour}
                className="flex items-start h-[60px] border-t border-white/20"
              >
                <div className="w-16 pr-3 text-right text-xs font-mono text-white opacity-60 -mt-2">
                  {hour.toString().padStart(2, "0")}:00
                </div>
                <div className="flex-1 relative" />
              </div>
            ))}
            <div className="flex items-start h-[20px] border-t border-white/20">
              <div className="w-16 pr-3 text-right text-xs font-mono text-white opacity-60 -mt-2">
                23:59
              </div>
              <div className="flex-1 relative" />
            </div>
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

// =============================================
// Current time indicator (moved from page.tsx)
// =============================================

function CurrentTimeIndicator() {
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
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

// =============================================
// Tasks list component (moved from page.tsx)
// =============================================

function TasksList({
  tasks,
  onEditTask,
  onToggleDone,
}: {
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onToggleDone: (task: Task) => void;
}) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-white font-mono text-sm opacity-80">
          NO TASKS FOR TODAY
        </p>
        <p className="text-white text-xs mt-2 opacity-60">
          ADD TASKS WITH VOICE OR MANUALLY
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 overflow-y-auto custom-scrollbar max-h-[calc(100%-2rem)]">
      {tasks.map((task) => (
        <div
          key={task.id}
          className={`group p-4 border-2 transition-colors cursor-pointer ${
            task.done
              ? "border-white/20 bg-black/40 opacity-60"
              : "border-white/40 bg-black/20 hover:bg-white/5"
          }`}
          onClick={() => onEditTask(task)}
        >
          <div className="flex items-start gap-3">
            <button
              type="button"
              aria-label={task.done ? "Mark task incomplete" : "Mark task complete"}
              aria-pressed={task.done}
              onClick={(event) => {
                event.stopPropagation();
                onToggleDone(task);
              }}
              className={`w-4 h-4 border-2 mt-0.5 flex-shrink-0 flex items-center justify-center ${
                task.done ? "border-white bg-white/20" : "border-white/60"
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
            </button>

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
                  {new Date(task.due)
                    .toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })
                    .toUpperCase()}
                </p>
              )}
              {task.description && (
                <p className="text-xs text-white/60 mt-1 truncate font-mono">
                  {task.description}
                </p>
              )}
            </div>

            <button
              onClick={(event) => {
                event.stopPropagation();
                onEditTask(task);
              }}
              className="text-xs font-mono uppercase tracking-[0.2em] text-white/60 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
            >
              EDIT
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================
// Tetrahedron icon with glow support
// =============================================

function TetrahedronIcon({ isConnected }: { isConnected?: boolean }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className="w-full h-full"
      style={{ color: "rgb(253, 247, 228)" }}
    >
      {/* Outer triangle */}
      <polygon
        points="50,10 10,90 90,90"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className={isConnected ? "animate-pulse" : ""}
      />
      {/* Inner 3D face - left */}
      <polygon
        points="50,10 50,60 10,90"
        fill="currentColor"
        fillOpacity={isConnected ? "0.2" : "0.1"}
        stroke="currentColor"
        strokeWidth="1"
      />
      {/* Inner 3D face - right */}
      <polygon
        points="50,10 50,60 90,90"
        fill="currentColor"
        fillOpacity={isConnected ? "0.15" : "0.05"}
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

// =============================================
// Utility: format time for system feed
// =============================================

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
