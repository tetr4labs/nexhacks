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
    <div className="relative min-h-screen bg-black cyber-grid overflow-hidden flex items-center justify-center px-4">
      {/* High contrast grid overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-30">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.1) 39px, rgba(255,255,255,0.1) 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(255,255,255,0.1) 39px, rgba(255,255,255,0.1) 40px)",
          }}
        />
      </div>

      {/* Background gradient effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-white opacity-10 blur-[140px] rounded-full" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-white opacity-5 blur-[140px] rounded-full" />
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
                  stroke="#ffffff" 
                  strokeWidth="2"
                  className="group-hover:animate-pulse-glow"
                />
                <polygon 
                  points="50,10 50,60 10,90" 
                  fill="rgba(255,255,255,0.08)" 
                  stroke="#ffffff" 
                  strokeWidth="1"
                />
              </svg>
            </div>
            <span className="font-mono text-2xl font-bold text-white tracking-[0.3em] uppercase">
              TETRA
            </span>
          </Link>
          
          <h1 className="text-3xl font-bold text-white font-mono mb-2 uppercase tracking-[0.1em]">
            {isSignUp ? "Create Account" : "Welcome Back"}
          </h1>
          <p className="text-white/70 text-sm font-mono uppercase tracking-[0.2em]">
            {isSignUp 
              ? "Initialize your Tetra OS profile" 
              : "Access your command console"}
          </p>
        </div>

        {/* Auth form panel */}
        <div className="glass-panel p-8 border-2 border-white bg-black/70">
          {/* Mode toggle */}
          <div className="flex mb-6 border-2 border-white overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(false);
                setError(null);
                setMessage(null);
              }}
              className={`flex-1 py-3 px-4 font-mono text-sm uppercase tracking-[0.2em] transition-all ${
                !isSignUp 
                  ? "bg-white/10 text-white border-r-2 border-white" 
                  : "text-white/50 hover:text-white border-r-2 border-white/40"
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
              className={`flex-1 py-3 px-4 font-mono text-sm uppercase tracking-[0.2em] transition-all ${
                isSignUp 
                  ? "bg-white/10 text-white" 
                  : "text-white/50 hover:text-white"
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border-2 border-red-500/40 text-red-300 text-sm font-mono uppercase tracking-[0.15em]">
              <span className="text-red-500 mr-2">ERROR:</span>
              {error}
            </div>
          )}

          {/* Success message */}
          {message && (
            <div className="mb-4 p-3 bg-green-500/10 border-2 border-green-500/40 text-green-300 text-sm font-mono uppercase tracking-[0.15em]">
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
                className="block text-xs font-mono text-white/70 mb-2 uppercase tracking-[0.2em]"
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
                className="w-full border-2 border-white bg-black text-white font-mono px-4 py-3 focus:outline-none focus:border-white placeholder:text-white/40"
                disabled={isLoading}
              />
            </div>

            {/* Password field */}
            <div>
              <label 
                htmlFor="password" 
                className="block text-xs font-mono text-white/70 mb-2 uppercase tracking-[0.2em]"
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
                className="w-full border-2 border-white bg-black text-white font-mono px-4 py-3 focus:outline-none focus:border-white placeholder:text-white/40"
                disabled={isLoading}
              />
            </div>

            {/* Confirm password field (sign up only) */}
            {isSignUp && (
              <div>
                <label 
                  htmlFor="confirmPassword" 
                  className="block text-xs font-mono text-white/70 mb-2 uppercase tracking-[0.2em]"
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
                  className="w-full border-2 border-white bg-black text-white font-mono px-4 py-3 focus:outline-none focus:border-white placeholder:text-white/40"
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
            <p className="mt-4 text-center text-xs text-white/60 font-mono uppercase tracking-[0.2em]">
              <button 
                type="button"
                className="text-white/70 hover:text-white transition-colors"
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
        <p className="mt-6 text-center text-xs text-white/60 font-mono uppercase tracking-[0.2em]">
          <Link 
            href="/" 
            className="text-white/70 hover:text-white transition-colors inline-flex items-center gap-2"
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
      className="animate-spin h-5 w-5 text-white" 
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
