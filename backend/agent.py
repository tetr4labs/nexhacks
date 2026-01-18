from arcadepy import Arcade
from supabase import Client, create_client, ClientOptions
from livekit.plugins.turn_detector.multilingual import MultilingualModel
from livekit.plugins import (
    noise_cancellation,
    silero,
)
from livekit.agents.job import AutoSubscribe
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    AutoSubscribe,
    JobContext,
    JobProcess,
    cli,
    inference,
    room_io,
    function_tool,
)
from livekit import rtc
from dotenv import load_dotenv
import base64
from typing import Annotated, Optional
import logging
import os
from dateutil import parser
import json
import asyncio
from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo  # type: ignore

# Arcade SDK for direct Gmail tool calls (bypasses MCP which has timing issues)
# This is the same approach used by read_gmail.py, which works reliably.

logger = logging.getLogger("Tetra")

load_dotenv(".env.local")


class TetraAgent(Agent):
    def __init__(self, room: rtc.Room, arcade_user_id: Optional[str] = None):
        self.room = room

        # 1. Identify User
        user = next(iter(self.room.remote_participants.values()), None)
        self.user_id = user.identity if user else None
        self.user_timezone = ZoneInfo("America/New_York")  # Default to EST

        # NOTE: `Agent` already exposes a read-only `.session` property internally.
        # We keep our own reference for convenience without clobbering the base property.
        self._session: Optional[AgentSession] = None
        # These are hydrated in `on_enter`. In practice the agent can enter the room
        # slightly before the user, so we also lazily hydrate them in tool calls.
        self.user_id: Optional[str] = None
        self.supabase: Optional[Client] = None

        # Arcade SDK client for direct Gmail tool calls (bypasses MCP timing issues).
        # This uses the same approach as read_gmail.py which works reliably.
        arcade_api_key = os.environ.get("ARCADE_API_KEY")
        self._arcade_client: Optional[Arcade] = Arcade(
            api_key=arcade_api_key) if arcade_api_key else None
        # Arcade user ID for OAuth token scoping (should match email used in console OAuth flow).
        self._arcade_user_id: Optional[str] = arcade_user_id

        # Cache Gmail integration state to avoid repeated DB calls within a conversation.
        # Format: {"state": "connected"|"not_connected"|"snoozed", "checked_at": datetime}
        self._gmail_state_cache: Optional[dict] = None
        # How long to cache Gmail state (seconds). Short enough to pick up reconnects.
        self._gmail_cache_ttl: int = 30

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


EMAIL (GMAIL) WORKFLOW:
When the user asks about email (inbox, messages, Gmail, etc.):

1. Call `get_gmail_integration_state` ONCE to check status.
2. Based on the result:
   - GMAIL_CONNECTED: Use `list_emails` (for recent mail), `search_emails` (to filter), or `get_email_thread` (for details).
   - GMAIL_NOT_CONNECTED: Call `prompt_gmail_connect`, say "Click Connect in the bottom-right."
   - GMAIL_SNOOZED: Say "You've snoozed Gmail. Reconnect from the console when ready."
   - GMAIL_TOOLS_UNAVAILABLE: Say "Gmail tools are temporarily unavailable. Try again in a moment."

3. IMPORTANT: Only call `get_gmail_integration_state` ONCE per conversation turn. Do NOT retry.
4. If `list_emails` or `search_emails` fails, tell the user briefly and suggest trying again later.
5. Keep summaries SHORT (this is voice). Offer more details if asked.
6. READ-ONLY: Never send, delete, or modify emails.

ROUTING:
- Email requests -> Gmail workflow
- Calendar/task requests -> Calendar workflow

