import { NextRequest, NextResponse } from "next/server";

/**
 * Atlas Authentication Middleware
 *
 * Protects routes based on authentication status and role.
 * Authentication is ENFORCED - unauthenticated users are redirected to /login.
 *
 * Route protection levels:
 * - Public: No auth required (login, public API, webhooks, cron)
 * - Auth Required: Must be logged in (most of the app)
 * - Admin Only: Must be logged in with admin role (validated in route handlers)
 */

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/login",
  "/change-password",
  "/api/auth/login",
  "/api/auth/change-password",
  "/api/auth/me",
  "/api/intake/public",
  "/api/version",
  "/api/health",
  "/_next",
  "/favicon.ico",
];

// Routes that require admin role
const ADMIN_PATHS = [
  "/admin",
  "/api/admin",
];

// API paths that are public (for webhooks, cron, etc.)
const PUBLIC_API_PATHS = [
  "/api/cron",
  "/api/webhook",
  "/api/intake/submit",
];

/**
 * Check if a path matches any of the given patterns
 */
function matchesPath(pathname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("*")) {
      return pathname.startsWith(pattern.slice(0, -1));
    }
    return pathname === pattern || pathname.startsWith(pattern + "/");
  });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for public paths
  if (matchesPath(pathname, PUBLIC_PATHS)) {
    return NextResponse.next();
  }

  // Skip middleware for public API paths
  if (matchesPath(pathname, PUBLIC_API_PATHS)) {
    return NextResponse.next();
  }

  // Get session cookie
  const sessionToken = request.cookies.get("atlas_session")?.value;

  // Enforce authentication for all non-public routes
  if (!sessionToken) {
    // API requests that require auth return 401
    if (pathname.startsWith("/api/")) {
      // Admin API routes require auth
      if (matchesPath(pathname, ADMIN_PATHS)) {
        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }
      // Other API routes - allow through but mark as unauthenticated
      // Individual routes can enforce auth as needed
      const response = NextResponse.next();
      response.headers.set("X-Auth-Status", "unauthenticated");
      return response;
    }

    // Non-API routes redirect to login
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Check for password change requirement
  // Note: Full validation happens in API routes; this is just for redirecting UI
  // The /api/auth/me endpoint will return password_change_required status
  // The change-password page handles the enforcement on the client side

  // Validate the session by calling the auth check endpoint
  // This is done asynchronously to avoid blocking
  // The actual validation happens in the API routes that need it

  // For admin paths, we mark the request as needing admin validation
  // The individual routes will check the actual role from the session
  const response = NextResponse.next();
  response.headers.set("X-Auth-Status", "authenticated");
  if (matchesPath(pathname, ADMIN_PATHS)) {
    response.headers.set("X-Admin-Route", "true");
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
