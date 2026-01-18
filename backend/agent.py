from datetime import datetime, timedelta
import asyncio
import json
from dateutil import parser
import os
import logging
from typing import Annotated, Optional
from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    inference,
    room_io,
    function_tool
)
from livekit.plugins import (
    noise_cancellation,
    silero,
)
from livekit.plugins.turn_detector.multilingual import MultilingualModel
from supabase import Client, ClientOptions, create_client

# MCP (Arcade Gateway -> Gmail tools)
# Note: LiveKit Agents requires the optional `mcp` extra for this import to work:
#   pip install 'livekit-agents[mcp]'
from livekit.agents.llm.mcp import MCPServerHTTP

logger = logging.getLogger("Tetra")

load_dotenv(".env.local")


class TetraAgent(Agent):
    def __init__(self, room: rtc.Room):
        self.room = room

        super().__init__(
            instructions=f"""\
SYSTEM IDENTITY:
You are TETRA, a proactive personal productivity partner.
Your goal is to bridge the gap between "I want to" and "I'm doing it."

OPERATIONAL PARAMETERS
- TONE: Casual, American, and conversational.
- TIME FORMAT: 12-hour clock (2 pm).
- DATE FORMAT: Natural/Relative.

EMAIL (GMAIL) CAPABILITIES (READ-ONLY):
- You MAY use Arcade Gmail tools to read/summarize emails if available.
- IMPORTANT: This agent is a voice assistant. Prefer short, skimmable summaries.
- NEVER send emails, create drafts, delete, label, or modify the user's mailbox.
- If an email tool call returns an authorization URL, tell the user to open it to connect Gmail,
  then retry the email request.
- When summarizing emails, do NOT read long bodies aloud; summarize and offer to open details.
- Use these read-only tools when needed:
  - Gmail.ListEmails (recent messages)
  - Gmail.ListEmailsByHeader (filter by sender/subject)
  - Gmail.GetThread (when the user asks about the full conversation)

EMAIL ROUTING RULE (IMPORTANT):
- If the user's request is about EMAIL (e.g. "inbox", "email", "Gmail", "message", "thread",
  "sender", "subject", "unread", "search my email"), then DO NOT call calendar/task database tools
  like `get_day_context`. Use Gmail tools instead.

CORE DIRECTIVES:
1. SEMANTIC TRANSLATION:
   - "Book/Schedule" -> `schedule_event`
   - "Remind me/Task" -> `create_task`
   - "Change/Move/Reschedule" -> `update_event` or `update_task`
   - "Cancel/Delete" -> `delete_event` or `delete_task`

2. ASPIRATION TO ACTION:
   - If the user implies a goal, check `get_day_context` and propose a time.

3. CONFLICT HANDLING:
   - Check `get_day_context` before booking.
   - If updating an event, confirm the new details are correct.

ERROR HANDLING:
- If a tool fails, explain why briefly.""",
        )

    async def on_enter(self, session: AgentSession):
        # LiveKit Agents (voice) calls `on_enter(session)`; storing it makes
        # it explicit and avoids signature mismatches across versions.
        self.session = session
        logger.info("Agent joined room. Hydrating user session...")

        # 2. Find the human user to get their token
        user = None
        # In practice, the agent can enter the room slightly before the user.
        # Wait briefly so we can reliably pick up the user's Supabase token metadata.
        for _ in range(50):  # ~10s total
            # Iterate over remote participants to find the human
            for p in self.room.remote_participants.values():
                if p.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
                    user = p
                    break
            if user:
                break
            await asyncio.sleep(0.2)

        if not user:
            logger.warning("No user found in room yet. Waiting...")
            # Ideally we would wait here, but for now we log warning.
            # The agent will still work but tools will fail until user is found/re-checked.
            return

        self.user_id = user.identity

        # 3. Parse Token
        user_token = ""
        try:
            if user.metadata:
                data = json.loads(user.metadata)
                user_token = data.get("supabase_token")
        except Exception:
            # Fallback if metadata is just the string
            user_token = user.metadata

        if user_token:
            # Repo convention: frontend uses NEXT_PUBLIC_SUPABASE_*.
            # Backend expects SUPABASE_* but we fall back for convenience.
            url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
            key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

            if not url or not key:
                logger.error(
                    "Supabase env vars missing. Set SUPABASE_URL + SUPABASE_ANON_KEY in backend/.env.local "
                    "(or provide NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY). "
                    "Calendar/task DB tools will be unavailable."
                )
                self.supabase = None  # type: ignore[assignment]
            else:
                # Create the client scoped to this user
                self.supabase = create_client(
                    url,  # type: ignore
                    key,  # type: ignore
                    options=ClientOptions(
                        headers={"Authorization": f"Bearer {user_token}"})
                )
                logger.info(
                    f"Supabase client authenticated for user {self.user_id}")
        else:
            logger.error(
                "No Supabase token found in metadata. DB tools will fail.")
            self.supabase = None  # type: ignore[assignment]

        # 4. Generate Greeting
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
        and get IDs for events/tasks.
        """
        logger.info(f"Fetching context for {date}")
        if not getattr(self, "supabase", None):
            return (
                "System Alert: Calendar/task database is not configured for this session. "
                "I can still help with other tools (like Gmail) if available."
            )
        try:
            try:
                dt_object = parser.parse(date)
            except parser.ParserError:
                return f"Error: Invalid date format '{date}'."

            day_str = dt_object.strftime("%Y-%m-%d")
            start_filter = f"{day_str}T00:00:00"
            end_filter = f"{day_str}T23:59:59"

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
                    start_str = e["start"].replace('Z', '+00:00')
                    dt = datetime.fromisoformat(start_str)
                    time_str = dt.strftime("%H:%M")
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
            return f"System Alert: Database connection failed. Details: {str(e)}"

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
            start_dt = datetime.fromisoformat(start_iso.replace('Z', '+00:00'))
            end_dt = start_dt + timedelta(minutes=duration_minutes)

            data = {
                "name": title,
                "start": start_iso,
                "end": end_dt.isoformat(),
                "description": notes or "",
                "owner": self.user_id  # Explicitly set owner to satisfy RLS
            }

            self.supabase.table("events").insert(data).execute()
            return f"Confirmed. Scheduled '{title}' for {start_dt.strftime('%H:%M')}."
        except Exception as e:
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

            self.supabase.table("events").update(
                updates).eq("id", event_id).execute()
            return f"Event {event_id} updated successfully."
        except Exception as e:
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
            return "Event deleted."
        except Exception as e:
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
            self.supabase.table("tasks").insert(data).execute()
            return f"Commitment logged: {name}"
        except Exception as e:
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

            self.supabase.table("tasks").update(
                updates).eq("id", task_id).execute()
            return "Task updated."
        except Exception as e:
            return f"Error updating task: {str(e)}"

    @function_tool()
    async def delete_task(
        self,
        task_id: Annotated[int, "The ID of the task"]
    ):
        """Permanently delete a task."""
        try:
            self.supabase.table("tasks").delete().eq("id", task_id).execute()
            return "Task deleted."
        except Exception as e:
            return f"Error deleting task: {str(e)}"

    @function_tool()
    async def mark_task_done(
        self,
        task_id: Annotated[int, "The numerical ID of the task"]
    ):
        """Mark a task as complete."""
        try:
            self.supabase.table("tasks").update(
                {"done": True}).eq("id", task_id).execute()
            return "Task marked as done. Good job."
        except Exception as e:
            return f"Error updating task: {str(e)}"


server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session(agent_name="Tetra")
async def entrypoint(ctx: JobContext):
    agent = TetraAgent(ctx.room)

    # Optional: connect this agent to Arcade's MCP Gateway so the LLM can call Gmail tools.
    #
    # Required env vars (backend/.env.local):
    # - ARCADE_MCP_URL: e.g. https://api.arcade.dev/mcp/<YOUR_GATEWAY_SLUG>
    # - ARCADE_API_KEY: used as Authorization: Bearer <key>
    #
    # User scoping:
    # - Arcade stores OAuth tokens per `Arcade-User-ID`, so we pass a stable per-user value.
    # - In this repo we name rooms like `room-${user.id}` (Supabase user id),
    #   so we derive Arcade-User-ID from the room name.
    arcade_mcp_url = os.environ.get("ARCADE_MCP_URL")
    arcade_api_key = os.environ.get("ARCADE_API_KEY")

    mcp_servers = []
    if arcade_mcp_url and arcade_api_key:
        arcade_user_id = ctx.room.name or ""
        if arcade_user_id.startswith("room-"):
            arcade_user_id = arcade_user_id.removeprefix("room-")

        # Restrict to read-only Gmail tools so the voice agent can't send/modify email.
        allowed_tools = [
            "Gmail.WhoAmI",
            "Gmail.ListEmails",
            "Gmail.ListEmailsByHeader",
            "Gmail.ListThreads",
            "Gmail.SearchThreads",
            "Gmail.GetThread",
        ]

        mcp_servers = [
            MCPServerHTTP(
                url=arcade_mcp_url,
                # Arcade MCP Gateways support streamable HTTP; this avoids legacy SSE quirks.
                transport_type="streamable_http",
                allowed_tools=allowed_tools,
                headers={
                    "Authorization": f"Bearer {arcade_api_key}",
                    # Arcade uses this header to scope OAuth tokens per application user.
                    "Arcade-User-ID": arcade_user_id,
                },
                timeout=10,
            )
        ]
    elif arcade_mcp_url or arcade_api_key:
        # Partial config: log a hint rather than crashing the agent.
        logger.warning(
            "Arcade MCP is partially configured. Set BOTH ARCADE_MCP_URL and ARCADE_API_KEY to enable Gmail tools."
        )

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
        # Expose Arcade tools (like Gmail) via MCP to the LLM.
        mcp_servers=mcp_servers,
    )

    logger.info("Starting session")

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
