from datetime import datetime, timedelta, timezone
import json
from dateutil import parser
import os
import logging
from typing import Annotated, Optional
from dotenv import load_dotenv
from livekit import rtc
try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    inference,
    room_io,
    function_tool,
)
from livekit.agents.job import AutoSubscribe
from livekit.plugins import (
    noise_cancellation,
    silero,
)
from livekit.plugins.turn_detector.multilingual import MultilingualModel
from supabase import create_client

logger = logging.getLogger("Tetra")

load_dotenv(".env.local")


class TetraAgent(Agent):
    def __init__(self, room: rtc.Room):
        self.room = room
        # 1. Identify User
        user = next(iter(self.room.remote_participants.values()), None)
        self.user_id = user.identity if user else None
        self.user_timezone = ZoneInfo("America/New_York")  # Default to EST

        # 3. Parse Token
        user_token = ""
        try:
            if user and user.metadata:
                data = json.loads(user.metadata)
                user_token = data.get("supabase_token")
        except Exception:
            # Fallback if metadata is just the string
            user_token = user.metadata if user else ""

        if user_token:
            url = os.environ.get("SUPABASE_URL")
            key = os.environ.get("SUPABASE_ANON_KEY")

            from supabase import ClientOptions
            # Create the client scoped to this user
            self.supabase = create_client(
                url,  # type: ignore
                key,  # type: ignore
                options=ClientOptions(
                    headers={"Authorization": f"Bearer {user_token}"})
            )
            logger.info(
                f"Supabase client authenticated for user {self.user_id}")
                
            # Fetch user profile to get timezone
            try:
                profile_resp = self.supabase.table("user_profiles").select("timezone").eq("id", self.user_id).single().execute()
                if profile_resp.data and profile_resp.data.get("timezone"):
                    tz_str = profile_resp.data.get("timezone")
                    try:
                        self.user_timezone = ZoneInfo(tz_str)
                        logger.info(f"User timezone set to {tz_str}")
                    except Exception:
                        logger.warning(f"Invalid timezone {tz_str}, falling back to default")
            except Exception as e:
                logger.warning(f"Could not fetch user profile: {e}")
                
        else:
            logger.error(
                "No Supabase token found in metadata. DB tools will fail.")
            # Fallback to anon key to prevent crash
            url = os.environ.get("SUPABASE_URL")
            key = os.environ.get("SUPABASE_ANON_KEY")
            self.supabase = create_client(url, key)  # type: ignore

        now_local = datetime.now(self.user_timezone)

        super().__init__(
            instructions=f"""\
SYSTEM IDENTITY:
You are TETRA, a proactive productivity coach.
Current Time: {now_local.strftime("%I:%M %p")} ({self.user_timezone.key})
Current Date: {now_local.strftime("%A, %Y-%m-%d")}

Your goal is not just to manage the user's schedule, but to optimize their energy and sustainability. You bridge the gap between "I want to" and "I'm doing it" while ensuring the user doesn't burn out.

OPERATIONAL PARAMETERS
- TONE: Casual, American, conversational, but authoritative on wellness (like a friendly personal trainer).
- TIME FORMAT: 12-hour clock (2 pm).
- DATE FORMAT: Natural/Relative.

CORE DIRECTIVES:

1. SEMANTIC TRANSLATION & TOOL MAPPING:
   - "Book/Schedule" -> `schedule_event`
   - "Remind me/Task" -> `create_task`
   - "Change/Move/Reschedule" -> `update_event` or `update_task`
   - "Cancel/Delete" -> `delete_event` or `delete_task`
   - "What's up?/Summary/How does my day look?" -> `get_day_context` (and synthesize findings)

2. CONSTRUCTIVE FRICTION (THE "TRAINER" PROTOCOL):
   - **Do not be a "Yes Man."** If a user requests a schedule that leads to burnout (e.g., back-to-back meetings with no food, working at 3 AM), challenge it.
   - **Advise on "How":** Don't just book the time; suggest the preparation. (e.g., "I can book that deep work session, but you’ve got a meeting right before. Want to add a 15-minute buffer to reset?")
   - **Stress-Test Goals:** If the user implies a massive goal, break it down. Don't let them commit to the impossible.

3. WELLNESS INJECTION:
   - **Promote Healthy Habits:** When scanning `get_day_context`, look for sedentary blocks. Propose "movement snacks," hydration breaks, or earlier bedtimes.
   - **Protect Sleep & Focus:** Guard the user's downtime as aggressively as their work time.

4. CONTEXTUAL SUMMARIES:
   - When asked for a summary (Day/Week), do not just list events chronologically.
   - Group them by "energy vibe" (e.g., "Your morning is heavy on calls, but the afternoon is wide open for deep work.")
   - Highlight conflicts or tight spots immediately.

ERROR HANDLING:
- If a tool fails, explain why briefly and offer a manual workaround or alternative time.""",
        )

    async def on_enter(self):
        await self.greet()

    async def greet(self):
        await self.session.generate_reply(
            instructions="Greet the user and offer your assistance.",
            allow_interruptions=True,
        )

    @function_tool()
    async def get_day_context(
        self,
        date: Annotated[str, "The target date. YYYY-MM-DD."]
    ):
        """
        CRITICAL: Call this BEFORE scheduling or updating to check availability 
        and get IDs for events/tasks. Please use the date format YYYY-MM-DD.
        """
        logger.info(f"Fetching context for {date}")
        try:
            try:
                dt_object = parser.parse(date)
            except parser.ParserError:
                return f"Error: Invalid date format '{date}'. Please use YYYY-MM-DD."

            day_str = dt_object.strftime("%Y-%m-%d")
            
            # Create timezone-aware datetime for the start of the day in user's timezone
            # Then convert to UTC for querying
            start_local = datetime.combine(dt_object.date(), datetime.min.time()).replace(tzinfo=self.user_timezone)
            end_local = datetime.combine(dt_object.date(), datetime.max.time()).replace(tzinfo=self.user_timezone)
            
            start_utc = start_local.astimezone(timezone.utc)
            end_utc = end_local.astimezone(timezone.utc)
            
            start_filter = start_utc.isoformat()
            end_filter = end_utc.isoformat()

            events_response = (
                self.supabase.table("events")
                .select("*")
                .gte("start", start_filter)
                .lte("start", end_filter)
                .order("start")
                .execute()
            )
            events = events_response.data

            tasks_response = (
                self.supabase.table("tasks")
                .select("*")
                .eq("done", False)
                .execute()
            )
            tasks = tasks_response.data

            context_str = f"## STATUS REPORT FOR {day_str}\n"

            if not events:
                context_str += "[TIMELINE]: Clear. No fixed events.\n"
            else:
                context_str += "[TIMELINE]:\n"
                for e in events:
                    # Parse UTC time from DB
                    start_str = e["start"].replace('Z', '+00:00')
                    dt_utc = datetime.fromisoformat(start_str)
                    
                    # Convert to user timezone for display
                    dt_local = dt_utc.astimezone(self.user_timezone)
                    time_str = dt_local.strftime("%H:%M")
                    
                    name = e.get("name", "Untitled")
                    # ADDED ID HERE so the LLM can reference it for updates
                    context_str += f"- {time_str}: {name} (ID: {e['id']})\n"

            context_str += "\n[INTENT LEDGER / TASKS]:\n"
            if not tasks:
                context_str += "- No open loops.\n"
            else:
                for t in tasks:
                    due = f" (Due: {t['due']})" if t.get("due") else ""
                    name = t.get("name", "Untitled")
                    context_str += f"- [ ] {name}{due} (ID: {t['id']})\n"

            return context_str

        except Exception as e:
            logger.error(f"Error getting day context: {e}", exc_info=True)
            return f"System Alert: Database connection failed. Details: {str(e)}"

    async def _broadcast_change(self, entity: str, action: str, data: dict):
        """Broadcast a change to the room using LiveKit data messages."""
        try:
            payload = json.dumps({
                "type": f"{entity}_update",
                "action": action,
                "data": data
            })
            await self.room.local_participant.publish_data(
                payload.encode("utf-8"),
                reliable=True
            )
            logger.info(f"Broadcasted {entity} {action}: {data}")
        except Exception as e:
            logger.error(f"Error broadcasting change: {e}")

    # --- EVENT TOOLS ---

    @function_tool()
    async def schedule_event(
        self,
        title: Annotated[str, "Title of the event"],
        start_iso: Annotated[str, "Start time in ISO 8601"],
        duration_minutes: Annotated[int, "Duration in minutes"] = 60,
        notes: Annotated[Optional[str], "Optional notes"] = None
    ):
        """Schedule a new calendar event."""
        logger.info(f"Scheduling: {title}")
        try:
            # Parse input time
            # If naive, assume user timezone. If aware, convert to UTC.
            dt = datetime.fromisoformat(start_iso.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=self.user_timezone)
            
            start_dt_utc = dt.astimezone(timezone.utc)
            end_dt_utc = start_dt_utc + timedelta(minutes=duration_minutes)

            data = {
                "name": title,
                "start": start_dt_utc.isoformat(),
                "end": end_dt_utc.isoformat(),
                "description": notes or "",
                "owner": self.user_id  # Explicitly set owner to satisfy RLS
            }

            response = self.supabase.table("events").insert(data).select().execute()
            
            # Broadcast the change if successful
            if response.data:
                await self._broadcast_change("event", "INSERT", response.data[0])
            
            # Return confirmation in user's local time
            start_local = start_dt_utc.astimezone(self.user_timezone)
            return f"Confirmed. Scheduled '{title}' for {start_local.strftime('%H:%M')}."
        except Exception as e:
            logger.error(f"Error scheduling event: {e}", exc_info=True)
            return f"Failed to schedule: {str(e)}"

    @function_tool()
    async def update_event(
        self,
        event_id: Annotated[int, "The ID of the event to update"],
        title: Annotated[Optional[str], "New title"] = None,
        start_iso: Annotated[Optional[str], "New start time ISO 8601"] = None,
        duration_minutes: Annotated[Optional[int], "New duration"] = None,
        notes: Annotated[Optional[str], "New notes"] = None
    ):
        """Update an existing event. Only provide fields that need changing."""
        logger.info(f"Updating event {event_id}")
        try:
            updates = {}
            if title:
                updates["name"] = title
            if notes:
                updates["description"] = notes

            # Handle time logic if start or duration changes
            if start_iso or duration_minutes:
                # We need to fetch the current event to calculate end time correctly
                # if only one of the two variables is provided.
                curr = self.supabase.table("events").select(
                    "*").eq("id", event_id).execute()
                if not curr.data:
                    return "Event not found."

                current_event = curr.data[0]

                # Determine base start time
                new_start = start_iso if start_iso else current_event["start"]
                start_dt = datetime.fromisoformat(
                    new_start.replace('Z', '+00:00'))

                # Determine duration
                if duration_minutes:
                    minutes = duration_minutes
                else:
                    # Calculate previous duration
                    old_start = datetime.fromisoformat(
                        current_event["start"].replace('Z', '+00:00'))
                    old_end = datetime.fromisoformat(
                        current_event["end"].replace('Z', '+00:00'))
                    minutes = (old_end - old_start).total_seconds() / 60

                end_dt = start_dt + timedelta(minutes=minutes)

                updates["start"] = new_start
                updates["end"] = end_dt.isoformat()

            response = self.supabase.table("events").update(
                updates).eq("id", event_id).select().execute()
            
            # Broadcast the change
            if response.data:
                await self._broadcast_change("event", "UPDATE", response.data[0])

            return f"Event {event_id} updated successfully."
        except Exception as e:
            logger.error(f"Error updating event: {e}", exc_info=True)
            return f"Error updating event: {str(e)}"

    @function_tool()
    async def delete_event(
        self,
        event_id: Annotated[int, "The ID of the event to delete"]
    ):
        """Remove an event from the calendar."""
        logger.info(f"Deleting event {event_id}")
        try:
            self.supabase.table("events").delete().eq("id", event_id).execute()
            # Broadcast just the ID for deletion
            await self._broadcast_change("event", "DELETE", {"id": event_id})
            return "Event deleted."
        except Exception as e:
            logger.error(f"Error deleting event: {e}", exc_info=True)
            return f"Error deleting event: {str(e)}"

    # --- TASK TOOLS ---

    @function_tool()
    async def create_task(
        self,
        name: Annotated[str, "The content of the task"],
        due_iso: Annotated[Optional[str], "Optional due date ISO"] = None
    ):
        """Log a new task."""
        try:
            data = {
                "name": name,
                "done": False,
                "due": due_iso,
                "owner": self.user_id  # Explicitly set owner
            }
            response = self.supabase.table("tasks").insert(data).select().execute()
            
            # Broadcast change
            if response.data:
                await self._broadcast_change("task", "INSERT", response.data[0])

            return f"Commitment logged: {name}"
        except Exception as e:
            logger.error(f"Error creating task: {e}", exc_info=True)
            return f"Error logging commitment: {str(e)}"

    @function_tool()
    async def update_task(
        self,
        task_id: Annotated[int, "The ID of the task"],
        name: Annotated[Optional[str], "New name"] = None,
        due_iso: Annotated[Optional[str], "New due date"] = None
    ):
        """Update a task's details."""
        try:
            updates = {}
            if name:
                updates["name"] = name
            if due_iso:
                updates["due"] = due_iso

            response = self.supabase.table("tasks").update(
                updates).eq("id", task_id).select().execute()

            # Broadcast change
            if response.data:
                await self._broadcast_change("task", "UPDATE", response.data[0])

            return "Task updated."
        except Exception as e:
            logger.error(f"Error updating task: {e}", exc_info=True)
            return f"Error updating task: {str(e)}"

    @function_tool()
    async def delete_task(
        self,
        task_id: Annotated[int, "The ID of the task"]
    ):
        """Permanently delete a task."""
        try:
            self.supabase.table("tasks").delete().eq("id", task_id).execute()
            # Broadcast ID for deletion
            await self._broadcast_change("task", "DELETE", {"id": task_id})
            return "Task deleted."
        except Exception as e:
            logger.error(f"Error deleting task: {e}", exc_info=True)
            return f"Error deleting task: {str(e)}"

    @function_tool()
    async def mark_task_done(
        self,
        task_id: Annotated[int, "The numerical ID of the task"]
    ):
        """Mark a task as complete."""
        try:
            response = self.supabase.table("tasks").update(
                {"done": True}).eq("id", task_id).select().execute()
            
            # Broadcast change
            if response.data:
                await self._broadcast_change("task", "UPDATE", response.data[0])

            return "Task marked as done. Good job."
        except Exception as e:
            logger.error(f"Error marking task done: {e}", exc_info=True)
            return f"Error updating task: {str(e)}"


server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session(agent_name="Tetra")
async def entrypoint(ctx: JobContext):
    session = AgentSession(
        stt=inference.STT(
            model="assemblyai/universal-streaming", language="en"),
        llm=inference.LLM(model="openai/gpt-4o"),
        tts=inference.TTS(
            model="elevenlabs/eleven_turbo_v2_5",
            voice="CwhRBWXzGAHq8TQ4Fs17",
            language="en-US"
        ),
        turn_detection=MultilingualModel(),
        vad=ctx.proc.userdata["vad"],
        preemptive_generation=True,
    )

    logger.info("Starting session...")

    logger.info(f"Connecting to room {ctx.room.name}...")
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("Waiting for participant...")
    participant = await ctx.wait_for_participant()
    logger.info(f"Participant {participant.identity} joined.")

    agent = TetraAgent(ctx.room)

    await session.start(
        agent=agent,
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=lambda params: noise_cancellation.BVCTelephony(
                ) if params.participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP else noise_cancellation.BVC(),
            ),
        ),
    )

    logger.info("Finished session")


if __name__ == "__main__":
    cli.run_app(server)
