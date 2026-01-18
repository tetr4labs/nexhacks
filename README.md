# nexhacks

## Setup

### Frontend Environment Variables

Create `frontend/.env.local` with:
```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
LIVEKIT_URL=your_livekit_url
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
```

### LiveKit Agent Environment Variables

Create `backend/.env.local` with your LiveKit credentials and API keys for:
- AssemblyAI (for STT)
- Google AI Studio (for LLM)
- ElevenLabs (for TTS)

Optional (Arcade Gmail via MCP):
```bash
# Arcade MCP Gateway URL (see Arcade MCP Gateways quickstart)
ARCADE_MCP_URL=https://api.arcade.dev/mcp/<YOUR_GATEWAY_SLUG>

# Arcade API key (used as `Authorization: Bearer ...`)
ARCADE_API_KEY=your_arcade_api_key
```

## Running

**Run the frontend:**
```bash
cd frontend
npm run dev
```

**Run LiveKit voice agent:**
```bash
cd livekit-voice-agent
# First time: download model files
pnpm download-files
# Then run in dev mode
pnpm dev
```

## Using the Voice Interface

1. Start both the frontend and LiveKit agent
2. Navigate to `/console` and click "Talk to Tetra"
3. Click "Connect to Tetra" on the talk page
4. Allow microphone permissions when prompted
5. Start speaking - Tetra will respond!

The agent will automatically join the room when you connect.

## Testing Arcade Gmail MCP

1. In Arcade, create an **MCP Gateway** that includes the **Gmail** tools and copy its URL.
2. Set `ARCADE_MCP_URL` and `ARCADE_API_KEY` in `backend/.env.local`.
3. Start the agent and connect from the Talk UI.
4. Ask Tetra something that should require Gmail tools, for example:
   - “List my 5 most recent emails.”
   - “Search my email for ‘invoice’ and summarize the top results.”

If Gmail isn’t authorized yet for that user, Arcade will return an authorization step (OAuth). Complete
the Google consent flow for the requested scopes, then retry the request.