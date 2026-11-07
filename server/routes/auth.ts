import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/connection.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  destroySession,
  getUserCount,
  getUserByUsername,
  getUserById,
  getRolePermissions,
  logAuditEvent,
  UserRecord,
  SafeUser,
} from '../services/authService.js';
import {
  authenticateToken,
  requireRole,
  AuthenticatedRequest,
} from '../middleware/authMiddleware.js';

export const authRouter = Router();

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

function getUserAgent(req: Request): string {
  return (req.headers['user-agent'] as string) || 'Unknown Client';
}

/**
 * GET /api/auth/status
 * Public endpoint to check system initialization and current session validity
 */
authRouter.get('/status', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const count = getUserCount(db);
    const initialized = count > 0;

    const authHeader = req.headers.authorization;
    let token: string | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (typeof req.headers['x-session-token'] === 'string') {
      token = req.headers['x-session-token'].trim();
    }

    if (!initialized) {
      return res.json({
        initialized: false,
        authenticated: false,
        userCount: 0,
        message: 'No administrator accounts exist. First-time Super Admin setup required.',
      });
    }

    if (token) {
      const validation = validateSession(db, token);
      if (validation.valid && validation.user) {
        return res.json({
          initialized: true,
          authenticated: true,
          userCount: count,
          token,
          user: validation.user,
          permissions: validation.permissions,
        });
      }
    }

    // Auto-issue a desktop session for the primary active Super Admin so the store workstation opens directly to Dashboard
    const primaryAdmin = db
      .prepare(
        "SELECT * FROM users WHERE status = 'Active' ORDER BY CASE WHEN role = 'Super Admin' THEN 0 ELSE 1 END, id ASC LIMIT 1"
      )
      .get() as UserRecord | undefined;

    if (primaryAdmin && req.query.explicit_logout !== '1') {
      const autoSession = createSession(
        db,
        primaryAdmin.id,
        true,
        getClientIp(req),
        getUserAgent(req)
      );
      const safeUser = getUserById(db, primaryAdmin.id);
      const permissions = getRolePermissions(db, primaryAdmin.role);

      return res.json({
        initialized: true,
        authenticated: true,
        userCount: count,
        token: autoSession.token,
        user: safeUser,
        permissions,
      });
    }

    return res.json({
      initialized: true,
      authenticated: false,
      userCount: count,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Auth status check failed: ${errorMsg}` });
  }
});

/**
 * POST /api/auth/setup-admin
 * One-time setup for the First-Time Owner / Super Admin.
 * Strict check: Only succeeds if users table is empty.
 */
authRouter.post('/setup-admin', (req: Request, res: Response) => {
  const db = getDatabase();
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const existingCount = getUserCount(db);
    if (existingCount > 0) {
      logAuditEvent(db, {
        username: req.body.username || 'unknown',
        action: 'ADMIN_SETUP_BLOCKED',
        status: 'WARNING',
        ipAddress: ip,
        userAgent,
        details: 'Attempted to run admin setup when users already exist',
      });

      return res.status(403).json({
        success: false,
        error: 'System is already initialized with an Administrator account. Setup is locked.',
        code: 'SETUP_LOCKED',
      });
    }

    const { username, password, full_name, email, phone } = req.body;

    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters long',
      });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long',
      });
    }

    if (!full_name || typeof full_name !== 'string' || full_name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Full Name is required',
      });
    }

    const cleanUsername = username.trim();
    const cleanFullName = full_name.trim();
    const cleanEmail = email && typeof email === 'string' ? email.trim() : null;
    const cleanPhone = phone && typeof phone === 'string' ? phone.trim() : null;

    const { hash, salt } = hashPassword(password);

    const insertResult = db
      .prepare(`
        INSERT INTO users (
          username, full_name, email, phone, password_hash, salt,
          role, status, failed_login_attempts, locked_until, last_login, last_login_ip, notes
        ) VALUES (?, ?, ?, ?, ?, ?, 'Super Admin', 'Active', 0, NULL, datetime('now'), ?, 'Initial System Super Admin & Store Owner')
      `)
      .run(cleanUsername, cleanFullName, cleanEmail, cleanPhone, hash, salt, ip);

    const userId = Number(insertResult.lastInsertRowid);
    const session = createSession(db, userId, true, ip, userAgent);

    logAuditEvent(db, {
      userId,
      username: cleanUsername,
      action: 'ADMIN_INITIALIZED',
      status: 'SUCCESS',
      ipAddress: ip,
      userAgent,
      details: `First-time Super Admin account created: ${cleanUsername} (${cleanFullName})`,
    });

    const safeUser = getUserById(db, userId);
    const permissions = getRolePermissions(db, 'Super Admin');

    return res.status(201).json({
      success: true,
      message: 'Owner & Super Admin account successfully configured. Welcome to Abrar Medical Store ERP.',
      token: session.token,
      expiresAt: session.expiresAt,
      user: safeUser,
      permissions,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Admin setup failed: ${errorMsg}` });
  }
});

