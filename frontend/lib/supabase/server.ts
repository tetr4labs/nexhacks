import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Creates a Supabase client for use in server components and API routes.
 * Handles cookie management for authentication state.
 * 
 * Usage:
 *   import { createClient } from '@/lib/supabase/server'
 *   const supabase = await createClient()
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // Get all cookies from the store
        getAll() {
          return cookieStore.getAll()
        },
        // Set cookies - used for auth token storage
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method is called from a Server Component
            // which can't set cookies. This can be ignored if middleware
            // is refreshing user sessions.
          }
        },
      },
    }
  )
}
