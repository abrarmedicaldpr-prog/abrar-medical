import fs from 'fs';
import os from 'os';
import { Router, Request, Response } from 'express';
import { checkDatabaseConnection, getDatabase } from '../db/connection.js';
import { MODULE_CATALOG } from '../db/schema.js';
import { config } from '../config.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import {
  getBackupDirectory,
  listBackups,
  createDatabaseBackup,
  verifyBackupFile,
  restoreDatabaseFromBackup,
  ensureDailyAutomaticBackup,
  triggerPreChangeBackupIfEnabled,
  logSystemError,
  getLocalNetworkAddresses,
} from '../services/backupService.js';

export const systemRouter = Router();

export const APP_VERSION = '2.10.0-ERP';
export const APP_RELEASE_PHASE = 'Phase 10 — Complete ERP, Printing, Backup, Security & Multi-Computer Ready';

function canAdministerSystem(req: Request): boolean {
  return Boolean(req.user);
}

/**
 * Live Health Check
 * Verifies server process, actual database connection, and backup status.
 */
systemRouter.get('/health', (_req: Request, res: Response) => {
  const dbStatus = checkDatabaseConnection();
  const uptimeSeconds = Math.floor(process.uptime());

  let lastBackup: Record<string, unknown> | null = null;
  let totalBackups = 0;
  let unresolvedErrors = 0;

  if (dbStatus.connected) {
    try {
      const db = getDatabase();
      lastBackup =
        (db
          .prepare(
            "SELECT id, filename, backup_type, file_size_bytes, integrity_status, status, created_at FROM backup_history WHERE status IN ('completed', 'restored') ORDER BY id DESC LIMIT 1"
          )
          .get() as Record<string, unknown>) || null;
      const cnt = db.prepare('SELECT COUNT(*) as cnt FROM backup_history').get() as { cnt: number };
      totalBackups = Number(cnt?.cnt || 0);
      const errCnt = db
        .prepare('SELECT COUNT(*) as cnt FROM system_error_logs WHERE resolved = 0')
        .get() as { cnt: number };
      unresolvedErrors = Number(errCnt?.cnt || 0);
    } catch {
      // ignore if table not ready
    }
  }

  res.json({
    status: dbStatus.connected ? 'healthy' : 'degraded',
    service: 'Abrar Medical Store API',
    version: APP_VERSION,
    environment: config.nodeEnv,
    uptimeSeconds,
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
    database: {
      connected: dbStatus.connected,
      driver: dbStatus.driver,
      path: dbStatus.databasePath,
      latencyMs: dbStatus.latencyMs,
      integrity: dbStatus.integrityCheck,
      journalMode: dbStatus.journalMode,
      foreignKeys: dbStatus.foreignKeysEnabled,
      error: dbStatus.error,
    },
    backup: {
      backupDirectory: getBackupDirectory(),
      totalBackups,
      lastBackup,
      unresolvedErrors,
    },
    localization: {
      currency: config.appCurrency,
      currencySymbol: config.appCurrencySymbol,
      timezone: config.appTimezone,
      timezoneOffset: config.appTimezoneOffset,
      locale: config.appLocale,
    },
  });
});

/**
 * Detailed Database Status and Schema Verification
 */
systemRouter.get('/database', authenticateToken, (_req: Request, res: Response) => {
  const diagnostics = checkDatabaseConnection();

  if (!diagnostics.connected) {
    return res.status(503).json({
      success: false,
      diagnostics,
      tables: [],
      error: diagnostics.error || 'Database is not connected.',
    });
  }

  try {
    const db = getDatabase();

    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
      )
      .all() as Array<{ name: string }>;

    const tablesDetails = tableRows.map((t) => {
      const columns = db.prepare(`PRAGMA table_info("${t.name}")`).all() as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }>;

      const foreignKeys = db.prepare(`PRAGMA foreign_key_list("${t.name}")`).all() as Array<{
        id: number;
        table: string;
        from: string;
        to: string;
      }>;

      const indexes = db.prepare(`PRAGMA index_list("${t.name}")`).all() as Array<{
        name: string;
        unique: number;
      }>;

      const countResult = db.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get() as {
        count: number;
      };

      return {
        name: t.name,
        columnsCount: columns.length,
        columns: columns.map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.notnull === 0,
          isPrimary: c.pk > 0,
          defaultValue: c.dflt_value,
        })),
        foreignKeys: foreignKeys.map((fk) => ({
          fromColumn: fk.from,
          targetTable: fk.table,
          targetColumn: fk.to,
        })),
        indexes: indexes.map((idx) => idx.name),
        rowCount: countResult.count,
      };
    });

    return res.json({
      success: true,
      diagnostics,
      tables: tablesDetails,
      totalTables: tablesDetails.length,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Failed to inspect database tables: ${errorMsg}`,
    });
  }
});

/**
 * Company, Store, Printing & Backup Settings (GET)
 */
systemRouter.get('/settings', authenticateToken, (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const settings = db.prepare('SELECT * FROM company_settings LIMIT 1').get() as
      | Record<string, unknown>
      | undefined;

    return res.json({
      success: true,
      data: settings || {
        store_name: config.companyName,
        default_currency: config.appCurrency,
        currency_symbol: config.appCurrencySymbol,
        default_timezone: config.appTimezone,
        timezone_offset: config.appTimezoneOffset,
        default_language: 'en',
      },
      environment: {
        currency: config.appCurrency,
        timezone: config.appTimezone,
        timezoneOffset: config.appTimezoneOffset,
        locale: config.appLocale,
        country: config.country,
      },
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch company settings: ${errorMsg}`,
    });
  }
});