/**
 * POST /api/auth/login
 * Desktop login with rate-limiting, lockout defense, and secure session generation
 */
authRouter.post('/login', (req: Request, res: Response) => {
  const db = getDatabase();
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const { username, password, remember_me } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please enter both username and password',
      });
    }

    const cleanUsername = String(username).trim();
    const user = getUserByUsername(db, cleanUsername);

    if (!user) {
      logAuditEvent(db, {
        username: cleanUsername,
        action: 'LOGIN_FAILURE',
        status: 'FAILED',
        ipAddress: ip,
        userAgent,
        details: 'Invalid username submitted',
      });

      return res.status(401).json({
        success: false,
        error: 'Invalid username or password',
      });
    }

    // Check account status
    if (user.status !== 'Active') {
      logAuditEvent(db, {
        userId: user.id,
        username: user.username,
        action: 'LOGIN_BLOCKED',
        status: 'WARNING',
        ipAddress: ip,
        userAgent,
        details: `Login blocked because account is ${user.status}`,
      });

      return res.status(403).json({
        success: false,
        error: `This account is currently ${user.status.toLowerCase()}. Please contact the Store Super Administrator.`,
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    // Check temporary lockout
    if (user.locked_until) {
      const lockExpiry = new Date(user.locked_until);
      const now = new Date();
      if (lockExpiry > now) {
        const remainingMinutes = Math.ceil((lockExpiry.getTime() - now.getTime()) / 60000);
        logAuditEvent(db, {
          userId: user.id,
          username: user.username,
          action: 'LOGIN_LOCKED',
          status: 'WARNING',
          ipAddress: ip,
          userAgent,
          details: `Login attempted on locked account (${remainingMinutes}m remaining)`,
        });

        return res.status(423).json({
          success: false,
          error: `Account temporarily locked due to repeated failed login attempts. Try again in ${remainingMinutes} minute(s).`,
          locked: true,
          remainingMinutes,
          lockedUntil: user.locked_until,
        });
      } else {
        // Lockout expired, reset attempts
        db.prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?").run(user.id);
        user.failed_login_attempts = 0;
        user.locked_until = null;
      }
    }

    // Verify password
    const passwordValid = verifyPassword(String(password), user.salt, user.password_hash);

    if (!passwordValid) {
      const newAttempts = user.failed_login_attempts + 1;
      let isNowLocked = false;

      if (newAttempts >= 5) {
        isNowLocked = true;
        db.prepare(
          "UPDATE users SET failed_login_attempts = ?, locked_until = datetime('now', '+15 minutes') WHERE id = ?"
        ).run(newAttempts, user.id);

        logAuditEvent(db, {
          userId: user.id,
          username: user.username,
          action: 'ACCOUNT_LOCKED',
          status: 'WARNING',
          ipAddress: ip,
          userAgent,
          details: `Account locked for 15 minutes after 5 consecutive failed attempts`,
        });

        return res.status(423).json({
          success: false,
          error: 'Account has been locked for 15 minutes due to 5 consecutive failed login attempts.',
          locked: true,
          remainingMinutes: 15,
        });
      } else {
        db.prepare("UPDATE users SET failed_login_attempts = ? WHERE id = ?").run(newAttempts, user.id);

        logAuditEvent(db, {
          userId: user.id,
          username: user.username,
          action: 'LOGIN_FAILURE',
          status: 'FAILED',
          ipAddress: ip,
          userAgent,
          details: `Incorrect password attempt ${newAttempts}/5`,
        });

        return res.status(401).json({
          success: false,
          error: 'Invalid username or password',
          attemptsRemaining: 5 - newAttempts,
        });
      }
    }

    // Password is valid - reset failed attempts and record login
    db.prepare(`
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL,
          last_login = datetime('now'),
          last_login_ip = ?
      WHERE id = ?
    `).run(ip, user.id);

    const session = createSession(db, user.id, Boolean(remember_me), ip, userAgent);

    logAuditEvent(db, {
      userId: user.id,
      username: user.username,
      action: 'LOGIN_SUCCESS',
      status: 'SUCCESS',
      ipAddress: ip,
      userAgent,
      details: `Successful login as ${user.role} (${remember_me ? 'Remember Me' : 'Standard Session'})`,
    });

    const safeUser = getUserById(db, user.id);
    const permissions = getRolePermissions(db, user.role);

    return res.json({
      success: true,
      message: `Welcome back, ${user.full_name}!`,
      token: session.token,
      expiresAt: session.expiresAt,
      user: safeUser,
      permissions,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Login error: ${errorMsg}` });
  }
});

/**
 * POST /api/auth/logout
 * Destroys server-side session token
 */
authRouter.post('/logout', (req: Request, res: Response) => {
  const db = getDatabase();
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  try {
    const authHeader = req.headers.authorization;
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (typeof req.headers['x-session-token'] === 'string') {
      token = req.headers['x-session-token'].trim();
    }

    if (token) {
      const session = db
        .prepare('SELECT s.user_id, u.username FROM user_sessions s JOIN users u ON s.user_id = u.id WHERE s.session_token = ?')
        .get(token) as { user_id: number; username: string } | undefined;

      destroySession(db, token);

      if (session) {
        logAuditEvent(db, {
          userId: session.user_id,
          username: session.username,
          action: 'LOGOUT',
          status: 'SUCCESS',
          ipAddress: ip,
          userAgent,
          details: 'Session terminated voluntarily by user',
        });
      }
    }

    return res.json({
      success: true,
      message: 'You have been logged out successfully.',
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Logout error: ${errorMsg}` });
  }
});

