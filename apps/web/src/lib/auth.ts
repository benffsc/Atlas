import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { queryOne, queryRows } from "./db";

/**
 * Staff Authentication Library
 *
 * Provides session-based authentication for Atlas staff members.
 * Uses bcrypt for password hashing and database-backed sessions.
 *
 * Session flow:
 * 1. Staff logs in with email/password
 * 2. Server creates session record and returns token in HTTP-only cookie
 * 3. Subsequent requests include cookie, validated via middleware
 * 4. Staff info attached to request for use in API handlers
 */

// ============================================================================
// Types
// ============================================================================

export interface Staff {
  staff_id: string;
  display_name: string;
  email: string;
  auth_role: "admin" | "staff" | "volunteer";
  person_id: string | null;
  session_id?: string;
}

export interface UserContext {
  /** Display identifier for audit trails (staff name or "app_user") */
  displayName: string;
  /** Staff ID if known (UUID), null otherwise */
  staffId: string | null;
  /** Whether this is an authenticated staff member */
  isAuthenticated: boolean;
  /** Auth role for permission checks */
  authRole?: "admin" | "staff" | "volunteer";
}

export interface SessionResult {
  token: string;
  expiresAt: Date;
  sessionId: string;
}

export interface LoginResult {
  success: boolean;
  staff?: Staff;
  session?: SessionResult;
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const SESSION_COOKIE_NAME = "atlas_session";
const SESSION_EXPIRY_HOURS = parseInt(process.env.SESSION_EXPIRY_HOURS || "24");
const BCRYPT_ROUNDS = 12;

// ============================================================================
// Password Hashing
// ============================================================================

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a bcrypt hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ============================================================================
// Token Generation
// ============================================================================

/**
 * Generate a cryptographically secure random token
 */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hash a token for storage (we never store raw tokens)
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new session for a staff member
 */
export async function createSession(
  staffId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<SessionResult> {
  const token = generateToken();
  const tokenHash = await hashToken(token);

  const result = await queryOne<{ session_id: string }>(
    `SELECT ops.create_staff_session($1, $2, $3, $4, $5) as session_id`,
    [staffId, tokenHash, SESSION_EXPIRY_HOURS, ipAddress || null, userAgent || null]
  );

  if (!result) {
    throw new Error("Failed to create session");
  }

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + SESSION_EXPIRY_HOURS);

  return {
    token,
    expiresAt,
    sessionId: result.session_id,
  };
}

/**
 * Validate a session token and return staff info
 */
export async function validateSession(token: string): Promise<Staff | null> {
  const tokenHash = await hashToken(token);

  const result = await queryOne<{
    staff_id: string;
    display_name: string;
    email: string;
    auth_role: "admin" | "staff" | "volunteer";
    person_id: string | null;
    session_id: string;
  }>(
    `SELECT * FROM ops.validate_staff_session($1)`,
    [tokenHash]
  );

  if (!result) {
    return null;
  }

  return {
    staff_id: result.staff_id,
    display_name: result.display_name,
    email: result.email,
    auth_role: result.auth_role,
    person_id: result.person_id ?? null,
    session_id: result.session_id,
  };
}

/**
 * Invalidate a session (logout)
 */
export async function invalidateSession(
  token: string,
  reason: string = "logout"
): Promise<boolean> {
  const tokenHash = await hashToken(token);

  const result = await queryOne<{ invalidate_staff_session: boolean }>(
    `SELECT ops.invalidate_staff_session($1, $2) as invalidate_staff_session`,
    [tokenHash, reason]
  );

  return result?.invalidate_staff_session || false;
}

// ============================================================================
// Login
// ============================================================================

/**
 * Attempt to log in a staff member
 */
export async function login(
  email: string,
  password: string,
  ipAddress?: string,
  userAgent?: string
): Promise<LoginResult> {
  // Find staff by email
  const staff = await queryOne<{
    staff_id: string;
    display_name: string;
    email: string;
    password_hash: string | null;
    auth_role: "admin" | "staff" | "volunteer";
    person_id: string | null;
    is_active: boolean;
    locked_until: Date | null;
  }>(
    `SELECT staff_id, display_name, email, password_hash, auth_role, person_id, is_active, locked_until
     FROM ops.staff
     WHERE LOWER(email) = LOWER($1)`,
    [email]
  );

  if (!staff) {
    return { success: false, error: "Invalid email or password" };
  }

  // Check if account is active
  if (!staff.is_active) {
    return { success: false, error: "Account is disabled" };
  }

  // Check if account is locked
  if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
    const minutesLeft = Math.ceil(
      (new Date(staff.locked_until).getTime() - Date.now()) / 60000
    );
    return {
      success: false,
      error: `Account is locked. Try again in ${minutesLeft} minutes.`,
    };
  }

  // Check if password is set
  if (!staff.password_hash) {
    return {
      success: false,
      error: "Password not set. Contact an administrator.",
    };
  }

  // Verify password
  const passwordValid = await verifyPassword(password, staff.password_hash);

  if (!passwordValid) {
    // Record failed login attempt
    await queryOne(`SELECT ops.record_failed_login($1)`, [email]);
    return { success: false, error: "Invalid email or password" };
  }

  // Create session
  const session = await createSession(staff.staff_id, ipAddress, userAgent);

  return {
    success: true,
    staff: {
      staff_id: staff.staff_id,
      display_name: staff.display_name,
      email: staff.email,
      auth_role: staff.auth_role,
      person_id: staff.person_id ?? null,
    },
    session,
  };
}

// ============================================================================
// Request Helpers
// ============================================================================

/**
 * Get session token from request cookies
 */
export function getSessionToken(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value || null;
}

/**
 * Get current staff from request (if authenticated)
 */