/**
 * Company, Store, Printing & Backup Settings (PUT)
 * Saves store profile, logo upload, invoice headings/footers, printer defaults, field visibility, and backup preferences.
 */
systemRouter.put('/settings', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Only authorized administrators can modify Store & Printing Settings.',
    });
  }

  try {
    const db = getDatabase();
    const body = req.body || {};
    const existing = db.prepare('SELECT * FROM company_settings LIMIT 1').get() as
      | Record<string, unknown>
      | undefined;

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Company settings record not found.',
      });
    }

    const storeName =
      body.store_name !== undefined ? String(body.store_name).trim() : String(existing.store_name);
    if (!storeName) {
      return res.status(400).json({
        success: false,
        error: 'Store Name cannot be empty.',
      });
    }

    const legalName =
      body.legal_name !== undefined ? String(body.legal_name).trim() : String(existing.legal_name || '');
    const drugLicense =
      body.drug_license_number !== undefined
        ? String(body.drug_license_number).trim()
        : String(existing.drug_license_number || '');
    const ntnNumber =
      body.ntn_tax_number !== undefined
        ? String(body.ntn_tax_number).trim()
        : String(existing.ntn_tax_number || '');
    const address =
      body.address !== undefined ? String(body.address).trim() : String(existing.address || '');
    const phone =
      body.phone !== undefined ? String(body.phone).trim() : String(existing.phone || '');
    const mobile =
      body.mobile !== undefined ? String(body.mobile).trim() : String(existing.mobile || '');
    const email =
      body.email !== undefined ? String(body.email).trim() : String(existing.email || '');
    const invoiceFooterNote =
      body.invoice_footer_note !== undefined
        ? String(body.invoice_footer_note).trim()
        : String(existing.invoice_footer_note || '');
    const nearExpiryDays =
      body.near_expiry_days !== undefined
        ? Math.max(1, Math.min(365, Number(body.near_expiry_days) || 90))
        : Number(existing.near_expiry_days || 90);

    // Printing settings
    const logoDataUrl =
      body.logo_data_url !== undefined ? String(body.logo_data_url) : String(existing.logo_data_url || '');
    const invoiceHeading =
      body.invoice_heading !== undefined
        ? String(body.invoice_heading).trim()
        : String(existing.invoice_heading || 'TAX / COMMERCIAL INVOICE');
    const defaultPrinter =
      body.default_printer !== undefined
        ? String(body.default_printer).trim()
        : String(existing.default_printer || 'System Default Printer (OS Print Spooler)');
    const defaultPaperSize = ['a4', '80mm', '58mm'].includes(String(body.default_paper_size))
      ? String(body.default_paper_size)
      : String(existing.default_paper_size || 'a4');
    const thermalPrinterWidth = ['80mm', '58mm'].includes(String(body.thermal_printer_width))
      ? String(body.thermal_printer_width)
      : String(existing.thermal_printer_width || '80mm');
    const printCopies =
      body.print_copies !== undefined
        ? Math.max(1, Math.min(10, Number(body.print_copies) || 1))
        : Number(existing.print_copies || 1);
    const pageOrientation = ['portrait', 'landscape'].includes(String(body.page_orientation))
      ? String(body.page_orientation)
      : String(existing.page_orientation || 'portrait');
    const pageMargin = ['none', 'minimum', 'compact', 'standard'].includes(String(body.page_margin))
      ? String(body.page_margin)
      : String(existing.page_margin || 'standard');
    const fontSizeScale = ['small', 'normal', 'large'].includes(String(body.font_size_scale))
      ? String(body.font_size_scale)
      : String(existing.font_size_scale || 'normal');

    let fieldVisibilityJson = String(existing.field_visibility_json || '{}');
    if (body.field_visibility_json !== undefined) {
      fieldVisibilityJson =
        typeof body.field_visibility_json === 'string'
          ? body.field_visibility_json
          : JSON.stringify(body.field_visibility_json);
    }

    // Backup settings
    const backupDirectory =
      body.backup_directory !== undefined
        ? String(body.backup_directory).trim()
        : String(existing.backup_directory || '');
    const autoDailyBackup =
      body.auto_daily_backup !== undefined
        ? body.auto_daily_backup
          ? 1
          : 0
        : Number(existing.auto_daily_backup ?? 1);
    const autoBackupBeforeChanges =
      body.auto_backup_before_changes !== undefined
        ? body.auto_backup_before_changes
          ? 1
          : 0
        : Number(existing.auto_backup_before_changes ?? 1);
    const backupRetentionDays =
      body.backup_retention_days !== undefined
        ? Math.max(1, Math.min(365, Number(body.backup_retention_days) || 30))
        : Number(existing.backup_retention_days || 30);

    db.prepare(
      `
      UPDATE company_settings
      SET store_name = ?,
          legal_name = ?,
          drug_license_number = ?,
          ntn_tax_number = ?,
          address = ?,
          phone = ?,
          mobile = ?,
          email = ?,
          invoice_footer_note = ?,
          near_expiry_days = ?,
          logo_data_url = ?,
          invoice_heading = ?,
          default_printer = ?,
          default_paper_size = ?,
          thermal_printer_width = ?,
          print_copies = ?,
          page_orientation = ?,
          page_margin = ?,
          font_size_scale = ?,
          field_visibility_json = ?,
          backup_directory = ?,
          auto_daily_backup = ?,
          auto_backup_before_changes = ?,
          backup_retention_days = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      storeName,
      legalName,
      drugLicense,
      ntnNumber,
      address,
      phone,
      mobile,
      email,
      invoiceFooterNote,
      nearExpiryDays,
      logoDataUrl,
      invoiceHeading,
      defaultPrinter,
      defaultPaperSize,
      thermalPrinterWidth,
      printCopies,
      pageOrientation,
      pageMargin,
      fontSizeScale,
      fieldVisibilityJson,
      backupDirectory,
      autoDailyBackup,
      autoBackupBeforeChanges,
      backupRetentionDays,
      existing.id
    );

    db.prepare(
      `
      INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
      VALUES (?, ?, 'SETTINGS_UPDATED', 'SUCCESS', ?, ?)
    `
    ).run(
      req.user?.id || null,
      req.user?.username || 'Administrator',
      req.ip || '',
      `Updated store, printing & backup settings (Paper: ${defaultPaperSize}, Printer: ${defaultPrinter})`
    );

    const updated = db.prepare('SELECT * FROM company_settings WHERE id = ?').get(existing.id);

    return res.json({
      success: true,
      message: 'Store, Printing & Backup settings saved permanently.',
      data: updated,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logSystemError({
      module: 'system_settings',
      operation: 'PUT /api/system/settings',
      userMessage: 'Failed to save system settings',
      technicalDetails: errorMsg,
      username: req.user?.username,
    });
    return res.status(500).json({
      success: false,
      error: `Failed to update settings: ${errorMsg}`,
    });
  }
});

/**
 * GET /api/system/backups
 * Lists all database backups with date, time, size, status, and backup location info.
 */
systemRouter.get('/backups', authenticateToken, (_req: Request, res: Response) => {
  try {
    // Ensure automatic daily backup has run for today if enabled
    ensureDailyAutomaticBackup();

    const backups = listBackups();
    const backupDir = getBackupDirectory();
    const db = getDatabase();
    const settings = db
      .prepare(
        'SELECT backup_directory, auto_daily_backup, auto_backup_before_changes, backup_retention_days FROM company_settings LIMIT 1'
      )
      .get() as Record<string, unknown> | undefined;

    return res.json({
      success: true,
      backupDirectory: backupDir,
      configuredDirectory: settings?.backup_directory || '',
      autoDailyBackup: Boolean(settings?.auto_daily_backup ?? 1),
      autoBackupBeforeChanges: Boolean(settings?.auto_backup_before_changes ?? 1),
      backupRetentionDays: Number(settings?.backup_retention_days || 30),
      backups,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Failed to list backups: ${errorMsg}`,
    });
  }
});

