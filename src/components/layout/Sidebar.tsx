import React, { useState } from 'react';
import {
  ShoppingCart,
  FileSpreadsheet,
  RotateCcw,
  PauseCircle,
  BookOpen,
  Users2,
  Wallet,
  Building2,
  Scale,
  FileText,
  Banknote,
  Receipt,
  CreditCard,
  Percent,
  History,
  BarChart3,
  Calendar,
  Package,
  TrendingUp,
  Tag,
  ShoppingBag,
  ArrowDownLeft,
  Boxes,
  Server,
  Database,
  Sliders,
  FileCheck2,
  ChevronDown,
  ChevronRight,
  UserCog,
  ShieldAlert,
  Users,
  Clock,
  AlertTriangle,
  ArrowRightLeft,
  Layers,
  LayoutDashboard,
  Truck,
  ClipboardCheck,
  HardDrive,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export type NavTabId =
  | 'dashboard'
  // SALES & BILLING
  | 'sales-new'
  | 'sales-register'
  | 'sales-return'
  | 'sales-return-register'
  | 'sales-held'
  // STAFF, SALESMAN & DELIVERY MANAGEMENT
  | 'staff-salesmen'
  | 'staff-deliverymen'
  | 'staff-deliveries'
  // ACCOUNTS & LEDGERS (TASK 7)
  | 'coa-hierarchy'
  | 'ledger-customer'
  | 'ledger-supplier'
  | 'ledger-cash'
  | 'ledger-bank'
  | 'ledger-general'
  | 'ledger-statement'
  | 'accounts'
  // VOUCHERS & PAYMENTS (TASK 7)
  | 'voucher-crv'
  | 'voucher-cpv'
  | 'voucher-brv'
  | 'voucher-bpv'
  | 'voucher-jv'
  | 'voucher-cv'
  | 'payment-receive'
  | 'payment-customer-receipt'
  | 'payment-cash'
  | 'payment-bank'
  // TAX & ADVANCE TAX ACCOUNTING
  | 'tax-advance-accounting'
  | 'tax-settings'
  | 'tax-summary'
  | 'tax-history'
  // FINANCIAL & SALES REPORTS (TASK 7)
  | 'fin-trial-balance'
  | 'fin-profit-loss'
  | 'fin-balance-sheet'
  | 'fin-cash-flow'
  | 'fin-day-book'
  | 'fin-account-summary'
  | 'fin-customer-outstanding'
  | 'fin-supplier-outstanding'
  | 'fin-expense-summary'
  | 'fin-income-summary'
  | 'fin-advance-tax-report'
  | 'report-daily-sales'
  | 'report-monthly-sales'
  | 'report-item-sales'
  | 'report-customer-sales'
  | 'report-profit'
  | 'report-discount'
  | 'report-sales-return'
  // PURCHASES & MASTER
  | 'purchases'
  | 'purchase-returns'
  | 'inventory'
  | 'items'
  // INVENTORY (TASK 6)
  | 'inv-overview'
  | 'inv-current'
  | 'inv-datasheet'
  | 'inv-expiry'
  | 'inv-near-expiry'
  | 'inv-expired'
  | 'inv-low-stock'
  | 'inv-adjustment'
  | 'inv-transfer'
  | 'inv-ledger'
  | 'inv-verification'
  // FOUNDATION & ADMIN
  | 'architecture'
  | 'schema-registry'
  | 'system-settings'
  | 'backup-restore'
  | 'system-admin'
  | 'task1-report'
  | 'sales'
  | 'sale-returns'
  | 'users'
  // USER MANAGEMENT & SECURITY
  | 'users-manage'
  | 'audit-logs';

interface SidebarProps {
  activeTab: NavTabId;
  onSelectTab: (tab: NavTabId) => void;
  databaseConnected: boolean;
  totalTables: number;
  hasUnsavedInvoiceItems?: boolean;
}

interface MenuGroup {
  id: string;
  title: string;
  badge?: string;
  items: Array<{
    id: NavTabId;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: string;
  }>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  databaseConnected,
  totalTables,
  hasUnsavedInvoiceItems,
}) => {
  const { user, hasPermission, isSuperAdmin } = useAuth();

  // Accordion state: by default on startup, ALL sidebar heads are collapsed (null)
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const toggleGroup = (groupId: string) => {
    setExpandedGroupId((current) => (current === groupId ? null : groupId));
  };

  const rawMenuGroups: (MenuGroup & { condition?: boolean })[] = [
    {
      id: 'user_management',
      title: 'USER MANAGEMENT',
      badge: 'Admin',
      condition: true,
      items: [
        ...(isSuperAdmin ? [{ id: 'users-manage' as NavTabId, label: 'Staff Accounts & Roles', icon: Users }] : []),
        { id: 'audit-logs', label: 'Security & Audit Logs', icon: ShieldAlert },
        { id: 'system-admin', label: 'Clear Demo Data', icon: Trash2 },
      ],
    },
    {
      id: 'sales_billing',
      title: 'SALES & BILLING',
      badge: 'POS',
      condition: hasPermission('sales') || hasPermission('sale_returns'),
      items: [
        {
          id: 'sales-new',
          label: 'New Sales Invoice',
          icon: ShoppingCart,
          badge: hasUnsavedInvoiceItems ? 'Active' : undefined,
        },
        { id: 'sales-register', label: 'Sales Register', icon: FileSpreadsheet },
        { id: 'sales-return', label: 'Sales Return', icon: RotateCcw },
        { id: 'sales-return-register', label: 'Sales Return Register', icon: FileText },
        { id: 'sales-held', label: 'Held / Draft Invoices', icon: PauseCircle },
      ],
    },
    {
      id: 'staff_delivery',
      title: 'SALESMAN & DELIVERY',
      badge: 'Staff',
      condition: hasPermission('sales') || hasPermission('reports') || isSuperAdmin,
      items: [
        { id: 'staff-salesmen', label: 'Salesman & Commissions', icon: UserCog },
        { id: 'staff-deliverymen', label: 'Deliveryman Directory', icon: Truck },
        { id: 'staff-deliveries', label: 'Delivery Dispatch & Reports', icon: ClipboardCheck },
      ],
    },
    {
      id: 'accounts',
      title: 'ACCOUNTS & LEDGERS',
      badge: 'GL',
      condition: hasPermission('accounts') || hasPermission('ledgers'),
      items: [
        { id: 'coa-hierarchy', label: 'Chart of Accounts (5-Pillar)', icon: BookOpen },
        { id: 'ledger-customer', label: 'Customer Ledger', icon: Users2 },
        { id: 'ledger-supplier', label: 'Supplier Ledger', icon: Building2 },
        { id: 'ledger-general', label: 'General Ledger (GL)', icon: Scale },
        { id: 'ledger-cash', label: 'Cash Book (Daily Cash)', icon: Wallet },
        { id: 'ledger-bank', label: 'Bank Book', icon: CreditCard },
        { id: 'accounts', label: 'Party & Account Master', icon: FileText },
      ],
    },
    {
      id: 'payments',
      title: 'VOUCHERS & PAYMENTS',
      badge: 'Double-Entry',
      condition: hasPermission('payments') || hasPermission('accounts'),
      items: [
        { id: 'voucher-crv', label: 'Cash Receipt Voucher (CRV)', icon: Banknote },
        { id: 'voucher-cpv', label: 'Cash Payment Voucher (CPV)', icon: Wallet },
        { id: 'voucher-brv', label: 'Bank Receipt Voucher (BRV)', icon: Receipt },
        { id: 'voucher-bpv', label: 'Bank Payment Voucher (BPV)', icon: CreditCard },
        { id: 'voucher-jv', label: 'Journal Voucher (JV)', icon: FileSpreadsheet },
        { id: 'voucher-cv', label: 'Contra Voucher (Cash/Bank)', icon: ArrowRightLeft },
        { id: 'payment-receive', label: 'Quick Party Receipt/Payment', icon: Banknote },
      ],
    },
    {
      id: 'tax',
      title: 'ADVANCE TAX & GST',
      condition: hasPermission('tax') || hasPermission('accounts'),
      items: [
        { id: 'tax-advance-accounting', label: 'Advance Tax Ledger & Recon', icon: Scale },
        { id: 'tax-settings', label: 'Advance Tax Settings', icon: Percent },
        { id: 'tax-summary', label: 'Sales & Purchase Tax Summary', icon: BarChart3 },
        { id: 'tax-history', label: 'Tax Rate History', icon: History },
      ],
    },
    {
      id: 'financial_reports',
      title: 'FINANCIAL REPORTS',
      badge: '11 Reports',
      condition: hasPermission('reports') || hasPermission('accounts'),
      items: [
        { id: 'fin-trial-balance', label: 'Trial Balance', icon: Scale },
        { id: 'fin-profit-loss', label: 'Profit & Loss Statement', icon: TrendingUp },
        { id: 'fin-balance-sheet', label: 'Balance Sheet', icon: Building2 },
        { id: 'fin-cash-flow', label: 'Cash Flow Statement', icon: Wallet },
        { id: 'fin-day-book', label: 'Day Book (Journal Register)', icon: BookOpen },
        { id: 'fin-account-summary', label: 'Account Summary', icon: FileSpreadsheet },
        { id: 'fin-customer-outstanding', label: 'Customer Outstanding', icon: Users2 },
        { id: 'fin-supplier-outstanding', label: 'Supplier Outstanding', icon: Building2 },
        { id: 'fin-expense-summary', label: 'Expense Summary', icon: ArrowDownLeft },
        { id: 'fin-income-summary', label: 'Income Summary', icon: TrendingUp },
        { id: 'fin-advance-tax-report', label: 'Advance Tax Report', icon: Percent },
      ],
    },
    {
      id: 'reports',
      title: 'SALES & MARGIN REPORTS',
      condition: hasPermission('reports'),
      items: [
        { id: 'report-daily-sales', label: 'Daily Sales', icon: Calendar },
        { id: 'report-monthly-sales', label: 'Monthly Sales', icon: BarChart3 },
        { id: 'report-item-sales', label: 'Item-wise Sales', icon: Package },
        { id: 'report-customer-sales', label: 'Customer-wise Sales', icon: Users2 },
        { id: 'report-profit', label: 'Profit Report', icon: TrendingUp },
        { id: 'report-discount', label: 'Discount Report', icon: Tag },
        { id: 'report-sales-return', label: 'Sales Return Report', icon: RotateCcw },
      ],
    },
    {
      id: 'inventory_stock',
      title: 'INVENTORY',
      badge: 'Stock',
      condition:
        hasPermission('inventory') ||
        hasPermission('items') ||
        isSuperAdmin ||
        user?.role === 'Administrator',
      items: [
        { id: 'inv-overview', label: 'Stock Overview', icon: Boxes },
        { id: 'inv-current', label: 'Current Stock', icon: Layers },
        { id: 'inv-datasheet', label: 'Batch-wise Stock', icon: FileSpreadsheet },
        { id: 'inv-expiry', label: 'Expiry Management', icon: Clock },
        { id: 'inv-near-expiry', label: 'Near Expiry Items', icon: AlertTriangle },
        { id: 'inv-expired', label: 'Expired Items', icon: ShieldAlert },
        { id: 'inv-low-stock', label: 'Low Stock', icon: ArrowDownLeft },
        { id: 'inv-adjustment', label: 'Stock Adjustment', icon: Sliders },
        { id: 'inv-transfer', label: 'Stock Transfer', icon: ArrowRightLeft },
        { id: 'inv-ledger', label: 'Stock Ledger', icon: Calendar },
        { id: 'inv-verification', label: 'Physical Stock Verification', icon: FileCheck2 },
      ],
    },
    {
      id: 'purchases_inventory',
      title: 'PURCHASES & INVENTORY',
      condition:
        hasPermission('purchases') ||
        hasPermission('purchase_returns') ||
        hasPermission('items') ||
        hasPermission('inventory'),
      items: [
        { id: 'purchases', label: 'Purchases & Advance Tax', icon: ShoppingBag },
        { id: 'purchase-returns', label: 'Purchase Returns', icon: ArrowDownLeft },
        { id: 'inventory', label: 'Inventory & Batches', icon: Boxes },
        { id: 'items', label: 'Items Master', icon: Package },
      ],
    },
    {
      id: 'foundation',
      title: 'SYSTEM ADMIN & BACKUP',
      badge: 'Admin',
      condition: true,
      items: [
        { id: 'system-admin', label: 'Clear Demo Data', icon: Trash2 },
        { id: 'audit-logs', label: 'System & Audit Logs', icon: ShieldAlert },
        { id: 'system-settings', label: 'Store & Printing Settings', icon: Sliders },
        { id: 'backup-restore', label: 'Database Backup & Restore', icon: HardDrive },
        { id: 'architecture', label: 'Core Architecture', icon: Server },
        { id: 'schema-registry', label: `Database Schemas (${totalTables || 33})`, icon: Database },
        { id: 'task1-report', label: 'Task 1 Sign-off Report', icon: FileCheck2 },
      ],
    },
  ];

  const menuGroups = rawMenuGroups.filter((g) => g.condition !== false);

  return (
    <aside className="w-64 bg-slate-900 text-slate-200 flex flex-col h-screen shrink-0 border-r border-slate-800 select-none print:hidden">
      {/* Brand Header */}
      <div className="px-3.5 py-2.5 border-b border-slate-800/80 bg-slate-950/60 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white shadow-sm font-bold text-xs tracking-wider shrink-0">
          AMS
        </div>
        <div className="overflow-hidden">
          <h2 className="text-xs font-bold text-white tracking-tight truncate uppercase">
            ABRAR MEDICAL STORE
          </h2>
          <p className="text-[10px] text-emerald-400 font-medium truncate flex items-center gap-1 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            {user ? `${user.role} • @${user.username}` : 'ERP & Pharmacy POS'}
          </p>
        </div>
      </div>

      {/* Dedicated Top Executive Dashboard Button */}
      <div className="px-2 pt-2 pb-1 shrink-0">
        <button
          type="button"
          onClick={() => {
            onSelectTab('dashboard');
            setExpandedGroupId(null);
          }}
          className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between text-xs font-bold transition-all cursor-pointer shadow-xs ${
            activeTab === 'dashboard'
              ? 'bg-emerald-600 text-white shadow-emerald-950/40'
              : 'bg-slate-900/90 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800/80'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <LayoutDashboard
              className={`w-4 h-4 shrink-0 ${
                activeTab === 'dashboard' ? 'text-white' : 'text-emerald-400'
              }`}
            />
            <span className="truncate tracking-wide uppercase text-[11px] font-bold">
              Executive Dashboard
            </span>
          </div>
          <span
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
              activeTab === 'dashboard'
                ? 'bg-white/20 text-white'
                : 'bg-emerald-950 border border-emerald-700 text-emerald-300'
            }`}
          >
            HOME
          </span>
        </button>
      </div>

      {/* Expandable / Collapsible Sectional Menu (Accordion: Only 1 section open, all collapsed by default) */}
      <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-1">
        {menuGroups.map((group) => {
          const isExpanded = expandedGroupId === group.id;
          const hasActiveChild = group.items.some((i) => i.id === activeTab);

          return (
            <div
              key={group.id}
              className="rounded-lg bg-slate-900/60 border border-slate-800/70 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={`w-full px-2.5 py-1.5 flex items-center justify-between text-left transition-colors cursor-pointer ${
                  hasActiveChild
                    ? 'bg-slate-800/90 text-emerald-400'
                    : 'bg-slate-900/40 text-slate-300 hover:bg-slate-800/60 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  )}
                  <span className="text-[11px] font-bold tracking-wider uppercase truncate">
                    {group.title}
                  </span>
                </div>
                {group.badge && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300 font-bold">
                    {group.badge}
                  </span>
                )}
              </button>

              {isExpanded && (
                <nav className="p-1 space-y-0.5 bg-slate-950/30 border-t border-slate-800/60">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={`${group.id}-${item.id}`}
                        type="button"
                        onClick={() => onSelectTab(item.id)}
                        className={`w-full text-left px-2.5 py-1.5 rounded-md flex items-center justify-between text-xs font-medium transition-all cursor-pointer ${
                          isActive
                            ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                            : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isActive ? 'text-white' : 'text-emerald-400/80'
                            }`}
                          />
                          <span className="truncate">{item.label}</span>
                        </div>
                        {item.badge && (
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ml-1 ${
                              isActive
                                ? 'bg-white/20 text-white'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </nav>
              )}
            </div>
          );
        })}
      </div>

      {/* Sidebar Footer */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/90 text-[11px]">
        <div className="flex items-center justify-between text-slate-400">
          <span>DB Engine:</span>
          <span className="font-mono text-emerald-400 font-semibold flex items-center gap-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                databaseConnected ? 'bg-emerald-400' : 'bg-rose-400'
              }`}
            />
            {databaseConnected ? 'SQLite WAL' : 'Offline'}
          </span>
        </div>
        <div className="flex items-center justify-between text-slate-400 mt-1">
          <span>Currency / TZ:</span>
          <span className="font-mono text-slate-200 font-semibold">PKR • UTC+5</span>
        </div>
      </div>
    </aside>
  );
};
