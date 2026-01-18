-- =============================================
-- Tetra Database Schema - User Profiles
-- =============================================
-- This schema extends Supabase's built-in auth.users table
-- with additional profile information for the Tetra app.

-- Create user_profiles table that links to auth.users
CREATE TABLE IF NOT EXISTS public.user_profiles (
    -- Primary key matching auth.users id
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    
    -- User's display handle (cyberpunk style username)
    handle TEXT UNIQUE,
    
    -- Timezone for scheduling (e.g., 'America/New_York')
    timezone TEXT DEFAULT 'UTC',
    
    -- Working hours configuration (24-hour format)
    working_hours_start TIME DEFAULT '09:00:00',
    working_hours_end TIME DEFAULT '17:00:00',
    
    -- Default duration settings (in minutes)
    default_task_duration INTEGER DEFAULT 30,
    
    -- Reminder style preference
    reminder_style TEXT DEFAULT 'gentle' CHECK (reminder_style IN ('gentle', 'strict')),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Gmail integration (Arcade MCP)
    -- Snooze: if set and in the future, UI won't prompt and agent won't attempt Gmail tools
    gmail_snoozed_until TIMESTAMPTZ NULL,
    -- Cached connection status from Arcade (authoritative source is Arcade API)
    gmail_connected BOOLEAN NOT NULL DEFAULT false,
    -- Token status from Arcade: 'not_started' | 'pending' | 'completed' | 'failed'
    gmail_token_status TEXT NULL,
    -- When we last checked Arcade for Gmail auth status
    gmail_last_checked_at TIMESTAMPTZ NULL
);

-- Create index for faster handle lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_handle ON public.user_profiles(handle);

-- =============================================
-- Row Level Security (RLS) Policies
-- =============================================

-- Enable RLS on user_profiles
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own profile
CREATE POLICY "Users can view own profile"
    ON public.user_profiles
    FOR SELECT
    USING (auth.uid() = id);

-- Policy: Users can insert their own profile
CREATE POLICY "Users can insert own profile"
    ON public.user_profiles
    FOR INSERT
    WITH CHECK (auth.uid() = id);

-- Policy: Users can update their own profile
CREATE POLICY "Users can update own profile"
    ON public.user_profiles
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Policy: Users can delete their own profile
CREATE POLICY "Users can delete own profile"
    ON public.user_profiles
    FOR DELETE
    USING (auth.uid() = id);

-- =============================================
-- Trigger: Auto-create profile on user signup
-- =============================================

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id)
    VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger that fires after a new user is created in auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- Function: Auto-update updated_at timestamp
-- =============================================

-- Function to update the updated_at column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating updated_at on user_profiles
CREATE OR REPLACE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.events (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  start timestamp with time zone,
  end timestamp with time zone,
  name text,
  description text,
  owner uuid,
  CONSTRAINT events_pkey PRIMARY KEY (id),
  CONSTRAINT events_owner_fkey FOREIGN KEY (owner) REFERENCES public.user_profiles(id)
);

CREATE TABLE public.tasks (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  name text,
  description text,
  owner uuid,
  due timestamp with time zone,
  done boolean,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_owner_fkey FOREIGN KEY (owner) REFERENCES public.user_profiles(id)
);

-- Enable RLS on the main data tables
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- Policy for Events: Users can only see/edit events where they are the owner
CREATE POLICY "Users can manage their own events"
    ON public.events
    FOR ALL -- Covers SELECT, INSERT, UPDATE, DELETE
    USING (auth.uid() = owner)
    WITH CHECK (auth.uid() = owner);

-- Policy for Tasks: Users can only see/edit tasks where they are the owner
CREATE POLICY "Users can manage their own tasks"
    ON public.tasks
    FOR ALL
    USING (auth.uid() = owner)
    WITH CHECK (auth.uid() = owner);

-- Update the foreign key to point to auth.users directly
ALTER TABLE public.events 
  DROP CONSTRAINT events_owner_fkey,
  ADD CONSTRAINT events_owner_fkey FOREIGN KEY (owner) REFERENCES auth.users(id);

ALTER TABLE public.tasks 
  DROP CONSTRAINT tasks_owner_fkey,
  ADD CONSTRAINT tasks_owner_fkey FOREIGN KEY (owner) REFERENCES auth.users(id);

ALTER TABLE public.events 
ALTER COLUMN owner 
SET DEFAULT auth.uid();

ALTER TABLE public.tasks 
ALTER COLUMN owner 
SET DEFAULT auth.uid();

-- =============================================
-- Gmail Integration Fields (for Arcade MCP)
-- =============================================
-- These fields track user's Gmail connection state and snooze preferences.
-- Arcade stores the actual OAuth tokens; we cache status + respect snooze here.

-- Add Gmail integration columns to user_profiles
-- Run this migration on existing databases:
/*
ALTER TABLE public.user_profiles 
  ADD COLUMN IF NOT EXISTS gmail_snoozed_until TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS gmail_connected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gmail_token_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS gmail_last_checked_at TIMESTAMPTZ NULL;
*/

-- For new installations, these columns are included in the CREATE TABLE above.
-- If you're adding to an existing database, run the ALTER TABLE statement above.
