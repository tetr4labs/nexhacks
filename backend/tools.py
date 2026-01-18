import logging
from datetime import datetime, timedelta
from typing import Annotated, Optional

from supabase import create_client, Client
from livekit.agents import llm

logger = logging.getLogger("tetra-tools")

class TetraTools:
    """
    A collection of tools to manage scheduling and tasks via Supabase.
    """
    def __init__(self, url: str, key: str, user_jwt: str):
        # We no longer call super().__init__() because we are a plain Python class.
        headers = {"Authorization": f"Bearer {user_jwt}"}
        self.supabase: Client = create_client(url, key, options={'global': {'headers': headers}})

    # --- HELPER FOR THE AGENT ---
    @property
    def tools(self) -> list[llm.FunctionTool]:
        """
        Returns the list of FunctionTools to be passed to the Agent.
        This allows you to do: agent = Agent(tools=tetra_tools.tools)
        """
        return [
            llm.FunctionTool.from_callable(self.get_day_context),
            llm.FunctionTool.from_callable(self.schedule_event),
            llm.FunctionTool.from_callable(self.create_task),
            llm.FunctionTool.from_callable(self.mark_task_done),
        ]

    # --- TOOL METHODS ---
    # Note: We removed @llm.ai_callable. 
    # The SDK now uses the docstring for the description and Annotated for arg types.

    async def get_day_context(
        self, 
        date: Annotated[str, "The target date in YYYY-MM-DD format"]
    ):
        """
        Get the user's schedule, tasks, and commitments for a specific date range.
        """
        logger.info(f"Fetching context for {date}")
        try:
            # Fetch Events
            start_filter = f"{date}T00:00:00"
            end_filter = f"{date}T23:59:59"
            
            events_response = (
                self.supabase.table("events")
                .select("*")
                .gte("start", start_filter)
                .lte("start", end_filter)
                .order("start")
                .execute()
            )
            events = events_response.data

            # Fetch Tasks (not done)
            tasks_response = (
                self.supabase.table("tasks")
                .select("*")
                .eq("done", False)
                .execute()
            )
            tasks = tasks_response.data

            context_str = f"## Agenda for {date}\n"

            if not events:
                context_str += "- No fixed events scheduled.\n"
            else:
                for e in events:
                    # Clean ISO string handling
                    start_str = e["start"].replace('Z', '+00:00')
                    dt = datetime.fromisoformat(start_str)
                    time_str = dt.strftime("%H:%M")
                    name = e.get("name", "Untitled")
                    context_str += f"- [{time_str}] {name} (ID: {e['id']})\n"

            context_str += "\n## Active Tasks / Commitments\n"
            if not tasks:
                context_str += "- No active tasks.\n"
            else:
                for t in tasks:
                    due = f" (Due: {t['due']})" if t.get("due") else ""
                    name = t.get("name", "Untitled")
                    context_str += f"- [ ] {name}{due} (ID: {t['id']})\n"

            return context_str

        except Exception as e:
            logger.error(f"Error in get_day_context: {e}")
            return f"Error accessing database: {str(e)}"

    async def schedule_event(
        self,
        title: Annotated[str, "Title of the event"],
        start_iso: Annotated[str, "Start time in ISO 8601 format (e.g. 2023-10-27T14:00:00)"],
        duration_minutes: Annotated[int, "Duration in minutes"] = 60,
        notes: Annotated[Optional[str], "Optional description or notes"] = None
    ):
        """
        Schedule a new calendar event.
        """
        logger.info(f"Scheduling: {title} at {start_iso}")
        try:
            # Parse to ensure valid format before sending
            start_dt = datetime.fromisoformat(start_iso.replace('Z', '+00:00'))
            end_dt = start_dt + timedelta(minutes=duration_minutes)
            
            data = {
                "name": title,
                "start": start_iso,
                "end": end_dt.isoformat(),
                "description": notes or ""
            }

            self.supabase.table("events").insert(data).execute()
            return f"Confirmed. Scheduled '{title}' for {start_dt.strftime('%H:%M')}."

        except Exception as e:
            logger.error(f"Error scheduling: {e}")
            return f"Failed to schedule event. System reported: {str(e)}"

    async def create_task(
        self,
        name: Annotated[str, "The content of the task/commitment"],
        due_iso: Annotated[Optional[str], "Optional due date/time in ISO 8601"] = None
    ):
        """
        Log a new task or commitment.
        """
        logger.info(f"Creating task: {name}")
        try:
            data = {
                "name": name,
                "done": False,
                "due": due_iso
            }
            self.supabase.table("tasks").insert(data).execute()
            return f"Commitment logged: {name}"
        except Exception as e:
            return f"Error logging commitment: {str(e)}"

    async def mark_task_done(
        self,
        task_id: Annotated[int, "The numerical ID of the task"]
    ):
        """
        Mark a task or commitment as complete.
        """
        logger.info(f"Completing task ID: {task_id}")
        try:
            self.supabase.table("tasks").update({"done": True}).eq("id", task_id).execute()
            return "Task marked as done. Good job."
        except Exception as e:
            return f"Error updating task: {str(e)}"