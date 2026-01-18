from datetime import datetime, timedelta
import asyncio
import json
from dateutil import parser
import os
import logging
from typing import Annotated, Optional
import base64
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
        # These are hydrated in `on_enter`. In practice the agent can enter the room
        # slightly before the user, so we also lazily hydrate them in tool calls.
        self.user_id: Optional[str] = None
        self.supabase: Optional[Client] = None

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
- TOOL YOU MUST USE FOR GMAIL AUTH UI: `prompt_gmail_connect`
  - Calling `prompt_gmail_connect` triggers the console UI to show the bottom-right
    "Gmail Integration" connect box with the Arcade authorization link.
  - If Gmail is not connected (or a Gmail tool requires authorization), you MUST call
    `prompt_gmail_connect` (do NOT just talk about the console UI).
  - After calling it, tell the user: "Click Connect in the bottom-right Gmail prompt, finish sign-in, and I’ll retry."
- When summarizing emails, do NOT read long bodies aloud; summarize and offer to open details.
- Use these read-only tools when needed:
  - Gmail.ListEmails (recent messages)
  - Gmail.ListEmailsByHeader (filter by sender/subject)
  - Gmail.GetThread (when the user asks about the full conversation)

EMAIL ROUTING RULE (IMPORTANT):
- If the user's request is about EMAIL (e.g. "inbox", "email", "Gmail", "message", "thread",
  "sender", "subject", "unread", "search my email"), then DO NOT call calendar/task database tools
  like `get_day_context`. Use Gmail tools instead.
- CRITICAL: Before attempting ANY Gmail/email tool, ALWAYS call `get_gmail_integration_state` first.
  If it returns "GMAIL_SNOOZED", do NOT use Gmail tools. Tell the user their Gmail is snoozed
  and they can reconnect from the console UI.

GMAIL TOOL-CALLING PLAYBOOK (STRICT):
- If the user asks anything email-related and Gmail is not confirmed connected:
  1) Call `get_gmail_integration_state`.
  2) If the result contains "GMAIL_NOT_CONNECTED" or says the state is unknown/not initialized:
     - Immediately call `prompt_gmail_connect(reason="<brief reason>")`.
     - Do NOT attempt Gmail.* tools yet.
     - Tell the user to click Connect in the bottom-right prompt, finish sign-in, then ask you to retry.
  3) If the result contains "GMAIL_SNOOZED":
     - Do NOT call Gmail.* tools.
     - Tell the user Gmail is snoozed and they can reconnect from the console.
  4) Only if the result says "connected" may you call Gmail.* tools.

