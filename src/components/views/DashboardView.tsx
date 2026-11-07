import React, { useState, useEffect, useCallback } from 'react';
import {
  ShoppingCart,
  Package,
  Boxes,
  ShoppingBag,
  BookOpen,
  Users2,
  Building2,
  Scale,
  Percent,
  BarChart3,
  Users,
  ShieldCheck,
  AlertTriangle,
  Clock,
  RotateCcw,
  ArrowDownLeft,
  Wallet,
  CreditCard,
  TrendingUp,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { NavTabId } from '../layout/Sidebar';
import { formatPKR } from '../../utils/formatters';

interface DashboardViewProps {
  onSelectTab: (tab: NavTabId) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onSelectTab }) => {
  const { user, hasPermission, isSuperAdmin } = useAuth();

  const [loading, setLoading] = useState<boolean>(true);
  const [inventoryOverview, setInventoryOverview] = useState<any | null>(null);
  const [salesCount, setSalesCount] = useState<number>(0);
  const [salesTotal, setSalesTotal] = useState<number>(0);
  const [purchasesCount, setPurchasesCount] = useState<number>(0);
  const [purchasesTotal, setPurchasesTotal] = useState<number>(0);
  const [accountsSummary, setAccountsSummary] = useState<{
    cashBalance: number;
    bankBalance: number;
    receivables: number;
    payables: number;
    totalAccounts: number;
  }>({
    cashBalance: 0,
    bankBalance: 0,
    receivables: 0,
    payables: 0,
    totalAccounts: 0,
  });

  const fetchDashboardMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const promises: Promise<any>[] = [];

      // 1. Inventory Overview (if permitted)
      if (hasPermission('inventory') || hasPermission('items') || hasPermission('sales') || hasPermission('purchases')) {
        promises.push(
          api
            .getInventoryOverview()
            .then((res) => setInventoryOverview(res.overview))
            .catch(() => null)
        );
      }

      // 2. Sales Summary (if permitted)
      if (hasPermission('sales')) {
        promises.push(
          api
            .getSales({ status: 'Confirmed' })
            .then((res) => {
              const list = res.sales || res.data || [];
              setSalesCount(list.length);
              const sum = list.reduce((acc: number, s: any) => acc + Number(s.net_payable || 0), 0);
              setSalesTotal(sum);
            })
            .catch(() => null)
        );
      }

      // 3. Purchases Summary (if permitted)
      if (hasPermission('purchases')) {
        promises.push(
          api
            .getPurchases({ status: 'Confirmed' })
            .then((res) => {
              const list = res.purchases || res.data || [];
              setPurchasesCount(list.length);
              const sum = list.reduce((acc: number, p: any) => acc + Number(p.total_payable || 0), 0);
              setPurchasesTotal(sum);
            })
            .catch(() => null)
        );
      }

      // 4. Accounts Summary (if permitted)
      if (hasPermission('accounts') || hasPermission('ledgers') || hasPermission('sales') || hasPermission('purchases')) {
        promises.push(
          api
            .getAccounts()
            .then((res) => {
              const accs: any[] = res.data || res.accounts || [];
              let cashBalance = 0;
              let bankBalance = 0;
              let receivables = 0;
              let payables = 0;

              for (const a of accs) {
                if (a.is_system_account && ['ACC-1000', 'ACC-2000', 'ACC-3000', 'FIN-1020'].includes(a.account_code)) {
                  continue;
                }
                const bal = Number(a.current_balance || 0);
                const sign = a.current_balance_type === 'Credit' ? -1 : 1;
                const signedDr = bal * sign;

                if (a.account_group === 'Cash in Hand') {
                  cashBalance += signedDr;
                } else if (a.account_group === 'Bank') {
                  bankBalance += signedDr;
                } else if (a.account_group === 'Customer' && signedDr > 0) {
                  receivables += signedDr;
                } else if (a.account_group === 'Supplier' && signedDr < 0) {
                  payables += Math.abs(signedDr);
                }
              }

              setAccountsSummary({
                cashBalance,
                bankBalance,
                receivables,
                payables,
                totalAccounts: accs.length,
              });
            })
            .catch(() => null)
        );
      }

      await Promise.all(promises);
    } finally {
      setLoading(false);
    }
  }, [hasPermission]);

  useEffect(() => {
    fetchDashboardMetrics();
  }, [fetchDashboardMetrics]);

  const allModuleCards: Array<{
    id: NavTabId;
    title: string;
    subtitle: string;
    badge: string;
    icon: React.FC<{ className?: string }>;
    color: string;
    visible: boolean;
  }> = [
    {
      id: 'sales-new',
      title: 'Sales & POS Billing',
      subtitle: '14-column medical billing datasheet, barcode scan & thermal receipt',
      badge: 'POS Counter',
      icon: ShoppingCart,
      color: 'from-emerald-600 to-teal-700',
      visible: hasPermission('sales'),
    },
    {
      id: 'sales-return',
      title: 'Sales Return',
      subtitle: 'Invoice-linked medicine return, batch restoration & credit notes',
      badge: 'Returns',
      icon: RotateCcw,
      color: 'from-amber-600 to-orange-700',
      visible: hasPermission('sale_returns') || hasPermission('sales'),
    },
    {
      id: 'items',
      title: 'Items Master Catalog',
      subtitle: 'Medicine catalog, packing conversion, rack locations & pricing',
      badge: `${inventoryOverview?.totalActiveItems ?? 12} Items`,
      icon: Package,
      color: 'from-blue-600 to-indigo-700',
      visible: hasPermission('items') || hasPermission('inventory'),
    },
    {
      id: 'inv-overview',
      title: 'Inventory & Batch Stock',
      subtitle: '18-column batch datasheet, expiry alerts, stock ledger & verification',
      badge: 'Batch Control',
      icon: Boxes,
      color: 'from-teal-600 to-cyan-700',
      visible: hasPermission('inventory') || hasPermission('items'),
    },
    {
      id: 'purchases',
      title: 'Purchases & Advance Tax',
      subtitle: 'Supplier goods receipt, batch creation & u/s 236H tax calculation',
      badge: 'Procurement',
      icon: ShoppingBag,
      color: 'from-violet-600 to-purple-700',
      visible: hasPermission('purchases'),
    },
    {
      id: 'purchase-returns',
      title: 'Purchase Return',
      subtitle: 'Supplier debit notes, batch deduction & input tax reversal',
      badge: 'Debit Note',
      icon: ArrowDownLeft,
      color: 'from-rose-600 to-pink-700',
      visible: hasPermission('purchase_returns') || hasPermission('purchases'),
    },
    {
      id: 'coa-hierarchy',
      title: 'Accounts & 5-Pillar COA',
      subtitle: 'Assets, Liabilities, Capital, Income, Expenses & Party Accounts',
      badge: `${accountsSummary.totalAccounts || 28} Accounts`,
      icon: BookOpen,
      color: 'from-slate-700 to-slate-900',
      visible: hasPermission('accounts') || hasPermission('ledgers'),
    },
    {
      id: 'ledger-customer',
      title: 'Customer, Supplier & GL Ledgers',
      subtitle: 'Customer Ledger, Supplier Ledger, General Ledger, Cash & Bank Books',
      badge: 'Double-Entry',
      icon: Scale,
      color: 'from-cyan-700 to-blue-800',
      visible: hasPermission('ledgers') || hasPermission('accounts'),
    },
    {
      id: 'voucher-jv',
      title: 'Voucher Management',
      subtitle: 'CRV, CPV, BRV, BPV, Journal Voucher (JV) & Contra Vouchers',
      badge: '6 Voucher Types',
      icon: Wallet,
      color: 'from-emerald-700 to-green-800',
      visible: hasPermission('payments') || hasPermission('accounts'),
    },
    {
      id: 'fin-trial-balance',
      title: 'Financial & Sales Reports',
      subtitle: 'Trial Balance, P&L, Balance Sheet, Cash Flow, Day Book & Sales Reports',
      badge: '18 Reports',
      icon: BarChart3,
      color: 'from-indigo-700 to-slate-900',
      visible: hasPermission('reports') || hasPermission('accounts'),
    },
    {
      id: 'tax-settings',
      title: 'Advance Tax Settings & Ledger',
      subtitle: 'Configurable Filer/Non-Filer rates, tax register & reconciliation',
      badge: 'FBR Tax',
      icon: Percent,
      color: 'from-amber-700 to-yellow-800',
      visible: hasPermission('tax') || hasPermission('accounts'),
    },
    {
      id: 'users-manage',
      title: 'User Management & Security',
      subtitle: 'Staff accounts, 6 ERP roles, module permissions & login audit logs',
      badge: 'Super Admin',
      icon: Users,
      color: 'from-purple-700 to-fuchsia-900',
      visible: isSuperAdmin,
    },
  ];
  const moduleCards = allModuleCards.filter((m) => m.visible);

  return (
    <div className="space-y-4">
      {/* Authenticated Welcome & Session Status Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-xl p-5 text-white border border-slate-700 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Authenticated Session Active
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-white border border-white/15">
              Role: {user?.role}
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight">
            Welcome to ABRAR MEDICAL STORE ERP, {user?.full_name} (@{user?.username})
          </h2>
          <p className="text-xs text-slate-300 max-w-3xl">
            All ERP modules, batch inventory controls, POS billing datasheets, and double-entry accounting ledgers are unlocked according to your assigned{' '}
            <span className="font-bold text-emerald-300">{user?.role}</span> role permissions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {hasPermission('sales') && (
            <button
              type="button"
              onClick={() => onSelectTab('sales-new')}
              className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>Open POS Billing</span>
            </button>
          )}
          <button
            type="button"
            onClick={fetchDashboardMetrics}
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5 border border-white/15 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh KPIs</span>
          </button>
        </div>
      </div>

      {/* Live Financial & Inventory KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Stock Valuation</span>
            <Boxes className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-base font-bold text-slate-900 font-mono mt-1">
            {formatPKR(inventoryOverview?.totalStockCostValue || 0)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {inventoryOverview?.totalActiveBatches ?? 0} Active Batches
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Confirmed Sales</span>
            <TrendingUp className="w-4 h-4 text-teal-600" />
          </div>
          <div className="text-base font-bold text-slate-900 font-mono mt-1">
            {formatPKR(salesTotal)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {salesCount} Confirmed Invoices
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Purchases Posted</span>
            <ShoppingBag className="w-4 h-4 text-violet-600" />
          </div>
          <div className="text-base font-bold text-slate-900 font-mono mt-1">
            {formatPKR(purchasesTotal)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {purchasesCount} Supplier Bills
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Cash & Bank</span>
            <Wallet className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-base font-bold text-slate-900 font-mono mt-1">
            {formatPKR(accountsSummary.cashBalance + accountsSummary.bankBalance)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Cash: {formatPKR(accountsSummary.cashBalance)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Receivables / Payables</span>
            <Users2 className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xs font-bold text-emerald-700 font-mono mt-1">
            Dr: {formatPKR(accountsSummary.receivables)}
          </div>
          <div className="text-xs font-bold text-rose-700 font-mono mt-0.5">
            Cr: {formatPKR(accountsSummary.payables)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Stock & Expiry Alerts</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold">
              {inventoryOverview?.lowStockItemsCount ?? 0} Low Stock
            </span>
            <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 text-xs font-bold">
              {(inventoryOverview?.expiring90Count ?? 0) + (inventoryOverview?.expiredCount ?? 0)} Expiry
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Real-time batch monitoring
          </div>
        </div>
      </div>

      {/* Complete ERP Modules Grid (Filtered by User Role Permissions) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Abrar Medical Store — Authorized ERP Modules ({moduleCards.length})
            </h3>
            <p className="text-xs text-slate-500">
              Select any module below or use the expandable left sidebar menu to navigate.
            </p>
          </div>
          <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            RBAC Verified
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {moduleCards.map((mod) => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => onSelectTab(mod.id)}
                className="group text-left p-4 rounded-xl border border-slate-200 hover:border-emerald-500 bg-slate-50/50 hover:bg-white transition-all shadow-2xs hover:shadow-md flex flex-col justify-between cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div
                      className={`w-9 h-9 rounded-lg bg-gradient-to-br ${mod.color} text-white flex items-center justify-center shadow-xs`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200/80 text-slate-700 font-mono">
                      {mod.badge}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">
                    {mod.title}
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    {mod.subtitle}
                  </p>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-200/70 flex items-center justify-between text-[11px] font-bold text-emerald-700">
                  <span>Open Module</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
