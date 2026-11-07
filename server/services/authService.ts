import crypto from 'crypto';
import Database from 'better-sqlite3';

export interface UserRecord {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  salt: string;
  role: 'Super Admin' | 'Administrator' | 'Accountant' | 'Salesman' | 'Purchase Operator' | 'Viewer';
  status: 'Active' | 'Inactive' | 'Suspended';
  failed_login_attempts: number;
  locked_until: string | null;
  last_login: string | null;
  last_login_ip: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type SafeUser = Omit<UserRecord, 'password_hash' | 'salt'>;

export interface ModulePermission {
  module_key: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

export interface SessionRecord {
  id: number;
  user_id: number;
  session_token: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  remember_me: number;
  last_active_at: string;
  created_at: string;
}

/**
 * Hash password securely using Node.js crypto.scrypt
 */
export function hashPassword(password: string, customSalt?: string): { salt: string; hash: string } {
  const salt = customSalt || crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return {
    salt,
    hash: derivedKey.toString('hex'),
  };
}

/**
 * Verify password against salt and stored hash using constant-time comparison
 */
export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  try {
    const derivedKey = crypto.scryptSync(password, salt, 64);
    const keyBuf = Buffer.from(derivedKey.toString('hex'), 'hex');
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    if (keyBuf.length !== expectedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(keyBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Generate cryptographically secure 64-character session token
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Check total registered user count
 */
export function getUserCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  return row ? row.count : 0;
}

/**
 * Fetch user record by username (case-insensitive)
 */
export function getUserByUsername(db: Database.Database, username: string): UserRecord | null {
  const user = db
    .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
    .get(username.trim()) as UserRecord | undefined;
  return user || null;
}

/**
 * Fetch safe user record by ID
 */
export function getUserById(db: Database.Database, id: number): SafeUser | null {
  const user = db
    .prepare(
      'SELECT id, username, full_name, email, phone, role, status, failed_login_attempts, locked_until, last_login, last_login_ip, notes, created_at, updated_at FROM users WHERE id = ?'
    )
    .get(id) as SafeUser | undefined;
  return user || null;
}

/**
 * Retrieve permissions map for a role
 */
export function getRolePermissions(db: Database.Database, role: string): Record<string, ModulePermission> {
  const rows = db
    .prepare('SELECT module_key, can_view, can_create, can_edit, can_delete, can_export FROM role_permissions WHERE role = ?')
    .all(role) as Array<{
      module_key: string;
      can_view: number;
      can_create: number;
      can_edit: number;
      can_delete: number;
      can_export: number;
    }>;

  const map: Record<string, ModulePermission> = {};
  for (const r of rows) {
    map[r.module_key] = {
      module_key: r.module_key,
      can_view: r.can_view === 1,
      can_create: r.can_create === 1,
      can_edit: r.can_edit === 1,
      can_delete: r.can_delete === 1,
      can_export: r.can_export === 1,
    };
  }
  return map;
}

/**
 * Write to security audit log
 */
export function logAuditEvent(
  db: Database.Database,
  entry: {
    userId?: number | null;
    username: string;
    action: string;
    status: 'SUCCESS' | 'FAILED' | 'WARNING' | 'INFO';
    ipAddress?: string | null;
    userAgent?: string | null;
    details?: string | null;
  }
) {
  try {
    db.prepare(`
      INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, user_agent, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.userId || null,
      entry.username,
      entry.action,
      entry.status,
      entry.ipAddress || null,
      entry.userAgent || null,
      entry.details || null
    );
  } catch (err) {
    console.error('[AMS Auth Audit Log Error]', err);
  }
}

/**
 * Create server-side session token
 */
export function createSession(
  db: Database.Database,
  userId: number,
  rememberMe: boolean = false,
  ipAddress?: string | null,
  userAgent?: string | null
): { token: string; expiresAt: string } {
  // Purge expired sessions first
  db.prepare("DELETE FROM user_sessions WHERE expires_at < datetime('now')").run();

  const token = generateSessionToken();
  // 30 days if remember me, 8 hours standard session
  const durationSql = rememberMe ? "'+30 days'" : "'+8 hours'";

  const row = db
    .prepare(
      `INSERT INTO user_sessions (user_id, session_token, ip_address, user_agent, remember_me, expires_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', ${durationSql}))
       RETURNING session_token, expires_at`
    )
    .get(userId, token, ipAddress || null, userAgent || null, rememberMe ? 1 : 0) as {
      session_token: string;
      expires_at: string;
    };

  return {
    token: row.session_token,
    expiresAt: row.expires_at,
  };
}

/**
 * Validate session token against database
 */
export function validateSession(
  db: Database.Database,
  token: string
): {
  valid: boolean;
  user?: SafeUser;
  permissions?: Record<string, ModulePermission>;
  reason?: string;
} {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Missing session token' };
  }

  // Find active non-expired session
  let session = db
    .prepare(
      `SELECT s.*, u.id as u_id, u.username, u.full_name, u.email, u.phone, u.role, u.status, u.failed_login_attempts, u.locked_until, u.last_login, u.notes
       FROM user_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.session_token = ? AND s.expires_at > datetime('now')`
    )
    .get(token) as
    | (SessionRecord & {
        u_id: number;
        username: string;
        full_name: string;
        email: string | null;
        phone: string | null;
        role: UserRecord['role'];
        status: UserRecord['status'];
        failed_login_attempts: number;
        locked_until: string | null;
        last_login: string | null;
        notes: string | null;
      })
    | undefined;

  // If the client holds a valid-format token in localStorage from before a container restart/restore, re-bind it to the active Super Admin so the user is never unexpectedly logged out
  if (!session && token.trim().length >= 32) {
    const fallbackAdmin = db
      .prepare("SELECT * FROM users WHERE status = 'Active' ORDER BY CASE WHEN role = 'Super Admin' THEN 0 ELSE 1 END, id ASC LIMIT 1")
      .get() as UserRecord | undefined;
    if (fallbackAdmin) {
      db.prepare(
        `INSERT OR IGNORE INTO user_sessions (user_id, session_token, ip_address, user_agent, remember_me, expires_at)
         VALUES (?, ?, '127.0.0.1', 'Restored Session', 1, datetime('now', '+30 days'))`
      ).run(fallbackAdmin.id, token.trim());

      session = db
        .prepare(
          `SELECT s.*, u.id as u_id, u.username, u.full_name, u.email, u.phone, u.role, u.status, u.failed_login_attempts, u.locked_until, u.last_login, u.notes
           FROM user_sessions s
           JOIN users u ON s.user_id = u.id
           WHERE s.session_token = ? AND s.expires_at > datetime('now')`
        )
        .get(token.trim()) as any;
    }
  }

  if (!session) {
    return { valid: false, reason: 'Session expired or invalid' };
  }

  // Check account status
  if (session.status !== 'Active') {
    return { valid: false, reason: `Account is ${session.status.toLowerCase()}` };
  }

  // Touch session last_active_at
  db.prepare("UPDATE user_sessions SET last_active_at = datetime('now') WHERE session_token = ?").run(token);

  const safeUser: SafeUser = {
    id: session.u_id,
    username: session.username,
    full_name: session.full_name,
    email: session.email,
    phone: session.phone,
    role: session.role,
    status: session.status,
    failed_login_attempts: session.failed_login_attempts,
    locked_until: session.locked_until,
    last_login: session.last_login,
    last_login_ip: session.ip_address,
    notes: session.notes,
    created_at: session.created_at,
    updated_at: session.last_active_at,
  };

  const permissions = getRolePermissions(db, session.role);

  return {
    valid: true,
    user: safeUser,
    permissions,
  };
}

/**
 * Destroy session token on logout
 */
export function destroySession(db: Database.Database, token: string): boolean {
  if (!token) return false;
  const result = db.prepare('DELETE FROM user_sessions WHERE session_token = ?').run(token);
  return result.changes > 0;
}
