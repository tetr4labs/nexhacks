-- =============================================
-- Tetra Database Schema - User Profiles
-- =============================================
-- This schema extends Supabase's built-in auth.users table
-- with additional profile information for the Tetra app.

-- Create user_profiles table that links to auth.users
CREATE TABLE public.user_profiles (
  id uuid NOT NULL,
  handle text UNIQUE,
  timezone text DEFAULT 'UTC'::text,
  working_hours_start time without time zone DEFAULT '09:00:00'::time without time zone,
  working_hours_end time without time zone DEFAULT '17:00:00'::time without time zone,
  default_task_duration integer DEFAULT 30,
  reminder_style text DEFAULT 'gentle'::text CHECK (reminder_style = ANY (ARRAY['gentle'::text, 'strict'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  gmail_snoozed_until timestamp with time zone,
  gmail_connected boolean NOT NULL DEFAULT false,
  gmail_token_status text,
  gmail_last_checked_at timestamp with time zone,
  phone_num text UNIQUE,
  CONSTRAINT user_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
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


-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.
