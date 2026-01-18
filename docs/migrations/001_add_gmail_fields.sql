-- =============================================
-- Migration: Add Gmail Integration Fields
-- =============================================
-- Run this in Supabase SQL Editor to add Gmail integration columns
-- to an existing user_profiles table.
--
-- These fields track user's Gmail connection state and snooze preferences.
-- Arcade stores the actual OAuth tokens; we cache status + respect snooze here.

ALTER TABLE public.user_profiles 
  ADD COLUMN IF NOT EXISTS gmail_snoozed_until TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS gmail_connected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gmail_token_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS gmail_last_checked_at TIMESTAMPTZ NULL;