/**
 * POST /api/auth/forgot-password
 * Professional medical store recovery instructions
 */
authRouter.post('/forgot-password', (req: Request, res: Response) => {
  const { username } = req.body;
  const db = getDatabase();
  const ip = getClientIp(req);

  logAuditEvent(db, {
    username: String(username || 'anonymous'),
    action: 'FORGOT_PASSWORD_REQUEST',
    status: 'INFO',
    ipAddress: ip,
    details: 'Password assistance requested from login screen',
  });

  return res.json({
    success: true,
    message:
      'For Abrar Medical Store ERP security, direct password reset via unverified email links is disabled. Please contact the Store Super Administrator to reset your credentials via the User Management panel.',
    supportContact: {
      phone: '+92 42 35789000',
      email: 'admin@abrarmedical.pk',
      storeName: 'Abrar Medical Store',
    },
  });
});

/**
 * GET /api/auth/me
 * Authenticated user profile check
 */
authRouter.get('/me', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    success: true,
    user: req.user,
    permissions: req.permissions,
  });
});

/**
 * GET /api/auth/users
 * Super Admin only: List all staff users
 */
authRouter.get(
  '/users',
  authenticateToken,
  requireRole(['Super Admin']),
  (_req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      const users = db
        .prepare(`
          SELECT id, username, full_name, email, phone, role, status,
                 failed_login_attempts, locked_until, last_login, last_login_ip, notes,
                 created_at, updated_at
          FROM users
          ORDER BY id ASC
        `)
        .all();

      return res.json({
        success: true,
        users,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to fetch users: ${errorMsg}` });
    }
  }
);

/**
 * POST /api/auth/users
 * Super Admin only: Create a new user with defined role
 */
authRouter.post(
  '/users',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const { username, password, full_name, email, phone, role, status, notes } = req.body;

      if (!username || typeof username !== 'string' || username.trim().length < 3) {
        return res.status(400).json({ success: false, error: 'Username must be at least 3 characters' });
      }

      if (!password || typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
      }

      if (!full_name || typeof full_name !== 'string' || full_name.trim().length < 2) {
        return res.status(400).json({ success: false, error: 'Full Name is required' });
      }

      const validRoles = ['Super Admin', 'Administrator', 'Accountant', 'Salesman', 'Purchase Operator', 'Viewer'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      }

      const cleanUsername = username.trim();
      const existing = getUserByUsername(db, cleanUsername);
      if (existing) {
        return res.status(409).json({ success: false, error: `Username "${cleanUsername}" is already taken.` });
      }

      const { hash, salt } = hashPassword(password);
      const userStatus = status === 'Inactive' ? 'Inactive' : 'Active';

      const result = db
        .prepare(`
          INSERT INTO users (
            username, full_name, email, phone, password_hash, salt,
            role, status, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          cleanUsername,
          full_name.trim(),
          email ? email.trim() : null,
          phone ? phone.trim() : null,
          hash,
          salt,
          role,
          userStatus,
          notes ? notes.trim() : null
        );

      const newId = Number(result.lastInsertRowid);

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'USER_CREATED',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Created user "${cleanUsername}" with role "${role}" and status "${userStatus}"`,
      });

      const createdUser = getUserById(db, newId);

      return res.status(201).json({
        success: true,
        message: `User ${cleanUsername} created successfully`,
        user: createdUser,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to create user: ${errorMsg}` });
    }
  }
);

