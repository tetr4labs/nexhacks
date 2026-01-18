import logging
import os
import sys
import traceback

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
from livekit.plugins import silero, assemblyai, elevenlabs, google
# Turn detector is optional - only import if available
try:
    from livekit.plugins.turn_detector.multilingual import MultilingualModel
    TURN_DETECTOR_AVAILABLE = True
except (ImportError, RuntimeError) as e:
    TURN_DETECTOR_AVAILABLE = False
    # Logger not initialized yet at module level, will log later
    MultilingualModel = None

# Import your tools
from tools import TetraTools

load_dotenv(dotenv_path=".env.local")

# Configure detailed logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger("tetra-agent")
logger.setLevel(logging.INFO)

server = AgentServer()

def prewarm(proc: JobProcess):
    logger.info("[Agent] ========== PREWARM STARTED ==========")
    try:
        logger.info("[Agent] Prewarming VAD...")
        proc.userdata["vad"] = silero.VAD.load()
        logger.info("[Agent] VAD loaded successfully")
    except Exception as e:
        logger.error(f"[Agent] ERROR in prewarm: {e}", exc_info=True)
        raise

server.setup_fnc = prewarm

@server.rtc_session(agent_name="Tetra")
async def entrypoint(ctx: JobContext):
    logger.info("=" * 60)
    logger.info("[Agent] ========== ENTRYPOINT CALLED ==========")
    logger.info(f"[Agent] Job ID: {ctx.job.id}")
    logger.info(f"[Agent] Job Type: {ctx.job.type}")
    logger.info(f"[Agent] Room: {ctx.job.room.name if ctx.job.room else 'Unknown'}")
    logger.info(f"[Agent] Participant: {ctx.job.participant.identity if ctx.job.participant else 'None'}")
    
    try:
        import asyncio

        # 1. Retrieve VAD from prewarm
        logger.info("[Agent] Step 1: Retrieving VAD...")
        vad = ctx.proc.userdata.get("vad")
        if vad:
            logger.info("[Agent] VAD retrieved from prewarm cache")
        else:
            logger.warning("[Agent] VAD not in cache, loading fresh...")
            vad = silero.VAD.load()
            logger.info("[Agent] VAD loaded successfully")

        # 2. FIRST connect to the room so we can see participants
        logger.info("[Agent] Step 2: Connecting to room...")
        await ctx.connect()
        logger.info("[Agent] ✓ Connected to room successfully")
        logger.info(f"[Agent] Room name: {ctx.room.name}")
        logger.info(f"[Agent] Remote participants after connect: {len(ctx.room.remote_participants)}")

        # 3. Handle Authentication - Extract JWT from participant metadata
        logger.info("[Agent] Step 3: Handling authentication...")
        user_jwt = None
        
        # Try to get JWT from job participant metadata first (most direct)
        if ctx.job.participant and ctx.job.participant.metadata:
            user_jwt = ctx.job.participant.metadata
            logger.info(f"[Agent] Found JWT in job participant metadata (length: {len(user_jwt)})")
        
        # If not found, check remote participants (should be connected after ctx.connect())
        if not user_jwt:
            for participant in ctx.room.remote_participants.values():
                if participant.metadata:
                    user_jwt = participant.metadata
                    logger.info(f"[Agent] Found JWT in remote participant: {participant.identity} (length: {len(user_jwt)})")
                    break

        if not user_jwt:
            logger.error("[Agent] CRITICAL: No User JWT found in participant metadata.")
            logger.error(f"[Agent] Participant count: {len(ctx.room.remote_participants)}")
            logger.error("[Agent] This usually means the JWT wasn't passed in participant metadata when creating the token.")
            logger.error("[Agent] Check that frontend passes session.access_token as metadata in LiveKit token.")
            return
        
        logger.info("[Agent] ✓ Authentication JWT found successfully")

        # 4. Initialize Tools
        logger.info("[Agent] Step 4: Initializing tools and checking environment variables...")
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_ANON_KEY")
        
        logger.info(f"[Agent] SUPABASE_URL present: {bool(supabase_url)}")
        logger.info(f"[Agent] SUPABASE_ANON_KEY present: {bool(supabase_key)}")
        
        if not supabase_url or not supabase_key:
            logger.error("[Agent] Missing Supabase credentials. Aborting.")
            logger.error(f"[Agent] SUPABASE_URL: {'SET' if supabase_url else 'MISSING'}")
            logger.error(f"[Agent] SUPABASE_ANON_KEY: {'SET' if supabase_key else 'MISSING'}")
            return

        logger.info("[Agent] Creating TetraTools instance...")
        tetra_tools = TetraTools(supabase_url, supabase_key, user_jwt)
        logger.info("[Agent] TetraTools initialized successfully")
        
        # 5. Validate API keys before creating session
        logger.info("[Agent] Step 5: Validating API keys...")
        assemblyai_api_key = os.environ.get("ASSEMBLYAI_API_KEY")
        google_api_key = os.environ.get("GOOGLE_API_KEY")
        elevenlabs_api_key = os.environ.get("ELEVENLABS_API_KEY")
        elevenlabs_voice_id = os.environ.get("ELEVENLABS_VOICE_ID")
        
        logger.info(f"[Agent] ASSEMBLYAI_API_KEY: {'SET' if assemblyai_api_key else 'MISSING'}")
        logger.info(f"[Agent] GOOGLE_API_KEY: {'SET' if google_api_key else 'MISSING'}")
        logger.info(f"[Agent] ELEVENLABS_API_KEY: {'SET' if elevenlabs_api_key else 'MISSING'}")
        logger.info(f"[Agent] ELEVENLABS_VOICE_ID: {elevenlabs_voice_id or 'Using default'}")
        
        if not assemblyai_api_key:
            logger.error("[Agent] ASSEMBLYAI_API_KEY not found. Speech-to-text will not work.")
        if not google_api_key:
            logger.error("[Agent] GOOGLE_API_KEY not found. LLM will not work.")
        if not elevenlabs_api_key:
            logger.error("[Agent] ELEVENLABS_API_KEY not found. Text-to-speech will not work.")
        
        if not all([assemblyai_api_key, google_api_key, elevenlabs_api_key]):
            logger.error("[Agent] Missing required API keys. Agent may not function properly.")
            # Continue anyway to see if we can at least connect
    
        # 6. Define Session 
        logger.info("[Agent] Step 6: Initializing AgentSession with STT, LLM, and TTS...")
        try:
            logger.info("[Agent] Creating STT model (AssemblyAI)...")
            stt = inference.STT(model="assemblyai/universal-streaming", language="en")
            logger.info("[Agent] STT model created")
            
            logger.info("[Agent] Creating LLM model (Google Gemini)...")
            llm = inference.LLM(model="google/gemini-2.5-flash")
            logger.info("[Agent] LLM model created")
            
            logger.info("[Agent] Creating TTS model (ElevenLabs)...")
            # ElevenLabs plugin expects ELEVEN_API_KEY environment variable
            # Set it from ELEVENLABS_API_KEY if not already set
            if elevenlabs_api_key and not os.environ.get("ELEVEN_API_KEY"):
                os.environ["ELEVEN_API_KEY"] = elevenlabs_api_key
                logger.info("[Agent] Set ELEVEN_API_KEY from ELEVENLABS_API_KEY")
            
            # Use a standard ElevenLabs voice - "Rachel" is available on all accounts
            # You can override with ELEVENLABS_VOICE_ID env var if you have a custom voice
            default_voice_id = "21m00Tcm4TlvDq8ikWAM"  # Rachel - default ElevenLabs voice
            voice_id = os.environ.get("ELEVENLABS_VOICE_ID", default_voice_id)
            logger.info(f"[Agent] Using ElevenLabs voice ID: {voice_id}")
            
            tts = elevenlabs.TTS(
                voice_id=voice_id,
                model="eleven_multilingual_v2"
            )
            logger.info("[Agent] TTS model created")
            
            logger.info("[Agent] Creating turn detection model...")
            turn_detection = None
            if TURN_DETECTOR_AVAILABLE and MultilingualModel is not None:
                try:
                    turn_detection = MultilingualModel()
                    logger.info("[Agent] Turn detection model created successfully")
                except (RuntimeError, Exception) as e:
                    logger.warning(f"[Agent] Turn detection model failed to load: {e}")
                    logger.warning("[Agent] Continuing without turn detection - agent will use VAD only")
                    logger.warning("[Agent] To fix: Run 'uv run agent.py download-files' to download the model")
                    # Continue without turn detection - VAD should still work
            else:
                logger.info("[Agent] Turn detector not available - using VAD only (this is fine)")
            
            logger.info("[Agent] Creating AgentSession...")
            session = AgentSession(
                vad=vad,
                stt=stt,
                llm=llm,
                tts=tts,
                turn_detection=turn_detection,  # Can be None if model failed to load
            )
            logger.info("[Agent] AgentSession initialized successfully")
        except Exception as e:
            logger.error(f"[Agent] ERROR creating AgentSession: {e}", exc_info=True)
            raise

        # 7. Start the Agent
        logger.info("[Agent] Step 7: Creating Agent instance...")
        try:
            agent = Agent(
                instructions=(
                    "You are a voice assistant named Tetra. Your purpose is to help with task creation, "
                    "event scheduling, and accountability tracking. "
                    "When you first connect, greet the user warmly and ask how you can help them today. "
                    "Be conversational and friendly. Respond in plain text only. Keep replies brief and natural."
                ),
                # NOTE: Tools disabled for now - FunctionTool API changed in livekit-agents 1.3
                # fnc_ctx=tetra_tools.tools,
            )
            logger.info("[Agent] Agent instance created successfully")
            # NOTE: Tools temporarily disabled due to API change in livekit-agents 1.3
            # logger.info(f"[Agent] Agent has {len(tetra_tools.tools)} tools available")
        except Exception as e:
            logger.error(f"[Agent] ERROR creating Agent: {e}", exc_info=True)
            raise

        # 8. Start the session
        logger.info("[Agent] Step 8: Starting agent session...")
        logger.info(f"[Agent] Room name: {ctx.room.name}")
        logger.info(f"[Agent] Room SID: {ctx.room.sid}")
        logger.info(f"[Agent] Current participants in room: {len(ctx.room.remote_participants)}")
        
        try:
            await session.start(
                agent=agent,
                room=ctx.room,
                room_options=room_io.RoomOptions(
                    audio_input=room_io.AudioInputOptions(
                        noise_cancellation=None, 
                    ),
                    audio_output=room_io.AudioOutputOptions(),
                ),
            )
            logger.info("[Agent] ========== SESSION STARTED SUCCESSFULLY ==========")
            logger.info("[Agent] Agent is now connected to the room and ready to respond")
            logger.info(f"[Agent] Room participants after connection: {len(ctx.room.remote_participants)}")
            
            # Log audio track information for debugging
            for participant in ctx.room.remote_participants.values():
                logger.info(f"[Agent] Participant: {participant.identity}")
                for track_pub in participant.track_publications.values():
                    # Use 'sid' instead of 'track_sid' for newer livekit SDK
                    track_sid = getattr(track_pub, 'sid', getattr(track_pub, 'track_sid', 'unknown'))
                    logger.info(f"[Agent]   Track: {track_pub.kind}, SID: {track_sid}, Subscribed: {track_pub.subscribed}")
            
            # Give the agent a moment to initialize, then trigger a greeting
            await asyncio.sleep(1)  # Give time for audio setup
            logger.info("[Agent] Audio setup complete, triggering initial greeting...")
            
            # Explicitly generate a greeting - the agent won't auto-greet based on instructions alone
            # Try different methods depending on what's available in the SDK
            try:
                # Try say() method first - this is common in livekit-agents
                if hasattr(session, 'say'):
                    await session.say("Hello! I'm Tetra, your voice assistant. How can I help you today?")
                    logger.info("[Agent] ✓ Greeting sent via session.say()")
                elif hasattr(session, 'generate_reply'):
                    # Fallback to generate_reply if available
                    await session.generate_reply(
                        instructions="Greet the user warmly. Introduce yourself as Tetra and ask how you can help them today."
                    )
                    logger.info("[Agent] ✓ Greeting sent via session.generate_reply()")
                else:
                    # Log available methods for debugging
                    session_methods = [m for m in dir(session) if not m.startswith('_')]
                    logger.warning(f"[Agent] No greeting method found. Available session methods: {session_methods[:20]}")
            except Exception as greet_err:
                logger.warning(f"[Agent] Could not send greeting: {greet_err}")
                logger.warning(f"[Agent] Greeting error type: {type(greet_err).__name__}")
        except Exception as e:
            logger.error(f"[Agent] CRITICAL ERROR starting session: {e}", exc_info=True)
            logger.error(f"[Agent] Traceback: {traceback.format_exc()}")
            raise
            
    except Exception as e:
        logger.error("=" * 60)
        logger.error(f"[Agent] ========== ENTRYPOINT FAILED ==========")
        logger.error(f"[Agent] Error: {e}", exc_info=True)
        logger.error(f"[Agent] Full traceback:\n{traceback.format_exc()}")
        logger.error("=" * 60)
        raise

def main():
    cli.run_app(server)

if __name__ == "__main__":
    main()