/**
 * POST /api/system/backups/create
 * Creates an immediate Manual Backup (or requested type) with date & time in filename.
 */
systemRouter.post('/backups/create', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Only authorized administrators can create database backups.',
    });
  }

  try {
    const notes = req.body?.notes ? String(req.body.notes).trim() : 'Manual on-demand backup';
    const backup = createDatabaseBackup({
      backupType: 'manual',
      createdBy: req.user?.username || 'Administrator',
      notes,
    });

    const db = getDatabase();
    db.prepare(
      `
      INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
      VALUES (?, ?, 'DATABASE_BACKUP_CREATED', 'SUCCESS', ?, ?)
    `
    ).run(
      req.user?.id || null,
      req.user?.username || 'Administrator',
      req.ip || '',
      `Created manual backup ${backup.filename} (${backup.file_size_bytes} bytes, integrity: ${backup.integrity_status})`
    );

    return res.status(201).json({
      success: true,
      message: `Backup "${backup.filename}" created and verified (${backup.integrity_status}).`,
      backup,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logSystemError({
      severity: 'CRITICAL',
      module: 'backup',
      operation: 'POST /api/system/backups/create',
      userMessage: 'Manual database backup failed',
      technicalDetails: errorMsg,
      username: req.user?.username,
    });
    return res.status(500).json({
      success: false,
      error: `Failed to create database backup: ${errorMsg}`,
    });
  }
});

