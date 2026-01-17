"use client";

import { useState } from "react";
import ImportICSModal from "./ImportICSModal";

/**
 * Client component wrapper for the Import .ics button.
 * Manages modal state and renders both the button and modal.
 */
export default function ImportButton() {
  // State to control modal visibility
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      {/* Import button that opens the modal */}
      <button
        onClick={() => setIsModalOpen(true)}
        className="btn-neon-secondary flex items-center gap-2"
      >
        <CalendarIcon />
        <span className="hidden sm:inline">Import .ics</span>
      </button>

      {/* ICS Import Modal */}
      <ImportICSModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}

/**
 * Calendar icon for Import .ics button.
 */
function CalendarIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}
