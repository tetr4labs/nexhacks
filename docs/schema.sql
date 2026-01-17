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
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
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