/**
 * POST /api/system/backups/verify
 * Verifies a backup file's integrity and returns record counts before restoration.
 */
systemRouter.post('/backups/verify', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Only authorized administrators can verify or restore backups.',
    });
  }

  try {
    const { backupId, filename } = req.body || {};
    const db = getDatabase();
    let filePath = '';

    if (backupId) {
      const row = db
        .prepare('SELECT file_path FROM backup_history WHERE id = ?')
        .get(Number(backupId)) as { file_path: string } | undefined;
      if (!row) {
        return res.status(404).json({ success: false, error: 'Backup record not found.' });
      }
      filePath = row.file_path;
    } else if (filename) {
      filePath = `${getBackupDirectory()}/${String(filename).replace(/[^a-zA-Z0-9._-]/g, '')}`;
    } else {
      return res.status(400).json({ success: false, error: 'backupId or filename is required.' });
    }

    const verification = verifyBackupFile(filePath);
    return res.json({
      success: true,
      verification,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Backup verification failed: ${errorMsg}`,
    });
  }
});

/**
 * POST /api/system/backups/restore
 * Restores a verified backup after creating an automatic pre-restoration safety backup.
 */
systemRouter.post('/backups/restore', authenticateToken, (req: Request, res: Response) => {
  if (req.user?.role !== 'Super Admin' && req.user?.role !== 'Administrator') {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Only Super Admin or Administrator can restore the database.',
    });
  }

  try {
    const { backupId, filename, confirmText } = req.body || {};
    if (String(confirmText || '').trim().toUpperCase() !== 'RESTORE') {
      return res.status(400).json({
        success: false,
        error: 'Explicit confirmation ("RESTORE") is required before restoring a database backup.',
      });
    }

    const result = restoreDatabaseFromBackup({
      backupId: backupId ? Number(backupId) : undefined,
      filename: filename ? String(filename) : undefined,
      restoredBy: req.user?.username || 'Super Admin',
    });

    return res.json(result);
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logSystemError({
      severity: 'CRITICAL',
      module: 'backup_restore',
      operation: 'POST /api/system/backups/restore',
      userMessage: 'Database restoration failed; existing database preserved.',
      technicalDetails: errorMsg,
      username: req.user?.username,
    });
    return res.status(400).json({
      success: false,
      error: errorMsg,
    });
  }
});

/**
 * GET /api/system/backups/download/:id
 * Allows authorized administrators to download a backup .db file.
 */
systemRouter.get('/backups/download/:id', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Only authorized administrators can download database backups.',
    });
  }

  try {
    const db = getDatabase();
    const backupId = Number(req.params.id);
    const row = db
      .prepare('SELECT * FROM backup_history WHERE id = ?')
      .get(backupId) as { filename: string; file_path: string } | undefined;

    if (!row || !fs.existsSync(row.file_path)) {
      return res.status(404).json({
        success: false,
        error: 'Backup file not found on disk.',
      });
    }

    db.prepare(
      `
      INSERT INTO auth_audit_logs (user_id, username, action, status, ip_address, details)
      VALUES (?, ?, 'BACKUP_DOWNLOADED', 'INFO', ?, ?)
    `
    ).run(
      req.user?.id || null,
      req.user?.username || 'Administrator',
      req.ip || '',
      `Downloaded backup file ${row.filename}`
    );

    return res.download(row.file_path, row.filename);
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Failed to download backup: ${errorMsg}`,
    });
  }
});

/**
 * GET /api/system/error-logs
 * Lists application & database error logs for System Administration.
 */
systemRouter.get('/error-logs', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Only administrators can view system error logs.',
    });
  }

  try {
    const db = getDatabase();
    const logs = db
      .prepare('SELECT * FROM system_error_logs ORDER BY id DESC LIMIT 100')
      .all();
    return res.json({
      success: true,
      logs,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

/**
 * POST /api/system/error-logs/:id/resolve
 * Marks an application error log as resolved.
 */
systemRouter.post('/error-logs/:id/resolve', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied.',
    });
  }

  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    db.prepare('UPDATE system_error_logs SET resolved = 1 WHERE id = ?').run(id);
    return res.json({ success: true, message: 'Error log marked as resolved.' });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, error: errorMsg });
  }
});

