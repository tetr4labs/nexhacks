"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Props for the ImportICSModal component
 */
interface ImportICSModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal component for importing ICS calendar files.
 * Features drag-and-drop file upload with cyberpunk styling.
 */
export default function ImportICSModal({ isOpen, onClose }: ImportICSModalProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // State for tracking upload process
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Handle file selection from input or drop
  const handleFileSelect = useCallback((file: File) => {
    // Validate file type
    if (!file.name.toLowerCase().endsWith(".ics")) {
      setResult({ success: false, message: "Invalid file type. Please select an .ics file." });
      return;
    }
    setSelectedFile(file);
    setResult(null);
  }, []);

  // Handle drag events for drop zone
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  // Handle file input change
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  // Trigger file input click
  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Upload the selected file to the API
  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setResult(null);

    try {
      // Create FormData and append the file
      const formData = new FormData();
      formData.append("file", selectedFile);

      // Send to API route
      const response = await fetch("/api/import-ics", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setResult({ success: true, message: data.message });
        // Refresh the page to show new events after a short delay
        setTimeout(() => {
          router.refresh();
          onClose();
        }, 1500);
      } else {
        setResult({ success: false, message: data.error || "Failed to import calendar." });
      }
    } catch (error) {
      console.error("Upload error:", error);
      setResult({ success: false, message: "Network error. Please try again." });
    } finally {
      setIsUploading(false);
    }
  }, [selectedFile, router, onClose]);

  // Reset state when closing
  const handleClose = useCallback(() => {
    setSelectedFile(null);
    setResult(null);
    setIsDragging(false);
    setIsUploading(false);
    onClose();
  }, [onClose]);

  // Don't render if not open
  if (!isOpen) return null;

  return (
    // Modal backdrop with blur effect
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={handleClose}
    >
      {/* Modal content - stop propagation to prevent closing when clicking inside */}
      <div 
        className="relative w-full max-w-md mx-4 glass-panel p-6 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-[#00ffff] transition-colors"
          aria-label="Close modal"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Modal header */}
        <div className="mb-6">
          <h2 className="font-mono text-lg font-bold text-[#00ffff] uppercase tracking-wider">
            Import Calendar
          </h2>
          <p className="text-sm text-zinc-500 mt-1">
            Upload an .ics file to import events (next 30 days)
          </p>
        </div>

        {/* Drop zone */}
        <div
          className={`
            relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
            transition-all duration-200 mb-4
            ${isDragging 
              ? "border-[#00ffff] bg-[#00ffff]/10" 
              : "border-zinc-700 hover:border-zinc-600 bg-zinc-900/50"
            }
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleBrowseClick}
        >
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".ics"
            onChange={handleInputChange}
            className="hidden"
          />

          {/* Drop zone content */}
          {selectedFile ? (
            // Show selected file info
            <div className="space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-[#00ffff]/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-[#00ffff]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="font-mono text-sm text-[#00ffff]">{selectedFile.name}</p>
              <p className="text-xs text-zinc-500">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
          ) : (
            // Show upload prompt
            <div className="space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-zinc-800 flex items-center justify-center">
                <svg className="w-6 h-6 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <div>
                <p className="font-mono text-sm text-zinc-400">
                  Drop .ics file here or <span className="text-[#00ffff]">browse</span>
                </p>
                <p className="text-xs text-zinc-600 mt-1">
                  Supports iCalendar format (.ics)
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Result message */}
        {result && (
          <div 
            className={`
              p-3 rounded border mb-4 font-mono text-sm
              ${result.success 
                ? "border-[#22c55e]/30 bg-[#22c55e]/10 text-[#22c55e]" 
                : "border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444]"
              }
            `}
          >
            {result.message}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 px-4 py-2.5 rounded border border-zinc-700 text-zinc-400 font-mono text-sm uppercase tracking-wider hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!selectedFile || isUploading}
            className="flex-1 btn-neon-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Importing...
              </span>
            ) : (
              "Import"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
