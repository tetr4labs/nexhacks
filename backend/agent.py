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
        logger.info("[Agent] Generating greeting...")
        try:
            await self.session.generate_reply(
                instructions="Ask the user what you can schedule or what they want to do today."
            )
            logger.info("[Agent] Greeting generated and should be playing")
        except Exception as e:
            logger.error(f"[Agent] Error generating greeting: {e}", exc_info=True)
            raise

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
    
    # 4. Validate API keys before creating session
    assemblyai_api_key = os.environ.get("ASSEMBLYAI_API_KEY")
    google_api_key = os.environ.get("GOOGLE_API_KEY")
    cartesia_api_key = os.environ.get("CARTESIA_API_KEY")
    
    if not assemblyai_api_key:
        logger.error("[Agent] ASSEMBLYAI_API_KEY not found. Speech-to-text will not work.")
    if not google_api_key:
        logger.error("[Agent] GOOGLE_API_KEY not found. LLM will not work.")
    if not cartesia_api_key:
        logger.error("[Agent] CARTESIA_API_KEY not found. Text-to-speech will not work.")
    
    # 5. Define Session 
    logger.info("[Agent] Initializing AgentSession with STT, LLM, and TTS...")
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
    logger.info("[Agent] AgentSession initialized")

    # 6. Start the Agent
    # FIX: Pass tetra_tools.tools (the list), not tetra_tools (the instance)
    agent = TetraAgent(tools=tetra_tools.tools)

    # Start the session with proper audio configuration
    await session.start(
        agent=agent,
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=None, 
            ),
            # Explicitly enable audio output (TTS will publish audio tracks)
            audio_output=room_io.AudioOutputOptions(),
        ),
    )
    
    logger.info("[Agent] Session started, waiting for session to be ready...")
    
    # Wait a moment for the session to fully initialize before triggering greeting
    import asyncio
    await asyncio.sleep(0.5)
    
    # Trigger the greeting - this will generate TTS audio
    logger.info("[Agent] Triggering greeting...")
    try:
        await agent.say_hello()
        logger.info("[Agent] Greeting sent successfully")
    except Exception as e:
        logger.error(f"[Agent] Error sending greeting: {e}", exc_info=True)

if __name__ == "__main__":
    cli.run_app(server)
