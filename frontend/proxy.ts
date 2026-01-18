import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { createServerClient } from '@supabase/ssr';

/**
 * Proxy to protect API routes and refresh auth sessions.
 * Protects all /api/* routes by checking authentication.
 */
export async function proxy(request: NextRequest) {
  // Update session (refresh tokens if needed) - this returns a response with updated cookies
  let response = await updateSession(request);

  const pathname = request.nextUrl.pathname;

  // Only protect /api routes
  if (pathname.startsWith('/api') || pathname.startsWith('/auth')) {
    // Create Supabase client to check authentication
    // Use the response from updateSession to get updated cookies
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            // Update cookies on the response
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    // Check if user is authenticated
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    // If not authenticated, return 401
    if (pathname.startsWith('/api') && (authError || !user)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (pathname.startsWith('/auth') && !authError && user) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/console';
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Continue to the route handler
  return response;
}

// Configure which routes the middleware runs on
export const config = {
  matcher: [
    // Match all API routes
    '/api/:path*',
    // Also match other routes that need session refresh (optional)
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
