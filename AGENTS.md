## LiveKit Documentation

LiveKit Agents is a fast-evolving project, and the documentation is updated frequently. You should always refer to the latest documentation when working with this project. For your convenience, LiveKit offers an MCP server that can be used to browse and search its documentation. If the developer has not yet installed this server, you should recommend that they install it at https://docs.livekit.io/mcp.

## Arcade (Gmail) MCP Gateway

This repo can optionally connect the LiveKit voice agent (`backend/agent.py`) to Arcade.dev via MCP
to access hosted toolkits like Gmail.

### Environment variables (backend)

- `ARCADE_MCP_URL`: Arcade MCP Gateway URL, typically `https://api.arcade.dev/mcp/<YOUR_GATEWAY_SLUG>`
- `ARCADE_API_KEY`: Arcade API key used as `Authorization: Bearer <key>`

### User scoping

We pass `Arcade-User-ID` to Arcade so OAuth tokens are stored per user. In this repo, the LiveKit
room is named `room-${user.id}` (Supabase user id), so the agent derives `Arcade-User-ID` from
`ctx.room.name`.

### Docs to consult

- LiveKit HTTP MCP client recipe: `https://docs.livekit.io/recipes/http_mcp_client`
- Arcade MCP Gateways quickstart (URL + headers): `https://docs.arcade.dev/en/home/mcp-gateway-quickstart`
- Arcade Gmail MCP server/toolkit docs (tool names + scopes): `https://docs.arcade.dev/en/mcp-servers/productivity/gmail`