EXAMPLE (YOU MUST FOLLOW THIS PATTERN):
- User: "Check my inbox"
  - You: (call `get_gmail_integration_state`)
  - If not connected: (call `prompt_gmail_connect`), then say: "Click Connect in the bottom-right Gmail prompt..."

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

    async def on_enter(self):
        """
        LiveKit Agents calls `Agent.on_enter()` with **no arguments** in the version used
        by this repo.

        We still want access to the `AgentSession` object (to generate greetings, etc.).
        The session is available via an internal contextvar set by LiveKit right before
        calling `on_enter()`, so we hydrate `self.session` from there.
        """
        # NOTE: This is an internal LiveKit context var, but it's the most reliable way
        # to stay compatible with the installed `livekit-agents` behavior.
        session: Optional[AgentSession] = None
        try:
            from livekit.agents.voice import agent_activity as _aa  # type: ignore

            data = _aa._OnEnterContextVar.get()  # pyright: ignore[reportPrivateUsage]
            session = getattr(data, "session", None)
        except Exception:
            session = None

        if session is None:
            logger.warning("on_enter() called but AgentSession was not available; skipping greeting.")
            return

        self.session = session
        logger.info("Agent joined room. Hydrating user session...")

        # Hydrate Supabase/user context. IMPORTANT: the agent can join before the user;
        # if the user isn't present yet, we kick off a background "late hydrate" task
        # so DB-backed tools (including Gmail status) start working as soon as the user joins.
        hydrated = await self._ensure_user_and_supabase(max_wait_seconds=10)
        if not hydrated:
            logger.warning(
                "User not present yet (or missing metadata). Will hydrate DB context when user joins."
            )
            asyncio.create_task(self._ensure_user_and_supabase(max_wait_seconds=120))

        # 4. Generate Greeting
        await self.session.generate_reply(
            instructions="Greet the user and offer your assistance.",
            allow_interruptions=True,
        )

    async def _ensure_user_and_supabase(self, max_wait_seconds: int = 10) -> bool:
        """
        Ensure we have `self.user_id` and an authenticated `self.supabase` client.

        Why this exists:
        - In LiveKit, the agent can enter the room before the user.
        - Our previous implementation returned early from `on_enter`, which meant DB-backed
          tools would *permanently* fail for that session.
        - This helper can be called from `on_enter` and from individual tools to recover.
        """
        if getattr(self, "supabase", None) and getattr(self, "user_id", None):
            return True

        if not getattr(self, "room", None):
            return False

        # Find the human user participant (non-agent) and extract their Supabase JWT from metadata.
        user = None
        attempts = max(1, int(max_wait_seconds / 0.2))
        for _ in range(attempts):
            for p in self.room.remote_participants.values():
                if p.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
                    user = p
                    break
            if user:
                break
            await asyncio.sleep(0.2)

        if not user:
            return False

        self.user_id = user.identity

        # Parse token from participant metadata. We set this in `/api/livekit-token` on the frontend.
        user_token = ""
        try:
            if user.metadata:
                data = json.loads(user.metadata)
                user_token = data.get("supabase_token") or ""
        except Exception:
            # Fallback if metadata is just the raw token string
            user_token = user.metadata or ""

        if not user_token:
            logger.warning("No Supabase token found in LiveKit participant metadata yet.")
            self.supabase = None
            return False

        # Repo convention: frontend uses NEXT_PUBLIC_SUPABASE_*.
        # Backend expects SUPABASE_* but we fall back for convenience.
        url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

        if not url or not key:
            logger.error(
                "Supabase env vars missing. Set SUPABASE_URL + SUPABASE_ANON_KEY in backend/.env.local "
                "(or provide NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY)."
            )
            self.supabase = None
            return False

        # Create the client scoped to this user's JWT (RLS applies properly).
        self.supabase = create_client(
            url,  # type: ignore[arg-type]
            key,  # type: ignore[arg-type]
            options=ClientOptions(headers={"Authorization": f"Bearer {user_token}"}),
        )
        logger.info(f"Supabase client authenticated for user {self.user_id}")
        return True

    def _email_from_supabase_jwt(self, jwt_token: str) -> Optional[str]:
        """
        Extract the user's email from a Supabase JWT without verifying the signature.

        Why:
        - Arcade's "Arcade.dev users only" verification often expects the provided `user_id`
          to match the currently signed-in Arcade account identity (email).
        - We already have the user's Supabase JWT in LiveKit participant metadata.

        Security:
        - We do NOT trust this value for authorization decisions. It's only used as an
          identifier for Arcade token scoping.
        """
        try:
            parts = jwt_token.split(".")
            if len(parts) < 2:
                return None
            payload_b64 = parts[1]
            # base64url decode with padding
            payload_b64 += "=" * (-len(payload_b64) % 4)
            payload_json = base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8")
            payload = json.loads(payload_json)
            email = payload.get("email")
            return email if isinstance(email, str) and email else None
        except Exception:
            return None

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

    # --- GMAIL INTEGRATION STATE ---

    @function_tool()
    async def get_gmail_integration_state(self):
        """
        Check if the user has snoozed Gmail integration.
        ALWAYS call this BEFORE attempting any Gmail/email tool.
        If snoozed, do NOT attempt Gmail tools - tell the user their Gmail is snoozed.
        """
        logger.info("Checking Gmail integration state...")
        # This tool depends on the `user_profiles` table; ensure Supabase is hydrated.
        # This avoids the common "agent joined before user" race.
        hydrated = await self._ensure_user_and_supabase(max_wait_seconds=3)
        if not hydrated or not getattr(self, "supabase", None) or not getattr(self, "user_id", None):
            return (
                "Gmail integration state: unknown (not fully initialized yet). "
                "If you want Gmail features, open the console UI and click **Connect Gmail** "
                "when prompted."
            )
        try:
            # Query user profile for gmail_snoozed_until
            response = (
                self.supabase.table("user_profiles")
                .select("gmail_snoozed_until, gmail_connected")
                .eq("id", self.user_id)
                .single()
                .execute()
            )
            
            profile = response.data
            if not profile:
                return "Gmail integration state: unknown (no profile). You may attempt Gmail tools."
            
            snoozed_until = profile.get("gmail_snoozed_until")
            is_connected = profile.get("gmail_connected", False)
            
            # Check if snooze is active
            if snoozed_until:
                try:
                    snooze_dt = datetime.fromisoformat(snoozed_until.replace("Z", "+00:00"))
                    if snooze_dt > datetime.now(snooze_dt.tzinfo):
                        # User has snoozed Gmail integration
                        return (
                            "GMAIL_SNOOZED: The user has snoozed Gmail integration. "
                            "Do NOT attempt Gmail tools. Tell them: 'You've snoozed Gmail integration. "
                            "You can reconnect it anytime from the console.'"
                        )
                except Exception:
                    # If timestamp parsing fails, don't block the user—treat as not snoozed.
                    logger.warning("Failed to parse gmail_snoozed_until; treating as not snoozed.")
            
            # Return connected status
            if is_connected:
                return "Gmail integration: connected. You may use Gmail tools."
            else:
                return (
                    "GMAIL_NOT_CONNECTED: Gmail isn't connected yet. "
                    "Call `prompt_gmail_connect` so the user can click Connect in the console UI, "
                    "then retry the Gmail request."
                )
                
        except Exception as e:
            logger.error(f"Error checking Gmail state: {e}")
            return f"Could not check Gmail state: {str(e)}. You may attempt Gmail tools."

    async def _publish_ui_event(self, event: str, payload: dict) -> bool:
        """
        Publish a small UI event to the LiveKit room so the frontend can react (e.g. show a toast).

        Implementation note:
        - The Next.js console listens to LiveKit `RoomEvent.DataReceived` and can parse JSON.
        - We include a `text` field so the message also appears in the transcript UI as a fallback.
        """
        try:
            if not getattr(self, "room", None) or not getattr(self.room, "local_participant", None):
                logger.warning("Cannot publish UI event: agent is not attached to a LiveKit room yet.")
                return False

            message = {
                "type": "ui_event",
                "event": event,
                **payload,
            }

            # Reliable data messages are appropriate for UI nudges (don't drop them).
            #
            # IMPORTANT:
            # - LiveKit's Python `publish_data` is async; if we don't await it, the message is never sent.
            # - The frontend decodes bytes -> string -> JSON, and LiveKit will UTF-8 encode strings for us.
            await self.room.local_participant.publish_data(
                json.dumps(message),
                reliable=True,
                topic="ui",
            )
            return True
        except Exception as e:
            logger.warning(f"Failed to publish UI event {event}: {e}")
            return False

    @function_tool()
    async def prompt_gmail_connect(
        self,
        reason: Annotated[Optional[str], "Optional reason why Gmail is needed (shown to the user)."] = None,
    ):
        """
        Ask the console UI to show the bottom-right Gmail connect prompt.

        Use this when Gmail tools require OAuth / the user hasn't connected Gmail yet.
        """
        # Keep the user-facing message short; the frontend has the actual Connect button + OAuth flow.
        fallback_text = (
            "Gmail isn’t connected yet. Please click **Connect** in the bottom-right Gmail prompt, "
            "finish sign-in, then tell me to retry."
        )

        sent = await self._publish_ui_event(
            "gmail_connect_required",
            {
                "reason": reason,
                # Include `text` so existing transcript UI shows a helpful instruction even if the toast fails.
                "text": fallback_text,
            },
        )

        if sent:
            return (
                "Requested Gmail connection in the console UI. "
                "Please click Connect in the bottom-right Gmail prompt to sign in."
            )
        return fallback_text


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
        # Arcade stores OAuth tokens per `Arcade-User-ID`. If Arcade is configured to verify
        # against Arcade.dev users, this should usually be the user's email.
        #
        # We try to derive email from the Supabase JWT stored in the LiveKit participant metadata.
        # If the user hasn't joined yet, we fall back to the room name (uuid) so the agent can start.
        arcade_user_id: str = ""

        async def _derive_arcade_user_id(max_wait_seconds: int = 10) -> str:
            attempts = max(1, int(max_wait_seconds / 0.2))
            for _ in range(attempts):
                for p in ctx.room.remote_participants.values():
                    if p.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
                        # Try to read Supabase JWT from participant metadata (set by frontend).
                        user_token = ""
                        try:
                            if p.metadata:
                                data = json.loads(p.metadata)
                                user_token = data.get("supabase_token") or ""
                        except Exception:
                            user_token = p.metadata or ""
                        if user_token:
                            email = agent._email_from_supabase_jwt(user_token)
                            if email:
                                return email
                await asyncio.sleep(0.2)

            # Fallback: room name convention is `room-${user.id}`
            rid = ctx.room.name or ""
            if rid.startswith("room-"):
                rid = rid.removeprefix("room-")
            return rid

        arcade_user_id = await _derive_arcade_user_id(max_wait_seconds=10)

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
