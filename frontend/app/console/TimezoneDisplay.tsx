"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Client component to display the user's timezone.
 * Falls back to browser-detected timezone if profile timezone is not available.
 */
export default function TimezoneDisplay({ profileTimezone }: { profileTimezone?: string | null }) {
  // IMPORTANT: Avoid hydration mismatches.
  // The server render can't know the browser timezone, so we render a stable initial value
  // and then update it client-side after mount.
  const normalizedProfile = useMemo(
    () => (profileTimezone?.trim() ? profileTimezone.trim() : null),
    [profileTimezone],
  );

  const isProfileUTC = useMemo(() => {
    if (!normalizedProfile) return true;
    const upper = normalizedProfile.toUpperCase();
    return (
      upper === "UTC" || normalizedProfile === "Etc/UTC" || normalizedProfile === "Etc/GMT"
    );
  }, [normalizedProfile]);

  const initialTimezoneLabel = useMemo(() => {
    // If the profile timezone is meaningful, prefer it on first paint.
    // Otherwise show a stable placeholder and replace with browser tz after mount.
    return isProfileUTC ? "LOCAL TIME" : normalizedProfile!;
  }, [isProfileUTC, normalizedProfile]);

  const [timezone, setTimezone] = useState<string>(initialTimezoneLabel);

  useEffect(() => {
    // Only swap to the browser tz if profile timezone isn't meaningful (often default "UTC").
    if (!isProfileUTC) return;
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browserTz) setTimezone(browserTz);
  }, [isProfileUTC]);

  return (
    <span
      className="text-xs font-mono text-white opacity-60 uppercase tracking-wider"
      suppressHydrationWarning
    >
      {timezone}
    </span>
  );
}
