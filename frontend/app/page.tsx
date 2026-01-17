"use client";

import Link from "next/link";

/**
 * Tetra Landing Page
 * Cyberpunk-themed marketing page with hero section, features, and CTAs.
 */
export default function LandingPage() {
  return (
    <div className="relative min-h-screen bg-[#0a0a0a] cyber-grid overflow-hidden">
      {/* Background gradient effects */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Top-right cyan glow */}
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#00ffff] opacity-10 blur-[120px] rounded-full" />
        {/* Bottom-left magenta glow */}
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#ff00ff] opacity-10 blur-[120px] rounded-full" />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 md:px-12 md:py-6">
          <div className="flex items-center gap-3">
            {/* Tetrahedron logo placeholder */}
            <div className="w-8 h-8 relative">
              <svg viewBox="0 0 100 100" className="w-full h-full">
                <polygon 
                  points="50,10 10,90 90,90" 
                  fill="none" 
                  stroke="#00ffff" 
                  strokeWidth="2"
                  className="animate-pulse-glow"
                />
                <polygon 
                  points="50,10 50,60 10,90" 
                  fill="rgba(0,255,255,0.1)" 
                  stroke="#00ffff" 
                  strokeWidth="1"
                />
              </svg>
            </div>
            <span className="font-mono text-lg font-bold text-[#00ffff] tracking-wider">
              TETRA
            </span>
          </div>
          
          <Link 
            href="/auth" 
            className="btn-neon-primary text-sm"
          >
            Sign In
          </Link>
        </header>

        {/* Hero Section */}
        <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 md:py-20">
          <div className="max-w-4xl mx-auto text-center stagger-fade-in">
            {/* Status line */}
            <p className="status-prefix text-[#00ffff] mb-6 tracking-widest">
              System Status: Online
            </p>

            {/* Main headline */}
            <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 font-mono tracking-tight glitch-hover">
              Your day,{" "}
              <span className="text-[#00ffff] text-glow-cyan">compiled.</span>
            </h1>

            {/* Subheadline */}
            <p className="text-xl md:text-2xl text-zinc-400 mb-12 max-w-2xl mx-auto leading-relaxed">
              A voice-first assistant that turns spoken intentions into structured action 
              — and holds you accountable.
            </p>

            {/* Feature bullets */}
            <div className="grid md:grid-cols-3 gap-6 mb-12 text-left">
              <FeatureCard 
                icon="🎙️"
                title="Voice-First Planning"
                description="Speak intentions. Tetra schedules."
              />
              <FeatureCard 
                icon="📅"
                title="Calendar Import"
                description="Imports your calendar. No integrations required."
              />
              <FeatureCard 
                icon="⚡"
                title="Accountability Mode"
                description="It remembers what you committed to."
              />
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link 
                href="/auth" 
                className="btn-neon-primary text-lg px-8 py-4"
              >
                Launch Console
              </Link>
              <Link 
                href="/auth" 
                className="btn-neon-secondary text-lg px-8 py-4"
              >
                Create Account
              </Link>
            </div>
          </div>
        </main>

        {/* Terminal-style footer */}
        <footer className="px-6 py-4 md:px-12 md:py-6 border-t border-zinc-800/50">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm font-mono text-zinc-600">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
              <span>TETRA OS v0.1.0</span>
            </div>
            <div className="flex items-center gap-6">
              <span>Built for NexHacks 2026</span>
              <span className="text-zinc-700">|</span>
              <span className="text-[#00ffff]/60">Connection: Secure</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Feature card component with glass panel styling.
 */
function FeatureCard({ 
  icon, 
  title, 
  description 
}: { 
  icon: string; 
  title: string; 
  description: string;
}) {
  return (
    <div className="glass-panel p-6 hover:border-[#00ffff]/30 transition-all duration-300 group">
      <div className="text-3xl mb-3 group-hover:scale-110 transition-transform duration-300">
        {icon}
      </div>
      <h3 className="text-white font-semibold mb-2 font-mono text-sm uppercase tracking-wider">
        {title}
      </h3>
      <p className="text-zinc-400 text-sm leading-relaxed">
        {description}
      </p>
    </div>
  );
}
