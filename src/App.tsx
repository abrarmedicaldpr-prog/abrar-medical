import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, NavTabId } from './components/layout/Sidebar';
import { TopHeader } from './components/layout/TopHeader';
import { DashboardView } from './components/views/DashboardView';
import { ItemsMasterView } from './components/items/ItemsMasterView';
import { AccountsMasterView } from './components/accounts/AccountsMasterView';
import { PurchasesWorkspaceView } from './components/purchases/PurchasesWorkspaceView';
import { AdvanceTaxSettingsPanel } from './components/purchases/AdvanceTaxSettingsPanel';
import { SalesInvoiceDatasheet } from './components/sales/SalesInvoiceDatasheet';
import { SalesRegisterView } from './components/sales/SalesRegisterView';
import { SalesReturnView } from './components/sales/SalesReturnView';
import { AccountLedgersView } from './components/sales/AccountLedgersView';
import { PaymentsWorkspaceView } from './components/sales/PaymentsWorkspaceView';
import { SalesReportsView } from './components/sales/SalesReportsView';
import { ArchitectureView } from './components/views/ArchitectureView';
import { SchemaExplorerView } from './components/views/SchemaExplorerView';
import { SystemSettingsView } from './components/views/SystemSettingsView';
import { TaskApprovalView } from './components/views/TaskApprovalView';
import { LoginScreen } from './components/auth/LoginScreen';
import { FirstTimeSetupScreen } from './components/auth/FirstTimeSetupScreen';
import { UserManagementView } from './components/admin/UserManagementView';
import { SecurityAuditView } from './components/admin/SecurityAuditView';
import { InventoryWorkspaceView } from './components/inventory/InventoryWorkspaceView';
import { ChartOfAccountsView } from './components/accounting/ChartOfAccountsView';
import { VoucherManagementView } from './components/accounting/VoucherManagementView';
import { LedgersWorkspaceView } from './components/accounting/LedgersWorkspaceView';
import { AdvanceTaxAccountingView } from './components/accounting/AdvanceTaxAccountingView';
import { FinancialReportsView } from './components/accounting/FinancialReportsView';
import {
  QuickAccountShortcutsModal,
  QuickShortcutAction,
} from './components/accounting/QuickAccountShortcutsModal';
import { StaffAndDeliveryWorkspaceView } from './components/staff/StaffAndDeliveryWorkspaceView';
import { AuthProvider, useAuth } from './context/AuthContext';
import { api } from './services/api';
import { DatabaseDiagnostics, TableDetail } from './types/database';
import { HealthResponse, CompanySettings } from './types/system';
import {
  AlertCircle,
  RefreshCw,
  ShieldAlert,
  Users2,
  Building2,
  Wallet,
  CreditCard,
  Banknote,
  FileSpreadsheet,
  Percent,
  LayoutDashboard,
} from 'lucide-react';