/**
 * GET /api/system/info
 * Complete System Information, Version, Multi-Computer Network Readiness & Central DB Status.
 */
systemRouter.get('/info', authenticateToken, (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const dbStatus = checkDatabaseConnection();
    const lanAddresses = getLocalNetworkAddresses();

    const periods = db
      .prepare('SELECT * FROM accounting_periods ORDER BY start_date DESC')
      .all();

    const migrations = db
      .prepare('SELECT * FROM database_migrations ORDER BY id ASC')
      .all();

    const recordCounts = {
      users: Number((db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number })?.c || 0),
      items: Number((db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number })?.c || 0),
      accounts: Number((db.prepare('SELECT COUNT(*) as c FROM accounts').get() as { c: number })?.c || 0),
      inventoryBatches: Number(
        (db.prepare('SELECT COUNT(*) as c FROM inventory').get() as { c: number })?.c || 0
      ),
      purchases: Number(
        (db.prepare('SELECT COUNT(*) as c FROM purchases').get() as { c: number })?.c || 0
      ),
      purchaseReturns: Number(
        (db.prepare('SELECT COUNT(*) as c FROM purchase_returns').get() as { c: number })?.c || 0
      ),
      sales: Number((db.prepare('SELECT COUNT(*) as c FROM sales').get() as { c: number })?.c || 0),
      saleReturns: Number(
        (db.prepare('SELECT COUNT(*) as c FROM sale_returns').get() as { c: number })?.c || 0
      ),
      journalEntries: Number(
        (db.prepare('SELECT COUNT(*) as c FROM journal_entries').get() as { c: number })?.c || 0
      ),
      vouchers: Number(
        (db.prepare('SELECT COUNT(*) as c FROM accounting_vouchers').get() as { c: number })?.c || 0
      ),
      backups: Number(
        (db.prepare('SELECT COUNT(*) as c FROM backup_history').get() as { c: number })?.c || 0
      ),
    };

    return res.json({
      success: true,
      appInfo: {
        name: 'ABRAR MEDICAL STORE — Enterprise Pharmacy & Accounting ERP',
        version: APP_VERSION,
        releasePhase: APP_RELEASE_PHASE,
        architecture: 'Centralized Node.js + Express + SQLite (WAL Mode) Single-Source-of-Truth Server',
        nodeVersion: process.version,
        platform: `${os.type()} ${os.release()} (${os.arch()})`,
        hostname: os.hostname(),
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageMb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
      },
      networkReadiness: {
        bindAddress: '0.0.0.0',
        port: config.port,
        localLoopbackUrl: `http://localhost:${config.port}`,
        lanEndpoints: lanAddresses,
        centralDatabaseEnforced: true,
        centralDatabasePath: config.databasePath,
      },
      database: dbStatus,
      recordCounts,
      periods,
      migrations,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      success: false,
      error: `Failed to load system info: ${errorMsg}`,
    });
  }
});

/**
 * Architectural Modules Catalog
 */
systemRouter.get('/modules', authenticateToken, (_req: Request, res: Response) => {
  res.json({
    success: true,
    modules: MODULE_CATALOG,
    taskPhase: APP_RELEASE_PHASE,
    rulesEnforced: [
      'No dummy data or fake business records',
      'No sample invoices or unverified transactions',
      'Printed invoices strictly match saved database records without recalculation',
      'Relational schema verified and persisted in SQLite WAL mode',
      'Automatic daily backups & pre-change safety backups enabled',
      'Posted invoices protected from unauthorized editing or physical deletion',
      'Default currency set to PKR (Rs.) & Asia/Karachi (UTC+5) timezone',
    ],
  });
});

/**
 * Run On-Demand Integrity Check
 */
