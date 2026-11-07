import { HealthResponse, SettingsResponse } from '../types/system';
import { DatabaseStatusResponse, ModulesResponse } from '../types/database';
import {
  AuthStatusResponse,
  LoginResponse,
  User,
  AuditLog,
} from '../types/auth';
import {
  StockDatasheetItem,
  CurrentStockSummary,
  InventoryOverview,
  ExpiryAlertItem,
  LowStockItem,
  StockAdjustment,
  StockTransfer,
  StockLedgerEntry,
  PhysicalVerification,
} from '../types/inventory';

const TOKEN_KEY = 'ams_session_token';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null, rememberMe: boolean = true) {
  try {
    if (token) {
      if (rememberMe) {
        localStorage.setItem(TOKEN_KEY, token);
        sessionStorage.removeItem(TOKEN_KEY);
      } else {
        sessionStorage.setItem(TOKEN_KEY, token);
        localStorage.removeItem(TOKEN_KEY);
      }
    } else {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    }
  } catch (err) {
    console.warn('Failed to access storage:', err);
  }
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/status')) {
    setAuthToken(null);
    window.dispatchEvent(new CustomEvent('ams-session-expired'));
  }
  return res;
}

export const api = {
  /**
   * Fetch system health and database connectivity
   */
  async getHealth(): Promise<HealthResponse> {
    const res = await authFetch('/api/system/health');
    if (!res.ok) {
      throw new Error(`Health check failed with status: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Fetch detailed database diagnostics and table schemas
   */
  async getDatabaseStatus(): Promise<DatabaseStatusResponse> {
    const res = await authFetch('/api/system/database');
    if (!res.ok) {
      throw new Error(`Database inspection failed with status: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Fetch company and localization settings
   */
  async getCompanySettings(): Promise<SettingsResponse> {
    const res = await authFetch('/api/system/settings');
    if (!res.ok) {
      throw new Error(`Settings request failed with status: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Save Store, Printing & Backup Settings permanently
   */
  async updateCompanySettings(payload: Record<string, unknown>): Promise<{
    success: boolean;
    message: string;
    data: any;
  }> {
    const res = await authFetch('/api/system/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to save settings');
    }
    return data;
  },

  /**
   * Backup & Recovery - List all backups and configuration
   */
  async getBackups(): Promise<{
    success: boolean;
    backupDirectory: string;
    configuredDirectory: string;
    autoDailyBackup: boolean;
    autoBackupBeforeChanges: boolean;
    backupRetentionDays: number;
    backups: any[];
  }> {
    const res = await authFetch('/api/system/backups');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load backup history');
    }
    return data;
  },

  /**
   * Backup & Recovery - Create Manual Backup Now
   */
  async createBackup(notes?: string): Promise<{
    success: boolean;
    message: string;
    backup: any;
  }> {
    const res = await authFetch('/api/system/backups/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create backup');
    }
    return data;
  },

  /**
   * Backup & Recovery - Verify Backup Integrity Before Restoration
   */
  async verifyBackup(backupId: number): Promise<{
    success: boolean;
    verification: any;
  }> {
    const res = await authFetch('/api/system/backups/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Backup verification failed');
    }
    return data;
  },

  /**
   * Backup & Recovery - Restore Database from Backup (with automatic pre-restore safety backup)
   */
  async restoreBackup(backupId: number, confirmText: string): Promise<{
    success: boolean;
    safetyBackup: any;
    restoredVerification: any;
    message: string;
  }> {
    const res = await authFetch('/api/system/backups/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId, confirmText }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Database restoration failed');
    }
    return data;
  },

  /**
   * Backup & Recovery - Download Backup File
   */
  async downloadBackup(backupId: number, filename: string): Promise<void> {
    const res = await authFetch(`/api/system/backups/download/${backupId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to download backup file');
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  /**
   * System Administration - Get Demo / Testing Data Preview Summary
   */
  async getDemoDataSummary(): Promise<{
    success: boolean;
    demoSummary: {
      demoSales: number;
      demoPurchases: number;
      demoVouchers: number;
      demoStockAdjustments: number;
      expiredSessions: number;
      resolvedErrorLogs: number;
      demoAuditLogs?: number;
      demoItems: number;
      totalDemoRecords: number;
    };
    genuineProtected: {
      genuineItems: number;
      genuineAccounts: number;
      genuineSales: number;
      genuinePurchases: number;
      inventoryBatches: number;
    };
  }> {
    const res = await authFetch('/api/system/demo-data');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to inspect system demo data');
    }
    return data;
  },

  /**
   * System Administration - Clear Temporary / Demo Data
   * Safeguards genuine business records and takes an automatic safety backup
   */
  async clearDemoData(): Promise<{
    success: boolean;
    message: string;
    result: {
      deletedSales: number;
      deletedSaleItems: number;
      deletedPurchases: number;
      deletedPurchaseItems: number;
      deletedVouchers: number;
      deletedAdjustments: number;
      deletedSessions: number;
      deletedResolvedErrors: number;
      deletedDemoItems: number;
      totalCleared: number;
    };
    safetyBackup: {
      filename: string;
      sizeBytes: number;
    };
  }> {
    const res = await authFetch('/api/system/demo-data/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to clear temporary / demo data');
    }
    return data;
  },

  /**
   * System Administration - Clear Temporary / Demo Logs
   */
  async clearDemoLogs(): Promise<{
    success: boolean;
    message: string;
    result: {
      deletedErrorLogs: number;
      deletedDemoAuditLogs: number;
      deletedExpiredSessions: number;
      totalLogsCleared: number;
    };
  }> {
    const res = await authFetch('/api/system/demo-logs/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to clear demo logs');
    }
    return data;
  },

  /**
   * System Administration - Fetch Application & Database Error Logs
   */
  async getSystemErrorLogs(): Promise<{ success: boolean; logs: any[] }> {
    const res = await authFetch('/api/system/error-logs');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch error logs');
    }
    return data;
  },

  /**
   * System Administration - Mark Error Log Resolved
   */
  async resolveSystemErrorLog(id: number): Promise<{ success: boolean; message: string }> {
    const res = await authFetch(`/api/system/error-logs/${id}/resolve`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to resolve error log');
    }
    return data;
  },

  /**
   * System Administration - Fetch Complete System Information, Version & LAN Readiness
   */
  async getSystemInfo(): Promise<any> {
    const res = await authFetch('/api/system/info');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load system information');
    }
    return data;
  },

  /**
   * Fetch module catalog and readiness states
   */
  async getModules(): Promise<ModulesResponse> {
    const res = await authFetch('/api/system/modules');
    if (!res.ok) {
      throw new Error(`Module catalog request failed with status: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Run live PRAGMA integrity check on the SQLite file
   */
  async runIntegrityCheck(): Promise<{ success: boolean; result: string; timestamp: string }> {
    const res = await authFetch('/api/system/integrity-check', { method: 'POST' });
    if (!res.ok) {
      throw new Error(`Integrity check request failed with status: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Items Master - Fetch all items with search & filtering
   */
  async getItems(params?: {
    q?: string;
    category?: string;
    company?: string;
    status?: string;
    lowStock?: boolean;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.category) query.append('category', params.category);
    if (params?.company) query.append('company', params.company);
    if (params?.status) query.append('status', params.status);
    if (params?.lowStock) query.append('lowStock', 'true');
    if (params?.sortBy) query.append('sortBy', params.sortBy);
    if (params?.sortOrder) query.append('sortOrder', params.sortOrder);

    const res = await authFetch(`/api/items?${query.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to fetch items: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Items Master - Check if Item Code exists
   */
  async checkItemCode(code: string, excludeId?: number): Promise<{ exists: boolean }> {
    const query = excludeId ? `?excludeId=${excludeId}` : '';
    const res = await authFetch(`/api/items/check-code/${encodeURIComponent(code)}${query}`);
    if (!res.ok) {
      return { exists: false };
    }
    return res.json();
  },

  /**
   * Items Master - Create Item
   */
  async createItem(item: any) {
    const res = await authFetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create item');
    }
    return data;
  },

  /**
   * Items Master - Update Item
   */
  async updateItem(id: number, item: any) {
    const res = await authFetch(`/api/items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update item');
    }
    return data;
  },

  /**
   * Items Master - Delete Item
   */
  async deleteItem(id: number) {
    const res = await authFetch(`/api/items/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to delete item');
    }
    return data;
  },

  /**
   * Items Master - Excel Bulk Import
   */
  async bulkImportItems(items: any[], updateExisting: boolean = false) {
    const res = await authFetch('/api/items/bulk-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, updateExisting }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      const detailMsg = data.errors ? `\n• ${data.errors.join('\n• ')}` : '';
      throw new Error((data.error || 'Import failed') + detailMsg);
    }
    return data;
  },

  /**
   * Accounts Master - Fetch all accounts with search, group, hierarchy & ledger filtering
   */
  async getAccounts(params?: {
    q?: string;
    mainGroup?: string;
    accountGroup?: string;
    parentAccountId?: string;
    status?: string;
    ledgerView?: 'all' | 'customer' | 'supplier';
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.mainGroup) query.append('mainGroup', params.mainGroup);
    if (params?.accountGroup) query.append('accountGroup', params.accountGroup);
    if (params?.parentAccountId) query.append('parentAccountId', params.parentAccountId);
    if (params?.status) query.append('status', params.status);
    if (params?.ledgerView && params.ledgerView !== 'all') query.append('ledgerView', params.ledgerView);
    if (params?.sortBy) query.append('sortBy', params.sortBy);
    if (params?.sortOrder) query.append('sortOrder', params.sortOrder);

    const res = await authFetch(`/api/accounts?${query.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to fetch accounts: ${res.status}`);
    }
    return res.json();
  },

  /**
   * Accounts Master - Fetch single account details with sub-accounts & protection info
   */
  async getAccountDetails(id: number) {
    const res = await authFetch(`/api/accounts/${id}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch account details');
    }
    return data;
  },

  /**
   * Accounts Master - Check if Account Code exists
   */
  async checkAccountCode(code: string, excludeId?: number): Promise<{ exists: boolean }> {
    const query = excludeId ? `?excludeId=${excludeId}` : '';
    const res = await authFetch(`/api/accounts/check-code/${encodeURIComponent(code)}${query}`);
    if (!res.ok) {
      return { exists: false };
    }
    return res.json();
  },

  /**
   * Accounts Master - Create Account
   */
  async createAccount(account: any) {
    const res = await authFetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(account),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create account');
    }
    return data;
  },

  /**
   * Accounts Master - Update Account
   */
  async updateAccount(id: number, account: any) {
    const res = await authFetch(`/api/accounts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(account),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update account');
    }
    return data;
  },

  /**
   * Accounts Master - Update single account Opening Balance
   */
  async updateAccountOpeningBalance(
    id: number,
    opening_balance: number,
    opening_balance_type: 'Debit' | 'Credit'
  ) {
    const res = await authFetch(`/api/accounts/${id}/opening-balance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opening_balance, opening_balance_type }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update opening balance');
    }
    return data;
  },

  /**
   * Accounts Master - Bulk Update Opening Balances
   */
  async bulkUpdateOpeningBalances(
    entries: Array<{ id: number; opening_balance: number; opening_balance_type: 'Debit' | 'Credit' }>
  ) {
    const res = await authFetch('/api/accounts/opening-balances/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update opening balances');
    }
    return data;
  },

  /**
   * Accounts Master - Delete Account (with transaction & hierarchy protection)
   */
  async deleteAccount(id: number) {
    const res = await authFetch(`/api/accounts/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to delete account');
    }
    return data;
  },

  /**
   * Accounts Master - Excel Bulk Import
   */
  async bulkImportAccounts(accounts: any[], updateExisting: boolean = false) {
    const res = await authFetch('/api/accounts/bulk-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts, updateExisting }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      const detailMsg = data.errors ? `\n• ${data.errors.join('\n• ')}` : '';
      throw new Error((data.error || 'Accounts import failed') + detailMsg);
    }
    return data;
  },

  /**
   * Advance Tax Settings & Audit History
   */
  async getAdvanceTaxSettings() {
    const res = await authFetch('/api/purchases/tax-settings');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch Advance Tax settings');
    }
    return data;
  },

  async updateAdvanceTaxSettings(payload: any) {
    const res = await authFetch('/api/purchases/tax-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update Advance Tax settings');
    }
    return data;
  },

  /**
   * Purchase Module - Next Auto Numbers
   */
  async getNextPurchaseNumbers(): Promise<{
    success: boolean;
    nextPurchaseNumber: string;
    nextReturnNumber: string;
  }> {
    const res = await authFetch('/api/purchases/next-numbers');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to generate next invoice number');
    }
    return data;
  },

  /**
   * Purchase Module - List Purchase Invoices
   */
  async getPurchases(params?: {
    q?: string;
    supplierId?: string;
    filerStatus?: string;
    paymentMode?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.supplierId) query.append('supplierId', params.supplierId);
    if (params?.filerStatus) query.append('filerStatus', params.filerStatus);
    if (params?.paymentMode) query.append('paymentMode', params.paymentMode);
    if (params?.status) query.append('status', params.status);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);

    const res = await authFetch(`/api/purchases?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch purchase invoices');
    }
    return data;
  },

  /**
   * Purchase Module - Get Single Purchase Invoice with Items & Journal Lines
   */
  async getPurchaseDetails(id: number) {
    const res = await authFetch(`/api/purchases/${id}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch purchase invoice details');
    }
    return data;
  },

  /**
   * Purchase Module - Create Confirmed Purchase Invoice
   */
  async createPurchase(payload: any) {
    const res = await authFetch('/api/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create purchase invoice');
    }
    return data;
  },

  /**
   * Purchase Module - Update Purchase Invoice (with Double-Entry Reversal)
   */
  async updatePurchase(id: number, payload: any) {
    const res = await authFetch(`/api/purchases/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update purchase invoice');
    }
    return data;
  },

  /**
   * Purchase Module - Cancel Purchase Invoice (with Double-Entry Reversal)
   */
  async cancelPurchase(id: number, reason: string) {
    const res = await authFetch(`/api/purchases/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to cancel purchase invoice');
    }
    return data;
  },

  /**
   * Purchase Returns - List & Get & Create
   */
  async getPurchaseReturns(params?: {
    q?: string;
    supplierId?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.supplierId) query.append('supplierId', params.supplierId);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.status) query.append('status', params.status);

    const res = await authFetch(`/api/purchases/returns/list?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch purchase returns');
    }
    return data;
  },

  async getPurchaseReturnDetails(id: number) {
    const res = await authFetch(`/api/purchases/returns/${id}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch purchase return details');
    }
    return data;
  },

  async createPurchaseReturn(payload: any) {
    const res = await authFetch('/api/purchases/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create purchase return');
    }
    return data;
  },

  /**
   * Batch-wise Inventory Stock
   */
  async getInventoryBatches(params?: {
    itemId?: number;
    q?: string;
    status?: string;
    inStockOnly?: boolean;
  }) {
    const query = new URLSearchParams();
    if (params?.itemId) query.append('itemId', String(params.itemId));
    if (params?.q) query.append('q', params.q);
    if (params?.status) query.append('status', params.status);
    if (params?.inStockOnly) query.append('inStockOnly', 'true');

    const res = await authFetch(`/api/purchases/batches?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch batch inventory');
    }
    return data;
  },

  /**
   * 8 Purchase & Tax Reports
   */
  async getPurchaseReport(
    reportType: string,
    params?: {
      startDate?: string;
      endDate?: string;
      supplierId?: string;
      itemId?: string;
      filerStatus?: string;
    }
  ) {
    const query = new URLSearchParams();
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.supplierId) query.append('supplierId', params.supplierId);
    if (params?.itemId) query.append('itemId', params.itemId);
    if (params?.filerStatus) query.append('filerStatus', params.filerStatus);

    const res = await authFetch(`/api/purchases/reports/${reportType}?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load report: ${reportType}`);
    }
    return data;
  },

  /**
   * Sales & Billing Module - Next Auto Numbers
   */
  async getNextSalesNumbers(): Promise<{
    success: boolean;
    nextInvoiceNumber: string;
    nextReturnNumber: string;
    nextVoucherNumber: string;
  }> {
    const res = await authFetch('/api/sales/next-numbers');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to generate next sales number');
    }
    return data;
  },

  /**
   * Sales & Billing Module - Ultra-Fast Item & Batch Search
   */
  async fastSearchSalesItems(q: string = '', limit: number = 30) {
    const query = new URLSearchParams();
    if (q) query.append('q', q);
    query.append('limit', String(limit));
    const res = await authFetch(`/api/sales/fast-search?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Fast item search failed');
    }
    return data;
  },

  /**
   * Sales & Billing Module - Get Sales Register / Held & Draft Invoices
   */
  async getSales(params?: {
    q?: string;
    customerId?: string;
    paymentMode?: string;
    invoiceType?: string;
    status?: string;
    salesman?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.customerId) query.append('customerId', params.customerId);
    if (params?.paymentMode) query.append('paymentMode', params.paymentMode);
    if (params?.invoiceType) query.append('invoiceType', params.invoiceType);
    if (params?.status) query.append('status', params.status);
    if (params?.salesman) query.append('salesman', params.salesman);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.page) query.append('page', String(params.page));
    if (params?.pageSize) query.append('pageSize', String(params.pageSize));

    const res = await authFetch(`/api/sales?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch sales invoices');
    }
    return data;
  },

  /**
   * Sales & Billing Module - Get Single Sales Invoice with 14-col Items & Journal Lines
   */
  async getSaleDetails(id: number) {
    const res = await authFetch(`/api/sales/${id}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch sales invoice details');
    }
    return data;
  },

  /**
   * Sales & Billing Module - Create Sales Invoice (completed, held, or draft)
   */
  async createSale(payload: any) {
    const res = await authFetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to save sales invoice');
    }
    return data;
  },

  /**
   * Sales & Billing Module - Update Sales Invoice
   */
  async updateSale(id: number, payload: any) {
    const res = await authFetch(`/api/sales/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update sales invoice');
    }
    return data;
  },

  /**
   * Sales & Billing Module - Delete Draft/Held or Cancel Completed Invoice
   */
  async deleteOrCancelSale(id: number) {
    const res = await authFetch(`/api/sales/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to discard/cancel invoice');
    }
    return data;
  },

  /**
   * Sales Return Module - List, Get & Create
   */
  async getSaleReturns(params?: {
    q?: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.customerId) query.append('customerId', params.customerId);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);

    const res = await authFetch(`/api/sales/returns/list?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch sales returns');
    }
    return data;
  },

  async getSaleReturnDetails(id: number) {
    const res = await authFetch(`/api/sales/returns/${id}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch sales return details');
    }
    return data;
  },

  async createSaleReturn(payload: any) {
    const res = await authFetch('/api/sales/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create sales return');
    }
    return data;
  },

  /**
   * Payments & Receipts Vouchers
   */
  async getPaymentVouchers(params?: {
    voucherType?: string;
    partyId?: string;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.voucherType) query.append('voucherType', params.voucherType);
    if (params?.partyId) query.append('partyId', params.partyId);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);

    const res = await authFetch(`/api/sales/payments?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch payment vouchers');
    }
    return data;
  },

  async createPaymentVoucher(payload: any) {
    const res = await authFetch('/api/sales/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to post payment voucher');
    }
    return data;
  },

  /**
   * Accounts Ledgers & Account Statements
   */
  async getAccountLedger(params: {
    ledgerType: string;
    accountId?: number | string;
    startDate?: string;
    endDate?: string;
  }) {
    const query = new URLSearchParams();
    query.append('ledgerType', params.ledgerType);
    if (params.accountId) query.append('accountId', String(params.accountId));
    if (params.startDate) query.append('startDate', params.startDate);
    if (params.endDate) query.append('endDate', params.endDate);

    const res = await authFetch(`/api/sales/ledgers?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch account ledger');
    }
    return data;
  },

  /**
   * Sales & Tax Reports
   */
  async getSalesReport(
    reportType: string,
    params?: {
      startDate?: string;
      endDate?: string;
      customerId?: string;
      itemId?: string;
    }
  ) {
    const query = new URLSearchParams();
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.customerId) query.append('customerId', params.customerId);
    if (params?.itemId) query.append('itemId', params.itemId);

    const res = await authFetch(`/api/sales/reports/${reportType}?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load sales report: ${reportType}`);
    }
    return data;
  },

  /**
   * Authentication - System status & session verification
   */
  async getAuthStatus(): Promise<AuthStatusResponse> {
    const res = await authFetch('/api/auth/status');
    return res.json();
  },

  /**
   * Authentication - First-Time Owner & Super Admin Setup
   */
  async setupAdmin(data: {
    username: string;
    password: string;
    full_name: string;
    email?: string;
    phone?: string;
  }): Promise<LoginResponse> {
    const res = await authFetch('/api/auth/setup-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Failed to complete Super Admin setup');
    }
    if (result.token) {
      setAuthToken(result.token);
    }
    return result;
  },

  /**
   * Authentication - Desktop Login
   */
  async login(data: {
    username: string;
    password: string;
    remember_me?: boolean;
  }): Promise<LoginResponse> {
    const res = await authFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      const err: any = new Error(result.error || 'Login failed');
      err.locked = result.locked;
      err.remainingMinutes = result.remainingMinutes;
      err.attemptsRemaining = result.attemptsRemaining;
      throw err;
    }
    if (result.token) {
      setAuthToken(result.token, data.remember_me !== false);
    }
    return result;
  },

  /**
   * Authentication - Voluntary Logout
   */
  async logout(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await authFetch('/api/auth/logout', { method: 'POST' });
      return await res.json();
    } finally {
      setAuthToken(null);
    }
  },

  /**
   * Authentication - Forgot Password Help
   */
  async forgotPassword(username: string): Promise<any> {
    const res = await authFetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    return res.json();
  },

  /**
   * User Management - Fetch all staff users (Super Admin only)
   */
  async getUsers(): Promise<{ success: boolean; users: User[] }> {
    const res = await authFetch('/api/auth/users');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch users');
    }
    return data;
  },

  /**
   * User Management - Create staff user (Super Admin only)
   */
  async createUser(user: any): Promise<{ success: boolean; user: User; message: string }> {
    const res = await authFetch('/api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create user');
    }
    return data;
  },

  /**
   * User Management - Update staff user info (Super Admin only)
   */
  async updateUser(id: number, user: any): Promise<{ success: boolean; user: User; message: string }> {
    const res = await authFetch(`/api/auth/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update user');
    }
    return data;
  },

  /**
   * User Management - Activate / Deactivate user (Super Admin only)
   */
  async updateUserStatus(id: number, status: 'Active' | 'Inactive'): Promise<{ success: boolean; user: User; message: string }> {
    const res = await authFetch(`/api/auth/users/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update user status');
    }
    return data;
  },

  /**
   * User Management - Reset user password (Super Admin only)
   */
  async resetUserPassword(id: number, new_password: string): Promise<{ success: boolean; message: string }> {
    const res = await authFetch(`/api/auth/users/${id}/reset-password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to reset user password');
    }
    return data;
  },

  /**
   * Security Audit Logs - View authentication and security events
   */
  async getAuditLogs(params?: {
    limit?: number;
    action?: string;
    username?: string;
  }): Promise<{ success: boolean; logs: AuditLog[] }> {
    const query = new URLSearchParams();
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.action) query.append('action', params.action);
    if (params?.username) query.append('username', params.username);

    const res = await authFetch(`/api/auth/audit-logs?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch audit logs');
    }
    return data;
  },

  /**
   * Security - Get role permissions matrix
   */
  async getRolesPermissions(): Promise<{ success: boolean; permissions: any[] }> {
    const res = await authFetch('/api/auth/roles-permissions');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch permissions matrix');
    }
    return data;
  },

  /**
   * Security - Update role permissions for a module (Super Admin only)
   */
  async updateRolePermission(payload: {
    role: string;
    module_key: string;
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
    can_export: boolean;
  }): Promise<{ success: boolean; message: string; permissions: any[] }> {
    const res = await authFetch('/api/auth/roles-permissions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update role permissions');
    }
    return data;
  },

  // ==========================================
  // INVENTORY MANAGEMENT MODULE (TASK 6)
  // ==========================================

  async getInventoryOverview(): Promise<{ success: boolean; overview: InventoryOverview }> {
    const res = await authFetch('/api/inventory/overview');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch inventory overview');
    }
    return data;
  },

  async getStockDatasheet(params?: {
    search?: string;
    code?: string;
    barcode?: string;
    company?: string;
    category?: string;
    batch?: string;
    expiry_status?: string;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }): Promise<{
    success: boolean;
    data: StockDatasheetItem[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
    summary: {
      total_items: number;
      total_packs: number;
      total_units: number;
      total_cost_valuation: number;
      total_retail_valuation: number;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.search) query.append('search', params.search);
    if (params?.code) query.append('code', params.code);
    if (params?.barcode) query.append('barcode', params.barcode);
    if (params?.company) query.append('company', params.company);
    if (params?.category) query.append('category', params.category);
    if (params?.batch) query.append('batch', params.batch);
    if (params?.expiry_status) query.append('expiry_status', params.expiry_status);
    if (params?.sort_by) query.append('sort_by', params.sort_by);
    if (params?.sort_order) query.append('sort_order', params.sort_order);
    if (params?.page) query.append('page', String(params.page));
    if (params?.limit) query.append('limit', String(params.limit));

    const res = await authFetch(`/api/inventory/datasheet?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch stock datasheet');
    }
    return data;
  },

  async getCurrentStock(params?: {
    search?: string;
    company?: string;
    category?: string;
    status?: string;
  }): Promise<{ success: boolean; data: CurrentStockSummary[]; count: number }> {
    const query = new URLSearchParams();
    if (params?.search) query.append('search', params.search);
    if (params?.company) query.append('company', params.company);
    if (params?.category) query.append('category', params.category);
    if (params?.status) query.append('status', params.status);

    const res = await authFetch(`/api/inventory/current-stock?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch current stock');
    }
    return data;
  },

  async getExpiryAlerts(params?: {
    filter?: 'ALL' | 'EXPIRED' | '30_DAYS' | '60_DAYS' | '90_DAYS';
    days?: number;
  }): Promise<{
    success: boolean;
    data: ExpiryAlertItem[];
    summary: {
      expired: number;
      days_30: number;
      days_60: number;
      days_90: number;
      total_cost_at_risk: number;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.filter) query.append('filter', params.filter);
    if (params?.days) query.append('days', String(params.days));

    const res = await authFetch(`/api/inventory/expiry-alerts?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch expiry alerts');
    }
    return data;
  },

  async getLowStock(params?: {
    search?: string;
    company?: string;
  }): Promise<{
    success: boolean;
    data: LowStockItem[];
    summary: {
      out_of_stock_count: number;
      low_stock_count: number;
      total_reorder_cost_estimate: number;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.search) query.append('search', params.search);
    if (params?.company) query.append('company', params.company);

    const res = await authFetch(`/api/inventory/low-stock?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch low stock items');
    }
    return data;
  },

  async getStockAdjustments(params?: { limit?: number; offset?: number }): Promise<{
    success: boolean;
    adjustments: StockAdjustment[];
  }> {
    const query = new URLSearchParams();
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.offset) query.append('offset', String(params.offset));

    const res = await authFetch(`/api/inventory/adjustments?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch stock adjustments');
    }
    return data;
  },

  async getStockAdjustmentById(id: number): Promise<{ success: boolean; adjustment: StockAdjustment }> {
    const res = await authFetch(`/api/inventory/adjustments/${id}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch stock adjustment');
    }
    return data;
  },

  async createStockAdjustment(payload: {
    adjustment_date: string;
    reason_category: 'INCREASE' | 'DECREASE' | 'DAMAGE' | 'EXPIRED' | 'PHYSICAL_DIFFERENCE' | 'CORRECTION';
    description: string;
    reference_no?: string;
    items: Array<{
      inventory_id: number;
      direction: 'INCREASE' | 'DECREASE';
      quantity_packs: number;
      quantity_loose?: number;
      unit_cost?: number;
      reason_note?: string;
    }>;
  }): Promise<{
    success: boolean;
    adjustment_no: string;
    adjustment_id: number;
    journal_voucher_id: number | null;
    message: string;
  }> {
    const res = await authFetch('/api/inventory/adjustments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create stock adjustment');
    }
    return data;
  },

  async getStockTransfers(params?: { limit?: number; offset?: number }): Promise<{
    success: boolean;
    transfers: StockTransfer[];
  }> {
    const query = new URLSearchParams();
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.offset) query.append('offset', String(params.offset));

    const res = await authFetch(`/api/inventory/transfers?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch stock transfers');
    }
    return data;
  },

  async createStockTransfer(payload: {
    transfer_date: string;
    from_location: string;
    to_location: string;
    reference_no?: string;
    remarks?: string;
    items: Array<{
      inventory_id: number;
      quantity_packs: number;
      quantity_loose?: number;
      from_rack?: string;
      to_rack?: string;
    }>;
  }): Promise<{
    success: boolean;
    transfer_no: string;
    transfer_id: number;
    message: string;
  }> {
    const res = await authFetch('/api/inventory/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create stock transfer');
    }
    return data;
  },

  async getStockLedger(params: {
    item_id?: number;
    batch_number?: string;
    from_date?: string;
    to_date?: string;
  }): Promise<{
    success: boolean;
    ledger: StockLedgerEntry[];
    summary: {
      total_in_packs: number;
      total_out_packs: number;
      net_change_packs: number;
      closing_pack_balance: number;
    };
  }> {
    const query = new URLSearchParams();
    if (params.item_id) query.append('item_id', String(params.item_id));
    if (params.batch_number) query.append('batch_number', params.batch_number);
    if (params.from_date) query.append('from_date', params.from_date);
    if (params.to_date) query.append('to_date', params.to_date);

    const res = await authFetch(`/api/inventory/stock-ledger?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch stock ledger');
    }
    return data;
  },

  async getPhysicalVerifications(): Promise<{
    success: boolean;
    verifications: PhysicalVerification[];
  }> {
    const res = await authFetch('/api/inventory/physical-verifications');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch physical verifications');
    }
    return data;
  },

  async getPhysicalVerificationById(id: number): Promise<{
    success: boolean;
    verification: PhysicalVerification;
  }> {
    const res = await authFetch(`/api/inventory/physical-verifications/${id}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch physical verification audit');
    }
    return data;
  },

  async createPhysicalVerification(payload: {
    verification_date: string;
    remarks?: string;
    items: Array<{
      inventory_id: number;
      physical_pack_qty: number;
      physical_loose_qty?: number;
      reason_note?: string;
    }>;
  }): Promise<{
    success: boolean;
    verification_no: string;
    verification_id: number;
    message: string;
  }> {
    const res = await authFetch('/api/inventory/physical-verifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create physical verification');
    }
    return data;
  },

  async reconcilePhysicalVerification(
    id: number,
    payload?: { reason_category?: string; remarks?: string }
  ): Promise<{
    success: boolean;
    adjustment_no: string;
    adjustment_id: number;
    message: string;
  }> {
    const res = await authFetch(`/api/inventory/physical-verifications/${id}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to reconcile physical verification');
    }
    return data;
  },

  async getInventorySettings(): Promise<{ success: boolean; near_expiry_days: number }> {
    const res = await authFetch('/api/inventory/settings');
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch inventory settings');
    }
    return data;
  },

  async updateInventorySettings(near_expiry_days: number): Promise<{ success: boolean; near_expiry_days: number }> {
    const res = await authFetch('/api/inventory/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ near_expiry_days }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update inventory settings');
    }
    return data;
  },

  // ==========================================
  // COMPLETE ACCOUNTING & LEDGER SYSTEM (TASK 7)
  // ==========================================

  async getHierarchicalCOA(params?: { q?: string; pillar?: string; status?: string }) {
    const query = new URLSearchParams();
    if (params?.q) query.append('q', params.q);
    if (params?.pillar) query.append('pillar', params.pillar);
    if (params?.status) query.append('status', params.status);

    const res = await authFetch(`/api/accounting/coa?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load Chart of Accounts');
    }
    return data;
  },

  async createCOAAccount(payload: any) {
    const res = await authFetch('/api/accounting/coa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create account');
    }
    return data;
  },

  async getNextAccountingVoucherNumber(type: string = 'JV') {
    const res = await authFetch(`/api/accounting/vouchers/next-number?type=${encodeURIComponent(type)}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to get next voucher number');
    }
    return data;
  },

  async getAccountingVouchers(params?: {
    voucherType?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    q?: string;
    accountId?: string | number;
  }) {
    const query = new URLSearchParams();
    if (params?.voucherType) query.append('voucherType', params.voucherType);
    if (params?.status) query.append('status', params.status);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);
    if (params?.accountId) query.append('accountId', String(params.accountId));

    const res = await authFetch(`/api/accounting/vouchers?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load vouchers');
    }
    return data;
  },

  async createAccountingVoucher(payload: any) {
    const res = await authFetch('/api/accounting/vouchers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to save voucher');
    }
    return data;
  },

  async updateAccountingVoucher(id: number, payload: any) {
    const res = await authFetch(`/api/accounting/vouchers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update voucher');
    }
    return data;
  },

  async postAccountingVoucher(id: number) {
    const res = await authFetch(`/api/accounting/vouchers/${id}/post`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to post voucher');
    }
    return data;
  },

  async reverseAccountingVoucher(id: number, reason: string = 'Authorized Accounting Reversal') {
    const res = await authFetch(`/api/accounting/vouchers/${id}/reverse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to reverse voucher');
    }
    return data;
  },

  async getCustomerLedger(params?: {
    accountId?: number | string;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.accountId) query.append('accountId', String(params.accountId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);

    const res = await authFetch(`/api/accounting/ledgers/customer?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load customer ledger');
    }
    return data;
  },

  async getSupplierLedger(params?: {
    accountId?: number | string;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.accountId) query.append('accountId', String(params.accountId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);

    const res = await authFetch(`/api/accounting/ledgers/supplier?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load supplier ledger');
    }
    return data;
  },

  async getGeneralLedger(params?: {
    accountId?: number | string;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.accountId) query.append('accountId', String(params.accountId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);

    const res = await authFetch(`/api/accounting/ledgers/general?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load general ledger');
    }
    return data;
  },

  async getCashBook(params?: {
    accountId?: number | string;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.accountId) query.append('accountId', String(params.accountId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);

    const res = await authFetch(`/api/accounting/ledgers/cash-book?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load cash book');
    }
    return data;
  },

  async getBankBook(params?: {
    accountId?: number | string;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.accountId) query.append('accountId', String(params.accountId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);

    const res = await authFetch(`/api/accounting/ledgers/bank-book?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load bank book');
    }
    return data;
  },

  async getAdvanceTaxAccounting(params?: {
    startDate?: string;
    endDate?: string;
    filerStatus?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.filerStatus) query.append('filerStatus', params.filerStatus);
    if (params?.q) query.append('q', params.q);

    const res = await authFetch(`/api/accounting/advance-tax?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load advance tax accounting');
    }
    return data;
  },

  async getFinancialReport(
    reportType: string,
    params?: {
      startDate?: string;
      endDate?: string;
      accountId?: string | number;
    }
  ) {
    const query = new URLSearchParams();
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.accountId) query.append('accountId', String(params.accountId));

    const res = await authFetch(`/api/accounting/reports/${reportType}?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load financial report: ${reportType}`);
    }
    return data;
  },

  /**
   * Customer-Wise Item Sale History & Item Purchase History
   */
  async getItemCustomerHistory(itemId: number, customerId?: number | null) {
    const query = new URLSearchParams();
    if (customerId && customerId > 0) {
      query.append('customerId', String(customerId));
    }
    const res = await authFetch(`/api/sales/item-history/${itemId}?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch item customer history');
    }
    return data;
  },

  /**
   * Live Account Balance Summary & Last Payment Info (Customer or Supplier)
   */
  async getAccountBalanceSummary(
    accountId: number,
    params?: {
      role?: 'customer' | 'supplier';
      excludeSaleId?: number | null;
      excludePurchaseId?: number | null;
    }
  ) {
    const query = new URLSearchParams();
    if (params?.role) query.append('role', params.role);
    if (params?.excludeSaleId) query.append('excludeSaleId', String(params.excludeSaleId));
    if (params?.excludePurchaseId) query.append('excludePurchaseId', String(params.excludePurchaseId));

    const res = await authFetch(`/api/accounts/${accountId}/balance-summary?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch account balance summary');
    }
    return data;
  },

  /**
   * Salesman Management & 6 Salesman Reports
   */
  async getSalesmen(params?: { status?: string; q?: string }) {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.q) query.append('q', params.q);
    const res = await authFetch(`/api/staff/salesmen?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load salesmen');
    }
    return data;
  },

  async createSalesman(payload: any) {
    const res = await authFetch('/api/staff/salesmen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create salesman');
    }
    return data;
  },

  async updateSalesman(id: number, payload: any) {
    const res = await authFetch(`/api/staff/salesmen/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update salesman');
    }
    return data;
  },

  async updateSalesmanStatus(id: number, status: 'Active' | 'Inactive') {
    const res = await authFetch(`/api/staff/salesmen/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update salesman status');
    }
    return data;
  },

  async paySalesmanCommission(id: number, payload: any) {
    const res = await authFetch(`/api/staff/salesmen/${id}/pay-commission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to record commission payment');
    }
    return data;
  },

  async getSalesmanReport(
    reportType: string,
    params?: { salesmanId?: string | number; startDate?: string; endDate?: string }
  ) {
    const query = new URLSearchParams();
    if (params?.salesmanId) query.append('salesmanId', String(params.salesmanId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    const res = await authFetch(`/api/staff/salesmen/reports/${reportType}?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load salesman report: ${reportType}`);
    }
    return data;
  },

  /**
   * Deliveryman Management & Delivery Tracking
   */
  async getDeliverymen(params?: { status?: string; q?: string }) {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.q) query.append('q', params.q);
    const res = await authFetch(`/api/staff/deliverymen?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load deliverymen');
    }
    return data;
  },

  async createDeliveryman(payload: any) {
    const res = await authFetch('/api/staff/deliverymen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create deliveryman');
    }
    return data;
  },

  async updateDeliveryman(id: number, payload: any) {
    const res = await authFetch(`/api/staff/deliverymen/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update deliveryman');
    }
    return data;
  },

  async updateDeliverymanStatus(id: number, status: 'Active' | 'Inactive') {
    const res = await authFetch(`/api/staff/deliverymen/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update deliveryman status');
    }
    return data;
  },

  async getDeliveries(params?: {
    deliveryStatus?: string;
    deliverymanId?: string | number;
    salesmanId?: string | number;
    startDate?: string;
    endDate?: string;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.deliveryStatus) query.append('deliveryStatus', params.deliveryStatus);
    if (params?.deliverymanId) query.append('deliverymanId', String(params.deliverymanId));
    if (params?.salesmanId) query.append('salesmanId', String(params.salesmanId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.q) query.append('q', params.q);
    const res = await authFetch(`/api/staff/deliveries?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to load deliveries');
    }
    return data;
  },

  async updateDeliveryTracking(saleId: number, payload: any) {
    const res = await authFetch(`/api/staff/deliveries/${saleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update delivery tracking');
    }
    return data;
  },

  async getDeliveryReport(
    reportType: string,
    params?: { deliverymanId?: string | number; startDate?: string; endDate?: string }
  ) {
    const query = new URLSearchParams();
    if (params?.deliverymanId) query.append('deliverymanId', String(params.deliverymanId));
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    const res = await authFetch(`/api/staff/deliveries/reports/${reportType}?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Failed to load delivery report: ${reportType}`);
    }
    return data;
  },
};