ERROR HANDLING:
- If a tool fails, explain why briefly and offer a manual workaround or alternative time.""",
        )

    async def on_enter(self) -> None:
        """
        LiveKit Agents calls `Agent.on_enter()` with **no arguments** in the version used
        by this repo.

        We still want access to the `AgentSession` object (to generate greetings, etc.).
        The session is available via an internal contextvar set by LiveKit right before
        calling `on_enter()`, so we read it from there.
        """
        # NOTE: This is an internal LiveKit context var, but it's the most reliable way
        # to stay compatible with the installed `livekit-agents` behavior.
        session: Optional[AgentSession] = None
        try:
            from livekit.agents.voice import agent_activity as _aa  # type: ignore

            # pyright: ignore[reportPrivateUsage]
            data = _aa._OnEnterContextVar.get()
            session = getattr(data, "session", None)
        except Exception:
            session = None

        if session is None:
            logger.warning(
                "on_enter() called but AgentSession was not available; skipping greeting.")
            return

        # IMPORTANT:
        # - Do NOT assign to `self.session`. In livekit-agents 1.3.x, `Agent.session` is a
        #   read-only property managed by the framework. Assigning to it throws:
        #     AttributeError: property 'session' of 'TetraAgent' object has no setter
        # - Store it on a private field instead.
        self._session = session
        logger.info("Agent joined room. Hydrating user session...")

        # Hydrate Supabase/user context. IMPORTANT: the agent can join before the user;
        # if the user isn't present yet, we kick off a background "late hydrate" task
        # so DB-backed tools (including Gmail status) start working as soon as the user joins.
        hydrated = await self._ensure_user_and_supabase(max_wait_seconds=10)
        if not hydrated:
            logger.warning(
                "User not present yet (or missing metadata). Will hydrate DB context when user joins."
            )
            asyncio.create_task(
                self._ensure_user_and_supabase(max_wait_seconds=120))

        await self.greet()

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
            if user and user.metadata:
                data = json.loads(user.metadata)
                user_token = data.get("supabase_token") or ""
        except Exception:
            # Fallback if metadata is just the string
            user_token = user.metadata if user else ""

        if not user_token:
            logger.warning(
                "No Supabase token found in LiveKit participant metadata yet.")
            self.supabase = None
            return False

        # Repo convention: frontend uses NEXT_PUBLIC_SUPABASE_*.
        # Backend expects SUPABASE_* but we fall back for convenience.
        url = os.environ.get("SUPABASE_URL") or os.environ.get(
            "NEXT_PUBLIC_SUPABASE_URL")
        key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get(
            "NEXT_PUBLIC_SUPABASE_ANON_KEY")

        if not url or not key:
            logger.error(
                "Supabase env vars missing. Set SUPABASE_URL + SUPABASE_ANON_KEY in backend/.env.local "
                "(or provide NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY)."
            )
            self.supabase = None
            return False

        try:
            # Create the client scoped to this user
            self.supabase = create_client(
                url,  # type: ignore
                key,  # type: ignore
                options=ClientOptions(
                    headers={"Authorization": f"Bearer {user_token}"})
            )
        except Exception as e:
            logger.error(
                "Couldn't get suprabase bearer token, falling back to global credentials", e)
            # Fallback to anon key to prevent crash
            url = os.environ.get("SUPABASE_URL")
            key = os.environ.get("SUPABASE_ANON_KEY")
            self.supabase = create_client(url, key)  # type: ignore

        logger.info(
            f"Supabase client authenticated for user {self.user_id}")

        # Fetch user profile to get timezone
        try:
            profile_resp = self.supabase.table("user_profiles").select(
                "timezone").eq("id", self.user_id).single().execute()
            if profile_resp.data and profile_resp.data.get("timezone"):
                tz_str = profile_resp.data.get("timezone")
                try:
                    self.user_timezone = ZoneInfo(tz_str)
                    logger.info(f"User timezone set to {tz_str}")
                except Exception:
                    logger.warning(
                        f"Invalid timezone {tz_str}, falling back to default")
        except Exception as e:
            logger.warning(f"Could not fetch user profile: {e}")
            return False

        return True

    async def greet(self):
        await self.session.generate_reply(
            instructions="Greet the user and offer your assistance.",
            allow_interruptions=True)

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
            payload_json = base64.urlsafe_b64decode(
                payload_b64.encode("utf-8")).decode("utf-8")
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
        and get IDs for events/tasks. Please use the date format YYYY-MM-DD.
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
                return f"Error: Invalid date format '{date}'. Please use YYYY-MM-DD."

            day_str = dt_object.strftime("%Y-%m-%d")

            # Create timezone-aware datetime for the start of the day in user's timezone
            # Then convert to UTC for querying
            start_local = datetime.combine(dt_object.date(), datetime.min.time()).replace(
                tzinfo=self.user_timezone)
            end_local = datetime.combine(dt_object.date(), datetime.max.time()).replace(
                tzinfo=self.user_timezone)

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

            response = self.supabase.table("events").insert(data).execute()

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
                updates).eq("id", event_id).execute()

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
            response = self.supabase.table("tasks").insert(data).execute()

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
                updates).eq("id", task_id).execute()

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
                {"done": True}).eq("id", task_id).execute()

            # Broadcast change
            if response.data:
                await self._broadcast_change("task", "UPDATE", response.data[0])

            return "Task marked as done. Good job."
        except Exception as e:
            logger.error(f"Error marking task done: {e}", exc_info=True)
            return f"Error updating task: {str(e)}"

    # --- GMAIL INTEGRATION STATE ---

    @function_tool()
    async def get_gmail_integration_state(self):
        """
        Check if the user's Gmail integration is connected, snoozed, or not set up.

        Returns one of:
        - "GMAIL_CONNECTED" - proceed with Gmail tools (Gmail.ListEmails, etc.)
        - "GMAIL_NOT_CONNECTED" - call prompt_gmail_connect first
        - "GMAIL_SNOOZED" - user disabled Gmail, don't use Gmail tools

        This result is cached for 30 seconds to avoid repeated DB calls.
        """
        # Check if we have a recent cached result to avoid repeated DB calls.
        now = datetime.now()
        if self._gmail_state_cache:
            cached_at = self._gmail_state_cache.get("checked_at")
            if cached_at and (now - cached_at).total_seconds() < self._gmail_cache_ttl:
                state = self._gmail_state_cache.get("state", "unknown")
                logger.debug(f"Using cached Gmail state: {state}")
                return self._format_gmail_state_response(state)

        logger.info("Checking Gmail integration state (fresh lookup)...")

        # Ensure Supabase is hydrated. This avoids the "agent joined before user" race.
        hydrated = await self._ensure_user_and_supabase(max_wait_seconds=3)
        if not hydrated or not getattr(self, "supabase", None) or not getattr(self, "user_id", None):
            # Cache as unknown so we don't retry immediately.
            self._gmail_state_cache = {"state": "unknown", "checked_at": now}
            return self._format_gmail_state_response("unknown")

        try:
            # Query user profile for gmail_snoozed_until and gmail_connected.
            response = (
                self.supabase.table("user_profiles")
                .select("gmail_snoozed_until, gmail_connected")
                .eq("id", self.user_id)
                .single()
                .execute()
            )

            profile = response.data
            if not profile:
                # No profile row yet - treat as not connected.
                self._gmail_state_cache = {
                    "state": "not_connected", "checked_at": now}
                return self._format_gmail_state_response("not_connected")

            snoozed_until = profile.get("gmail_snoozed_until")
            is_connected = profile.get("gmail_connected", False)

            # Check if snooze is currently active.
            if snoozed_until:
                try:
                    snooze_dt = datetime.fromisoformat(
                        snoozed_until.replace("Z", "+00:00"))
                    if snooze_dt > datetime.now(snooze_dt.tzinfo):
                        self._gmail_state_cache = {
                            "state": "snoozed", "checked_at": now}
                        return self._format_gmail_state_response("snoozed")
                except Exception:
                    # Parsing failed - treat as not snoozed.
                    logger.warning(
                        "Failed to parse gmail_snoozed_until; treating as not snoozed.")

            # Determine final state based on gmail_connected flag.
            state = "connected" if is_connected else "not_connected"
            self._gmail_state_cache = {"state": state, "checked_at": now}
            return self._format_gmail_state_response(state)

        except Exception as e:
            logger.error(f"Error checking Gmail state: {e}")
            # On error, cache as unknown briefly to avoid hammering the DB.
            self._gmail_state_cache = {"state": "unknown", "checked_at": now}
            return self._format_gmail_state_response("unknown")

    def _format_gmail_state_response(self, state: str, tools_available: bool = True) -> str:
        """Format a consistent response string based on Gmail state and tool availability."""
        # If Arcade SDK is not configured, override the response regardless of DB state.
        if not tools_available:
            return (
                "GMAIL_TOOLS_UNAVAILABLE: Gmail tools (list_emails, search_emails, etc.) are not configured. "
                "This is a setup issue. Tell the user: 'Gmail tools are temporarily unavailable. "
                "Try reconnecting or ask again in a moment.'"
            )

        if state == "connected":
            return (
                "GMAIL_CONNECTED: Gmail is connected and ready. "
                "You can now use list_emails, search_emails, or get_email_thread."
            )
        elif state == "snoozed":
            return (
                "GMAIL_SNOOZED: The user has snoozed Gmail integration. "
                "Do NOT use Gmail tools. Tell them they can reconnect from the console when ready."
            )
        elif state == "not_connected":
            return (
                "GMAIL_NOT_CONNECTED: Gmail is not connected. "
                "Call prompt_gmail_connect to show the auth UI, then tell the user to click Connect."
            )
        else:
            # Unknown state - allow Gmail tools to try (they'll fail with auth error if needed).
            return (
                "GMAIL_UNKNOWN: Could not determine Gmail status. "
                "You may try Gmail tools - they will fail gracefully if not authorized."
            )

    async def _publish_ui_event(self, event: str, payload: dict) -> bool:
        """
        Publish a small UI event to the LiveKit room so the frontend can react (e.g. show a toast).

        Implementation note:
        - The Next.js console listens to LiveKit `RoomEvent.DataReceived` and can parse JSON.
        - We include a `text` field so the message also appears in the transcript UI as a fallback.
        """
        try:
            if not getattr(self, "room", None) or not getattr(self.room, "local_participant", None):
                logger.warning(
                    "Cannot publish UI event: agent is not attached to a LiveKit room yet.")
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
        reason: Annotated[Optional[str],
                          "Optional reason why Gmail is needed (shown to the user)."] = None,
    ):
        """
        Ask the console UI to show the bottom-right Gmail connect prompt.

        Use this when Gmail tools require OAuth / the user hasn't connected Gmail yet.
        """
        # Keep the user-facing message short; the frontend has the actual Connect button + OAuth flow.
        fallback_text = (
            "Gmail isn't connected yet. Please click Connect in the bottom-right Gmail prompt, "
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

    # --- GMAIL TOOLS (via Arcade SDK, NOT MCP) ---
    # These use the Arcade SDK directly, bypassing the MCP layer which has timing/connection issues.
    # This is the same approach used by read_gmail.py and works reliably.

    def _call_arcade_tool(self, tool_name: str, tool_input: dict) -> dict:
        """
        Call an Arcade tool using the SDK directly (synchronous).

        This bypasses the MCP layer which has timing issues in LiveKit sessions.
        Same approach as read_gmail.py, which works reliably.
        """
        if not self._arcade_client:
            return {"error": "Arcade client not configured. Set ARCADE_API_KEY in backend/.env.local"}

        if not self._arcade_user_id:
            return {"error": "Arcade user ID not set. Cannot scope OAuth tokens."}

        try:
            # Execute the tool call directly via Arcade SDK.
            # The OAuth token is already stored in Arcade under this user_id (from console auth flow).
            res = self._arcade_client.tools.execute(
                tool_name=tool_name,
                input=tool_input,
                user_id=self._arcade_user_id,
            )

            # Arcade responses typically put tool output under `res.output.value`.
            output = getattr(getattr(res, "output", None), "value", None)
            if output is not None:
                return output

            # Fallback: check if there's an error or return raw response.
            if hasattr(res, "error") and res.error:
                return {"error": str(res.error)}

            return {"result": str(res)}

        except Exception as e:
            error_msg = str(e)
            # Common error: user hasn't authorized Gmail yet.
            if "authorization" in error_msg.lower() or "not authorized" in error_msg.lower():
                return {"error": "Gmail not authorized. User needs to click Connect in the console."}
            return {"error": f"Arcade tool call failed: {error_msg}"}

    @function_tool()
    async def list_emails(
        self,
        n_emails: Annotated[int,
                            "Number of recent emails to fetch (1-20)"] = 5,
    ):
        """
        List the user's most recent emails from Gmail.

        Returns a list of emails with sender, subject, date, and snippet.
        Use this after confirming Gmail is connected via get_gmail_integration_state.
        """
        logger.info(f"Listing {n_emails} recent emails via Arcade SDK")

        # Clamp to reasonable range.
        n_emails = max(1, min(20, n_emails))

        # Call Arcade Gmail tool synchronously (the SDK is sync, run in executor to not block).
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: self._call_arcade_tool(
                "Gmail.ListEmails", {"n_emails": n_emails})
        )

        # Check for errors.
        if isinstance(result, dict) and "error" in result:
            return f"Gmail error: {result['error']}"

        # Format emails for voice output (keep it concise).
        emails = result.get("emails") if isinstance(result, dict) else None
        if not emails:
            return "No emails found or unable to retrieve emails."

        # Build a voice-friendly summary.
        summary_parts = [f"Found {len(emails)} recent emails:"]
        for i, email in enumerate(emails[:n_emails], 1):
            if not isinstance(email, dict):
                continue
            sender = email.get("from") or email.get(
                "sender") or "Unknown sender"
            subject = email.get("subject") or "(no subject)"
            # Truncate long subjects for voice.
            if len(subject) > 60:
                subject = subject[:57] + "..."
            summary_parts.append(f"{i}. From {sender}: {subject}")

        return "\n".join(summary_parts)

    @function_tool()
    async def search_emails(
        self,
        sender: Annotated[Optional[str],
                          "Filter by sender email address"] = None,
        subject: Annotated[Optional[str], "Filter by subject text"] = None,
        limit: Annotated[int, "Maximum number of results (1-20)"] = 10,
    ):
        """
        Search emails by sender and/or subject.

        At least one of sender or subject must be provided.
        Use this after confirming Gmail is connected via get_gmail_integration_state.
        """
        if not sender and not subject:
            return "Please provide at least a sender or subject to search for."

        logger.info(
            f"Searching emails: sender={sender}, subject={subject}, limit={limit}")

        # Build tool input.
        tool_input = {"limit": max(1, min(20, limit))}
        if sender:
            tool_input["sender"] = sender
        if subject:
            tool_input["subject"] = subject

        # Call Arcade Gmail tool.
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: self._call_arcade_tool(
                "Gmail.ListEmailsByHeader", tool_input)
        )

        # Check for errors.
        if isinstance(result, dict) and "error" in result:
            return f"Gmail search error: {result['error']}"

        # Format results.
        emails = None
        if isinstance(result, dict):
            emails = result.get("emails_by_header") or result.get("emails")

        if not emails:
            search_desc = []
            if sender:
                search_desc.append(f"from {sender}")
            if subject:
                search_desc.append(f"about '{subject}'")
            return f"No emails found {' '.join(search_desc)}."

        # Build voice-friendly summary.
        summary_parts = [f"Found {len(emails)} matching emails:"]
        for i, email in enumerate(emails[:limit], 1):
            if not isinstance(email, dict):
                continue
            sender_addr = email.get("from") or email.get("sender") or "Unknown"
            subj = email.get("subject") or "(no subject)"
            if len(subj) > 50:
                subj = subj[:47] + "..."
            summary_parts.append(f"{i}. From {sender_addr}: {subj}")

        return "\n".join(summary_parts)

    @function_tool()
    async def get_email_thread(
        self,
        thread_id: Annotated[str, "The Gmail thread ID to retrieve"],
    ):
        """
        Get the full content of an email thread by its ID.

        Use this to read the full body of an email when the user asks for more details.
        Thread IDs can be obtained from list_emails or search_emails results.
        """
        logger.info(f"Fetching email thread: {thread_id}")

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: self._call_arcade_tool(
                "Gmail.GetThread", {"thread_id": thread_id})
        )

        if isinstance(result, dict) and "error" in result:
            return f"Error fetching thread: {result['error']}"

        # Format thread for voice (summarize if too long).
        if isinstance(result, dict):
            messages = result.get("messages") or []
            if not messages:
                return "Thread found but no messages in it."

            parts = [f"Thread has {len(messages)} message(s):"]
            for msg in messages[:3]:  # Limit to first 3 for voice.
                if isinstance(msg, dict):
                    sender = msg.get("from") or "Unknown"
                    body = msg.get("body") or msg.get("snippet") or ""
                    # Truncate body for voice.
                    if len(body) > 200:
                        body = body[:197] + "..."
                    parts.append(f"From {sender}: {body}")

            if len(messages) > 3:
                parts.append(f"...and {len(messages) - 3} more messages.")

            return "\n".join(parts)

        return str(result)


server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


async def _derive_arcade_user_id(ctx: JobContext, max_wait_seconds: int = 10) -> str:
    """
    Derive a stable Arcade user ID for OAuth token scoping.

    CRITICAL: This MUST match the user ID used in the console OAuth flow.
    The console uses `user.email || user.id` (see /api/gmail/authorize).

    Preference order:
    1) Supabase JWT email (matches the console's Arcade scoping)
    2) Supabase user id (participant identity)
    3) Room name fallback (`room-${user.id}` convention)
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max_wait_seconds

    while loop.time() < deadline:
        for p in ctx.room.remote_participants.values():
            # Skip other agents.
            if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
                continue

            # Try to read Supabase JWT from participant metadata (set by /api/livekit-token).
            user_token = ""
            try:
                if p.metadata:
                    data = json.loads(p.metadata)
                    user_token = data.get("supabase_token") or ""
            except Exception:
                # Fallback if metadata is just the raw token string.
                user_token = p.metadata or ""

            if user_token:
                # Decode email from JWT (same helper used by TetraAgent).
                email = _email_from_jwt(user_token)
                if email:
                    return email

            # If we found the human user but couldn't decode an email, fall back to their ID.
            if getattr(p, "identity", None):
                return p.identity

        await asyncio.sleep(0.2)

    # Last-resort fallback: room name convention is `room-${user.id}`.
    rid = ctx.room.name or ""
    if rid.startswith("room-"):
        rid = rid.removeprefix("room-")
    return rid


