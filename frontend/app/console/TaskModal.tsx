"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

interface Task {
  id: number;
  name: string | null;
  description: string | null;
  due: string | null;
  done: boolean | null;
}

interface TaskModalProps {
  isOpen: boolean;
  mode: "create" | "edit";
  task: Task | null;
  selectedDayString: string;
  onClose: () => void;
  onSave: (payload: { name: string; description: string; due: string | null }) => void;
  onDelete: () => void;
  isSaving: boolean;
  errorMessage: string | null;
}

function formatTimeInput(date: Date) {
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

export default function TaskModal({
  isOpen,
  mode,
  task,
  selectedDayString,
  onClose,
  onSave,
  onDelete,
  isSaving,
  errorMessage,
}: TaskModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [hasDueTime, setHasDueTime] = useState(false);
  const [dueTime, setDueTime] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(task?.name || "");
    setDescription(task?.description || "");
    if (task?.due) {
      setHasDueTime(true);
      setDueTime(formatTimeInput(new Date(task.due)));
    } else {
      setHasDueTime(false);
      setDueTime("");
    }
    setLocalError(null);
  }, [isOpen, task]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setLocalError("Task name is required.");
      return;
    }

    let due: string | null = null;
    if (hasDueTime) {
      if (!dueTime) {
        setLocalError("Select a due time or turn it off.");
        return;
      }

      const dueDate = new Date(`${selectedDayString}T${dueTime}`);
      if (Number.isNaN(dueDate.getTime())) {
        setLocalError("Invalid due time.");
        return;
      }
      due = dueDate.toISOString();
    }

    onSave({
      name: trimmedName,
      description: description.trim(),
      due,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="glass-panel w-[min(92vw,520px)] border-2 border-white p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/60">
              {mode === "create" ? "New Task" : "Edit Task"}
            </p>
            <h2 className="font-mono text-lg text-white uppercase tracking-[0.2em] mt-2">
              {selectedDayString.replaceAll("-", ".")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors"
            aria-label="Close task modal"
            disabled={isSaving}
          >
            ✕
          </button>
        </div>

        {(localError || errorMessage) && (
          <div className="text-red-400 font-mono text-xs mb-4 p-3 border border-red-500/40 bg-red-500/10">
            {localError || errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-white/70 uppercase tracking-[0.2em] mb-2">
              Task Name
            </label>
            <input
              className="input-cyber"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="ENTER TASK NAME"
              disabled={isSaving}
              maxLength={120}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-white/70 uppercase tracking-[0.2em] mb-2">
              Details
            </label>
            <textarea
              className="input-cyber min-h-[96px] resize-none"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="ADD OPTIONAL CONTEXT"
              disabled={isSaving}
              maxLength={240}
            />
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-3 text-xs font-mono text-white/80 uppercase tracking-[0.2em]">
              <input
                type="checkbox"
                checked={hasDueTime}
                onChange={(event) => setHasDueTime(event.target.checked)}
                disabled={isSaving}
                className="h-4 w-4 border border-white/50 bg-black"
              />
              Set due time
            </label>

            {hasDueTime && (
              <input
                type="time"
                className="input-cyber"
                value={dueTime}
                onChange={(event) => setDueTime(event.target.value)}
                disabled={isSaving}
              />
            )}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-white/20">
            {mode === "edit" ? (
              <button
                type="button"
                onClick={onDelete}
                className="btn-neon-secondary text-xs px-4 py-2 border-red-500/60 text-red-400 hover:border-red-400"
                disabled={isSaving}
              >
                DELETE TASK
              </button>
            ) : (
              <span className="text-xs font-mono text-white/40 uppercase tracking-[0.2em]">
                Task will be saved for this day
              </span>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="btn-neon-secondary text-xs px-4 py-2"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-neon-primary text-xs px-4 py-2"
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : mode === "create" ? "Create" : "Update"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
