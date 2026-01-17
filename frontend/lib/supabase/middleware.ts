import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Updates the Supabase auth session by refreshing tokens.
 * Should be called in middleware to maintain auth state across requests.
 * 
 * Usage in middleware.ts:
 *   import { updateSession } from '@/lib/supabase/middleware'
 *   export async function middleware(request: NextRequest) {
 *     return await updateSession(request)
 *   }
 */
export async function updateSession(request: NextRequest) {
  // Create a response object that we can modify
  let supabaseResponse = NextResponse.next({
    request,
  })

  // Create Supabase client with cookie handling
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Update request cookies
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          // Create new response with updated cookies
          supabaseResponse = NextResponse.next({
            request,
          })
          // Set cookies on response
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Do not add logic between createServerClient and supabase.auth.getUser()
  // A simple mistake could make it hard to debug auth issues.

  // Refresh the session if needed
  await supabase.auth.getUser()

  return supabaseResponse
}
