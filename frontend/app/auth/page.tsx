"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Authentication Page
 * Handles both sign up and sign in with email/password.
 * Cyberpunk-themed UI matching the landing page aesthetic.
 */
export default function AuthPage() {
  // Toggle between sign in and sign up modes
  const [isSignUp, setIsSignUp] = useState(false);
  
  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  
  const router = useRouter();
  const supabase = createClient();

  /**
   * Handle form submission for both sign in and sign up.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    // Validate password confirmation for sign up
    if (isSignUp && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    // Validate password length
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setIsLoading(true);

    try {
      if (isSignUp) {
        // Sign up new user
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            // Redirect to console after email confirmation
            emailRedirectTo: `${window.location.origin}/console`,
          },
        });

        if (error) throw error;

        // Show success message for email confirmation
        setMessage("Check your email for a confirmation link to complete registration.");
      } else {
        // Sign in existing user
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        // Redirect to console on successful sign in
        router.push("/console");
      }
    } catch (err) {
      // Handle authentication errors
      setError(err instanceof Error ? err.message : "An error occurred during authentication.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#0a0a0a] cyber-grid overflow-hidden flex items-center justify-center px-4">
      {/* Background gradient effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#00ffff] opacity-10 blur-[120px] rounded-full" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#ff00ff] opacity-10 blur-[120px] rounded-full" />
      </div>

      {/* Auth container */}
      <div className="relative z-10 w-full max-w-md animate-fade-in">
        {/* Header with logo and back link */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6 group">
            {/* Tetrahedron logo */}
            <div className="w-10 h-10">
              <svg viewBox="0 0 100 100" className="w-full h-full">
                <polygon 
                  points="50,10 10,90 90,90" 
                  fill="none" 
                  stroke="#00ffff" 
                  strokeWidth="2"
                  className="group-hover:animate-pulse-glow"
                />
                <polygon 
                  points="50,10 50,60 10,90" 
                  fill="rgba(0,255,255,0.1)" 
                  stroke="#00ffff" 
                  strokeWidth="1"
                />
              </svg>
            </div>
            <span className="font-mono text-2xl font-bold text-[#00ffff] tracking-wider">
              TETRA
            </span>
          </Link>
          
          <h1 className="text-3xl font-bold text-white font-mono mb-2">
            {isSignUp ? "Create Account" : "Welcome Back"}
          </h1>
          <p className="text-zinc-400 text-sm">
            {isSignUp 
              ? "Initialize your Tetra OS profile" 
              : "Access your command console"}
          </p>
        </div>

        {/* Auth form panel */}
        <div className="glass-panel p-8">
          {/* Mode toggle */}
          <div className="flex mb-6 border border-zinc-800 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(false);
                setError(null);
                setMessage(null);
              }}
              className={`flex-1 py-3 px-4 font-mono text-sm uppercase tracking-wider transition-all ${
                !isSignUp 
                  ? "bg-[#00ffff]/10 text-[#00ffff] border-r border-[#00ffff]/30" 
                  : "text-zinc-500 hover:text-zinc-300 border-r border-zinc-800"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSignUp(true);
                setError(null);
                setMessage(null);
              }}
              className={`flex-1 py-3 px-4 font-mono text-sm uppercase tracking-wider transition-all ${
                isSignUp 
                  ? "bg-[#00ffff]/10 text-[#00ffff]" 
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm font-mono">
              <span className="text-red-500 mr-2">ERROR:</span>
              {error}
            </div>
          )}

          {/* Success message */}
          {message && (
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-sm font-mono">
              <span className="text-green-500 mr-2">SUCCESS:</span>
              {message}
            </div>
          )}

          {/* Auth form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email field */}
            <div>
              <label 
                htmlFor="email" 
                className="block text-sm font-mono text-zinc-400 mb-2 uppercase tracking-wider"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@tetra.os"
                required
                className="input-cyber"
                disabled={isLoading}
              />
            </div>

            {/* Password field */}
            <div>
              <label 
                htmlFor="password" 
                className="block text-sm font-mono text-zinc-400 mb-2 uppercase tracking-wider"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="input-cyber"
                disabled={isLoading}
              />
            </div>

            {/* Confirm password field (sign up only) */}
            {isSignUp && (
              <div>
                <label 
                  htmlFor="confirmPassword" 
                  className="block text-sm font-mono text-zinc-400 mb-2 uppercase tracking-wider"
                >
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="input-cyber"
                  disabled={isLoading}
                />
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full btn-neon-primary py-4 mt-6 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <LoadingSpinner />
                  <span>Processing...</span>
                </>
              ) : (
                <span>{isSignUp ? "Initialize Account" : "Access Console"}</span>
              )}
            </button>
          </form>

          {/* Forgot password link (sign in only) */}
          {!isSignUp && (
            <p className="mt-4 text-center text-sm text-zinc-500">
              <button 
                type="button"
                className="text-[#00ffff]/60 hover:text-[#00ffff] transition-colors font-mono"
                onClick={() => {
                  // TODO: Implement password reset flow
                  setMessage("Password reset functionality coming soon.");
                }}
              >
                Forgot access credentials?
              </button>
            </p>
          )}
        </div>

        {/* Back to home link */}
        <p className="mt-6 text-center text-sm text-zinc-500">
          <Link 
            href="/" 
            className="text-zinc-400 hover:text-[#00ffff] transition-colors font-mono inline-flex items-center gap-2"
          >
            <span>←</span>
            <span>Return to main terminal</span>
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * Loading spinner component for button states.
 */
function LoadingSpinner() {
  return (
    <svg 
      className="animate-spin h-5 w-5 text-[#00ffff]" 
      xmlns="http://www.w3.org/2000/svg" 
      fill="none" 
      viewBox="0 0 24 24"
    >
      <circle 
        className="opacity-25" 
        cx="12" 
        cy="12" 
        r="10" 
        stroke="currentColor" 
        strokeWidth="4"
      />
      <path 
        className="opacity-75" 
        fill="currentColor" 
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
