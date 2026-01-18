import logging
import os

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    inference,
    room_io,
)
from livekit.plugins import silero, assemblyai, cartesia, google
from livekit.plugins.turn_detector.multilingual import MultilingualModel

# Import your tools
from tools import TetraTools

load_dotenv(dotenv_path=".env.local")

logger = logging.getLogger("tetra-agent")
logger.setLevel(logging.INFO)

# --- AGENT LOGIC ---

class TetraAgent(Agent):
    def __init__(self, tools: list) -> None:
        super().__init__(
            instructions=(
                "You are a voice assistant named Tetra. Your purpose is to help with task creation, "
                "event scheduling, and accountability tracking. "
                "DO NOT INTRODUCE YOURSELF. Ask the user what you can schedule or what they want to do today."
                "Respond in plain text only. Keep replies brief."
            ),
            tools=tools,
        )

    # Note: We keep this as a custom method we call manually
    async def say_hello(self):
        await self.session.generate_reply(
            instructions="Ask the user what you can schedule or what they want to do today."
        )

# --- SERVER SETUP ---

server = AgentServer()

def prewarm(proc: JobProcess):
    logger.info("[Agent] Prewarming VAD...")
    proc.userdata["vad"] = silero.VAD.load()
    logger.info("[Agent] VAD loaded")

server.setup_fnc = prewarm

@server.rtc_session(agent_name="Tetra")
async def entrypoint(ctx: JobContext):
    logger.info(f"[Agent] Job ID: {ctx.job.id}")
    logger.info(f"[Agent] Room: {ctx.job.room.name if ctx.job.room else 'Unknown'}")

    # 1. Retrieve VAD from prewarm
    vad = ctx.proc.userdata.get("vad") or silero.VAD.load()

    # 2. Handle Authentication
    user_jwt = ctx.job.participant.metadata if ctx.job.participant else None

    if not user_jwt:
        logger.info("[Agent] JWT missing in job metadata, checking connected participants...")
        for p in ctx.room.remote_participants.values():
            if p.metadata:
                user_jwt = p.metadata
                logger.info(f"[Agent] Found JWT in participant: {p.identity}")
                break

    if not user_jwt:
        logger.error("[Agent] CRITICAL: No User JWT found. Aborting session.")
        return

    # 3. Initialize Tools
    # We instantiate the tool class normally
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_ANON_KEY")
    
    if not supabase_url or not supabase_key:
        logger.error("[Agent] Missing Supabase credentials.")
        return

    tetra_tools = TetraTools(supabase_url, supabase_key, user_jwt)
    
    # 4. Define Session 
    session = AgentSession(
        vad=vad,
        stt=inference.STT(model="assemblyai/universal-streaming", language="en"),
        llm=inference.LLM(model="google/gemini-2.5-flash"), 
        tts=inference.TTS(
            model="cartesia/sonic-3", 
            voice="a167e0f3-df7e-4d52-a9c3-f949145efdab"
        ),
        turn_detection=MultilingualModel(),
    )

    # 5. Start the Agent
    # FIX: Pass tetra_tools.tools (the list), not tetra_tools (the instance)
    agent = TetraAgent(tools=tetra_tools.tools)

    await session.start(
        agent=agent,
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=None, 
            ),
        ),
    )
    
    # Trigger the greeting
    await agent.say_hello()

if __name__ == "__main__":
    cli.run_app(server)
