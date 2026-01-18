"""
Arcade.dev Gmail example: authorize + read/search emails.

This uses Arcade's hosted Gmail tools (via the Arcade SDK `arcadepy`), not LiveKit MCP.
If you want to call Gmail tools from your LiveKit agent via an Arcade MCP Gateway, tell me
which LiveKit MCP client API you’re using (LiveKit's docs change quickly).

Docs:
- Arcade "call tools in agents" quickstart: https://docs.arcade.dev/en/get-started/quickstarts/call-tool-agent
- Arcade Gmail MCP server/toolkit docs (tool names + scopes): https://docs.arcade.dev/en/mcp-servers/productivity/gmail
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Dict, Optional

from arcadepy import Arcade
from dotenv import load_dotenv


def _require_env(name: str) -> str:
    """Fetch a required env var and raise a helpful error if missing."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def authorize_and_run_tool(
    *,
    client: Arcade,
    tool_name: str,
    tool_input: Dict[str, Any],
    user_id: str,
) -> Any:
    """
    Authorize the tool for `user_id` if needed, then execute it.

    Arcade stores OAuth tokens keyed by `user_id`, so pick a stable identifier per user:
    - email, UUID, or (in your LiveKit setup) Supabase user id.
    """
    auth = client.tools.authorize(tool_name=tool_name, user_id=user_id)

    # Tools that don't require auth often return status "completed" immediately.
    if getattr(auth, "status", None) != "completed":
        # The user must complete the OAuth consent flow in a browser.
        print(f"\nAuthorize `{tool_name}` by visiting:\n{auth.url}\n")
        if auth.id:
            client.auth.wait_for_completion(auth.id)

    # Execute the tool call.
    res = client.tools.execute(tool_name=tool_name, input=tool_input, user_id=user_id)

    # Arcade responses typically put tool output under `res.output.value`.
    return getattr(getattr(res, "output", None), "value", res)


def print_email(email: Dict[str, Any]) -> None:
    """Pretty-print a single email object returned by Arcade Gmail tools."""
    # Field names can vary slightly by tool; we defensively check common keys.
    from_ = email.get("from") or email.get("sender") or ""
    subject = email.get("subject") or "(no subject)"
    date = email.get("date") or email.get("internalDate") or ""
    snippet = email.get("snippet") or ""

    print("------------------------------------------------------------")
    if date:
        print(f"Date:    {date}")
    if from_:
        print(f"From:    {from_}")
    print(f"Subject: {subject}")
    if snippet:
        print(f"Snippet: {snippet}")

    # Some tools may return a body field; print a short preview if present.
    body = email.get("body") or email.get("text") or email.get("plain_text")
    if body:
        preview = body.strip().replace("\n", " ")
        if len(preview) > 280:
            preview = preview[:280] + "…"
        print(f"Body:    {preview}")


def cmd_whoami(*, client: Arcade, user_id: str) -> None:
    """Verify which Gmail account is authorized for this Arcade user_id."""
    out = authorize_and_run_tool(
        client=client,
        tool_name="Gmail.WhoAmI",
        tool_input={},
        user_id=user_id,
    )
    print(out)


def cmd_list(*, client: Arcade, user_id: str, n_emails: int) -> None:
    """List the most recent emails."""
    out = authorize_and_run_tool(
        client=client,
        tool_name="Gmail.ListEmails",
        tool_input={"n_emails": n_emails},
        user_id=user_id,
    )

    emails = out.get("emails") if isinstance(out, dict) else None
    if not emails:
        print(out)
        return

    for email in emails:
        if isinstance(email, dict):
            print_email(email)
        else:
            print(email)


def cmd_search_headers(
    *,
    client: Arcade,
    user_id: str,
    sender: Optional[str],
    subject: Optional[str],
    limit: int,
) -> None:
    """
    Search emails using header filters.

    Arcade Gmail supports `Gmail.ListEmailsByHeader` for basic filtering by sender/subject.
    """
    tool_input: Dict[str, Any] = {"limit": limit}
    if sender:
        tool_input["sender"] = sender
    if subject:
        tool_input["subject"] = subject

    out = authorize_and_run_tool(
        client=client,
        tool_name="Gmail.ListEmailsByHeader",
        tool_input=tool_input,
        user_id=user_id,
    )

    # Docs suggest `emails_by_header`, but we also tolerate `emails`.
    emails = None
    if isinstance(out, dict):
        emails = out.get("emails_by_header") or out.get("emails")

    if not emails:
        print(out)
        return

    for email in emails:
        if isinstance(email, dict):
            print_email(email)
        else:
            print(email)


def main() -> None:
    # Load backend/.env.local if present (matches the rest of this repo).
    load_dotenv(".env.local")

    parser = argparse.ArgumentParser(description="Read/search Gmail via Arcade.dev tools.")
    parser.add_argument(
        "--user-id",
        default=os.getenv("ARCADE_USER_ID"),
        help="Arcade user id for OAuth token scoping (email/UUID/Supabase user id). Defaults to ARCADE_USER_ID.",
    )

    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("whoami", help="Print the Gmail account identity for this user_id.")

    p_list = sub.add_parser("list", help="List most recent emails.")
    p_list.add_argument("--n", type=int, default=5, help="Number of emails to fetch.")

    p_hdr = sub.add_parser("search-headers", help="Search emails by header filters (sender/subject).")
    p_hdr.add_argument("--sender", type=str, default=None, help="Filter by sender email (exact/partial depending on tool).")
    p_hdr.add_argument("--subject", type=str, default=None, help="Filter by subject text.")
    p_hdr.add_argument("--limit", type=int, default=10, help="Max results.")

    args = parser.parse_args()

    api_key = _require_env("ARCADE_API_KEY")
    user_id = args.user_id
    if not user_id:
        # Avoid a noisy traceback: this is just missing configuration.
        # Arcade uses `user_id` to scope OAuth tokens per application user.
        parser.print_usage(sys.stderr)
        raise SystemExit(
            "\nMissing Arcade user id.\n\n"
            "Set ARCADE_USER_ID (recommended: your email) or pass --user-id.\n"
            "Example:\n"
            "  export ARCADE_USER_ID=\"you@example.com\"\n"
            "  uv run read_gmail.py list --n 5\n"
        )

    client = Arcade(api_key=api_key)

    if args.cmd == "whoami":
        cmd_whoami(client=client, user_id=user_id)
    elif args.cmd == "list":
        cmd_list(client=client, user_id=user_id, n_emails=args.n)
    elif args.cmd == "search-headers":
        cmd_search_headers(
            client=client,
            user_id=user_id,
            sender=args.sender,
            subject=args.subject,
            limit=args.limit,
        )


if __name__ == "__main__":
    main()

