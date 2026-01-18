"use client";

import { useState } from "react";

/**
 * Props for the EventCard component
 */
interface EventCardProps {
  id: number;
  name: string | null;
  description: string | null;
  start: string | null;
  end: string | null;
  style: React.CSSProperties;
}

/**
 * Expandable event card component for the timeline.
 * Clips overflow content and expands on click to show full details.
 */
export default function EventCard({
  name,
  description,
  start,
  end,
  style,
}: EventCardProps) {
  // State to track if the card is expanded
  const [isExpanded, setIsExpanded] = useState(false);

  // Format time for display
  const formatEventTime = (dateString: string | null) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Toggle expanded state on click
  const handleClick = () => {
    setIsExpanded(!isExpanded);
  };

  // Close expanded view when clicking outside (on the overlay)
  const handleOverlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(false);
  };

  return (
    <>
      {/* Collapsed event card in timeline - angular, high contrast */}
      <div
        onClick={handleClick}
        className="absolute left-1 right-1 px-3 py-2 border-2 border-white bg-black/40 hover:bg-white/10 transition-colors cursor-pointer group overflow-hidden"
        style={style}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* Event title - truncated */}
            <p className="font-mono text-sm text-white uppercase tracking-wider truncate">
              {name || "UNTITLED EVENT"}
            </p>
            {/* Event time */}
            <p className="text-xs text-white/70 mt-0.5 font-mono">
              {formatEventTime(start)}
              {end && ` - ${formatEventTime(end)}`}
            </p>
          </div>
          {/* Expand indicator */}
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <span className="text-white/50 text-xs">▶</span>
          </div>
        </div>
        {/* Description preview - hidden if overflows */}
        {description && (
          <p className="text-xs text-white/60 mt-1 truncate font-mono">
            {description}
          </p>
        )}
      </div>

      {/* Expanded modal overlay - high contrast */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={handleOverlayClick}
        >
          {/* Expanded event card - angular */}
          <div
            className="relative w-full max-w-lg mx-4 glass-panel p-8 border-2 border-white animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setIsExpanded(false)}
              className="absolute top-4 right-4 text-white hover:bg-white/10 transition-colors p-2"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Event header */}
            <div className="mb-6">
              <h3 className="font-mono text-lg font-bold text-white uppercase tracking-wider pr-8">
                {name || "UNTITLED EVENT"}
              </h3>
              <p className="text-sm text-white/70 mt-2 font-mono">
                {formatEventTime(start)}
                {end && ` - ${formatEventTime(end)}`}
              </p>
            </div>

            {/* Divider - angular */}
            <div className="h-[2px] bg-white mb-6" />

            {/* Full description */}
            {description ? (
              <div className="max-h-64 overflow-y-auto custom-scrollbar">
                <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed font-mono">
                  {description}
                </p>
              </div>
            ) : (
              <p className="text-sm text-white/60 italic font-mono">NO DESCRIPTION</p>
            )}

            {/* Close button at bottom */}
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setIsExpanded(false)}
                className="btn-neon-secondary text-sm px-6 py-2 uppercase tracking-wider"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
