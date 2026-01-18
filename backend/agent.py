import logging
import os
import json
import asyncio

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
from livekit.plugins import silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

# Import your tools
from tools import TetraTools

load_dotenv(dotenv_path=".env.local")

logger = logging.getLogger("tetra-agent")
logger.setLevel(logging.INFO)

server = AgentServer()

def prewarm(proc: JobProcess):
    logger.info("[Agent] Prewarming VAD...")
    proc.userdata["vad"] = silero.VAD.load()
    logger.info("[Agent] VAD loaded")

server.setup_fnc = prewarm

class TetraAgent(Agent):
    def __init__(self, tools):
        self.__init__("""\
You are a friendly voice assistant named Tetra. Your purpose is to help with task creation, 
event scheduling, and accountability tracking.
DO NOT INTRODUCE YOURSELF. Ask the user what you can schedule or what they want to do today.
Respond in plain text only. Keep replies brief. Use any tools available to you.""")
        self.tools = tools

    async def on_enter(self):
        await session.generate_reply(
            instructions="Ask the user what you can schedule or what they want to do today.",
            allow_interruptions=True,
        )
        logger.info("[Agent] Greeting generated")

@server.rtc_session(agent_name="Tetra")
async def entrypoint(ctx: JobContext):
    logger.info(f"[Agent] Job started. Job ID: {ctx.job.id}")
     # 2. Handle Authentication via Job Metadata (Non-blocking)
    # We check the job payload directly. If the participant initiated the job,
    # their info is already here.
    user_jwt = None
    if ctx.job.participant and ctx.job.participant.metadata:
        user_jwt = ctx.job.participant.metadata
        logger.info(f"[Agent] Found JWT in job metadata for: {ctx.job.participant.identity}")
    else:
        logger.warning("[Agent] No JWT found in job metadata. Initializing as Guest.")

    # 3. Initialize Tools
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_ANON_KEY")
    
    tetra_tools = None
    if supabase_url and supabase_key:
        if user_jwt:
            try:
                tetra_tools = TetraTools(supabase_url, supabase_key, user_jwt)
            except Exception as e:
                logger.error(f"[Agent] Failed to initialize tools with JWT: {e}")
        else:
            logger.info("[Agent] Skipping tool initialization (Guest mode)")
    else:
        logger.error("[Agent] Missing Supabase credentials.")

    # 4. Define Session 
    session = AgentSession(
        vad=ctx.proc.userdata["vad"],
        stt=inference.STT(model="assemblyai/universal-streaming", language="en"),
        llm=inference.LLM(model="google/gemini-2.5-flash"), 
        tts=inference.TTS(
            model="cartesia/sonic-3", 
            voice="a167e0f3-df7e-4d52-a9c3-f949145efdab"
        ),
        turn_detection=MultilingualModel(),
        preemptive_generation=True,
    ) 

    # # 6. Setup Data Handler
    @ctx.room.on("data_received")
    def on_data_received(data):
        if data.participant and data.participant.identity == ctx.room.local_participant.identity:
            return

        try:
            payload = data.data.decode("utf-8")
            msg_data = json.loads(payload)
            
            if msg_data.get("type") == "user_chat":
                user_text = msg_data.get("text")
                logger.info(f"[Agent] Received text input: {user_text}")

                if agent.is_speaking:
                    agent.interrupt()

                # Process chat message
                asyncio.create_task(session.process_chat_message(user_text))
                
        except Exception as e:
            logger.error(f"Failed to process data packet: {e}")

    # Start the session (this handles the room connection)
    await session.start(
        agent=TetraAgent(tetra_tools.tools),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=None, 
            ),
            audio_output=room_io.AudioOutputOptions(),
        ),
    )

def main():
    cli.run_app(server)

if __name__ == "__main__":
    main()
