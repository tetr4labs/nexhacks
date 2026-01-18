"use client";

/**
 * SettingsModal.tsx
 *
 * Modal component for user settings. Currently supports:
 * - Phone number input in E.164 format (+{country_code}{number})
 *
 * The phone number is saved to the user_profiles table in Supabase.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

// =============================================
// Props interface
// =============================================

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// =============================================
// Main SettingsModal component
// =============================================

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const supabase = useMemo(() => createClient(), []);

  // Form state
  const [phone, setPhone] = useState("");
  const [originalPhone, setOriginalPhone] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // =============================================
  // Load current phone number from database
  // =============================================

  const loadUserProfile = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get the current user
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Unable to load user session.");
      }

      // Fetch the user's profile (phone_num column in database)
      const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("phone_num")
        .eq("id", user.id)
        .single();

      if (profileError) {
        // Profile might not exist yet, which is fine
        console.warn("Could not load profile:", profileError);
        setPhone("");
        setOriginalPhone("");
      } else {
        // Set the phone number from the database
        setPhone(profile?.phone_num || "");
        setOriginalPhone(profile?.phone_num || "");
      }
    } catch (err) {
      console.error("Error loading user profile:", err);
      setError(err instanceof Error ? err.message : "Failed to load settings.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  // Load profile when modal opens
  useEffect(() => {
    if (isOpen) {
      loadUserProfile();
      // Reset messages when modal opens
      setError(null);
      setSuccessMessage(null);
    }
  }, [isOpen, loadUserProfile]);

  // =============================================
  // Phone number validation
  // =============================================

  /**
   * Validates E.164 phone number format.
   * Format: +{country_code}{number} with 7-15 total digits after the +
   * Examples: +14155551234, +442071234567
   */
  const validatePhone = useCallback((value: string): string | null => {
    // Allow empty phone (user can clear it)
    if (!value || value.trim() === "") {
      return null;
    }

    // Check format: must start with + followed by digits only
    const e164Regex = /^\+[1-9][0-9]{6,14}$/;

    if (!e164Regex.test(value)) {
      return "Phone must be in format: +{country_code}{number} (e.g., +14155551234)";
    }

    return null;
  }, []);

  // =============================================
  // Handle phone input change
  // =============================================

  const handlePhoneChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;

      // Only allow + at the start and digits after
      // This provides real-time input sanitization
      const sanitized = value
        .replace(/[^\d+]/g, "") // Remove non-digit, non-plus characters
        .replace(/(?!^)\+/g, ""); // Remove + if not at start

      setPhone(sanitized);
      // Clear messages when user types
      setError(null);
      setSuccessMessage(null);
    },
    []
  );

  // =============================================
  // Save phone number to database
  // =============================================

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // Validate phone format
      const validationError = validatePhone(phone);
      if (validationError) {
        setError(validationError);
        setIsSaving(false);
        return;
      }

      // Get current user
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Unable to load user session.");
      }

      // Update the phone number in user_profiles (phone_num column)
      // Use null for empty string to clear the phone
      const phoneValue = phone.trim() === "" ? null : phone.trim();

      const { error: updateError } = await supabase
        .from("user_profiles")
        .update({ phone_num: phoneValue })
        .eq("id", user.id);

      if (updateError) {
        throw updateError;
      }

      // Update original value to reflect saved state
      setOriginalPhone(phone);
      setSuccessMessage("Phone number saved successfully!");

      // Auto-close after a brief delay on success
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      console.error("Error saving phone number:", err);
      setError(
        err instanceof Error ? err.message : "Failed to save phone number."
      );
    } finally {
      setIsSaving(false);
    }
  }, [phone, supabase, validatePhone, onClose]);

  // =============================================
  // Handle keyboard events
  // =============================================

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) {
        onClose();
      } else if (e.key === "Enter" && !isSaving) {
        handleSave();
      }
    },
    [isSaving, onClose, handleSave]
  );

  // Check if there are unsaved changes
  const hasChanges = phone !== originalPhone;

  // Don't render if modal is closed
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop - clicking closes modal */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={() => !isSaving && onClose()}
      />

      {/* Modal content */}
      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="glass-panel border-2 border-white p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-mono text-lg uppercase tracking-[0.2em] text-white">
              SETTINGS
            </h2>
            <button
              onClick={() => !isSaving && onClose()}
              disabled={isSaving}
              className="text-white/60 hover:text-white transition-colors p-1 disabled:opacity-50"
              aria-label="Close settings"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Loading state */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-white/30 border-t-white animate-spin" />
            </div>
          ) : (
            <>
              {/* Phone number input section */}
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="phone"
                    className="block font-mono text-xs uppercase tracking-wider text-white/80 mb-2"
                  >
                    Phone Number
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={handlePhoneChange}
                    placeholder="+14155551234"
                    disabled={isSaving}
                    className="w-full px-4 py-3 bg-black/50 border-2 border-white/40 text-white font-mono text-sm 
                               placeholder:text-white/30 focus:border-white focus:outline-none 
                               disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  />
                  <p className="mt-2 font-mono text-xs text-white/50">
                    Format: +{"{country_code}"}{"{number}"} (e.g., +14155551234)
                  </p>
                </div>

                {/* Error message */}
                {error && (
                  <div className="p-3 border-2 border-red-500/50 bg-red-500/10">
                    <p className="font-mono text-xs text-red-400">{error}</p>
                  </div>
                )}

                {/* Success message */}
                {successMessage && (
                  <div className="p-3 border-2 border-green-500/50 bg-green-500/10">
                    <p className="font-mono text-xs text-green-400">
                      {successMessage}
                    </p>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => !isSaving && onClose()}
                  disabled={isSaving}
                  className="flex-1 btn-neon-secondary text-xs py-3 disabled:opacity-50"
                >
                  CANCEL
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving || !hasChanges}
                  className="flex-1 btn-neon-primary text-xs py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? "SAVING..." : "SAVE"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