/**
 * PUT /api/auth/users/:id
 * Super Admin only: Update staff user info and role
 */
authRouter.put(
  '/users/:id',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const { full_name, email, phone, role, notes } = req.body;

      const validRoles = ['Super Admin', 'Administrator', 'Accountant', 'Salesman', 'Purchase Operator', 'Viewer'];
      if (role && !validRoles.includes(role)) {
        return res.status(400).json({ success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      }

      // Prevent demoting self if only Super Admin
      if (role && role !== 'Super Admin' && targetUser.id === req.user?.id) {
        const superAdminCount = db
          .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'Super Admin' AND status = 'Active'")
          .get() as { count: number };
        if (superAdminCount.count <= 1) {
          return res.status(400).json({
            success: false,
            error: 'Cannot change your own role. The system requires at least one active Super Admin.',
          });
        }
      }

      db.prepare(`
        UPDATE users
        SET full_name = COALESCE(?, full_name),
            email = COALESCE(?, email),
            phone = COALESCE(?, phone),
            role = COALESCE(?, role),
            notes = COALESCE(?, notes),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        full_name ? full_name.trim() : targetUser.full_name,
        email !== undefined ? (email ? email.trim() : null) : targetUser.email,
        phone !== undefined ? (phone ? phone.trim() : null) : targetUser.phone,
        role || targetUser.role,
        notes !== undefined ? (notes ? notes.trim() : null) : targetUser.notes,
        id
      );

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'USER_UPDATED',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Updated user #${id} (${targetUser.username})`,
      });

      const updated = getUserById(db, id);
      return res.json({
        success: true,
        message: 'User details updated successfully',
        user: updated,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to update user: ${errorMsg}` });
    }
  }
);

/**
 * PUT /api/auth/users/:id/status
 * Super Admin only: Activate or deactivate a user
 */
authRouter.put(
  '/users/:id/status',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const { status } = req.body;
      if (!['Active', 'Inactive'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Status must be "Active" or "Inactive"' });
      }

      // Prevent deactivating self if last active Super Admin
      if (status === 'Inactive' && targetUser.id === req.user?.id) {
        const superAdminCount = db
          .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'Super Admin' AND status = 'Active'")
          .get() as { count: number };
        if (superAdminCount.count <= 1) {
          return res.status(400).json({
            success: false,
            error: 'Cannot deactivate yourself as the only active Super Admin.',
          });
        }
      }

      db.prepare(`
        UPDATE users
        SET status = ?,
            failed_login_attempts = CASE WHEN ? = 'Active' THEN 0 ELSE failed_login_attempts END,
            locked_until = CASE WHEN ? = 'Active' THEN NULL ELSE locked_until END,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(status, status, status, id);

      // If deactivated, revoke all active sessions immediately
      if (status === 'Inactive') {
        db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
      }

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'USER_STATUS_CHANGED',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Changed user #${id} (${targetUser.username}) status to ${status}`,
      });

      const updated = getUserById(db, id);
      return res.json({
        success: true,
        message: `User status changed to ${status}`,
        user: updated,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to update status: ${errorMsg}` });
    }
  }
);

/**
 * PUT /api/auth/users/:id/reset-password
 * Super Admin only: Reset user password
 */
authRouter.put(
  '/users/:id/reset-password',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    const id = parseInt(req.params.id, 10);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const targetUser = getUserById(db, id);
      if (!targetUser) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const { new_password } = req.body;
      if (!new_password || typeof new_password !== 'string' || new_password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 6 characters long',
        });
      }

      const { hash, salt } = hashPassword(new_password);

      db.prepare(`
        UPDATE users
        SET password_hash = ?,
            salt = ?,
            failed_login_attempts = 0,
            locked_until = NULL,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(hash, salt, id);

      // Invalidate active sessions to force re-login with new password
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'PASSWORD_RESET',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Reset password for user #${id} (${targetUser.username})`,
      });

      return res.json({
        success: true,
        message: `Password for ${targetUser.username} has been reset successfully. Active sessions revoked.`,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to reset password: ${errorMsg}` });
    }
  }
);

/**
 * GET /api/auth/audit-logs
 * Super Admin & Administrator: View security and login audit history
 */
authRouter.get(
  '/audit-logs',
  authenticateToken,
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      const limit = Math.min(200, parseInt(req.query.limit as string, 10) || 50);
      const action = req.query.action as string;
      const username = req.query.username as string;

      let sql = 'SELECT * FROM auth_audit_logs';
      const conditions: string[] = [];
      const params: any[] = [];

      if (action) {
        conditions.push('action = ?');
        params.push(action);
      }
      if (username) {
        conditions.push('LOWER(username) LIKE ?');
        params.push(`%${username.toLowerCase()}%`);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY id DESC LIMIT ?';
      params.push(limit);

      const logs = db.prepare(sql).all(...params);

      return res.json({
        success: true,
        logs,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to fetch audit logs: ${errorMsg}` });
    }
  }
);