function AppContent() {
  const { isAuthenticated, isInitialized, loading: authLoading, user, hasPermission, isSuperAdmin } =
    useAuth();

  const [activeTab, setActiveTab] = useState<NavTabId>('dashboard');
  const [hasVisitedSales, setHasVisitedSales] = useState<boolean>(false);
  const [resumeInvoiceId, setResumeInvoiceId] = useState<number | null>(null);
  const [hasUnsavedInvoiceItems, setHasUnsavedInvoiceItems] = useState<boolean>(false);
  const [quickShortcut, setQuickShortcut] = useState<QuickShortcutAction | null>(null);

  useEffect(() => {
    if (activeTab === 'sales-new') {
      setHasVisitedSales(true);
    }
  }, [activeTab]);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<DatabaseDiagnostics | null>(null);
  const [tables, setTables] = useState<TableDetail[]>([]);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Check if current logged-in user is permitted to access a specific tab
  const canAccessTab = useCallback(
    (tab: NavTabId): boolean => {
      if (!isAuthenticated || !user) return false;
      if (isSuperAdmin) return true;
      if (tab === 'dashboard') return true;

      if (tab === 'users-manage' || tab === 'users') {
        return isSuperAdmin;
      }
      if (
        tab === 'audit-logs' ||
        tab === 'architecture' ||
        tab === 'schema-registry' ||
        tab === 'system-settings' ||
        tab === 'backup-restore' ||
        tab === 'system-admin' ||
        tab === 'task1-report'
      ) {
        return true;
      }
      if (
        tab === 'sales-new' ||
        tab === 'sales-register' ||
        tab === 'sales-held' ||
        tab === 'sales' ||
        tab === 'staff-salesmen' ||
        tab === 'staff-deliverymen' ||
        tab === 'staff-deliveries'
      ) {
        return hasPermission('sales') || hasPermission('reports');
      }
      if (tab === 'sales-return' || tab === 'sales-return-register' || tab === 'sale-returns') {
        return hasPermission('sale_returns') || hasPermission('sales');
      }
      if (tab === 'purchases') {
        return hasPermission('purchases');
      }
      if (tab === 'purchase-returns') {
        return hasPermission('purchase_returns') || hasPermission('purchases');
      }
      if (tab === 'items') {
        return hasPermission('items') || hasPermission('inventory');
      }
      if (tab === 'inventory' || tab.startsWith('inv-')) {
        return hasPermission('inventory') || hasPermission('items') || user.role === 'Administrator';
      }
      if (tab === 'accounts' || tab === 'coa-hierarchy') {
        return hasPermission('accounts') || hasPermission('ledgers');
      }
      if (tab.startsWith('ledger-')) {
        return hasPermission('ledgers') || hasPermission('accounts');
      }
      if (tab.startsWith('voucher-') || tab.startsWith('payment-')) {
        return hasPermission('payments') || hasPermission('accounts');
      }
      if (tab.startsWith('tax-')) {
        return hasPermission('tax') || hasPermission('accounts');
      }
      if (tab.startsWith('fin-') || tab.startsWith('report-')) {
        return hasPermission('reports') || hasPermission('accounts');
      }
      return true;
    },
    [isAuthenticated, user, isSuperAdmin, hasPermission]
  );

  // Protect direct URLs: when unauthenticated, force URL to root and block direct path/hash bypass
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      if (window.location.pathname !== '/' || window.location.hash) {
        window.history.replaceState(null, '', '/');
      }
    }
  }, [authLoading, isAuthenticated]);

  const fetchSystemData = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setLoading(true);
      setError(null);

      const [healthData, dbData, settingsData] = await Promise.all([
        api.getHealth(),
        api.getDatabaseStatus(),
        api.getCompanySettings(),
      ]);

      setHealth(healthData);
      setDiagnostics(dbData.diagnostics);
      setTables(dbData.tables || []);
      setSettings(settingsData.data);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchSystemData();
    }
  }, [isAuthenticated, fetchSystemData]);

  // Default to Dashboard on fresh login
  useEffect(() => {
    if (user) {
      setActiveTab('dashboard');
    }
  }, [user?.id]);

  // 1. Loading Splash while checking server-side authentication session
  if (authLoading) {
    return (
      <div className="min-h-screen w-screen bg-slate-900 flex flex-col items-center justify-center text-white">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-bold text-2xl shadow-xl shadow-emerald-500/20 mb-4 animate-pulse">
          A
        </div>
        <div className="text-base font-bold tracking-tight">ABRAR MEDICAL STORE</div>
        <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
          <div className="w-3.5 h-3.5 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
          <span>Verifying security session...</span>
        </div>
      </div>
    );
  }

  // 2. Uninitialized System: First-Time Super Admin Setup
  if (!isInitialized) {
    return <FirstTimeSetupScreen />;
  }

  // 3. Unauthenticated: Display Login Screen First (Never reveal dashboard or menus before login)
  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // 4. Authenticated: Render Full Medical Store ERP Workspace
  const handleResumeFromRegister = (id: number) => {
    setResumeInvoiceId(id);
    setActiveTab('sales-new');
  };

  // Determine view title & breadcrumbs
  const getHeaderInfo = (): { title: string; crumbs: string[] } => {
    switch (activeTab) {
      case 'dashboard':
        return {
          title: 'Executive Store Dashboard — Real-Time ERP Overview',
          crumbs: ['Dashboard', 'Store Overview'],
        };
      case 'users-manage':
        return {
          title: 'Staff Accounts, Roles & Module Permissions',
          crumbs: ['User Management', 'Staff & Permissions'],
        };
      case 'audit-logs':
        return {
          title: 'Authentication & Security Audit Trail',
          crumbs: ['User Management', 'Security Logs'],
        };
      case 'sales-new':
        return {
          title: 'New Sales Invoice — 14-Column POS & Wholesale Datasheet',
          crumbs: ['Sales & Billing', 'New Sales Invoice'],
        };
      case 'sales-register':
        return {
          title: 'Sales Register — Confirmed Invoices & Reprint Center',
          crumbs: ['Sales & Billing', 'Sales Register'],
        };
      case 'sales-return':
        return {
          title: 'Sales Return — Invoice-Linked Medicine Return & Stock Restoration',
          crumbs: ['Sales & Billing', 'Sales Return'],
        };
      case 'sales-return-register':
        return {
          title: 'Sales Return Register — Customer Credit Notes & Refunds',
          crumbs: ['Sales & Billing', 'Sales Return Register'],
        };
      case 'sales-held':
        return {
          title: 'Held & Draft Invoices — Resume or Discard Pending Bills',
          crumbs: ['Sales & Billing', 'Held / Draft Invoices'],
        };
      case 'staff-salesmen':
        return {
          title: 'Salesman Management, Commissions & Performance Reports',
          crumbs: ['Salesman & Delivery', 'Salesmen & Commissions'],
        };
      case 'staff-deliverymen':
        return {
          title: 'Deliveryman Directory & Rider Performance',
          crumbs: ['Salesman & Delivery', 'Deliveryman Directory'],
        };
      case 'staff-deliveries':
        return {
          title: 'Delivery Management, Dispatch Tracking & Delivery Reports',
          crumbs: ['Salesman & Delivery', 'Delivery Dispatch'],
        };
      case 'coa-hierarchy':
        return {
          title: 'Chart of Accounts — 5-Pillar Hierarchical Double-Entry COA',
          crumbs: ['Accounts & Ledgers', 'Chart of Accounts'],
        };
      case 'ledger-customer':
        return {
          title: 'Customer Ledger — Double-Entry Receivables Statement',
          crumbs: ['Accounts & Ledgers', 'Customer Ledger'],
        };
      case 'ledger-supplier':
        return {
          title: 'Supplier Ledger — Double-Entry Payables Statement',
          crumbs: ['Accounts & Ledgers', 'Supplier Ledger'],
        };
      case 'ledger-cash':
        return {
          title: 'Cash Book — Counter Cash Drawer & Daily Cash Balance',
          crumbs: ['Accounts & Ledgers', 'Cash Book'],
        };
      case 'ledger-bank':
        return {
          title: 'Bank Book — Bank Deposits, Withdrawals & Running Balance',
          crumbs: ['Accounts & Ledgers', 'Bank Book'],
        };
      case 'ledger-general':
        return {
          title: 'General Ledger — Complete Double-Entry Account Ledger',
          crumbs: ['Accounts & Ledgers', 'General Ledger'],
        };
      case 'ledger-statement':
        return {
          title: 'Account Statement — Running Balance Statement',
          crumbs: ['Accounts & Ledgers', 'Account Statement'],
        };
      case 'accounts':
        return {
          title: 'Accounts Master — Chart of Accounts & Party Ledgers',
          crumbs: ['Accounts & Ledgers', 'Accounts Master'],
        };
      case 'voucher-crv':
        return {
          title: 'Cash Receipt Voucher (CRV) — Double-Entry Datasheet',
          crumbs: ['Vouchers', 'Cash Receipt Voucher'],
        };
      case 'voucher-cpv':
        return {
          title: 'Cash Payment Voucher (CPV) — Double-Entry Datasheet',
          crumbs: ['Vouchers', 'Cash Payment Voucher'],
        };
      case 'voucher-brv':
        return {
          title: 'Bank Receipt Voucher (BRV) — Double-Entry Datasheet',
          crumbs: ['Vouchers', 'Bank Receipt Voucher'],
        };
      case 'voucher-bpv':
        return {
          title: 'Bank Payment Voucher (BPV) — Double-Entry Datasheet',
          crumbs: ['Vouchers', 'Bank Payment Voucher'],
        };
      case 'voucher-jv':
        return {
          title: 'Journal Voucher (JV) — Multi-Line General Journal Datasheet',
          crumbs: ['Vouchers', 'Journal Voucher'],
        };
      case 'voucher-cv':
        return {
          title: 'Contra Voucher (CV) — Cash & Bank Transfer Datasheet',
          crumbs: ['Vouchers', 'Contra Voucher'],
        };
      case 'payment-receive':
        return {
          title: 'Receive Payment — Customer & Party Receipt Voucher',
          crumbs: ['Payments', 'Receive Payment'],
        };
      case 'payment-customer-receipt':
        return {
          title: 'Customer Receipt — Counter & Credit Settlement',
          crumbs: ['Payments', 'Customer Receipt'],
        };
      case 'payment-cash':
        return {
          title: 'Cash Payment — Supplier & Expense Cash Voucher',
          crumbs: ['Payments', 'Cash Payment'],
        };
      case 'payment-bank':
        return {
          title: 'Bank Payment — Online / Cheque Payment Voucher',
          crumbs: ['Payments', 'Bank Payment'],
        };
      case 'tax-advance-accounting':
        return {
          title: 'Advance Tax Accounting — Ledger, Register & Reconciliation',
          crumbs: ['Tax', 'Advance Tax Accounting'],
        };
      case 'tax-settings':
        return {
          title: 'Advance Tax Settings — Configurable Filer / Non-Filer Rates',
          crumbs: ['Tax', 'Advance Tax Settings'],
        };
      case 'tax-summary':
        return {
          title: 'Tax Summary — Sales & Purchase Advance Tax + GST Statement',
          crumbs: ['Tax', 'Tax Summary'],
        };
      case 'tax-history':
        return {
          title: 'Tax History — Advance Tax Rate Change Audit Trail',
          crumbs: ['Tax', 'Tax History'],
        };
      case 'fin-trial-balance':
        return { title: 'Trial Balance — Double-Entry Verification', crumbs: ['Financial Reports', 'Trial Balance'] };
      case 'fin-profit-loss':
        return { title: 'Profit & Loss Statement (Income Statement)', crumbs: ['Financial Reports', 'Profit & Loss'] };
      case 'fin-balance-sheet':
        return { title: 'Balance Sheet — Assets, Liabilities & Equity', crumbs: ['Financial Reports', 'Balance Sheet'] };
      case 'fin-cash-flow':
        return { title: 'Cash Flow Statement — Cash & Bank Movements', crumbs: ['Financial Reports', 'Cash Flow'] };
      case 'fin-day-book':
        return { title: 'Day Book — Chronological Journal Register', crumbs: ['Financial Reports', 'Day Book'] };
      case 'fin-account-summary':
        return { title: 'Account Summary — Group & Pillar Summary', crumbs: ['Financial Reports', 'Account Summary'] };
      case 'fin-customer-outstanding':
        return { title: 'Customer Outstanding Receivables Report', crumbs: ['Financial Reports', 'Customer Outstanding'] };
      case 'fin-supplier-outstanding':
        return { title: 'Supplier Outstanding Payables Report', crumbs: ['Financial Reports', 'Supplier Outstanding'] };
      case 'fin-expense-summary':
        return { title: 'Expense Summary Report', crumbs: ['Financial Reports', 'Expense Summary'] };
      case 'fin-income-summary':
        return { title: 'Income Summary Report', crumbs: ['Financial Reports', 'Income Summary'] };
      case 'fin-advance-tax-report':
        return { title: 'Advance Tax Financial Report', crumbs: ['Financial Reports', 'Advance Tax Report'] };
      case 'report-daily-sales':
        return { title: 'Daily Sales Report', crumbs: ['Reports', 'Daily Sales'] };
      case 'report-monthly-sales':
        return { title: 'Monthly Sales Report', crumbs: ['Reports', 'Monthly Sales'] };
      case 'report-item-sales':
        return { title: 'Item-wise Sales Report', crumbs: ['Reports', 'Item-wise Sales'] };
      case 'report-customer-sales':
        return { title: 'Customer-wise Sales Report', crumbs: ['Reports', 'Customer-wise Sales'] };
      case 'report-profit':
        return { title: 'Profit & Margin Report', crumbs: ['Reports', 'Profit Report'] };
      case 'report-discount':
        return { title: 'Discount Report', crumbs: ['Reports', 'Discount Report'] };
      case 'report-sales-return':
        return { title: 'Sales Return Report', crumbs: ['Reports', 'Sales Return Report'] };
      case 'items':
        return {
          title: 'Items Master — Catalog & Inventory Valuation',
          crumbs: ['Purchases & Inventory', 'Items Master'],
        };
      case 'purchases':
        return {
          title: 'Purchases, Purchase Return & Configurable Advance Tax',
          crumbs: ['Purchases & Inventory', 'Purchases & Tax'],
        };
      case 'purchase-returns':
        return {
          title: 'Purchase Returns (Supplier Debit Notes & Tax Adjustments)',
          crumbs: ['Purchases & Inventory', 'Purchase Returns'],
        };
      case 'inventory':
        return {
          title: 'Inventory & Batch-Wise Stock Ledger (Box / Strip / Loose)',
          crumbs: ['Purchases & Inventory', 'Batch Stock'],
        };
      // INVENTORY (TASK 6)
      case 'inv-overview':
        return {
          title: 'Stock Overview — Inventory Valuation, Health & KPI Dashboard',
          crumbs: ['Inventory', 'Stock Overview'],
        };
      case 'inv-current':
        return {
          title: 'Current Stock — Consolidated Item-Level Inventory Summary',
          crumbs: ['Inventory', 'Current Stock'],
        };
      case 'inv-datasheet':
        return {
          title: 'Batch-wise Stock — 18-Column Spreadsheet Inventory Datasheet',
          crumbs: ['Inventory', 'Batch-wise Stock'],
        };
      case 'inv-expiry':
        return {
          title: 'Expiry Management — Pharmaceutical Batch Expiry Controls',
          crumbs: ['Inventory', 'Expiry Management'],
        };
      case 'inv-near-expiry':
        return {
          title: 'Near Expiry Items — 30/60/90 Day Early Warning Batches',
          crumbs: ['Inventory', 'Near Expiry Items'],
        };
      case 'inv-expired':
        return {
          title: 'Expired Items — Quarantine Register (Sale Blocked)',
          crumbs: ['Inventory', 'Expired Items'],
        };
      case 'inv-low-stock':
        return {
          title: 'Low Stock & Reorder Deficit Planning',
          crumbs: ['Inventory', 'Low Stock'],
        };
      case 'inv-adjustment':
        return {
          title: 'Stock Adjustment — Quantity Corrections & Damage Write-Offs',
          crumbs: ['Inventory', 'Stock Adjustment'],
        };
      case 'inv-transfer':
        return {
          title: 'Stock Transfer — Shelf & Location Movements',
          crumbs: ['Inventory', 'Stock Transfer'],
        };
      case 'inv-ledger':
        return {
          title: 'Stock Ledger — Chronological Item Movement & Running Balances',
          crumbs: ['Inventory', 'Stock Ledger'],
        };
      case 'inv-verification':
        return {
          title: 'Physical Stock Verification — Count Sheets & Audit Reconciliation',
          crumbs: ['Inventory', 'Physical Verification'],
        };
      case 'architecture':
        return {
          title: 'Core Architecture & Database Foundation',
          crumbs: ['Foundation', 'Architecture'],
        };
      case 'schema-registry':
        return {
          title: 'Database Schema & Relational Structure',
          crumbs: ['Foundation', 'Schemas'],
        };
      case 'system-settings':
        return {
          title: 'Store Profile, Professional Printing & System Administration',
          crumbs: ['System Admin', 'Store & Printing Settings'],
        };
      case 'backup-restore':
        return {
          title: 'Automatic Database Backup, Integrity Verification & Recovery',
          crumbs: ['System Admin', 'Backup & Restore'],
        };
      case 'system-admin':
        return {
          title: 'System Administration & Clear Demo Data',
          crumbs: ['System Admin', 'Clear Demo Data'],
        };
      case 'task1-report':
        return {
          title: 'Task 1 Sign-Off & Status Report',
          crumbs: ['Foundation', 'Completion Report'],
        };
      default:
        return { title: 'Abrar Medical Store ERP', crumbs: ['Workspace'] };
    }
  };

  const headerInfo = getHeaderInfo();
  const isTabPermitted = canAccessTab(activeTab);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-800 font-sans antialiased print:h-auto print:w-auto print:overflow-visible print:bg-white">
      {/* Expandable / Collapsible Left Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        databaseConnected={diagnostics?.connected ?? false}
        totalTables={tables.length}
        hasUnsavedInvoiceItems={hasUnsavedInvoiceItems}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0 print:h-auto print:overflow-visible print:block">
        <TopHeader
          currentViewTitle={headerInfo.title}
          breadcrumbs={headerInfo.crumbs}
          diagnostics={diagnostics}
          loading={loading}
          onRefresh={fetchSystemData}
          onNavigateToUsers={() => setActiveTab('users-manage')}
          onNavigateToAudit={() => setActiveTab('audit-logs')}
          onNavigateToClearDemoData={() => setActiveTab('system-admin')}
          compact={activeTab === 'sales-new' || activeTab === 'purchases'}
        />

        {/* Non-Destructive Quick Account & Voucher Shortcuts Bar (Hidden on full-screen invoice forms to maximize vertical workspace) */}
        {activeTab !== 'sales-new' &&
          activeTab !== 'purchases' &&
          (hasPermission('accounts') || hasPermission('ledgers') || hasPermission('payments')) && (
          <div className="bg-slate-900 border-b border-slate-800 px-3 py-1 flex items-center gap-1.5 overflow-x-auto shrink-0 print:hidden">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mr-1 shrink-0">
              Quick Shortcuts:
            </span>
            <button
              type="button"
              onClick={() => setQuickShortcut('customer-ledger')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <Users2 className="w-3 h-3 text-emerald-400" />
              Customer Ledger
            </button>
            <button
              type="button"
              onClick={() => setQuickShortcut('supplier-ledger')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <Building2 className="w-3 h-3 text-teal-400" />
              Supplier Ledger
            </button>
            <button
              type="button"
              onClick={() => setQuickShortcut('cash-ledger')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <Wallet className="w-3 h-3 text-amber-400" />
              Cash Book
            </button>
            <button
              type="button"
              onClick={() => setQuickShortcut('bank-ledger')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <CreditCard className="w-3 h-3 text-sky-400" />
              Bank Book
            </button>
            {hasPermission('payments', 'create') && (
              <>
                <button
                  type="button"
                  onClick={() => setQuickShortcut('receive-payment')}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Banknote className="w-3 h-3 text-emerald-400" />
                  Receive Payment
                </button>
                <button
                  type="button"
                  onClick={() => setQuickShortcut('make-payment')}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Banknote className="w-3 h-3 text-rose-400" />
                  Make Payment
                </button>
                <button
                  type="button"
                  onClick={() => setQuickShortcut('journal-voucher')}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3 h-3 text-purple-400" />
                  Journal Voucher
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setQuickShortcut('advance-tax-details')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <Percent className="w-3 h-3 text-amber-300" />
              Advance Tax Details
            </button>
          </div>
        )}

        <main
          className={`flex-1 min-h-0 ${
            activeTab === 'sales-new' || activeTab === 'purchases'
              ? 'p-0.5 overflow-hidden flex flex-col'
              : 'overflow-y-auto p-4 lg:p-5'
          }`}
        >
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                <div>
                  <div className="font-bold text-xs">Database / Backend Communication Notice</div>
                  <div className="text-xs text-rose-700 font-mono mt-0.5">{error}</div>
                </div>
              </div>
              <button
                onClick={fetchSystemData}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          )}

          {/* RBAC Guard: If user lacks permission for activeTab, block rendering */}
          {!isTabPermitted ? (
            <div className="max-w-lg mx-auto my-12 bg-white rounded-2xl border border-rose-200 p-6 text-center shadow-sm space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-slate-900">Access Restricted</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Your assigned role (<span className="font-bold text-slate-900">{user?.role}</span>) does not have permission to view this module. Please contact the Store Super Administrator if you require access.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>Return to Executive Dashboard</span>
              </button>
            </div>
          ) : (
            <>
              {/* EXECUTIVE DASHBOARD */}
              {activeTab === 'dashboard' && <DashboardView onSelectTab={setActiveTab} />}

              {/* USER MANAGEMENT & LOGS */}
              {activeTab === 'users-manage' && <UserManagementView />}
              {activeTab === 'audit-logs' && (
                <SecurityAuditView onNavigateToClearDemoData={() => setActiveTab('system-admin')} />
              )}

              {/* SALES & BILLING (Loaded on demand only when user visits, then kept mounted to prevent data loss) */}
              {hasPermission('sales') && hasVisitedSales && (
                <div className={activeTab === 'sales-new' ? 'flex-1 h-full flex flex-col min-h-0 overflow-hidden' : 'hidden'}>
                  <SalesInvoiceDatasheet
                    resumeInvoiceId={resumeInvoiceId}
                    onClearResume={() => setResumeInvoiceId(null)}
                    onDraftItemsStateChange={setHasUnsavedInvoiceItems}
                    onNavigateToSalesReturn={() => setActiveTab('sales-return')}
                  />
                </div>
              )}

              {activeTab === 'sales-register' && <SalesRegisterView mode="register" />}

              {activeTab === 'sales-held' && (
                <SalesRegisterView mode="held_or_draft" onResumeInvoice={handleResumeFromRegister} />
              )}

              {activeTab === 'sales-return' && <SalesReturnView initialMode="entry" />}

              {activeTab === 'sales-return-register' && <SalesReturnView initialMode="register" />}

              {/* SALESMAN, DELIVERYMAN & DELIVERY MANAGEMENT */}
              {activeTab === 'staff-salesmen' && (
                <StaffAndDeliveryWorkspaceView initialTab="salesmen" />
              )}
              {activeTab === 'staff-deliverymen' && (
                <StaffAndDeliveryWorkspaceView initialTab="deliverymen" />
              )}
              {activeTab === 'staff-deliveries' && (
                <StaffAndDeliveryWorkspaceView initialTab="deliveries" />
              )}

              {/* ACCOUNTS & LEDGERS (TASK 7) */}
              {activeTab === 'coa-hierarchy' && <ChartOfAccountsView />}
              {activeTab === 'ledger-customer' && <LedgersWorkspaceView initialTab="customer" />}
              {activeTab === 'ledger-supplier' && <LedgersWorkspaceView initialTab="supplier" />}
              {activeTab === 'ledger-general' && <LedgersWorkspaceView initialTab="general" />}
              {activeTab === 'ledger-cash' && <LedgersWorkspaceView initialTab="cash-book" />}
              {activeTab === 'ledger-bank' && <LedgersWorkspaceView initialTab="bank-book" />}
              {activeTab === 'ledger-statement' && <AccountLedgersView ledgerType="statement" />}
              {activeTab === 'accounts' && <AccountsMasterView />}

              {/* VOUCHERS & PAYMENTS (TASK 7) */}
              {activeTab === 'voucher-crv' && <VoucherManagementView initialVoucherType="CRV" />}
              {activeTab === 'voucher-cpv' && <VoucherManagementView initialVoucherType="CPV" />}
              {activeTab === 'voucher-brv' && <VoucherManagementView initialVoucherType="BRV" />}
              {activeTab === 'voucher-bpv' && <VoucherManagementView initialVoucherType="BPV" />}
              {activeTab === 'voucher-jv' && <VoucherManagementView initialVoucherType="JV" />}
              {activeTab === 'voucher-cv' && <VoucherManagementView initialVoucherType="CV" />}

              {activeTab === 'payment-receive' && (
                <PaymentsWorkspaceView initialVoucherType="receive_payment" />
              )}
              {activeTab === 'payment-customer-receipt' && (
                <PaymentsWorkspaceView initialVoucherType="customer_receipt" />
              )}
              {activeTab === 'payment-cash' && (
                <PaymentsWorkspaceView initialVoucherType="cash_payment" />
              )}
              {activeTab === 'payment-bank' && (
                <PaymentsWorkspaceView initialVoucherType="bank_payment" />
              )}

              {/* TAX & ADVANCE TAX ACCOUNTING */}
              {activeTab === 'tax-advance-accounting' && <AdvanceTaxAccountingView />}
              {activeTab === 'tax-settings' && <AdvanceTaxSettingsPanel />}
              {activeTab === 'tax-summary' && <SalesReportsView initialReport="tax-summary" />}
              {activeTab === 'tax-history' && <SalesReportsView initialReport="tax-history" />}

              {/* FINANCIAL REPORTS (TASK 7) */}
              {activeTab === 'fin-trial-balance' && (
                <FinancialReportsView initialReport="trial-balance" />
              )}
              {activeTab === 'fin-profit-loss' && (
                <FinancialReportsView initialReport="profit-loss" />
              )}
              {activeTab === 'fin-balance-sheet' && (
                <FinancialReportsView initialReport="balance-sheet" />
              )}
              {activeTab === 'fin-cash-flow' && <FinancialReportsView initialReport="cash-flow" />}
              {activeTab === 'fin-day-book' && <FinancialReportsView initialReport="day-book" />}
              {activeTab === 'fin-account-summary' && (
                <FinancialReportsView initialReport="account-summary" />
              )}
              {activeTab === 'fin-customer-outstanding' && (
                <FinancialReportsView initialReport="customer-outstanding" />
              )}
              {activeTab === 'fin-supplier-outstanding' && (
                <FinancialReportsView initialReport="supplier-outstanding" />
              )}
              {activeTab === 'fin-expense-summary' && (
                <FinancialReportsView initialReport="expense-summary" />
              )}
              {activeTab === 'fin-income-summary' && (
                <FinancialReportsView initialReport="income-summary" />
              )}
              {activeTab === 'fin-advance-tax-report' && (
                <FinancialReportsView initialReport="advance-tax-report" />
              )}

              {/* SALES & MARGIN REPORTS */}
              {activeTab === 'report-daily-sales' && (
                <SalesReportsView initialReport="daily-sales" />
              )}
              {activeTab === 'report-monthly-sales' && (
                <SalesReportsView initialReport="monthly-sales" />
              )}
              {activeTab === 'report-item-sales' && (
                <SalesReportsView initialReport="item-wise-sales" />
              )}
              {activeTab === 'report-customer-sales' && (
                <SalesReportsView initialReport="customer-wise-sales" />
              )}
              {activeTab === 'report-profit' && <SalesReportsView initialReport="profit-report" />}
              {activeTab === 'report-discount' && (
                <SalesReportsView initialReport="discount-report" />
              )}
              {activeTab === 'report-sales-return' && (
                <SalesReportsView initialReport="sales-return-report" />
              )}

              {/* PURCHASES & INVENTORY */}
              {activeTab === 'items' && <ItemsMasterView />}
              {activeTab === 'purchases' && (
                <div className="flex-1 h-full flex flex-col min-h-0 overflow-hidden">
                  <PurchasesWorkspaceView initialSubTab="new-invoice" />
                </div>
              )}
              {activeTab === 'purchase-returns' && (
                <PurchasesWorkspaceView initialSubTab="purchase-return" />
              )}
              {activeTab === 'inventory' && <PurchasesWorkspaceView initialSubTab="batch-stock" />}

              {/* INVENTORY MANAGEMENT & STOCK CONTROL (TASK 6) */}
              {(activeTab === 'inv-overview' ||
                activeTab === 'inv-current' ||
                activeTab === 'inv-datasheet' ||
                activeTab === 'inv-expiry' ||
                activeTab === 'inv-near-expiry' ||
                activeTab === 'inv-expired' ||
                activeTab === 'inv-low-stock' ||
                activeTab === 'inv-adjustment' ||
                activeTab === 'inv-transfer' ||
                activeTab === 'inv-ledger' ||
                activeTab === 'inv-verification') && (
                <InventoryWorkspaceView
                  initialSubTab={activeTab as any}
                  onSubTabChange={(tab) => setActiveTab(tab as any)}
                />
              )}

              {/* FOUNDATION */}
              {activeTab === 'architecture' && (
                <ArchitectureView
                  health={health}
                  diagnostics={diagnostics}
                  tables={tables}
                  onNavigateToSchema={() => setActiveTab('schema-registry')}
                  onNavigateToSettings={() => setActiveTab('system-settings')}
                  onNavigateToReport={() => setActiveTab('task1-report')}
                />
              )}
              {activeTab === 'schema-registry' && <SchemaExplorerView tables={tables} />}
              {activeTab === 'system-settings' && (
                <SystemSettingsView
                  key="system-settings"
                  settings={settings}
                  initialSubTab="store-printing"
                  onSettingsUpdated={(updated) => setSettings(updated)}
                  onNavigateToAuditLogs={() => setActiveTab('audit-logs')}
                />
              )}
              {activeTab === 'backup-restore' && (
                <SystemSettingsView
                  key="backup-restore"
                  settings={settings}
                  initialSubTab="backup-restore"
                  onSettingsUpdated={(updated) => setSettings(updated)}
                  onNavigateToAuditLogs={() => setActiveTab('audit-logs')}
                />
              )}
              {activeTab === 'system-admin' && (
                <SystemSettingsView
                  key="system-admin"
                  settings={settings}
                  initialSubTab="system-admin"
                  onSettingsUpdated={(updated) => setSettings(updated)}
                  onNavigateToAuditLogs={() => setActiveTab('audit-logs')}
                />
              )}
              {activeTab === 'task1-report' && (
                <TaskApprovalView
                  diagnostics={diagnostics}
                  tables={tables}
                  settings={settings}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Non-Destructive Quick Account & Voucher Modal Overlay */}
      <QuickAccountShortcutsModal
        isOpen={quickShortcut !== null}
        initialAction={quickShortcut || 'customer-ledger'}
        onClose={() => setQuickShortcut(null)}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
