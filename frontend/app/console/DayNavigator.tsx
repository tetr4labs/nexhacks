"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function toDayString(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, delta: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}

export default function DayNavigator({ currentDay }: { currentDay: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentDate = useMemo(
    () => new Date(`${currentDay}T00:00:00`),
    [currentDay],
  );

  const goToDay = useCallback(
    (date: Date) => {
      const nextDay = toDayString(date);
      const params = new URLSearchParams(searchParams.toString());
      // Always set the `day` param for deterministic server rendering.
      // Relying on "today" (client-local) and deleting the param can desync with the server's
      // timezone and make the arrows appear broken.
      params.set("day", nextDay);
      const nextSearch = params.toString();
      // Push a new URL so the server `ConsolePage` re-renders with fresh `searchParams.day`.
      router.push(`/console${nextSearch ? `?${nextSearch}` : ""}`);
    },
    [router, searchParams],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToDay(addDays(currentDate, -1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToDay(addDays(currentDate, 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentDate, goToDay]);

  const label = currentDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex items-center gap-3 border-2 border-white px-3 py-1">
      <button
        type="button"
        onClick={() => goToDay(addDays(currentDate, -1))}
        className="text-white hover:bg-white/10 transition-colors font-mono px-2 py-1 uppercase tracking-wider text-xs"
        aria-label="Previous day"
      >
        ←
      </button>
      <span className="text-xs font-mono text-white uppercase tracking-wider">{label.toUpperCase()}</span>
      <button
        type="button"
        onClick={() => goToDay(addDays(currentDate, 1))}
        className="text-white hover:bg-white/10 transition-colors font-mono px-2 py-1 uppercase tracking-wider text-xs"
        aria-label="Next day"
      >
        →
      </button>
    </div>
  );
}