export async function getCurrentStaff(
  request: NextRequest
): Promise<Staff | null> {
  const token = getSessionToken(request);
  if (!token) {
    return null;
  }

  return validateSession(token);
}

/**
 * Get session info including password change status
 * Alias for getCurrentStaff with extended info
 */
export async function getSession(
  request: NextRequest
): Promise<(Staff & { password_change_required?: boolean }) | null> {
  const token = getSessionToken(request);
  if (!token) {
    return null;
  }

  const tokenHash = await hashToken(token);

  const result = await queryOne<{
    staff_id: string;
    display_name: string;
    email: string;
    auth_role: "admin" | "staff" | "volunteer";
    person_id: string | null;
    session_id: string;
    password_change_required: boolean;
  }>(
    `SELECT
      s.staff_id,
      s.display_name,
      s.email,
      s.auth_role,
      s.person_id,
      ss.session_id,
      COALESCE(s.password_change_required, FALSE) as password_change_required
    FROM ops.staff_sessions ss
    JOIN ops.staff s ON s.staff_id = ss.staff_id
    WHERE ss.token_hash = $1
      AND ss.expires_at > NOW()
      AND ss.invalidated_at IS NULL
      AND s.is_active = TRUE`,
    [tokenHash]
  );

  if (!result) {
    return null;
  }

  return {
    staff_id: result.staff_id,
    display_name: result.display_name,
    email: result.email,
    auth_role: result.auth_role,
    person_id: result.person_id,
    session_id: result.session_id,
    password_change_required: result.password_change_required,
  };
}

/**
 * Hash a token for storage (exported for use in other modules)
 */
export async function hashTokenForStorage(token: string): Promise<string> {
  return hashToken(token);
}

/**
 * Require authentication - throws if not authenticated
 */
export async function requireAuth(request: NextRequest): Promise<Staff> {
  const staff = await getCurrentStaff(request);

  if (!staff) {
    throw new AuthError("Authentication required", 401);
  }

  return staff;
}

/**
 * Require specific role(s) - throws if not authorized
 */
export async function requireRole(
  request: NextRequest,
  allowedRoles: ("admin" | "staff" | "volunteer")[]
): Promise<Staff> {
  const staff = await requireAuth(request);

  if (!allowedRoles.includes(staff.auth_role)) {
    throw new AuthError(
      `Access denied. Required role: ${allowedRoles.join(" or ")}`,
      403
    );
  }

  return staff;
}

/**
 * Check if staff has permission for a resource action
 */
export async function hasPermission(
  staffId: string,
  resource: string,
  action: string
): Promise<boolean> {
  const result = await queryOne<{ staff_can_access: boolean }>(
    `SELECT ops.staff_can_access($1, $2, $3) as staff_can_access`,
    [staffId, resource, action]
  );

  return result?.staff_can_access || false;
}

// ============================================================================
// Cookie Helpers
// ============================================================================

/**
 * Set the session cookie in a response
 */
export function setSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date
): void {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

/**
 * Clear the session cookie
 */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(0),
    path: "/",
  });
}

// ============================================================================
// Error Class
// ============================================================================

export class AuthError extends Error {
  constructor(message: string, public statusCode: number = 401) {
    super(message);
    this.name = "AuthError";
  }
}

// ============================================================================
// Password Management
// ============================================================================

/**
 * Set password for a staff member (admin operation)
 */
export async function setStaffPassword(
  staffId: string,
  newPassword: string
): Promise<boolean> {
  const hash = await hashPassword(newPassword);

  const result = await queryOne<{ updated: boolean }>(
    `UPDATE ops.staff
     SET password_hash = $2, login_attempts = 0, locked_until = NULL
     WHERE staff_id = $1
     RETURNING true as updated`,
    [staffId, hash]
  );

  return result?.updated || false;
}

/**
 * Change password (requires current password)
 */
export async function changePassword(
  staffId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  // Get current hash
  const staff = await queryOne<{ password_hash: string | null }>(
    `SELECT password_hash FROM ops.staff WHERE staff_id = $1`,
    [staffId]
  );

  if (!staff || !staff.password_hash) {
    return { success: false, error: "Staff not found or password not set" };
  }

  // Verify current password
  const valid = await verifyPassword(currentPassword, staff.password_hash);
  if (!valid) {
    return { success: false, error: "Current password is incorrect" };
  }

  // Set new password
  const updated = await setStaffPassword(staffId, newPassword);
  if (!updated) {
    return { success: false, error: "Failed to update password" };
  }

  return { success: true };
}

// ============================================================================
// Legacy Compatibility (from original auth.ts)
// ============================================================================

/**
 * Get the current user context from request
 * This maintains backward compatibility with existing code
 */
export function getCurrentUser(request: NextRequest): UserContext {
  // First check for session cookie (new auth system)
  const token = getSessionToken(request);

  // For synchronous compatibility, check headers as fallback
  const staffId = request.headers.get("X-Staff-ID");
  const staffName = request.headers.get("X-Staff-Name");

  if (staffId) {
    return {
      displayName: staffName || `staff:${staffId.slice(0, 8)}`,
      staffId,
      isAuthenticated: true,
    };
  }

  // No auth context - return anonymous user
  return {
    displayName: "app_user",
    staffId: null,
    isAuthenticated: false,
  };
}

/**
 * Get user context for non-request scenarios (e.g., cron jobs, scripts)
 */
export function getSystemUser(): UserContext {
  return {
    displayName: "system",
    staffId: null,
    isAuthenticated: false,
  };
}

/**
 * Get admin user context for admin-only operations
 */
export function getAdminUser(): UserContext {
  return {
    displayName: "admin",
    staffId: null,
    isAuthenticated: true,
  };
}
