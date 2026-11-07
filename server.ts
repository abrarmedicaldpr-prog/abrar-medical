import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { config } from './server/config.js';
import { systemRouter } from './server/routes/system.js';
import { itemsRouter } from './server/routes/items.js';
import { accountsRouter } from './server/routes/accounts.js';
import { purchasesRouter } from './server/routes/purchases.js';
import { salesRouter } from './server/routes/sales.js';
import { authRouter } from './server/routes/auth.js';
import { inventoryRouter } from './server/routes/inventory.js';
import { accountingRouter } from './server/routes/accounting.js';
import { staffRouter } from './server/routes/staff.js';
import { authenticateToken, enforceModulePermissions } from './server/middleware/authMiddleware.js';
import { runMigrations } from './server/db/migrations.js';
import { checkDatabaseConnection } from './server/db/connection.js';
import { ensureDailyAutomaticBackup } from './server/services/backupService.js';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  console.log('----------------------------------------------------');
  console.log(' [AMS] Abrar Medical Store - System Initializing...');
  console.log(` [AMS] Environment: ${config.nodeEnv}`);
  console.log(` [AMS] Port: ${config.port}`);
  console.log(` [AMS] Currency: ${config.appCurrency} (${config.appCurrencySymbol})`);
  console.log(` [AMS] Timezone: ${config.appTimezone} (${config.appTimezoneOffset})`);
  console.log('----------------------------------------------------');

  // Initialize and verify database
  try {
    const migration = runMigrations();
    console.log(`[AMS DB] ${migration.message}`);
    const connectionTest = checkDatabaseConnection();
    console.log(`[AMS DB] Connection verification: ${connectionTest.connected ? 'SUCCESS' : 'FAILED'}`);
    console.log(`[AMS DB] Storage: ${connectionTest.databasePath} (${connectionTest.fileSizeBytes} bytes)`);
    console.log(`[AMS DB] Journal Mode: ${connectionTest.journalMode}, Foreign Keys: ${connectionTest.foreignKeysEnabled}`);
    console.log(`[AMS DB] Verified Tables: ${connectionTest.tables.join(', ')}`);

    // Run automatic daily backup check on startup and every 60 minutes
    const dailyBackup = ensureDailyAutomaticBackup();
    if (dailyBackup) {
      console.log(`[AMS Backup] Automatic daily backup created: ${dailyBackup.filename}`);
    }
    setInterval(() => {
      ensureDailyAutomaticBackup();
    }, 60 * 60 * 1000);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[AMS DB ERROR] Migration or connection failed: ${errorMsg}`);
  }

  // Mount API routes with server-side authentication and module RBAC enforcement
  app.use('/api/auth', authRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/items', authenticateToken, enforceModulePermissions('items'), itemsRouter);
  app.use('/api/accounts', authenticateToken, enforceModulePermissions('accounts'), accountsRouter);
  app.use('/api/purchases', authenticateToken, enforceModulePermissions('purchases'), purchasesRouter);
  app.use('/api/sales', authenticateToken, enforceModulePermissions('sales'), salesRouter);
  app.use('/api/staff', authenticateToken, enforceModulePermissions('sales'), staffRouter);
  app.use('/api/inventory', authenticateToken, enforceModulePermissions('inventory'), inventoryRouter);
  app.use('/api/accounting', authenticateToken, enforceModulePermissions('accounting'), accountingRouter);

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[AMS Ready] Listening on http://0.0.0.0:${config.port}`);
  });
}

startServer().catch((err) => {
  console.error('[AMS Fatal] Server failed to start:', err);
  process.exit(1);
});
