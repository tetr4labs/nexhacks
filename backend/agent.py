from datetime import datetime, timedelta
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


class TetraAgent(Agent):
    def __init__(self):
        super().__init__(
            instructions="""\
You are a friendly voice assistant named Tetra. Your purpose is to help with task creation, 
event scheduling, and accountability tracking.
DO NOT INTRODUCE YOURSELF. Ask the user what you can schedule or what they want to do today.
Respond in plain text only. Keep replies brief. Use any tools available to you.""",
            #  mcp_servers=[
            #     mcp.MCPServerHTTP(
            #         url="https://example.com/mcp",
            #     ),
            # ],
        )

        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_ANON_KEY")

        # Create Supabase client with default options
        self.supabase: Client = create_client(url, key)  # type: ignore

    async def on_enter(self):
        await self.session.generate_reply(
            instructions="""Greet the user and offer your assistance.""",
            allow_interruptions=True,
        )

    """
    A collection of tools to manage scheduling and tasks via Supabase.
    """

    @function_tool()
    async def get_day_context(
        self,
        date: Annotated[str, "The target date in YYYY-MM-DD format"]
    ):
        """
        Get the user's schedule, tasks, and commitments for a specific date range.
        """
        logger.info(f"Fetching context for {date}")
        try:
            start_filter = f"{date}T00:00:00"
            end_filter = f"{date}T23:59:59"

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

            context_str = f"## Agenda for {date}\n"

            if not events:
                context_str += "- No fixed events scheduled.\n"
            else:
                for e in events:
                    start_str = e["start"].replace('Z', '+00:00')
                    dt = datetime.fromisoformat(start_str)
                    time_str = dt.strftime("%H:%M")
                    name = e.get("name", "Untitled")
                    context_str += f"- [{time_str}] {name} (ID: {e['id']})\n"

            context_str += "\n## Active Tasks / Commitments\n"
            if not tasks:
                context_str += "- No active tasks.\n"
            else:
                for t in tasks:
                    due = f" (Due: {t['due']})" if t.get("due") else ""
                    name = t.get("name", "Untitled")
                    context_str += f"- [ ] {name}{due} (ID: {t['id']})\n"

            return context_str

        except Exception as e:
            logger.error(f"Error in get_day_context: {e}")
            return f"Error accessing database: {str(e)}"

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

    await agent.on_enter()

    await self.session.generate_reply(
        instructions="""Greet the user and offer your assistance.""",
        allow_interruptions=True,
    )


if __name__ == "__main__":
    cli.run_app(server)