def _email_from_jwt(jwt_token: str) -> Optional[str]:
    """
    Extract the user's email from a Supabase JWT without verifying the signature.

    Used to match the Arcade user ID to the one used in the console OAuth flow.
    """
    try:
        parts = jwt_token.split(".")
        if len(parts) < 2:
            return None
        payload_b64 = parts[1]
        # base64url decode with padding
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload_json = base64.urlsafe_b64decode(
            payload_b64.encode("utf-8")).decode("utf-8")
        payload = json.loads(payload_json)
        email = payload.get("email")
        return email if isinstance(email, str) and email else None
    except Exception:
        return None


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
        # turn_detection=MultilingualModel(), # Disabled to prevent 'language' error
        vad=ctx.proc.userdata["vad"],
        preemptive_generation=True,
        # Gmail tools are now implemented as direct function_tools using Arcade SDK,
        # so we don't need MCP servers anymore. This avoids the CancelledError issues.
        # IMPORTANT: Increase max_tool_steps from default of 3.
        # Default is too low for Gmail workflows which need:
        # 1. get_gmail_integration_state (check auth)
        # 2. list_emails or search_emails
        # 3+ potential follow-up tools
        max_tool_steps=15,
    )

    logger.info("Starting session...")

    logger.info(f"Connecting to room {ctx.room.name}...")
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("Waiting for participant...")
    participant = await ctx.wait_for_participant()
    logger.info(f"Participant {participant.identity} joined.")

    # Derive Arcade user ID for OAuth token scoping.
    # This MUST match the email used in the console OAuth flow (see /api/gmail/authorize).
    # We wait for the human participant to join so we can extract their email from the JWT.
    arcade_user_id = await _derive_arcade_user_id(ctx)
    logger.info(f"Arcade SDK user scope resolved to: {arcade_user_id}")

    # Create agent with Arcade user ID for direct Gmail tool calls.
    # We use the Arcade SDK directly instead of MCP because:
    # 1. MCP has timing issues (CancelledError before tools list)
    # 2. The SDK approach is simpler and more reliable
    # 3. This is the same approach as read_gmail.py which works flawlessly
    agent = TetraAgent(ctx.room, arcade_user_id=arcade_user_id)

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
