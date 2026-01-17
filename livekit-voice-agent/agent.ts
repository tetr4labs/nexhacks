import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
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
    console.log(
      "[Agent] Job received! Room:",
      ctx.room.name,
      "Participant:",
      ctx.job.participant?.identity,
    );
    const vad = ctx.proc.userData.vad! as silero.VAD;

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
cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
