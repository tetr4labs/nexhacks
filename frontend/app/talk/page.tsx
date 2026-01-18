"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  DataPacket_Kind,
} from "livekit-client";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * Talk to Tetra Page
 * Voice interface for interacting with the LiveKit voice agent.
 */
export default function TalkPage() {
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<
    Array<{ speaker: string; text: string; timestamp: Date }>
  >([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [isWaitingForAgent, setIsWaitingForAgent] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Transcript buffering and debouncing refs
  const transcriptBufferRef = useRef<
    Map<string, { text: string; timestamp: Date; timer: NodeJS.Timeout | null }>
  >(new Map());
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Connect to LiveKit room
  const connectToRoom = async () => {
    if (isConnecting || isConnected) return;

    setIsConnecting(true);
    setError(null);

    try {
      // Get access token from API
      const response = await fetch("/api/livekit-token");
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to get access token");
      }

      const { token, url, room: roomName } = await response.json();
      console.log("Connecting to room:", roomName);

      // Import LiveKit client dynamically (client-side only)
      const { Room } = await import("livekit-client");

      // Create room instance
      const newRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      // Helper to cleanup duplicate agents
      const cleanupDuplicateAgents = async (currentRoom: Room) => {
        const agents = Array.from(currentRoom.remoteParticipants.values())
          .filter(p => p.identity === "agent" || p.identity.includes("agent") || p.identity === "Tetra");

        if (agents.length > 1) {
          console.log("Found multiple agents, cleaning up...", agents.map(a => a.identity));

          // Sort by joinedAt (ascending: oldest first)
          const sortedAgents = agents.sort((a, b) => {
            const timeA = a.joinedAt?.getTime() || 0;
            const timeB = b.joinedAt?.getTime() || 0;
            return timeA - timeB;
          });

          // Keep the LAST one (newest). Remove all others.
          const agentsToRemove = sortedAgents.slice(0, sortedAgents.length - 1);

          for (const agent of agentsToRemove) {
            console.log("Removing duplicate agent:", agent.identity);
            try {
              await fetch("/api/kick-participant", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ room: currentRoom.name, identity: agent.identity }),
              });
            } catch (err) {
              console.error("Failed to remove agent:", err);
            }
          }
        }
      };

      // Set up event listeners
      newRoom.on(RoomEvent.Connected, () => {
        console.log("Connected to room:", newRoom.name);
        setIsConnected(true);
        setIsConnecting(false);

        // Cleanup duplicates
        cleanupDuplicateAgents(newRoom);


        // Log all participants
        const allParticipants = Array.from(newRoom.remoteParticipants.values());
        console.log(
          "Remote participants:",
          allParticipants.map((p) => p.identity),
        );
        setParticipants(allParticipants.map((p) => p.identity));

        // Clear error and waiting state if participants are already present
        if (allParticipants.length > 0) {
          setError(null);
          setIsWaitingForAgent(false);
        } else {
          // No participants yet, show waiting state
          setIsWaitingForAgent(true);
        }
      });

      newRoom.on(RoomEvent.Disconnected, (reason) => {
        console.log("Disconnected from room:", reason);
        setIsConnected(false);
        setRoom(null);
        setParticipants([]);
        setIsWaitingForAgent(false);
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
      });

      newRoom.on(
        RoomEvent.ParticipantConnected,
        (participant: RemoteParticipant) => {
          console.log(
            "Participant connected:",
            participant.identity,
            participant,
          );

          // Cleanup duplicates
          cleanupDuplicateAgents(newRoom);

          setParticipants((prev) => {
            const updated = [...prev, participant.identity];
            // Clear error and waiting state once agent is detected
            if (updated.length > 0) {
              setError(null);
              setIsWaitingForAgent(false);
            }
            return updated;
          });

          // Set up track listeners for this participant
          participant.on(
            RoomEvent.TrackSubscribed,
            (track: RemoteTrack, publication: RemoteTrackPublication) => {
              console.log(
                "Track subscribed:",
                track.kind,
                publication.trackSid,
                "from",
                participant.identity,
              );
              handleTrack(track, participant.identity);
            },
          );

          // Check for existing tracks
          participant.trackPublications.forEach((publication) => {
            if (publication.track) {
              console.log(
                "Existing track:",
                publication.kind,
                publication.trackSid,
              );
              handleTrack(
                publication.track as RemoteTrack,
                participant.identity,
              );
            }
          });
        },
      );

      newRoom.on(
        RoomEvent.ParticipantDisconnected,
        (participant: RemoteParticipant) => {
          console.log("Participant disconnected:", participant.identity);
          setParticipants((prev) =>
            prev.filter((id) => id !== participant.identity),
          );
        },
      );

      // Handle data messages (for transcripts)
      newRoom.on(
        RoomEvent.DataReceived,
        (
          payload: Uint8Array,
          participant?: RemoteParticipant,
          kind?: DataPacket_Kind,
        ) => {
          try {
            const text = new TextDecoder().decode(payload);
            console.log("Data received:", text, "from", participant?.identity);

            // Try to parse as JSON (transcript data)
            try {
              const data = JSON.parse(text);
              if (data.text || data.transcript) {
                addTranscript(
                  participant?.identity || "system",
                  data.text || data.transcript,
                );
              }
            } catch {
              // If not JSON, treat as plain text
              addTranscript(participant?.identity || "system", text);
            }
          } catch (err) {
            console.error("Error processing data:", err);
          }
        },
      );

      // Register text stream handler for transcripts
      try {
        newRoom.registerTextStreamHandler(
          "lk.transcription",
          async (reader, participantInfo) => {
            console.log("Text stream handler registered for transcription");
            try {
              const text = await reader.readAll();
              console.log(
                "Transcript received:",
                text,
                "from",
                participantInfo?.identity,
              );
              if (text) {
                addTranscript(participantInfo?.identity || "system", text);
              }
            } catch (err) {
              console.error("Error reading transcript stream:", err);
            }
          },
        );
      } catch (err) {
        console.warn(
          "Could not register text stream handler (may not be available in this version):",
          err,
        );
      }

      // Also listen for transcription events if available
      newRoom.on(RoomEvent.TranscriptionReceived, (transcription: any) => {
        console.log("Transcription event received:", transcription);
        if (transcription.text) {
          addTranscript(
            transcription.participant?.identity || "system",
            transcription.text,
          );
        }
      });

      // Handle local track published
      newRoom.localParticipant.on(RoomEvent.TrackPublished, (publication) => {
        console.log(
          "Local track published:",
          publication.kind,
          publication.trackSid,
        );
      });

      // Listen for all track subscriptions (including from remote participants)
      newRoom.on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          publication: RemoteTrackPublication,
          participant: RemoteParticipant,
        ) => {
          console.log(
            "Track subscribed event:",
            track.kind,
            "from",
            participant.identity,
          );
          handleTrack(track, participant.identity);
        },
      );

      // Connect to room FIRST - ensures participant is in room before agent joins
      await newRoom.connect(url, token);
      console.log("Room connection initiated");

      // Wait a moment for the room to be fully established on LiveKit's side
      // This helps prevent race conditions where the dispatch happens before the room is ready
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log("Room connection stabilized");

      // Trigger agent to join AFTER we're connected, with retry logic
      // This ensures the agent will find the participant with JWT metadata
      const dispatchAgentWithRetry = async (retries = 3, delay = 1000) => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            console.log(`[Dispatch] Attempt ${attempt}/${retries} to dispatch agent...`);
            const triggerResponse = await fetch("/api/trigger-agent", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ room: roomName }),
            });
            if (triggerResponse.ok) {
              console.log("[Dispatch] Agent trigger sent successfully");
              return true;
            } else {
              console.warn(`[Dispatch] Attempt ${attempt} failed with status:`, triggerResponse.status);
            }
          } catch (triggerErr) {
            console.warn(`[Dispatch] Attempt ${attempt} failed:`, triggerErr);
          }
          // Wait before retrying (except on last attempt)
          if (attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
        console.warn("[Dispatch] All dispatch attempts failed, agent may need to join automatically");
        return false;
      };

      await dispatchAgentWithRetry();

      // Enable microphone after connection
      try {
        await newRoom.localParticipant.setMicrophoneEnabled(true);
        console.log("Microphone enabled");

        // Verify microphone track is published
        const micPublication = newRoom.localParticipant.audioTrackPublications.values().next().value;
        if (micPublication) {
          console.log("Microphone track published:", micPublication.trackSid);
        } else {
          console.warn("Microphone track not found after enabling");
        }
      } catch (micError) {
        console.error("Failed to enable microphone:", micError);
        setError("Failed to enable microphone. Please check permissions.");
      }

      setRoom(newRoom);

      // Periodically check for agent (every 2 seconds for up to 10 seconds)
      // The error will be cleared automatically when the agent connects via ParticipantConnected event
      let checkCount = 0;
      const maxChecks = 5; // Check 5 times over 10 seconds
      const checkInterval = setInterval(() => {
        checkCount++;

        // Check if room is still connected
        if (newRoom.state === "connected") {
          // Properly check using string state
          const allParticipants = Array.from(
            newRoom.remoteParticipants.values(),
          );
          console.log(
            `[Check ${checkCount}/${maxChecks}] Participants:`,
            allParticipants.map((p) => p.identity),
          );

          if (allParticipants.length > 0) {
            // Agent found, clear any error and stop checking
            setError(null);
            setIsWaitingForAgent(false);
            clearInterval(checkInterval);
          } else if (checkCount >= maxChecks) {
            // After max checks, show a more helpful message (not an error)
            console.warn("Agent not detected after waiting period");
            setIsWaitingForAgent(true);
            // Don't set as error - just show waiting state
            clearInterval(checkInterval);
          }
        } else {
          // Room disconnected, stop checking
          clearInterval(checkInterval);
        }
      }, 2000); // Check every 2 seconds
    } catch (err) {
      console.error("Connection error:", err);
      setError(err instanceof Error ? err.message : "Failed to connect");
      setIsConnecting(false);
    }
  };

  // Handle audio track playback
  const handleTrack = (track: RemoteTrack, participantIdentity: string) => {
    if (track.kind === Track.Kind.Audio) {
      console.log("Handling audio track from:", participantIdentity, track);

      if (!audioRef.current) {
        console.error("Audio element not available");
        return;
      }

      // Stop any existing tracks
      if (audioRef.current.srcObject) {
        const existingStream = audioRef.current.srcObject as MediaStream;
        existingStream.getTracks().forEach((t) => {
          t.stop();
          existingStream.removeTrack(t);
        });
      }

      // Create new media stream and attach track
      const stream = new MediaStream();
      if (track.mediaStreamTrack) {
        stream.addTrack(track.mediaStreamTrack);
        audioRef.current.srcObject = stream;

        // Ensure audio element is ready
        audioRef.current.volume = 1.0;
        audioRef.current.muted = false;

        // Play audio with error handling
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              console.log(
                "Audio track playing successfully from:",
                participantIdentity,
              );
            })
            .catch((err) => {
              console.error("Error playing audio:", err);
              // Try again after user interaction
              if (err.name === "NotAllowedError") {
                setError(
                  "Please allow audio playback in your browser settings",
                );
              }
            });
        }
      } else {
        console.warn("Track has no mediaStreamTrack:", track);
      }
    }
    // Note: Data is handled via DataReceived event (see line 121), not as a track kind
  };

  // Simple similarity calculation (Jaccard similarity on words)
  // Used to detect duplicate transcript entries
  const calculateSimilarity = useCallback(
    (text1: string, text2: string): number => {
      const words1 = new Set(text1.toLowerCase().trim().split(/\s+/));
      const words2 = new Set(text2.toLowerCase().trim().split(/\s+/));

      const intersection = new Set([...words1].filter((x) => words2.has(x)));
      const union = new Set([...words1, ...words2]);

      return intersection.size / union.size;
    },
    [],
  );

  // Commit buffered transcripts to the main transcript array
  // Only commits after a pause in speech (debounced)
  const commitBufferedTranscripts = useCallback(() => {
    const buffers = Array.from(transcriptBufferRef.current.entries());

    if (buffers.length === 0) {
      return;
    }

    setTranscript((prev) => {
      // Get the last entry to check for duplicates
      const lastEntry = prev.length > 0 ? prev[prev.length - 1] : null;

      // Process each buffered transcript
      const newEntries = buffers
        .map(([speaker, buffer]) => {
          // Check if this is a duplicate of the last entry
          if (
            lastEntry &&
            lastEntry.speaker === speaker &&
            lastEntry.text.toLowerCase().trim() ===
            buffer.text.toLowerCase().trim()
          ) {
            return null; // Skip duplicate
          }

          // Check if this is very similar to the last entry (fuzzy duplicate)
          if (lastEntry && lastEntry.speaker === speaker) {
            const similarity = calculateSimilarity(lastEntry.text, buffer.text);
            if (similarity > 0.85) {
              // 85% similar = likely duplicate
              return null;
            }
          }

          return {
            speaker,
            text: buffer.text,
            timestamp: buffer.timestamp,
          };
        })
        .filter(
          (
            entry,
          ): entry is { speaker: string; text: string; timestamp: Date } =>
            entry !== null,
        );

      // Clear the buffers
      transcriptBufferRef.current.clear();

      // Return updated transcript
      return [...prev, ...newEntries];
    });
  }, [calculateSimilarity]);

  // Add transcript entry with buffering and debouncing
  // This prevents duplicate entries and waits until the user is done speaking
  const addTranscript = useCallback(
    (speaker: string, text: string) => {
      // Normalize speaker name
      const normalizedSpeaker =
        speaker === "agent" || speaker.includes("agent") ? "Tetra" : "You";

      // Skip empty or very short text
      if (!text || text.trim().length < 2) {
        return;
      }

      // Get or create buffer entry for this speaker
      const bufferKey = normalizedSpeaker;
      const existingBuffer = transcriptBufferRef.current.get(bufferKey);

      // Check if this is a duplicate or very similar to existing text
      if (existingBuffer) {
        const existingText = existingBuffer.text.toLowerCase().trim();
        const newText = text.toLowerCase().trim();

        // If the new text is contained in existing text, skip it (it's a partial update we already have)
        if (
          existingText.includes(newText) &&
          existingText.length > newText.length
        ) {
          return;
        }

        // If existing text is contained in new text, replace it (new text is more complete)
        if (
          newText.includes(existingText) &&
          newText.length > existingText.length
        ) {
          // Update the buffer with the more complete text
          transcriptBufferRef.current.set(bufferKey, {
            text: text.trim(),
            timestamp: existingBuffer.timestamp, // Keep original timestamp
            timer: existingBuffer.timer,
          });
        } else {
          // Merge texts if they're different (partial updates)
          // Only merge if they're from the same session (within 3 seconds)
          const timeDiff = Date.now() - existingBuffer.timestamp.getTime();
          if (timeDiff < 3000) {
            // Merge: append new words that aren't already in the buffer
            const existingWords = existingText.split(/\s+/);
            const newWords = newText.split(/\s+/);
            const additionalWords = newWords.filter(
              (word) => word.length > 0 && !existingWords.includes(word),
            );

            if (additionalWords.length > 0) {
              transcriptBufferRef.current.set(bufferKey, {
                text: existingBuffer.text + " " + additionalWords.join(" "),
                timestamp: existingBuffer.timestamp,
                timer: existingBuffer.timer,
              });
            }
          } else {
            // Different session, create new buffer entry
            transcriptBufferRef.current.set(bufferKey, {
              text: text.trim(),
              timestamp: new Date(),
              timer: null,
            });
          }
        }
      } else {
        // New buffer entry
        transcriptBufferRef.current.set(bufferKey, {
          text: text.trim(),
          timestamp: new Date(),
          timer: null,
        });
      }

      // Clear existing debounce timer
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      // Set new debounce timer - wait 1.5 seconds of silence before committing
      // This ensures we wait until the user is done speaking
      debounceTimeoutRef.current = setTimeout(() => {
        commitBufferedTranscripts();
      }, 1500);
    },
    [commitBufferedTranscripts],
  );

  // Disconnect from room
  const disconnect = async () => {
    if (room) {
      room.disconnect();
      setRoom(null);
      setIsConnected(false);
      setTranscript([]);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (room) {
        room.disconnect();
      }
      // Clear any pending timers
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      // Commit any remaining buffered transcripts before unmount
      commitBufferedTranscripts();
      transcriptBufferRef.current.forEach((buffer) => {
        if (buffer.timer) {
          clearTimeout(buffer.timer);
        }
      });
    };
  }, [room, commitBufferedTranscripts]);

  return (
    <div className="relative min-h-screen bg-[#0a0a0a] cyber-grid overflow-hidden">
      {/* Background gradient effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#00ffff] opacity-10 blur-[120px] rounded-full" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#ff00ff] opacity-10 blur-[120px] rounded-full" />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 md:px-12 md:py-6 border-b border-zinc-800/50">
          <Link href="/console" className="flex items-center gap-3 group">
            <div className="w-8 h-8 relative">
              <svg viewBox="0 0 100 100" className="w-full h-full">
                <polygon
                  points="50,10 10,90 90,90"
                  fill="none"
                  stroke="#00ffff"
                  strokeWidth="2"
                  className="animate-pulse-glow"
                />
              </svg>
            </div>
            <span className="font-mono text-lg font-bold text-[#00ffff] tracking-wider group-hover:text-[#00ffff]/80 transition-colors">
              TETRA
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <span
              className={`font-mono text-xs px-3 py-1 rounded border ${isConnected
                ? "border-[#22c55e] text-[#22c55e] bg-[#22c55e]/10"
                : isConnecting
                  ? "border-[#fbbf24] text-[#fbbf24] bg-[#fbbf24]/10"
                  : "border-zinc-700 text-zinc-500"
                }`}
            >
              {isConnected
                ? "CONNECTED"
                : isConnecting
                  ? "CONNECTING..."
                  : "DISCONNECTED"}
            </span>
          </div>
        </header>

        {/* Main voice interface */}
        <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 md:py-20">
          <div className="max-w-2xl mx-auto text-center">
            {/* Tetrahedron icon - pulsing when connected */}
            <div className="mb-8 flex justify-center">
              <div
                className={`w-32 h-32 relative transition-all duration-300 ${isConnected ? "animate-pulse" : ""
                  }`}
              >
                <svg viewBox="0 0 100 100" className="w-full h-full">
                  <polygon
                    points="50,10 10,90 90,90"
                    fill="none"
                    stroke={isConnected ? "#00ffff" : "#00ffff/50"}
                    strokeWidth="3"
                    className={isConnected ? "animate-pulse-glow" : ""}
                  />
                  <polygon
                    points="50,10 50,60 10,90"
                    fill={
                      isConnected
                        ? "rgba(0,255,255,0.2)"
                        : "rgba(0,255,255,0.05)"
                    }
                    stroke={isConnected ? "#00ffff" : "#00ffff/30"}
                    strokeWidth="1"
                  />
                  <polygon
                    points="50,10 50,60 90,90"
                    fill={
                      isConnected
                        ? "rgba(0,255,255,0.1)"
                        : "rgba(0,255,255,0.02)"
                    }
                    stroke={isConnected ? "#00ffff" : "#00ffff/30"}
                    strokeWidth="1"
                  />
                </svg>
              </div>
            </div>

            {/* Status message */}
            <div className="mb-8">
              {error ? (
                <div className="text-red-400 font-mono text-sm mb-4">
                  {error}
                </div>
              ) : isConnected ? (
                <>
                  <p className="text-[#00ffff] font-mono text-lg mb-2">
                    ✓ Connected to Tetra
                  </p>
                  {isWaitingForAgent && participants.length === 0 ? (
                    <p className="text-[#fbbf24] font-mono text-sm mt-2 animate-pulse">
                      ⏳ Waiting for agent to join...
                    </p>
                  ) : participants.length > 0 ? (
                    <p className="text-zinc-500 font-mono text-xs mt-2">
                      Speak naturally. Tetra is listening.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-zinc-400 font-mono text-sm">
                  Ready to connect
                </p>
              )}
            </div>

            {/* Control buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              {!isConnected && !isConnecting ? (
                <button
                  onClick={connectToRoom}
                  className="btn-neon-primary text-lg px-8 py-4"
                >
                  Connect to Tetra
                </button>
              ) : isConnecting ? (
                <button
                  disabled
                  className="btn-neon-secondary text-lg px-8 py-4 opacity-50 cursor-not-allowed"
                >
                  Connecting...
                </button>
              ) : (
                <button
                  onClick={disconnect}
                  className="btn-neon-secondary text-lg px-8 py-4"
                >
                  Disconnect
                </button>
              )}
            </div>

            {/* Debug info */}
            {isConnected && participants.length > 0 && (
              <div className="mb-4 text-xs font-mono text-zinc-500">
                Participants: {participants.join(", ")}
              </div>
            )}

            {/* Transcript area */}
            {isConnected && (
              <div className="glass-panel p-6 text-left min-h-[200px] max-h-[400px] overflow-y-auto custom-scrollbar">
                <h3 className="font-mono text-xs uppercase tracking-wider text-[#00ffff] mb-4">
                  Transcript
                </h3>
                {transcript.length === 0 ? (
                  <p className="text-zinc-600 font-mono text-sm italic">
                    Waiting for conversation...
                    {participants.length === 0 && (
                      <span className="block mt-2 text-zinc-700">
                        (Waiting for agent to join...)
                      </span>
                    )}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {transcript.map((entry, i) => (
                      <div
                        key={i}
                        className="border-l-2 border-[#00ffff]/30 pl-3"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`font-mono text-xs uppercase ${entry.speaker === "Tetra"
                              ? "text-[#00ffff]"
                              : "text-[#ff00ff]"
                              }`}
                          >
                            {entry.speaker}:
                          </span>
                          <span className="text-xs text-zinc-600">
                            {entry.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-zinc-300 font-mono text-sm">
                          {entry.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* Audio element for agent audio */}
        <audio
          ref={audioRef}
          autoPlay
          playsInline
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
}