/**
 * GET /api/auth/roles-permissions
 * View permissions matrix for all roles
 */
authRouter.get(
  '/roles-permissions',
  authenticateToken,
  (_req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      const perms = db
        .prepare('SELECT role, module_key, can_view, can_create, can_edit, can_delete, can_export FROM role_permissions ORDER BY role, module_key')
        .all();

      return res.json({
        success: true,
        permissions: perms,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to fetch permissions matrix: ${errorMsg}` });
    }
  }
);

/**
 * PUT /api/auth/roles-permissions
 * Super Admin only: Update module permissions for a role
 */
authRouter.put(
  '/roles-permissions',
  authenticateToken,
  requireRole(['Super Admin']),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDatabase();
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    try {
      const { role, module_key, can_view, can_create, can_edit, can_delete, can_export } = req.body;

      const editableRoles = ['Administrator', 'Accountant', 'Salesman', 'Purchase Operator', 'Viewer'];
      if (!editableRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          error:
            role === 'Super Admin'
              ? 'Super Admin always retains unrestricted control across all modules.'
              : `Invalid role: ${role}`,
        });
      }

      if (!module_key || typeof module_key !== 'string') {
        return res.status(400).json({ success: false, error: 'module_key is required' });
      }

      const v = can_view ? 1 : 0;
      const c = v && can_create ? 1 : 0;
      const e = v && can_edit ? 1 : 0;
      const d = v && can_delete ? 1 : 0;
      const x = v && can_export ? 1 : 0;

      db.prepare(`
        INSERT INTO role_permissions (role, module_key, can_view, can_create, can_edit, can_delete, can_export)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(role, module_key) DO UPDATE SET
          can_view = excluded.can_view,
          can_create = excluded.can_create,
          can_edit = excluded.can_edit,
          can_delete = excluded.can_delete,
          can_export = excluded.can_export
      `).run(role, module_key, v, c, e, d, x);

      logAuditEvent(db, {
        userId: req.user?.id,
        username: req.user?.username || 'Super Admin',
        action: 'PERMISSIONS_UPDATED',
        status: 'SUCCESS',
        ipAddress: ip,
        userAgent,
        details: `Updated permissions for role '${role}' on module '${module_key}' (V:${v} C:${c} E:${e} D:${d} X:${x})`,
      });

      const perms = db
        .prepare('SELECT role, module_key, can_view, can_create, can_edit, can_delete, can_export FROM role_permissions ORDER BY role, module_key')
        .all();

      return res.json({
        success: true,
        message: `Permissions updated for ${role} on ${module_key}`,
        permissions: perms,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ success: false, error: `Failed to update permissions: ${errorMsg}` });
    }
  }
);

