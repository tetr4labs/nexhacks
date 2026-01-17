import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  voice,
  AutoSubscribe,
  WorkerPermissions,
} from "@livekit/agents";
import * as livekit from "@livekit/agents-plugin-livekit";
import * as silero from "@livekit/agents-plugin-silero";
import { BackgroundVoiceCancellation } from "@livekit/noise-cancellation-node";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    console.log("[Agent] Prewarming VAD...");
    proc.userData.vad = await silero.VAD.load();
    console.log("[Agent] VAD loaded");
  },
  entry: async (ctx: JobContext) => {
    console.log("[Agent] Entry triggered.");
    console.log("[Agent] LIVEKIT_URL:", process.env.LIVEKIT_URL);
    console.log("[Agent] Job ID:", ctx.job.id);
    console.log("[Agent] Room Name (ctx.room.name):", ctx.room.name);
    console.log("[Agent] Job info:", JSON.stringify({
      id: ctx.job.id,
      roomName: ctx.job.room?.name,
      participantIdentity: ctx.job.participant?.identity,
      participantMetadata: ctx.job.participant?.metadata ? "Present" : "Missing"
    }, null, 2));

    const vad = ctx.proc.userData.vad! as silero.VAD;

    // --- SETUP SUPABASE TOOLS ---
    // Note: Assuming User JWT is passed via Participant Metadata.
    // We check both the job participant (if available) and connected participants.
    let userJwt = ctx.job.participant?.metadata;

    if (!userJwt) {
      console.log("[Agent] No JWT in job participant, attempting to connect to room...");
      try {
        await ctx.connect();
        console.log("[Agent] Connected to room:", ctx.room.name);
        
        for (const p of ctx.room.remoteParticipants.values()) {
          if (p.metadata) {
            userJwt = p.metadata;
            console.log("[Agent] Found JWT in participant:", p.identity);
            break;
          }
        }
      } catch (error) {
        console.error("[Agent] Failed to connect to room:", error);
      }
    } else {
       // We have the JWT, but we still need to connect to the room to function
       console.log("[Agent] Found JWT in job, connecting to room...");
       await ctx.connect();
       console.log("[Agent] Connected to room:", ctx.room.name);
    }

    const assistant = new voice.Agent({
      instructions: `You are a voice assistant named Tetra. Your purpose is to help with task creation, event scheduling, and accountability tracking'
          'DO NOT INTRODUCE YOURSELF. Ask the user what you can schedule or what they want to do today.`,
    });

    const session = new voice.AgentSession({
      vad,
      stt: "assemblyai/universal-streaming:en",
      llm: "gemini-2.5-flash", // "openai/gpt-4.1-mini",
      tts: "cartesia/sonic-3:a167e0f3-df7e-4d52-a9c3-f949145efdab",
      turnDetection: new livekit.turnDetector.MultilingualModel(),
    });

    await session.start({
      agent: assistant,
      room: ctx.room,
      inputOptions: {
        noiseCancellation: BackgroundVoiceCancellation(),
      },
      outputOptions: {
        transcriptionEnabled: true,
        syncTranscription: true,
      },
    });
  },
});

console.log("[Agent] Starting worker...");
cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: "tetra"
}));
