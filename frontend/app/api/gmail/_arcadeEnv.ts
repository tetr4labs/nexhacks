import fs from "node:fs";
import path from "node:path";

/**
 * Arcade config helper for Next.js API routes (server-only).
 *
 * Why this exists:
 * - The voice agent reads env vars from `backend/.env.local` (see `backend/agent.py`).
 * - Next.js reads env vars from the repo root `.env.local` by default, so it's easy to end up
 *   with Arcade configured for the agent but NOT for the console API routes.
 * - The console's Gmail prompt + OAuth link are driven by these API routes, so we add a
 *   fallback that reads `backend/.env.local` when `process.env.ARCADE_API_KEY` is missing.
 *
 * Security:
 * - This runs only on the server (API routes). We never expose the API key to the client.
 */

function parseDotEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq < 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Handle quoted values: KEY="value" or KEY='value'
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) out[key] = value;
  }

  return out;
}

export function getArcadeApiKey(): string | null {
  // Preferred: set ARCADE_API_KEY in the environment visible to Next.js (repo root `.env.local`).
  const direct = process.env.ARCADE_API_KEY;
  if (direct) return direct;

  // Fallback (DX): read it from backend/.env.local to match the agent's config.
  try {
    const backendEnvPath = path.join(process.cwd(), "..", "backend", ".env.local");
    const contents = fs.readFileSync(backendEnvPath, "utf8");
    const parsed = parseDotEnvFile(contents);
    return parsed.ARCADE_API_KEY || null;
  } catch {
    return null;
  }
}

export function getArcadeBaseURL(): string {
  // Preferred: explicitly configure the Arcade API base URL for the JS SDK.
  // This avoids SDK defaults drifting over time.
  const direct = process.env.ARCADE_BASE_URL;
  if (direct) return direct;

  // Fallback (DX): read it from backend/.env.local to match the agent's config.
  try {
    const backendEnvPath = path.join(process.cwd(), "..", "backend", ".env.local");
    const contents = fs.readFileSync(backendEnvPath, "utf8");
    const parsed = parseDotEnvFile(contents);
    if (parsed.ARCADE_BASE_URL) return parsed.ARCADE_BASE_URL;
  } catch {
    // ignore
  }

  // Known-good default (verified in dev: GET https://api.arcade.dev/v1/health -> 200)
  return "https://api.arcade.dev";
}

