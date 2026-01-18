"use client";

import Image from "next/image";
import Link from "next/link";

/**
 * Tetra Landing Page
 * High contrast, angular, retro/Japanese-inspired design with Geist Mono throughout.
 */
export default function LandingPage() {
  return (
    <div className="relative min-h-screen bg-black cyber-grid overflow-hidden">
      {/* High contrast grid overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-30">
        <div className="absolute inset-0" style={{
          backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.1) 39px, rgba(255,255,255,0.1) 40px),
                           repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(255,255,255,0.1) 39px, rgba(255,255,255,0.1) 40px)`
        }} />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Angular header with sharp borders */}
        <header className="flex items-center justify-between px-6 py-4 md:px-12 md:py-6 border-b-2 border-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 relative border-2 border-white">
              <Image
                src="/tetra.png"
                alt="Tetra logo"
                width={36}
                height={36}
                className="w-full h-full object-contain"
                priority
              />
            </div>
            <span className="font-mono text-lg font-bold text-white tracking-[0.4em] uppercase">
              TETRA
            </span>
          </div>
          
          <Link 
            href="/auth" 
            className="btn-neon-primary text-sm"
          >
            SIGN IN
          </Link>
        </header>

        {/* Split panel layout - inspired by retro Japanese design */}
        <main className="flex-1 flex flex-col md:flex-row">
          {/* Left panel - Text content */}
          <div className="flex-1 flex flex-col justify-center px-6 py-12 md:px-12 md:py-20 border-r-2 border-white md:border-b-0 border-b-2">
            <div className="max-w-2xl mx-auto md:mx-0">
              {/* Status line - high contrast */}
              <p className="font-mono text-xs text-white mb-8 tracking-[0.3em] uppercase opacity-80">
                SIGNAL LOCK: INBOX + CALENDAR ONLINE
              </p>

              {/* Main headline - white, angular */}
              <h1 className="text-4xl md:text-6xl font-bold text-white mb-8 font-mono uppercase tracking-[0.1em] leading-tight">
                TUNE OUT OF TURING
              </h1>

              {/* Subheadline - high contrast */}
              <p className="text-base md:text-lg text-white mb-12 max-w-xl leading-relaxed font-mono opacity-90">
                TETRA READS YOUR EMAIL STREAM, DISTILLS THE SIGNAL, AND FORGES TASKS AND EVENTS YOU CAN CREATE, EDIT, AND DEPLOY IN SECONDS.
              </p>

              {/* Feature grid - angular cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
                <FeatureCard
                  icon="[01]"
                  title="INBOX RECON"
                  description="READ AND SUMMARIZE THREADS WITHOUT OPENING THEM."
                />
                <FeatureCard
                  icon="[02]"
                  title="TASK FORGE"
                  description="CONVERT ANY EMAIL INTO EDITABLE TASKS INSTANTLY."
                />
                <FeatureCard
                  icon="[03]"
                  title="CALENDAR OPS"
                  description="CREATE AND EDIT EVENTS WITH A SINGLE COMMAND."
                />
                <FeatureCard
                  icon="[04]"
                  title="SIGNAL MEMORY"
                  description="TETRA TRACKS COMMITMENTS AND PUSHES REMINDERS."
                />
              </div>

              {/* CTAs - angular buttons */}
              <div className="flex flex-col sm:flex-row gap-4">
                <Link 
                  href="/auth" 
                  className="btn-neon-primary text-base px-8 py-4 text-center"
                >
                  ENTER CONSOLE
                </Link>
                <Link 
                  href="/auth" 
                  className="btn-neon-secondary text-base px-8 py-4 text-center"
                >
                  REQUEST ACCESS
                </Link>
              </div>
            </div>
          </div>

          {/* Right panel - Visual/Info area - angular border */}
          <div className="flex-1 flex flex-col justify-center px-6 py-12 md:px-12 md:py-20 bg-black relative">
            {/* Angular decorative elements */}
            <div className="absolute top-0 left-0 w-full h-2 bg-white" />
            <div className="absolute top-0 right-0 w-2 h-full bg-white" />
            
            <div className="max-w-md mx-auto md:mx-0">
              {/* Info block - high contrast */}
              <div className="border-2 border-white p-8 mb-8">
                <p className="font-mono text-xs text-white mb-4 tracking-[0.2em] uppercase opacity-70">
                  SYSTEM STATUS
                </p>
                <div className="space-y-3 font-mono text-sm text-white">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-white" />
                    <span>INBOX: CONNECTED</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-white" />
                    <span>CALENDAR: SYNCED</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-white" />
                    <span>AGENT: ONLINE</span>
                  </div>
                </div>
              </div>

              {/* Version info - angular style */}
              <div className="border-l-2 border-white pl-4">
                <p className="font-mono text-xs text-white uppercase tracking-[0.2em] opacity-60">
                  TETRA OS v0.1.0
                </p>
                <p className="font-mono text-xs text-white uppercase tracking-[0.2em] opacity-60 mt-2">
                  BUILT FOR NEXHACKS 2026
                </p>
              </div>
            </div>
          </div>
        </main>

        {/* Angular footer - sharp borders */}
        <footer className="px-6 py-4 md:px-12 md:py-6 border-t-2 border-white">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-mono text-white">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-white" />
              <span>TETRA OS v0.1.0</span>
            </div>
            <div className="flex items-center gap-4">
              <span>FOR THE NEW WORLD</span>
              <span className="opacity-50">|</span>
              <span className="opacity-80">CONNECTION: SECURE</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Feature card component with angular, high-contrast styling.
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
    <div className="glass-panel p-6 hover:border-white hover:bg-white/5 transition-all duration-200 group border-white/30">
      <div className="font-mono text-xs text-white mb-3 opacity-70 tracking-wider">
        {icon}
      </div>
      <h3 className="text-white font-bold mb-2 font-mono text-xs uppercase tracking-[0.15em]">
        {title}
      </h3>
      <p className="text-white text-xs leading-relaxed font-mono opacity-80">
        {description}
      </p>
    </div>
  );
}
