import {
    type JobContext,
    type JobProcess,
    WorkerOptions,
    cli,
    defineAgent,
    voice,
  } from '@livekit/agents';
  import * as livekit from '@livekit/agents-plugin-livekit';
  import * as silero from '@livekit/agents-plugin-silero';
  import { BackgroundVoiceCancellation } from '@livekit/noise-cancellation-node';
  import { fileURLToPath } from 'node:url';
  import dotenv from 'dotenv';
  
  dotenv.config({ path: '.env.local' });
  
  export default defineAgent({
    prewarm: async (proc: JobProcess) => {
      console.log("[Agent] Prewarming VAD...");
      proc.userData.vad = await silero.VAD.load();
      console.log("[Agent] VAD loaded");
    },
    entry: async (ctx: JobContext) => {
      console.log("[Agent] Job received! Room:", ctx.room.name, "Participant:", ctx.participant?.identity);
      const vad = ctx.proc.userData.vad! as silero.VAD;
      
      const assistant = new voice.Agent({
          instructions: 'You are a helpful voice AI assistant.',
      });
  
      const session = new voice.AgentSession({
        vad,
        stt: "assemblyai/universal-streaming:en",
        llm: "openai/gpt-4.1-mini",
        tts: "cartesia/sonic-3:9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
        turnDetection: new livekit.turnDetector.MultilingualModel(),
      });

      await session.start({
        agent: assistant,
        room: ctx.room,
        inputOptions: {
          // For telephony applications, use `TelephonyBackgroundVoiceCancellation` for best results
          noiseCancellation: BackgroundVoiceCancellation(),
        },
        outputOptions: {
          // Enable transcription forwarding to clients
          transcriptionEnabled: true,
          syncTranscription: true,
        },
      });
  
      await ctx.connect();
      console.log("[Agent] Connected to room:", ctx.room.name);

      const handle = session.generateReply({
        instructions: 'Greet the user and offer your assistance.',
      });
      console.log("[Agent] Greeting sent");
    },
  });
  
  console.log("[Agent] Starting worker...");
  cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));