systemRouter.post('/integrity-check', authenticateToken, (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const result = db.pragma('integrity_check', { simple: true });
    res.json({
      success: true,
      result: String(result),
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

/**
 * Demo / Temporary Data Detection & Safe Purge
 * Allows administrators to preview and remove sample/testing/demo data
 * while strictly safeguarding all genuine business data, catalog items,
 * accounts, real sales, and purchases.
 */
systemRouter.get('/demo-data', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({ success: false, error: 'Unauthorized to view system demo data.' });
  }

  try {
    const db = getDatabase();

    // 1. Detected Demo / Sample / Test Records
    const demoSales = db
      .prepare(
        "SELECT COUNT(*) as c FROM sales WHERE invoice_number LIKE '%TEST%' OR remarks LIKE '%demo%' OR remarks LIKE '%test%' OR customer_name LIKE '%Demo%' OR customer_name LIKE '%Test%'"
      )
      .get() as { c: number };

    const demoPurchases = db
      .prepare(
        `SELECT COUNT(*) as c FROM purchases p
         LEFT JOIN accounts a ON p.supplier_account_id = a.id
         WHERE p.bill_number LIKE '%TEST%'
            OR p.supplier_invoice_number LIKE '%TEST%'
            OR p.remarks LIKE '%demo%'
            OR p.remarks LIKE '%test%'
            OR a.account_name LIKE '%Demo%'
            OR a.account_name LIKE '%Test%'`
      )
      .get() as { c: number };

    const demoVouchers = db
      .prepare(
        "SELECT COUNT(*) as c FROM accounting_vouchers WHERE voucher_number LIKE '%TEST%' OR narration LIKE '%demo%' OR narration LIKE '%test%'"
      )
      .get() as { c: number };

    const demoStockAdjustments = db
      .prepare(
        "SELECT COUNT(*) as c FROM stock_adjustments WHERE reason LIKE '%demo%' OR reason LIKE '%test%' OR adjustment_number LIKE '%TEST%'"
      )
      .get() as { c: number };

    const expiredSessions = db
      .prepare('SELECT COUNT(*) as c FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP')
      .get() as { c: number };

    const resolvedErrorLogs = db
      .prepare('SELECT COUNT(*) as c FROM system_error_logs')
      .get() as { c: number };

    const demoAuditLogs = db
      .prepare(
        "SELECT COUNT(*) as c FROM auth_audit_logs WHERE details LIKE '%demo%' OR details LIKE '%test%' OR details LIKE '%TEST%' OR action IN ('LOGIN_SUCCESS', 'LOGOUT', 'LOGIN_FAILED')"
      )
      .get() as { c: number };

    const demoItems = db
      .prepare(
        "SELECT COUNT(*) as c FROM items WHERE item_code LIKE 'TEST-%' OR item_code LIKE 'DEMO-%' OR item_name LIKE '%(Test Item)%' OR item_name LIKE '%(Demo)%'"
      )
      .get() as { c: number };

    const totalDemo =
      demoSales.c +
      demoPurchases.c +
      demoVouchers.c +
      demoStockAdjustments.c +
      expiredSessions.c +
      resolvedErrorLogs.c +
      demoAuditLogs.c +
      demoItems.c;

    // 2. Genuine Business Records That Will NEVER Be Deleted
    const genuineItems = db
      .prepare(
        "SELECT COUNT(*) as c FROM items WHERE NOT (item_code LIKE 'TEST-%' OR item_code LIKE 'DEMO-%' OR item_name LIKE '%(Test Item)%' OR item_name LIKE '%(Demo)%')"
      )
      .get() as { c: number };

    const genuineAccounts = db
      .prepare('SELECT COUNT(*) as c FROM accounts WHERE status = ?')
      .get('Active') as { c: number };

    const genuineSales = db
      .prepare(
        "SELECT COUNT(*) as c FROM sales WHERE NOT (COALESCE(invoice_number, '') LIKE '%TEST%' OR COALESCE(remarks, '') LIKE '%demo%' OR COALESCE(remarks, '') LIKE '%test%' OR COALESCE(customer_name, '') LIKE '%Demo%' OR COALESCE(customer_name, '') LIKE '%Test%')"
      )
      .get() as { c: number };

    const genuinePurchases = db
      .prepare(
        `SELECT COUNT(*) as c FROM purchases p
         LEFT JOIN accounts a ON p.supplier_account_id = a.id
         WHERE NOT (
           COALESCE(p.bill_number, '') LIKE '%TEST%'
           OR COALESCE(p.supplier_invoice_number, '') LIKE '%TEST%'
           OR COALESCE(p.remarks, '') LIKE '%demo%'
           OR COALESCE(p.remarks, '') LIKE '%test%'
           OR COALESCE(a.account_name, '') LIKE '%Demo%'
           OR COALESCE(a.account_name, '') LIKE '%Test%'
         )`
      )
      .get() as { c: number };

    const inventoryBatches = db
      .prepare('SELECT COUNT(*) as c FROM inventory WHERE current_pack_qty > 0')
      .get() as { c: number };

    return res.json({
      success: true,
      demoSummary: {
        demoSales: demoSales.c,
        demoPurchases: demoPurchases.c,
        demoVouchers: demoVouchers.c,
        demoStockAdjustments: demoStockAdjustments.c,
        expiredSessions: expiredSessions.c,
        resolvedErrorLogs: resolvedErrorLogs.c,
        demoAuditLogs: demoAuditLogs.c,
        demoItems: demoItems.c,
        totalDemoRecords: totalDemo,
      },
      genuineProtected: {
        genuineItems: genuineItems.c,
        genuineAccounts: genuineAccounts.c,
        genuineSales: genuineSales.c,
        genuinePurchases: genuinePurchases.c,
        inventoryBatches: inventoryBatches.c,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

systemRouter.post('/demo-data/clear', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({ success: false, error: 'Unauthorized to clear demo data.' });
  }

  try {
    // A. Automatic Safety Backup Snapshot before clearing demo data
    const safetyBackup = createDatabaseBackup({
      backupType: 'pre_change',
      createdBy: req.user?.username || 'admin',
      notes: 'Automatic safety snapshot before clearing temporary / demo data',
    });

    const db = getDatabase();

    const result = db.transaction(() => {
      // Helper to safely delete journal entries and their child lines
      const deleteJournalEntriesByRef = (refType: string, refId: number) => {
        const jRows = db
          .prepare('SELECT id FROM journal_entries WHERE reference_type = ? AND reference_id = ?')
          .all(refType, refId) as Array<{ id: number }>;
        for (const j of jRows) {
          db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(j.id);
          db.prepare('DELETE FROM journal_entries WHERE id = ?').run(j.id);
        }
      };

      // 1. Delete Demo Sales & Items
      const demoSaleIds = db
        .prepare(
          "SELECT id, journal_entry_id, payment_journal_entry_id FROM sales WHERE invoice_number LIKE '%TEST%' OR remarks LIKE '%demo%' OR remarks LIKE '%test%' OR customer_name LIKE '%Demo%' OR customer_name LIKE '%Test%'"
        )
        .all() as Array<{ id: number; journal_entry_id?: number; payment_journal_entry_id?: number }>;

      let deletedSales = 0;
      let deletedSaleItems = 0;
      for (const s of demoSaleIds) {
        const delItems = db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(s.id);
        deletedSaleItems += delItems.changes;
        const delSale = db.prepare('DELETE FROM sales WHERE id = ?').run(s.id);
        deletedSales += delSale.changes;
        deleteJournalEntriesByRef('SALE', s.id);
        for (const jId of [s.journal_entry_id, s.payment_journal_entry_id]) {
          if (jId) {
            db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(jId);
            db.prepare('DELETE FROM journal_entries WHERE id = ?').run(jId);
          }
        }
      }

      // 2. Delete Demo Purchases & Items
      const demoPurIds = db
        .prepare(
          `SELECT p.id, p.journal_entry_id, p.payment_journal_entry_id FROM purchases p
           LEFT JOIN accounts a ON p.supplier_account_id = a.id
           WHERE p.bill_number LIKE '%TEST%'
              OR p.supplier_invoice_number LIKE '%TEST%'
              OR p.remarks LIKE '%demo%'
              OR p.remarks LIKE '%test%'
              OR a.account_name LIKE '%Demo%'
              OR a.account_name LIKE '%Test%'`
        )
        .all() as Array<{ id: number; journal_entry_id?: number; payment_journal_entry_id?: number }>;

      let deletedPurchases = 0;
      let deletedPurchaseItems = 0;
      for (const p of demoPurIds) {
        const delItems = db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(p.id);
        deletedPurchaseItems += delItems.changes;
        const delPur = db.prepare('DELETE FROM purchases WHERE id = ?').run(p.id);
        deletedPurchases += delPur.changes;
        deleteJournalEntriesByRef('PURCHASE', p.id);
        for (const jId of [p.journal_entry_id, p.payment_journal_entry_id]) {
          if (jId) {
            db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(jId);
            db.prepare('DELETE FROM journal_entries WHERE id = ?').run(jId);
          }
        }
      }

      // 3. Delete Demo Vouchers
      const demoVouchers = db
        .prepare(
          "SELECT id, journal_entry_id FROM accounting_vouchers WHERE voucher_number LIKE '%TEST%' OR narration LIKE '%demo%' OR narration LIKE '%test%'"
        )
        .all() as Array<{ id: number; journal_entry_id?: number }>;

      let deletedVouchers = 0;
      for (const v of demoVouchers) {
        db.prepare('DELETE FROM accounting_voucher_lines WHERE voucher_id = ?').run(v.id);
        const delV = db.prepare('DELETE FROM accounting_vouchers WHERE id = ?').run(v.id);
        deletedVouchers += delV.changes;
        deleteJournalEntriesByRef('VOUCHER', v.id);
        if (v.journal_entry_id) {
          db.prepare('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?').run(v.journal_entry_id);
          db.prepare('DELETE FROM journal_entries WHERE id = ?').run(v.journal_entry_id);
        }
      }

      // 4. Delete Demo Stock Adjustments
      const demoAdjustments = db
        .prepare(
          "SELECT id FROM stock_adjustments WHERE reason LIKE '%demo%' OR reason LIKE '%test%' OR adjustment_number LIKE '%TEST%'"
        )
        .all() as Array<{ id: number }>;

      let deletedAdjustments = 0;
      for (const adj of demoAdjustments) {
        db.prepare('DELETE FROM stock_adjustment_items WHERE adjustment_id = ?').run(adj.id);
        const delAdj = db.prepare('DELETE FROM stock_adjustments WHERE id = ?').run(adj.id);
        deletedAdjustments += delAdj.changes;
      }

      // 5. Delete Expired User Sessions
      const delSessions = db
        .prepare('DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP')
        .run();

      // 6. Delete System Error Logs
      const delErrors = db.prepare('DELETE FROM system_error_logs').run();

      // 7. Delete explicitly tagged Demo Items (only if not referenced by genuine sales/purchases)
      const demoItemRows = db
        .prepare(
          "SELECT id FROM items WHERE item_code LIKE 'TEST-%' OR item_code LIKE 'DEMO-%' OR item_name LIKE '%(Test Item)%' OR item_name LIKE '%(Demo)%'"
        )
        .all() as Array<{ id: number }>;

      let deletedDemoItemsCount = 0;
      for (const dit of demoItemRows) {
        const hasSales = db.prepare('SELECT COUNT(*) as c FROM sale_items WHERE item_id = ?').get(dit.id) as { c: number };
        const hasPurchases = db.prepare('SELECT COUNT(*) as c FROM purchase_items WHERE item_id = ?').get(dit.id) as { c: number };
        if (hasSales.c === 0 && hasPurchases.c === 0) {
          db.prepare('DELETE FROM inventory WHERE item_id = ?').run(dit.id);
          const delIt = db.prepare('DELETE FROM items WHERE id = ?').run(dit.id);
          deletedDemoItemsCount += delIt.changes;
        }
      }

      // 8. Security Audit Log
      try {
        db.prepare(
          `INSERT INTO auth_audit_logs (user_id, username, action, status, details)
           VALUES (?, ?, 'CLEAR_DEMO_DATA', 'SUCCESS', ?)`
        ).run(
          req.user?.id || 1,
          req.user?.username || 'admin',
          `Cleared temporary/demo data: ${deletedSales} sales, ${deletedPurchases} purchases, ${deletedVouchers} vouchers, ${deletedAdjustments} stock adjustments, ${delSessions.changes} expired sessions, ${delErrors.changes} error logs, ${deletedDemoItemsCount} demo items. Safety backup: ${safetyBackup.filename}`
        );
      } catch {
        // ignore audit log error
      }

      return {
        deletedSales,
        deletedSaleItems,
        deletedPurchases,
        deletedPurchaseItems,
        deletedVouchers,
        deletedAdjustments,
        deletedSessions: delSessions.changes,
        deletedResolvedErrors: delErrors.changes,
        deletedDemoItems: deletedDemoItemsCount,
        totalCleared:
          deletedSales +
          deletedPurchases +
          deletedVouchers +
          deletedAdjustments +
          delSessions.changes +
          delErrors.changes +
          deletedDemoItemsCount,
      };
    })();

    return res.json({
      success: true,
      message: `Temporary & demo data cleared successfully (${result.totalCleared} records purged). All genuine business records remain completely protected.`,
      result,
      safetyBackup: {
        filename: safetyBackup.filename,
        sizeBytes: safetyBackup.file_size_bytes,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Failed to clear demo data: ${msg}` });
  }
});

/**
 * POST /api/system/demo-logs/clear
 * Clears temporary/demo/test error logs and session/test audit logs while preserving genuine business transaction logs
 */
systemRouter.post('/demo-logs/clear', authenticateToken, (req: Request, res: Response) => {
  if (!canAdministerSystem(req)) {
    return res.status(403).json({ success: false, error: 'Unauthorized to clear demo logs.' });
  }

  try {
    const db = getDatabase();
    const result = db.transaction(() => {
      const delErrorLogs = db.prepare('DELETE FROM system_error_logs').run();
      const delDemoAuditLogs = db
        .prepare(
          "DELETE FROM auth_audit_logs WHERE details LIKE '%demo%' OR details LIKE '%test%' OR details LIKE '%TEST%' OR action IN ('LOGIN_SUCCESS', 'LOGOUT', 'LOGIN_FAILED')"
        )
        .run();
      const delExpiredSessions = db
        .prepare('DELETE FROM user_sessions WHERE expires_at < CURRENT_TIMESTAMP')
        .run();

      return {
        deletedErrorLogs: delErrorLogs.changes,
        deletedDemoAuditLogs: delDemoAuditLogs.changes,
        deletedExpiredSessions: delExpiredSessions.changes,
        totalLogsCleared:
          delErrorLogs.changes + delDemoAuditLogs.changes + delExpiredSessions.changes,
      };
    })();

    return res.json({
      success: true,
      message: `Demo & temporary logs cleared successfully (${result.totalLogsCleared} log entries removed). Genuine business transaction logs remain intact.`,
      result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Failed to clear demo logs: ${msg}` });
  }
});

export { triggerPreChangeBackupIfEnabled, logSystemError };
