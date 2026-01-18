from datetime import datetime, timedelta
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
from supabase import Client, create_client

logger = logging.getLogger("Tetra")

load_dotenv(".env.local")


def format_date(date):
    try:
        dt_object = parser.parse(date)
    except parser.ParserError:
        # Fallback: If the LLM sends "tomorrow" literally, return a helpful error
        # guiding it back to specific dates, or handle relative logic here.
        return f"I couldn't understand the date '{date}'. Please provide the date in YYYY-MM-DD format."
    return dt_object.strftime("%Y-%m-%d")


class TetraAgent(Agent):
    def __init__(self):
        now = datetime.now()
        # Added "Standard Time" to help LLM understand it's a specific zone
        time_context = now.strftime("%A, %B %d, %Y at %I:%M %p %Z")

        super().__init__(
            instructions=f"""\
SYSTEM IDENTITY:
You are TETRA, a high-efficiency tactical day-planning OS. You are not a chatty assistant; you are a productivity engine.
Your goal is to turn spoken "intentions" into rigid database commitments.

OPERATIONAL PARAMETERS:
- SYSTEM TIME: {time_context}. Trust this timestamp implicitly for all relative date calculations (today, tomorrow).
- TONE: Professional, futuristic, concise, and commanding.
- AUDIO OUTPUT: strictly plain text. NO markdown (no asterisks, no hashes). 
- BREVITY: Speak in short, punchy sentences. 1-2 sentences max for confirmations.

CORE DIRECTIVES:
1. THE INTENT LEDGER: When a user says they "want" to do something (e.g., "I want to hit the gym"), treat it as a 'Commitment'. Immediately propose logging it or scheduling it.
2. SCHEDULING LOGIC: 
   - NEVER schedule blindly. If asked to schedule something without a specific time, ALWAYS call `get_day_context` first to find a gap.
   - If a specific time is requested, verify it doesn't conflict by calling `get_day_context`.
3. ACCOUNTABILITY: If the user asks "What's my day?", summarize the structure (Events) and the pressure (Tasks).

PHRASEOLOGY (Use these vibes):
- Instead of "I have scheduled that for you," say "Confirmed. Event injected at [Time]."
- Instead of "What do you want to do?", say "Awaiting directives." or "State your intention."
- Instead of "Done," say "Status updated." or "Commitment logged."

ERROR HANDLING:
- If a user provides a relative date (e.g., "next Friday"), calculate the specific date based on SYSTEM TIME before calling tools.
- If a tool fails, report the error briefly: "System error: [Reason].""",
            #  mcp_servers=[
            #     mcp.MCPServerHTTP(
            #         url="https://example.com/mcp",
            #     ),
            # ],
        )

        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_ANON_KEY")

        self.supabase: Client = create_client(url, key)  # type: ignore

    async def on_enter(self):
        # Cyberpunk intro - short and active
        await self.session.generate_reply(
            instructions="Greet the user and offer your assistance.",
            allow_interruptions=True,
        )

    @function_tool()
    async def get_day_context(
        self,
        date: Annotated[str,
                        "The target date. Can be YYYY-MM-DD or a full ISO timestamp."]
    ):
        """
        CRITICAL: Call this BEFORE scheduling anything to check availability. 
        Gets the user's schedule, tasks, and commitments for a specific date range.
        """
        logger.info(f"Fetching context for {date}")
        try:
            # ROBUST PARSING (From previous step)
            try:
                dt_object = parser.parse(date)
            except parser.ParserError:
                return f"Error: Invalid date format '{date}'. Retry with YYYY-MM-DD."

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

            # FORMATTING FOR LLM CONSUMPTION
            # We use a very strict format so the LLM parses it easily
            context_str = f"## STATUS REPORT FOR {day_str}\n"

            if not events:
                context_str += "[TIMELINE]: Clear. No fixed events.\n"
            else:
                context_str += "[TIMELINE]:\n"
                for e in events:
                    start_str = e["start"].replace('Z', '+00:00')
                    dt = datetime.fromisoformat(start_str)
                    # 24hr format is better for bots
                    time_str = dt.strftime("%H:%M")
                    name = e.get("name", "Untitled")
                    context_str += f"- {time_str}: {name}\n"

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
            logger.error(f"Error in get_day_context: {e}")
            return f"System Alert: Database connection failed. Details: {str(e)}"

    async def schedule_event(
        self,
        title: Annotated[str, "Title of the event"],
        start_iso: Annotated[str, "Start time in ISO 8601 format (e.g. 2023-10-27T14:00:00)"],
        duration_minutes: Annotated[int, "Duration in minutes"] = 60,
        notes: Annotated[Optional[str], "Optional description or notes"] = None
    ):
        """
        Schedule a new calendar event.
        """
        logger.info(f"Scheduling: {title} at {start_iso}")
        try:
            start_dt = datetime.fromisoformat(start_iso.replace('Z', '+00:00'))
            end_dt = start_dt + timedelta(minutes=duration_minutes)

            data = {
                "name": title,
                "start": start_iso,
                "end": end_dt.isoformat(),
                "description": notes or ""
            }

            self.supabase.table("events").insert(data).execute()
            return f"Confirmed. Scheduled '{title}' for {start_dt.strftime('%H:%M')}."

        except Exception as e:
            logger.error(f"Error scheduling: {e}")
            return f"Failed to schedule event. System reported: {str(e)}"

    async def create_task(
        self,
        name: Annotated[str, "The content of the task/commitment"],
        due_iso: Annotated[Optional[str],
                           "Optional due date/time in ISO 8601"] = None
    ):
        """
        Log a new task or commitment.
        """
        logger.info(f"Creating task: {name}")
        try:
            data = {
                "name": name,
                "done": False,
                "due": due_iso
            }
            self.supabase.table("tasks").insert(data).execute()
            return f"Commitment logged: {name}"
        except Exception as e:
            return f"Error logging commitment: {str(e)}"

    async def mark_task_done(
        self,
        task_id: Annotated[int, "The numerical ID of the task"]
    ):
        """
        Mark a task or commitment as complete.
        """
        logger.info(f"Completing task ID: {task_id}")
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
    session = AgentSession(
        stt=inference.STT(
            model="assemblyai/universal-streaming", language="en"),
        llm=inference.LLM(model="google/gemini-2.5-flash"),
        tts=inference.TTS(
            model="elevenlabs/eleven_flash_v2_5",
            voice="CwhRBWXzGAHq8TQ4Fs17",
            language="en-US"
        ),
        turn_detection=MultilingualModel(),
        vad=ctx.proc.userdata["vad"],
        preemptive_generation=True,
    )

    agent = TetraAgent()

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
