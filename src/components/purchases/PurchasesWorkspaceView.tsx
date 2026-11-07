import React, { useState, useEffect, useCallback } from 'react';
import {
  ShoppingBag,
  Plus,
  Trash2,
  Save,
  Printer,
  Edit2,
  XCircle,
  ArrowDownLeft,
  Boxes,
  Sliders,
  FileSpreadsheet,
  ListChecks,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  Scale,
  Search,
  Barcode,
  Minus,
  Zap,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ShoppingCart,
  Banknote,
} from 'lucide-react';
import { Item } from '../../types/item';
import { Account, FilerStatus } from '../../types/account';
import {
  AdvanceTaxSettings,
  AdvanceTaxHistoryEntry,
  PurchaseInvoice,
  PurchaseLineItem,
  PurchaseReturn,
  PurchaseReturnLineItem,
  BatchInventoryItem,
  PurchasePaymentMode,
  JournalEntryLineView,
} from '../../types/purchase';
import { api } from '../../services/api';
import { formatPKR } from '../../utils/formatters';
import { PurchasePrintModal } from './PurchasePrintModal';
import { AdvanceTaxSettingsPanel } from './AdvanceTaxSettingsPanel';
import { BatchInventoryPanel } from './BatchInventoryPanel';
import { PurchaseReturnPanel } from './PurchaseReturnPanel';
import { PurchaseReportsPanel } from './PurchaseReportsPanel';
import { NumericInput } from '../common/NumericInput';

export type PurchaseSubTab =
  | 'new-invoice'
  | 'register'
  | 'purchase-return'
  | 'batch-stock'
  | 'advance-tax'
  | 'reports';

interface PurchasesWorkspaceViewProps {
  initialSubTab?: PurchaseSubTab;
}

const round2 = (n: number) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

function parseUnitsPerPack(packing?: string): number {
  const clean = (packing || '1x1').trim();
  const m = clean.match(/^(\d+)\s*[xX*]\s*(\d+)/);
  if (m) {
    return Math.max(1, (parseInt(m[1], 10) || 1) * (parseInt(m[2], 10) || 1));
  }
  const s = clean.match(/^(\d+)/);
  if (s) return Math.max(1, parseInt(s[1], 10) || 1);
  return 1;
}

export const PurchasesWorkspaceView: React.FC<PurchasesWorkspaceViewProps> = ({
  initialSubTab = 'new-invoice',
}) => {
  const [subTab, setSubTab] = useState<PurchaseSubTab>(initialSubTab);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  // Master Data & Tax Settings
  const [items, setItems] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<Account[]>([]);
  const [financialAccounts, setFinancialAccounts] = useState<Account[]>([]);
  const [taxSettings, setTaxSettings] = useState<AdvanceTaxSettings | null>(null);
  const [taxHistory, setTaxHistory] = useState<AdvanceTaxHistoryEntry[]>([]);

  // Transactions & Stock Lists
  const [purchases, setPurchases] = useState<PurchaseInvoice[]>([]);
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [batches, setBatches] = useState<BatchInventoryItem[]>([]);
  const [nextPurchaseNo, setNextPurchaseNo] = useState('PUR-2026-0001');
  const [nextReturnNo, setNextReturnNo] = useState('PRN-2026-0001');
  const [loading, setLoading] = useState(false);

  // Purchase Invoice Form State
  const [editingPurchaseId, setEditingPurchaseId] = useState<number | null>(null);
  const [billNumber, setBillNumber] = useState('PUR-2026-0001');
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState<string>('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [supplierFilerStatus, setSupplierFilerStatus] = useState<FilerStatus>('Filer');
  const [notes, setNotes] = useState('');

  // Discounts, Tax Override & Payment
  const [invoiceDiscountPercent, setInvoiceDiscountPercent] = useState<number>(0);
  const [invoiceDiscountAmount, setInvoiceDiscountAmount] = useState<number>(0);
  const [isTaxOverridden, setIsTaxOverridden] = useState<boolean>(false);
  const [customAdvanceTaxRate, setCustomAdvanceTaxRate] = useState<number>(0.5);
  const [taxOverrideReason, setTaxOverrideReason] = useState<string>('');
  const [taxOverrideAuthorizedBy, setTaxOverrideAuthorizedBy] = useState<string>(
    'Chief Pharmacist / Admin'
  );
  const [paymentMode, setPaymentMode] = useState<PurchasePaymentMode>('Credit');
  const [paymentAccountId, setPaymentAccountId] = useState<string>('');
  const [paidAmount, setPaidAmount] = useState<number>(0);

  // Line Items State
  const createBlankLine = (): PurchaseLineItem => ({
    item_id: 0,
    item_code: '',
    company_name: '',
    item_name: '',
    packing: '1x1',
    units_per_pack: 1,
    batch_number: '',
    manufacturing_date: '2026-01-01',
    expiry_date: '2028-01-01',
    quantity: 0,
    bonus_quantity: 0,
    purchase_rate: 0,
    mrp_rate: 0,
    gross_amount: 0,
    discount_percent: 0,
    discount_amount: 0,
    taxable_amount: 0,
    tax_percent: 0,
    tax_amount: 0,
    line_total: 0,
  });

  const [lines, setLines] = useState<PurchaseLineItem[]>([createBlankLine()]);

  // TWO INDEPENDENT INVOICE INTERFACES: Option 1 (POS View) vs Option 2 (MS Access View)
  const [purchaseViewMode, setPurchaseViewMode] = useState<'pos' | 'access'>(() => {
    try {
      const saved = localStorage.getItem('ams_purchase_invoice_view_mode');
      return saved === 'access' ? 'access' : 'pos';
    } catch {
      return 'pos';
    }
  });

  const togglePurchaseViewMode = (mode: 'pos' | 'access') => {
    setPurchaseViewMode(mode);
    try {
      localStorage.setItem('ams_purchase_invoice_view_mode', mode);
    } catch {}
  };

  const [selectedPurchaseLineIndex, setSelectedPurchaseLineIndex] = useState<number>(0);
  const [purchaseSearchQuery, setPurchaseSearchQuery] = useState<string>('');
  const [purchaseSearchResults, setPurchaseSearchResults] = useState<Item[]>([]);
  const [showPurchaseSearchDropdown, setShowPurchaseSearchDropdown] = useState<boolean>(false);

  const [savingInvoice, setSavingInvoice] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Print Modal State
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printMode, setPrintMode] = useState<'invoice' | 'return'>('invoice');
  const [printInvoice, setPrintInvoice] = useState<PurchaseInvoice | null>(null);
  const [printInvoiceItems, setPrintInvoiceItems] = useState<PurchaseLineItem[]>([]);
  const [printReturn, setPrintReturn] = useState<PurchaseReturn | null>(null);
  const [printReturnItems, setPrintReturnItems] = useState<PurchaseReturnLineItem[]>([]);
  const [printJournalLines, setPrintJournalLines] = useState<JournalEntryLineView[]>([]);

  // Load Master Data & Transactions
  const fetchWorkspaceData = useCallback(async () => {
    try {
      setLoading(true);
      const [
        itemsRes,
        accountsRes,
        taxRes,
        nextNumsRes,
        purchasesRes,
        returnsRes,
        batchesRes,
      ] = await Promise.all([
        api.getItems({ status: 'Active' }),
        api.getAccounts({ status: 'Active' }),
        api.getAdvanceTaxSettings(),
        api.getNextPurchaseNumbers(),
        api.getPurchases(),
        api.getPurchaseReturns(),
        api.getInventoryBatches(),
      ]);

      setItems(itemsRes.items || []);
      const allAccounts: Account[] = accountsRes.accounts || [];
      const supList = allAccounts.filter(
        (a) =>
          ['Supplier', 'Customer & Supplier'].includes(a.account_group) && a.is_system_account === 0
      );
      setSuppliers(supList);

      const finList = allAccounts.filter((a) =>
        ['Cash in Hand', 'Bank'].includes(a.account_group)
      );
      setFinancialAccounts(finList);

      setTaxSettings(taxRes.settings);
      setTaxHistory(taxRes.history || []);
      setNextPurchaseNo(nextNumsRes.nextPurchaseNumber);
      setNextReturnNo(nextNumsRes.nextReturnNumber);
      if (!editingPurchaseId) {
        setBillNumber(nextNumsRes.nextPurchaseNumber);
      }

      setPurchases(purchasesRes.purchases || []);
      setReturns(returnsRes.returns || []);
      setBatches(batchesRes.batches || []);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [editingPurchaseId]);

  useEffect(() => {
    fetchWorkspaceData();
  }, [fetchWorkspaceData]);

  // Selected Supplier Object
  const selectedSupplier = suppliers.find((s) => s.id === parseInt(supplierId, 10)) || null;

  // Live Supplier Ledger Balance Summary & Last Payment + Supplier Ledger Modal
  const [supplierBalanceSummary, setSupplierBalanceSummary] = useState<{
    previousBalance: number;
    previousBalanceAbs: number;
    previousBalanceType: 'Credit' | 'Debit';
    lastPayment: {
      payment_date: string;
      amount: number;
      reference_no: string;
      payment_mode: string;
      source: string;
    } | null;
  } | null>(null);
  const [supplierLedgerModalOpen, setSupplierLedgerModalOpen] = useState(false);
  const [supplierLedgerEntries, setSupplierLedgerEntries] = useState<any[]>([]);
  const [loadingSupplierLedger, setLoadingSupplierLedger] = useState(false);
  const [clientRequestId, setClientRequestId] = useState<string>(
    () => `pur-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  );

  // Fetch accurate Supplier Balance from actual ledger (excluding current invoice if editing)
  useEffect(() => {
    const supIdNum = parseInt(supplierId, 10);
    if (!supIdNum || isNaN(supIdNum)) {
      setSupplierBalanceSummary(null);
      return;
    }
    let active = true;
    api
      .getAccountBalanceSummary(supIdNum, {
        role: 'supplier',
        excludePurchaseId: editingPurchaseId,
      })
      .then((res) => {
        if (active && res?.data) {
          setSupplierBalanceSummary({
            previousBalance: Number(res.data.previousBalance || 0),
            previousBalanceAbs: Number(res.data.previousBalanceAbs || 0),
            previousBalanceType:
              res.data.previousBalanceType === 'Debit' ? 'Debit' : 'Credit',
            lastPayment: res.data.lastPayment || null,
          });
        }
      })
      .catch(() => {
        // Fallback to account master cached totals if offline
      });
    return () => {
      active = false;
    };
  }, [supplierId, editingPurchaseId, purchases.length]);

  const handleOpenSupplierLedger = async () => {
    const supIdNum = parseInt(supplierId, 10);
    if (!supIdNum) return;
    try {
      setSupplierLedgerModalOpen(true);
      setLoadingSupplierLedger(true);
      const res = await api.getSupplierLedger({ accountId: supIdNum });
      setSupplierLedgerEntries(res.data || []);
    } catch {
      setSupplierLedgerEntries([]);
    } finally {
      setLoadingSupplierLedger(false);
    }
  };

  // When Supplier changes, auto-populate Supplier Filer Status
  const handleSupplierChange = (newSupIdStr: string) => {
    setSupplierId(newSupIdStr);
    const sup = suppliers.find((s) => s.id === parseInt(newSupIdStr, 10));
    if (sup) {
      const fStatus: FilerStatus = sup.filer_status || 'Filer';
      setSupplierFilerStatus(fStatus);
    }
  };

  // Determine Applicable Advance Tax Rate (never hard-coded; comes from taxSettings or override)
  const getStatutoryAdvanceTaxRate = (): number => {
    if (!taxSettings || taxSettings.status === 'Inactive') return 0;
    if (supplierFilerStatus === 'Filer') return round2(taxSettings.filer_rate);
    if (supplierFilerStatus === 'Non-Filer') return round2(taxSettings.non_filer_rate);
    return round2(taxSettings.exempt_rate || 0);
  };

  const appliedAdvanceTaxRate = isTaxOverridden
    ? Math.max(0, round2(customAdvanceTaxRate))
    : getStatutoryAdvanceTaxRate();

  // Line Item Selection & Calculation
  const handleSelectItemOnRow = (idx: number, itemIdStr: string) => {
    const idNum = parseInt(itemIdStr, 10);
    const found = items.find((i) => i.id === idNum);
    setLines((prev) => {
      const copy = [...prev];
      if (!found) {
        copy[idx] = createBlankLine();
        return copy;
      }
      const rate = round2(found.purchase_price || 0);
      const qty = copy[idx].quantity > 0 ? copy[idx].quantity : 10;
      const discPct = round2(found.discount_percent || 0);
      const taxPct = round2(found.tax_percent || 0);
      const gross = round2(qty * rate);
      const discAmt = round2(gross * (discPct / 100));
      const taxable = round2(gross - discAmt);
      const taxAmt = round2(taxable * (taxPct / 100));
      const net = round2(taxable + taxAmt);

      copy[idx] = {
        ...copy[idx],
        item_id: found.id,
        item_code: found.item_code,
        company_name: found.company_name,
        item_name: found.item_name,
        packing: found.packing || '1x1',
        units_per_pack: parseUnitsPerPack(found.packing),
        batch_number: copy[idx].batch_number || `B-${found.item_code}-01`,
        manufacturing_date: copy[idx].manufacturing_date || '2026-01-01',
        expiry_date: copy[idx].expiry_date || '2028-06-30',
        quantity: qty,
        bonus_quantity: copy[idx].bonus_quantity || 0,
        purchase_rate: rate,
        mrp_rate: round2(found.retail_price || 0),
        gross_amount: gross,
        discount_percent: discPct,
        discount_amount: discAmt,
        taxable_amount: taxable,
        tax_percent: taxPct,
        tax_amount: taxAmt,
        line_total: net,
      };
      return copy;
    });
  };

  const handleLineChange = (
    idx: number,
    field: keyof PurchaseLineItem,
    value: string | number
  ) => {
    setLines((prev) => {
      const copy = [...prev];
      const row = { ...copy[idx], [field]: value };

      const qty = Math.max(0, round2(Number(row.quantity) || 0));
      const rate = Math.max(0, round2(Number(row.purchase_rate) || 0));
      const gross = round2(qty * rate);

      let discPct = Math.max(0, round2(Number(row.discount_percent) || 0));
      let discAmt = Math.max(0, round2(Number(row.discount_amount) || 0));

      if (field === 'discount_amount') {
        discAmt = Math.min(gross, discAmt);
        discPct = gross > 0 ? round2((discAmt / gross) * 100) : 0;
      } else {
        discAmt = round2(gross * (discPct / 100));
      }

      const taxable = round2(gross - discAmt);
      const taxPct = Math.max(0, round2(Number(row.tax_percent) || 0));
      const taxAmt = round2(taxable * (taxPct / 100));
      const net = round2(taxable + taxAmt);

      copy[idx] = {
        ...row,
        units_per_pack: parseUnitsPerPack(row.packing),
        gross_amount: gross,
        discount_percent: discPct,
        discount_amount: discAmt,
        taxable_amount: taxable,
        tax_percent: taxPct,
        tax_amount: taxAmt,
        line_total: net,
      };
      return copy;
    });
  };

  const addLineRow = () => {
    setLines((prev) => [...prev, createBlankLine()]);
  };

  const removeLineRow = (idx: number) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  // Automatic Invoice-Level Calculations (Decimal Precision)
  const validLines = lines.filter((l) => l.item_id > 0);
  const grossTotal = round2(validLines.reduce((s, l) => s + l.gross_amount, 0));
  const itemDiscountTotal = round2(validLines.reduce((s, l) => s + l.discount_amount, 0));
  const subtotalAfterItemDisc = round2(grossTotal - itemDiscountTotal);

  const computedInvoiceDiscAmt =
    invoiceDiscountPercent > 0
      ? round2(subtotalAfterItemDisc * (invoiceDiscountPercent / 100))
      : Math.min(subtotalAfterItemDisc, round2(invoiceDiscountAmount));

  const totalDiscount = round2(itemDiscountTotal + computedInvoiceDiscAmt);
  const taxableAmount = round2(grossTotal - totalDiscount);

  // Prorate invoice discount for GST
  const gstTotal = round2(
    validLines.reduce((sum, l) => {
      const share =
        subtotalAfterItemDisc > 0 ? l.taxable_amount / subtotalAfterItemDisc : 0;
      const lineTaxableAfterInvDisc = round2(l.taxable_amount - computedInvoiceDiscAmt * share);
      return sum + round2(lineTaxableAfterInvDisc * (l.tax_percent / 100));
    }, 0)
  );

  const basis = taxSettings?.calculation_basis || 'taxable_plus_gst';
  const advanceTaxBase =
    basis === 'taxable_amount'
      ? taxableAmount
      : basis === 'gross_amount'
      ? grossTotal
      : round2(taxableAmount + gstTotal);

  const advanceTaxAmount = round2(advanceTaxBase * (appliedAdvanceTaxRate / 100));
  const netInvoiceAmount = round2(taxableAmount + gstTotal + advanceTaxAmount);

  // Supplier Balance & Payable Calculations (From actual supplier ledger)
  const fallbackPrevSupplierNetPayable = selectedSupplier
    ? round2(Number(selectedSupplier.supplier_credit || 0) - Number(selectedSupplier.supplier_debit || 0))
    : 0;
  const prevSupplierNetPayable =
    supplierBalanceSummary !== null
      ? round2(supplierBalanceSummary.previousBalance)
      : fallbackPrevSupplierNetPayable;
  const previousSupplierBalance = Math.abs(prevSupplierNetPayable);
  const previousBalanceType =
    supplierBalanceSummary !== null
      ? supplierBalanceSummary.previousBalanceType
      : prevSupplierNetPayable >= 0
      ? 'Credit'
      : 'Debit';
  const totalPayable = round2(prevSupplierNetPayable + netInvoiceAmount);

  // Sync Paid Amount when Payment Mode is Cash or Bank or Credit
  useEffect(() => {
    if (paymentMode === 'Credit') {
      setPaidAmount(0);
    } else if (paymentMode === 'Cash' || paymentMode === 'Bank') {
      setPaidAmount(netInvoiceAmount);
    }
  }, [paymentMode, netInvoiceAmount]);

  const remainingBalance = round2(totalPayable - round2(paidAmount));

  // POS & Datasheet Helper Functions
  const runPurchaseItemSearch = (q: string) => {
    const query = q.trim().toLowerCase();
    if (!query) {
      setPurchaseSearchResults([]);
      return;
    }
    const matched = items
      .filter(
        (it) =>
          it.item_name.toLowerCase().includes(query) ||
          it.item_code.toLowerCase().includes(query) ||
          (it.barcode && it.barcode.toLowerCase().includes(query)) ||
          (it.company_name && it.company_name.toLowerCase().includes(query)) ||
          (it.generic_name && it.generic_name.toLowerCase().includes(query))
      )
      .slice(0, 25);
    setPurchaseSearchResults(matched);
  };

  const handleSelectPurchaseSearchItem = (it: Item) => {
    let targetIdx = selectedPurchaseLineIndex;
    if (lines[targetIdx]?.item_id && lines[targetIdx].item_id > 0) {
      const emptyIdx = lines.findIndex((l) => !l.item_id || l.item_id === 0);
      if (emptyIdx >= 0) {
        targetIdx = emptyIdx;
      } else {
        targetIdx = lines.length;
        setLines((prev) => [...prev, createBlankLine()]);
      }
    }

    handleSelectItemOnRow(targetIdx, it.id.toString());
    setSelectedPurchaseLineIndex(targetIdx);
    setPurchaseSearchQuery('');
    setShowPurchaseSearchDropdown(false);
  };

  const handleIncrementPurchaseQty = (idx: number) => {
    const cur = Number(lines[idx]?.quantity || 0);
    handleLineChange(idx, 'quantity', cur + 1);
  };

  const handleDecrementPurchaseQty = (idx: number) => {
    const cur = Number(lines[idx]?.quantity || 0);
    if (cur > 1) {
      handleLineChange(idx, 'quantity', cur - 1);
    }
  };

  const handleIncrementBonusQty = (idx: number) => {
    const cur = Number(lines[idx]?.bonus_quantity || 0);
    handleLineChange(idx, 'bonus_quantity', cur + 1);
  };

  const handleDecrementBonusQty = (idx: number) => {
    const cur = Number(lines[idx]?.bonus_quantity || 0);
    if (cur > 0) {
      handleLineChange(idx, 'bonus_quantity', cur - 1);
    }
  };

  const handleExactPurchasePayment = () => {
    setPaidAmount(totalPayable > 0 ? totalPayable : netInvoiceAmount);
  };

  const handleQuickPurchaseCash = (amt: number) => {
    setPaidAmount(amt);
  };

  const purchaseColOrder = [
    'item_id',
    'batch_number',
    'expiry_date',
    'quantity',
    'bonus_quantity',
    'purchase_rate',
    'discount_percent',
    'tax_percent',
  ];

  const focusPurchaseCell = (rIdx: number, col: string) => {
    const el = document.getElementById(`pur_cell_${rIdx}_${col}`) as HTMLInputElement | HTMLSelectElement | null;
    if (el) {
      el.focus();
      if ('select' in el && typeof el.select === 'function') {
        el.select();
      }
    }
  };

  const handlePurchaseCellKeyDown = (
    e: React.KeyboardEvent<HTMLElement>,
    rowIdx: number,
    field: string
  ) => {
    const curColIdx = purchaseColOrder.indexOf(field);

    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      if (curColIdx >= 0 && curColIdx < purchaseColOrder.length - 1) {
        e.preventDefault();
        focusPurchaseCell(rowIdx, purchaseColOrder[curColIdx + 1]);
      } else if (curColIdx === purchaseColOrder.length - 1) {
        e.preventDefault();
        if (rowIdx === lines.length - 1) {
          setLines((prev) => [...prev, createBlankLine()]);
          setSelectedPurchaseLineIndex(rowIdx + 1);
          setTimeout(() => {
            focusPurchaseCell(rowIdx + 1, 'item_id');
          }, 30);
        } else {
          setSelectedPurchaseLineIndex(rowIdx + 1);
          focusPurchaseCell(rowIdx + 1, 'item_id');
        }
      }
      return;
    }

    if (e.key === 'Tab' && e.shiftKey) {
      if (curColIdx > 0) {
        e.preventDefault();
        focusPurchaseCell(rowIdx, purchaseColOrder[curColIdx - 1]);
      } else if (curColIdx === 0 && rowIdx > 0) {
        e.preventDefault();
        setSelectedPurchaseLineIndex(rowIdx - 1);
        focusPurchaseCell(rowIdx - 1, purchaseColOrder[purchaseColOrder.length - 1]);
      }
      return;
    }

    if (e.key === 'ArrowUp' && rowIdx > 0) {
      e.preventDefault();
      setSelectedPurchaseLineIndex(rowIdx - 1);
      focusPurchaseCell(rowIdx - 1, field);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rowIdx < lines.length - 1) {
        setSelectedPurchaseLineIndex(rowIdx + 1);
        focusPurchaseCell(rowIdx + 1, field);
      } else {
        setLines((prev) => [...prev, createBlankLine()]);
        setSelectedPurchaseLineIndex(rowIdx + 1);
        setTimeout(() => {
          focusPurchaseCell(rowIdx + 1, field);
        }, 30);
      }
      return;
    }
  };


  const resetInvoiceForm = async () => {
    setEditingPurchaseId(null);
    setSupplierInvoiceNumber('');
    setNotes('');
    setInvoiceDiscountPercent(0);
    setInvoiceDiscountAmount(0);
    setIsTaxOverridden(false);
    setTaxOverrideReason('');
    setPaymentMode('Credit');
    setPaidAmount(0);
    setLines([createBlankLine()]);
    setClientRequestId(`pur-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    try {
      const nums = await api.getNextPurchaseNumbers();
      setBillNumber(nums.nextPurchaseNumber);
      setNextPurchaseNo(nums.nextPurchaseNumber);
      setNextReturnNo(nums.nextReturnNumber);
    } catch {
      // ignore
    }
  };

  // Submit Purchase Invoice (Create or Update)
  const handleSavePurchaseInvoice = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!supplierId) {
      setFormError('Please select a Supplier Account.');
      return;
    }
    if (validLines.length === 0) {
      setFormError('Please select at least one Medicine Item on the invoice.');
      return;
    }
    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      if (!l.batch_number.trim()) {
        setFormError(`Row ${i + 1} (${l.item_name}): Batch Number is required.`);
        return;
      }
      if (!l.expiry_date) {
        setFormError(`Row ${i + 1} (${l.item_name}): Expiry Date is required.`);
        return;
      }
      if (l.quantity <= 0 && l.bonus_quantity <= 0) {
        setFormError(`Row ${i + 1} (${l.item_name}): Quantity must be greater than 0.`);
        return;
      }
    }

    if (isTaxOverridden && !taxOverrideReason.trim()) {
      setFormError('Please enter a valid Override Reason for the Advance Tax override.');
      return;
    }

    const payload = {
      bill_number: billNumber,
      supplier_invoice_number: supplierInvoiceNumber,
      bill_date: billDate,
      supplier_account_id: parseInt(supplierId, 10),
      supplier_filer_status: supplierFilerStatus,
      invoice_discount_percent: invoiceDiscountPercent,
      invoice_discount_amount: computedInvoiceDiscAmt,
      is_tax_overridden: isTaxOverridden,
      advance_tax_rate: appliedAdvanceTaxRate,
      tax_override_reason: taxOverrideReason,
      tax_override_authorized_by: taxOverrideAuthorizedBy,
      payment_mode: paymentMode,
      payment_account_id: paymentAccountId ? parseInt(paymentAccountId, 10) : null,
      paid_amount: round2(paidAmount),
      remarks: notes,
      client_request_id: clientRequestId,
      items: validLines,
    };

    try {
      setSavingInvoice(true);
      if (editingPurchaseId) {
        const res = await api.updatePurchase(editingPurchaseId, payload);
        setFormSuccess(res.message);
        await resetInvoiceForm();
        await fetchWorkspaceData();
        handleOpenPrintInvoice(res.purchase.id);
      } else {
        const res = await api.createPurchase(payload);
        setFormSuccess(res.message);
        await resetInvoiceForm();
        await fetchWorkspaceData();
        handleOpenPrintInvoice(res.purchase.id);
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingInvoice(false);
    }
  };

  // Open A4 Print Modal for Purchase Invoice
  const handleOpenPrintInvoice = async (purId: number) => {
    try {
      const res = await api.getPurchaseDetails(purId);
      setPrintMode('invoice');
      setPrintInvoice(res.purchase);
      setPrintInvoiceItems(res.items || []);
      setPrintJournalLines(res.journalLines || []);
      setPrintModalOpen(true);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  // Keyboard Shortcuts for Purchases Invoice (F2: Save & Post, Ctrl+N: New Bill)
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (subTab !== 'new-invoice') return;
      if (e.key === 'F2') {
        e.preventDefault();
        handleSavePurchaseInvoice();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        resetInvoiceForm();
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [subTab, billNumber, supplierId, validLines, isTaxOverridden, taxOverrideReason, supplierInvoiceNumber, billDate]);


  // Open A4 Print Modal for Purchase Return
  const handleOpenPrintReturn = async (retId: number) => {
    try {
      const res = await api.getPurchaseReturnDetails(retId);
      setPrintMode('return');
      setPrintReturn(res.purchaseReturn);
      setPrintReturnItems(res.items || []);
      setPrintJournalLines(res.journalLines || []);
      setPrintModalOpen(true);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  // Load Purchase Invoice into Edit Form
  const handleEditPurchase = async (purId: number) => {
    try {
      const res = await api.getPurchaseDetails(purId);
      const p: PurchaseInvoice = res.purchase;
      const pItems: PurchaseLineItem[] = res.items || [];

      setEditingPurchaseId(p.id);
      setBillNumber(p.bill_number);
      setBillDate(p.bill_date);
      setSupplierId(String(p.supplier_account_id));
      setSupplierInvoiceNumber(p.supplier_invoice_number || '');
      setSupplierFilerStatus(p.supplier_filer_status || 'Filer');
      setNotes(p.remarks || '');
      setInvoiceDiscountPercent(p.invoice_discount_percent || 0);
      setInvoiceDiscountAmount(p.invoice_discount_amount || 0);
      setIsTaxOverridden(p.is_tax_overridden === 1);
      setCustomAdvanceTaxRate(p.advance_tax_rate);
      setTaxOverrideReason(p.tax_override_reason || '');
      setTaxOverrideAuthorizedBy(p.tax_override_authorized_by || 'Chief Pharmacist / Admin');
      setPaymentMode(p.payment_mode || 'Credit');
      setPaymentAccountId(p.payment_account_id ? String(p.payment_account_id) : '');
      setPaidAmount(p.paid_amount || 0);
      setLines(pItems.length > 0 ? pItems : [createBlankLine()]);
      setSubTab('new-invoice');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  // Cancel Purchase Invoice with Reversal Entries
  const handleCancelPurchase = async (pur: PurchaseInvoice) => {
    try {
      setFormError(null);
      const res = await api.cancelPurchase(
        pur.id,
        `Cancelled Invoice ${pur.bill_number} with full stock & double-entry reversal`
      );
      setFormSuccess(res.message);
      await fetchWorkspaceData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const navItems: Array<{ id: PurchaseSubTab; label: string; icon: React.ElementType }> = [
    {
      id: 'new-invoice',
      label: editingPurchaseId ? `Editing ${billNumber}` : '1. Purchase Invoice',
      icon: ShoppingBag,
    },
    {
      id: 'register',
      label: `2. Purchase Register (${purchases.length})`,
      icon: ListChecks,
    },
    {
      id: 'purchase-return',
      label: `3. Purchase Return (${returns.length})`,
      icon: ArrowDownLeft,
    },
    {
      id: 'batch-stock',
      label: `4. Batch Stock (${batches.length})`,
      icon: Boxes,
    },
    {
      id: 'advance-tax',
      label: '5. Advance Tax Settings',
      icon: Sliders,
    },
    {
      id: 'reports',
      label: '6. Purchase Reports (8)',
      icon: FileSpreadsheet,
    },
  ];

  return (
    <div
      className={
        subTab === 'new-invoice'
          ? 'flex-1 h-full flex flex-col min-h-0 overflow-hidden'
          : 'space-y-5'
      }
    >
      {/* Top Sub-Navigation Bar */}
      <div
        className={`bg-white border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-1 shrink-0 print:hidden ${
          subTab === 'new-invoice' ? 'px-2 py-0.5 rounded mb-0.5' : 'p-2 rounded-2xl'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1">
          {navItems.map((tab) => {
            const Icon = tab.icon;
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`rounded font-bold flex items-center gap-1 transition-all cursor-pointer ${
                  subTab === 'new-invoice' ? 'px-2 py-0.5 text-[10px]' : 'px-3.5 py-2 text-xs'
                } ${
                  active
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Inline Two Independent Invoice Interfaces Selector when on New Invoice */}
        {subTab === 'new-invoice' && (
          <div className="flex items-center gap-1.5 bg-slate-900 text-white px-2 py-0.5 rounded border border-slate-700">
            <span className="text-[9px] font-black uppercase tracking-wider text-slate-300 hidden md:inline">
              Interface:
            </span>
            <button
              type="button"
              onClick={() => togglePurchaseViewMode('pos')}
              className={`px-2 py-0 rounded text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                purchaseViewMode === 'pos'
                  ? 'bg-emerald-600 text-white ring-1 ring-emerald-400'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700'
              }`}
              title="Switch to Traditional Desktop POS Goods Receipt Interface"
            >
              <ShoppingBag className="w-3 h-3" />
              <span>1. POS View</span>
            </button>
            <button
              type="button"
              onClick={() => togglePurchaseViewMode('access')}
              className={`px-2 py-0 rounded text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                purchaseViewMode === 'access'
                  ? 'bg-blue-600 text-white ring-1 ring-blue-400'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700'
              }`}
              title="Switch to Microsoft Access-Style Desktop Datasheet Form"
            >
              <FileSpreadsheet className="w-3 h-3" />
              <span>2. MS Access View</span>
            </button>
            <span className="bg-slate-800 px-1.5 py-0 rounded text-emerald-400 font-mono font-bold text-[9px]">
              {lines.filter((l) => l.item_id > 0).length} Items
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5 pr-0.5">
          {taxSettings && (
            <div className="hidden 2xl:flex items-center gap-1 px-1.5 py-0 rounded bg-amber-50 border border-amber-200 text-[9px] font-mono text-amber-900">
              <ShieldCheck className="w-3 h-3 text-amber-700" />
              <span>
                Filer: <strong>{taxSettings.filer_rate}%</strong> | Non-Filer:{' '}
                <strong>{taxSettings.non_filer_rate}%</strong>
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={fetchWorkspaceData}
            className="p-0.5 rounded border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
            title="Refresh Purchase & Inventory Data"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {formError && (
        <div className="px-2.5 py-1 rounded bg-rose-50 border border-rose-200 text-rose-800 text-[11px] flex items-center justify-between shrink-0 mb-0.5">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            <span className="font-semibold">{formError}</span>
          </div>
          <button
            type="button"
            onClick={() => setFormError(null)}
            className="text-rose-600 hover:underline font-bold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {formSuccess && (
        <div className="px-2.5 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] flex items-center justify-between shrink-0 mb-0.5">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="font-semibold">{formSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setFormSuccess(null)}
            className="text-emerald-700 hover:underline font-bold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: NEW / EDIT PURCHASE INVOICE SCREEN */}
      {subTab === 'new-invoice' && (
        <div
          className={
            purchaseViewMode === 'access'
              ? 'flex-1 h-full flex flex-col min-h-0 overflow-hidden'
              : 'flex-1 h-full overflow-y-auto space-y-3 pr-1'
          }
        >

          {/* ================= OPTION 1: TRADITIONAL POS INTERFACE ================= */}
          {purchaseViewMode === 'pos' && (
            <form onSubmit={handleSavePurchaseInvoice} className="space-y-3">
              {/* POS Header: Compact Supplier, Bill #, Date, Mode */}
              <div className="bg-white rounded-lg border border-slate-200 shadow-xs p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded bg-slate-900 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1">
                      <Zap className="w-3 h-3 text-amber-300" />
                      PURCHASE POS COUNTER
                    </span>
                    <span className="font-mono text-xs font-black text-slate-900 bg-slate-100 px-2 py-1 rounded border border-slate-300">
                      {billNumber}
                    </span>
                    {editingPurchaseId && (
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold">
                        EDIT #{editingPurchaseId}
                      </span>
                    )}
                    <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-2 py-0.5">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Date:</span>
                      <input
                        type="date"
                        required
                        value={billDate}
                        onChange={(e) => setBillDate(e.target.value)}
                        className="text-xs font-mono font-semibold text-slate-800 bg-transparent outline-none cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={resetInvoiceForm}
                      className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3 text-emerald-600" />
                      New Purchase
                    </button>
                  </div>
                </div>

                {/* Middle Row: Supplier with Live Ledger Balance */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
                  <div className="md:col-span-5 space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      Supplier Account <span className="text-rose-500">*</span>
                    </label>
                    <select
                      required
                      value={supplierId}
                      onChange={(e) => handleSupplierChange(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-bold rounded-md border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="">— Select Pharmaceutical Supplier —</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          [{s.account_code}] {s.account_name} ({s.filer_status || 'Filer'})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Live Supplier Previous Balance Badge */}
                  <div className="md:col-span-4 bg-slate-900 text-white rounded-md p-2 flex items-center justify-between shadow-xs">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 block">
                        Supplier Previous Ledger Balance
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-mono text-xs font-black ${
                            previousSupplierBalance > 0
                              ? 'text-rose-400'
                              : previousSupplierBalance < 0
                              ? 'text-emerald-400'
                              : 'text-slate-300'
                          }`}
                        >
                          {formatPKR(Math.abs(previousSupplierBalance))} ({previousBalanceType})
                        </span>
                        {supplierBalanceSummary?.lastPayment && (
                          <span className="text-[9px] text-slate-400 hidden sm:inline">
                            • Last: {formatPKR(supplierBalanceSummary.lastPayment.amount)}
                          </span>
                        )}
                      </div>
                    </div>
                    {selectedSupplier && (
                      <button
                        type="button"
                        onClick={handleOpenSupplierLedger}
                        className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer shrink-0"
                        title="Open Detailed Supplier Ledger"
                      >
                        <Scale className="w-3 h-3" />
                        <span>Ledger</span>
                      </button>
                    )}
                  </div>

                  {/* Supplier Invoice # & Payment Mode */}
                  <div className="md:col-span-3 grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block mb-0.5">
                        Sup. Inv #
                      </label>
                      <input
                        type="text"
                        value={supplierInvoiceNumber}
                        onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                        placeholder="Inv #"
                        className="w-full px-2 py-1 text-xs font-mono font-semibold rounded border border-slate-300 bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block mb-0.5">
                        Mode
                      </label>
                      <select
                        value={paymentMode}
                        onChange={(e) => setPaymentMode(e.target.value as PurchasePaymentMode)}
                        className="w-full px-2 py-1 text-xs font-bold rounded border border-slate-300 bg-white"
                      >
                        <option value="Credit">Credit</option>
                        <option value="Cash">Cash</option>
                        <option value="Bank">Bank</option>
                        <option value="Partial">Partial</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Fast Search & Barcode Bar for Purchase */}
              <div className="relative bg-slate-900 rounded-lg p-2.5 shadow-sm text-white">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Barcode className="w-5 h-5 text-emerald-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={purchaseSearchQuery}
                      onChange={(e) => {
                        const q = e.target.value;
                        setPurchaseSearchQuery(q);
                        setShowPurchaseSearchDropdown(true);
                        runPurchaseItemSearch(q);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (purchaseSearchResults.length > 0) {
                            handleSelectPurchaseSearchItem(purchaseSearchResults[0]);
                          }
                        }
                      }}
                      placeholder="Scan Barcode or Search Medicine Name / Code / Company for Goods Receipt (Press Enter)..."
                      className="w-full pl-10 pr-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-white placeholder-slate-400 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addLineRow}
                    className="px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0 shadow-xs"
                    title="Add Blank Item Row"
                  >
                    <Plus className="w-4 h-4" />
                    <span>+ Blank Line</span>
                  </button>
                </div>

                {/* Search Dropdown */}
                {showPurchaseSearchDropdown && purchaseSearchResults.length > 0 && (
                  <div className="absolute left-2.5 right-2.5 top-full mt-1 z-30 bg-white text-slate-900 rounded-lg border border-slate-300 shadow-2xl max-h-60 overflow-y-auto">
                    <div className="p-1.5 bg-slate-100 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600 flex justify-between">
                      <span>Matching Catalog Medicines ({purchaseSearchResults.length})</span>
                      <span>Click or Press Enter to Add to Receipt</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {purchaseSearchResults.map((it) => (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => handleSelectPurchaseSearchItem(it)}
                          className="w-full px-3 py-2 text-left hover:bg-emerald-50 flex items-center justify-between text-xs cursor-pointer transition-colors"
                        >
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span className="font-mono text-emerald-700">[{it.item_code}]</span>
                              <span>{it.item_name}</span>
                              <span className="text-[10px] text-slate-500 font-normal">({it.packing})</span>
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {it.company_name} • Trade: Rs. {it.trade_price || 0} • MRP: Rs. {it.retail_price}
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            <div className="font-mono font-bold text-slate-900">
                              Pur. Rate: Rs. {(it.trade_price || it.retail_price).toFixed(2)}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Active Item Goods Receipt Entry Strip */}
              {lines[selectedPurchaseLineIndex] && lines[selectedPurchaseLineIndex].item_id > 0 ? (
                <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border-2 border-emerald-500/80 rounded-lg p-3 shadow-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-[11px] font-bold">
                        Active Item #{selectedPurchaseLineIndex + 1}
                      </span>
                      <span className="font-bold text-slate-900 text-sm">
                        [{lines[selectedPurchaseLineIndex].item_code}] {lines[selectedPurchaseLineIndex].item_name}
                      </span>
                      <span className="text-xs text-slate-600 font-medium">
                        ({lines[selectedPurchaseLineIndex].packing}) • {lines[selectedPurchaseLineIndex].company_name}
                      </span>
                    </div>
                  </div>

                  {/* Fast Stepper & Entry Controls for Active Purchase Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 items-end pt-1">
                    {/* Batch Number */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold uppercase text-slate-700">
                        Batch # <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={lines[selectedPurchaseLineIndex].batch_number}
                        onChange={(e) => handleLineChange(selectedPurchaseLineIndex, 'batch_number', e.target.value)}
                        className="w-full px-2 py-1 font-mono font-bold text-xs rounded border border-slate-300 bg-white"
                      />
                    </div>

                    {/* Expiry Date */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold uppercase text-slate-700">
                        Expiry <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="date"
                        required
                        value={lines[selectedPurchaseLineIndex].expiry_date}
                        onChange={(e) => handleLineChange(selectedPurchaseLineIndex, 'expiry_date', e.target.value)}
                        className="w-full px-1.5 py-1 font-mono text-xs rounded border border-slate-300 bg-white"
                      />
                    </div>

                    {/* Quantity with Steppers */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold uppercase text-slate-700">
                        Qty (Packs)
                      </label>
                      <div className="flex items-center border border-slate-300 rounded bg-white shadow-xs overflow-hidden">
                        <button
                          type="button"
                          onClick={() => handleDecrementPurchaseQty(selectedPurchaseLineIndex)}
                          className="px-1.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer"
                        >
                          -
                        </button>
                        <NumericInput
                          min="1"
                          step="1"
                          value={lines[selectedPurchaseLineIndex].quantity}
                          onChange={(e) => handleLineChange(selectedPurchaseLineIndex, 'quantity', e.target.value)}
                          className="w-full text-center font-mono font-bold text-xs text-slate-900 outline-none py-1"
                        />
                        <button
                          type="button"
                          onClick={() => handleIncrementPurchaseQty(selectedPurchaseLineIndex)}
                          className="px-1.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Bonus Qty with Steppers */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold uppercase text-teal-800">
                        Bonus Qty
                      </label>
                      <div className="flex items-center border border-teal-300 rounded bg-white shadow-xs overflow-hidden">
                        <button
                          type="button"
                          onClick={() => handleDecrementBonusQty(selectedPurchaseLineIndex)}
                          className="px-1.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-xs cursor-pointer"
                        >
                          -
                        </button>
                        <NumericInput
                          min="0"
                          step="1"
                          value={lines[selectedPurchaseLineIndex].bonus_quantity}
                          onChange={(e) => handleLineChange(selectedPurchaseLineIndex, 'bonus_quantity', e.target.value)}
                          className="w-full text-center font-mono font-bold text-xs text-teal-950 outline-none py-1"
                        />
                        <button
                          type="button"
                          onClick={() => handleIncrementBonusQty(selectedPurchaseLineIndex)}
                          className="px-1.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-xs cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Purchase Rate */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold uppercase text-slate-700">
                        Pur. Rate (PKR)
                      </label>
                      <NumericInput
                        min="0"
                        step="0.01"
                        value={lines[selectedPurchaseLineIndex].purchase_rate}
                        onChange={(e) => handleLineChange(selectedPurchaseLineIndex, 'purchase_rate', e.target.value)}
                        className="w-full px-2 py-1 font-mono font-bold text-xs text-right rounded border border-slate-300 bg-white"
                      />
                    </div>

                    {/* Disc % */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold uppercase text-slate-700">
                        Disc %
                      </label>
                      <NumericInput
                        min="0"
                        max="100"
                        step="0.5"
                        value={lines[selectedPurchaseLineIndex].discount_percent}
                        onChange={(e) => handleLineChange(selectedPurchaseLineIndex, 'discount_percent', e.target.value)}
                        className="w-full px-2 py-1 font-mono text-xs text-right rounded border border-slate-300 bg-white"
                      />
                    </div>

                    {/* Tax (GST) % */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold uppercase text-slate-700">
                        GST %
                      </label>
                      <NumericInput
                        min="0"
                        max="100"
                        step="0.5"
                        value={lines[selectedPurchaseLineIndex].tax_percent}
                        onChange={(e) => handleLineChange(selectedPurchaseLineIndex, 'tax_percent', e.target.value)}
                        className="w-full px-2 py-1 font-mono text-xs text-right rounded border border-slate-300 bg-white"
                      />
                    </div>

                    {/* Net Total & Add Next Item */}
                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          addLineRow();
                          setSelectedPurchaseLineIndex(lines.length);
                          setPurchaseSearchQuery('');
                        }}
                        className="w-full py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center justify-center gap-1 cursor-pointer shadow-xs"
                        title="Add Next Purchase Item"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Next Item</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 border border-dashed border-slate-300 rounded-lg p-3 text-center text-xs text-slate-500">
                  Scan a barcode or search a medicine above to enter batch, expiry and purchase rates into goods receipt.
                </div>
              )}

              {/* Compact Purchase Cart Grid */}
              <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                    Purchase Line Items ({lines.filter((l) => l.item_id > 0).length})
                  </span>
                  <span className="font-mono text-slate-600 text-[11px]">
                    Total Packs: {lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)} • Bonus: {lines.reduce((s, l) => s + (Number(l.bonus_quantity) || 0), 0)}
                  </span>
                </div>

                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 bg-slate-200/90 text-slate-700 text-[10px] font-bold uppercase tracking-wider">
                      <tr>
                        <th className="py-2 px-2 w-8 text-center">#</th>
                        <th className="py-2 px-2">Item Description & Company</th>
                        <th className="py-2 px-2 w-20 text-center">Pack</th>
                        <th className="py-2 px-2 w-24">Batch #</th>
                        <th className="py-2 px-2 w-24">Expiry</th>
                        <th className="py-2 px-2 w-24 text-center">Qty (Packs)</th>
                        <th className="py-2 px-2 w-20 text-center">Bonus</th>
                        <th className="py-2 px-2 w-24 text-right">Pur. Rate</th>
                        <th className="py-2 px-2 w-16 text-right">Disc %</th>
                        <th className="py-2 px-2 w-16 text-right">GST %</th>
                        <th className="py-2 px-2 w-28 text-right">Net Total</th>
                        <th className="py-2 px-2 w-12 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lines.map((line, idx) => {
                        const isSelected = idx === selectedPurchaseLineIndex;
                        if (!line.item_id && lines.length > 1) {
                          return null;
                        }

                        return (
                          <tr
                            key={idx}
                            onClick={() => setSelectedPurchaseLineIndex(idx)}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? 'bg-emerald-50/80 font-medium' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="py-2 px-2 text-center font-mono text-slate-500 text-[11px]">
                              {idx + 1}
                            </td>
                            <td className="py-2 px-2">
                              <div className="font-bold text-slate-900">
                                {line.item_name || <span className="text-slate-400 italic">Empty Row</span>}
                              </div>
                              {line.company_name && (
                                <div className="text-[10px] text-slate-500">
                                  {line.company_name} • [{line.item_code}]
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-2 text-center font-mono text-[11px] text-slate-700">
                              {line.packing}
                            </td>
                            <td className="py-2 px-2 font-mono text-[11px] text-slate-800">
                              {line.batch_number || '-'}
                            </td>
                            <td className="py-2 px-2 font-mono text-[11px] text-slate-600">
                              {line.expiry_date}
                            </td>

                            {/* Direct Stepper Controls for Qty */}
                            <td className="py-2 px-2">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDecrementPurchaseQty(idx);
                                  }}
                                  className="w-5 h-5 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold flex items-center justify-center cursor-pointer"
                                >
                                  -
                                </button>
                                <span className="font-mono font-bold text-xs w-8 text-center text-slate-900">
                                  {line.quantity}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleIncrementPurchaseQty(idx);
                                  }}
                                  className="w-5 h-5 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold flex items-center justify-center cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                            </td>

                            {/* Bonus Qty Stepper */}
                            <td className="py-2 px-2 text-center font-mono text-xs text-teal-900 font-bold">
                              {line.bonus_quantity}
                            </td>

                            <td className="py-2 px-2 text-right font-mono text-slate-800">
                              {line.purchase_rate.toFixed(2)}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-slate-600">
                              {line.discount_percent > 0 ? `${line.discount_percent}%` : '-'}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-slate-600">
                              {line.tax_percent > 0 ? `${line.tax_percent}%` : '-'}
                            </td>
                            <td className="py-2 px-2 text-right font-mono font-black text-slate-900">
                              {formatPKR(line.line_total)}
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeLineRow(idx);
                                }}
                                className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                                title="Remove Line"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* POS Bottom Totals & Payment Settlement */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                {/* Left 7 cols: Cash Tender & Live Remaining Payable */}
                <div className="lg:col-span-7 bg-white rounded-lg border border-slate-200 p-3 shadow-xs space-y-3">
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                      <Banknote className="w-4 h-4 text-emerald-600" />
                      <span>Supplier Payment Settlement</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      Mode: <strong className="text-slate-800">{paymentMode}</strong>
                    </span>
                  </div>

                  {/* Quick Cash Buttons */}
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold uppercase text-slate-600">
                      Payment Shortcuts
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={handleExactPurchasePayment}
                        className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-black cursor-pointer shadow-xs"
                      >
                        Exact Payable
                      </button>
                      {[500, 1000, 5000, 10000, 50000].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => handleQuickPurchaseCash(amt)}
                          className="px-2.5 py-1.5 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 font-mono text-xs font-bold text-slate-800 cursor-pointer"
                        >
                          Rs. {amt.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Amount Paid Input */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-700">
                        Amount Paid to Supplier (PKR):
                      </label>
                      <NumericInput
                        min="0"
                        step="0.01"
                        value={paidAmount}
                        onChange={(e) => setPaidAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-full px-3 py-2 rounded-lg border-2 border-emerald-500 text-lg font-mono font-black text-emerald-950 bg-emerald-50/20 text-right outline-none"
                      />
                    </div>

                    {/* High Contrast Live Remaining Payable */}
                    <div
                      className={`p-3 rounded-lg border text-right ${
                        remainingBalance <= 0
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                          : 'bg-rose-50 border-rose-300 text-rose-950'
                      }`}
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider block">
                        {remainingBalance <= 0 ? 'Supplier Balance Cleared:' : 'Remaining Payable (Credit):'}
                      </span>
                      <span className="text-xl font-mono font-black block mt-0.5">
                        {formatPKR(Math.abs(remainingBalance))}
                      </span>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="pt-2 border-t border-slate-100 text-xs">
                    <label className="block text-[10px] font-bold text-slate-600 uppercase mb-0.5">
                      Invoice Delivery Notes / Remarks
                    </label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Challan #, delivery verification notes..."
                      className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs"
                    />
                  </div>
                </div>

                {/* Right 5 cols: Purchase Totals & Action Buttons */}
                <div className="lg:col-span-5 bg-slate-900 text-white rounded-lg p-3 shadow-xs space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>Gross Total:</span>
                      <span className="font-mono font-bold text-slate-200">{formatPKR(grossTotal)}</span>
                    </div>
                    <div className="flex justify-between text-rose-400">
                      <span>Total Discounts:</span>
                      <span className="font-mono font-bold">-{formatPKR(totalDiscount)}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>GST / Tax:</span>
                      <span className="font-mono font-bold">+{formatPKR(gstTotal)}</span>
                    </div>
                    {advanceTaxAmount > 0 && (
                      <div className="flex justify-between text-amber-300">
                        <span>Advance Tax ({appliedAdvanceTaxRate}%):</span>
                        <span className="font-mono font-bold">+{formatPKR(advanceTaxAmount)}</span>
                      </div>
                    )}

                    <div className="flex justify-between border-t border-slate-800 pt-1.5 items-baseline">
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                        Net Purchase:
                      </span>
                      <span className="text-xl font-mono font-black text-emerald-400">
                        {formatPKR(netInvoiceAmount)}
                      </span>
                    </div>

                    <div className="flex justify-between text-slate-300 text-[11px] pt-1 border-t border-slate-800/80">
                      <span>Supplier Previous Ledger:</span>
                      <span className="font-mono font-semibold text-amber-300">
                        {formatPKR(previousSupplierBalance)} ({previousBalanceType})
                      </span>
                    </div>

                    <div className="flex justify-between font-bold text-white text-xs pt-1 border-t border-slate-800">
                      <span>Total Payable (Prev + Net):</span>
                      <span className="font-mono text-sm text-sky-300">{formatPKR(totalPayable)}</span>
                    </div>
                  </div>

                  {/* Large Action Buttons */}
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="submit"
                        disabled={savingInvoice}
                        className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-md disabled:opacity-50"
                      >
                        <Save className="w-4 h-4" />
                        <span>{savingInvoice ? 'Posting...' : editingPurchaseId ? 'Update & Re-Post' : 'Confirm Purchase (F2)'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (purchases.length > 0) {
                            handleOpenPrintInvoice(purchases[0].id);
                          }
                        }}
                        className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer border border-slate-700"
                      >
                        <Printer className="w-4 h-4 text-emerald-400" />
                        <span>Print A4</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* ================= OPTION 2: MICROSOFT ACCESS-STYLE INTERFACE (FULL-SCREEN DESKTOP FORM) ================= */}
          {purchaseViewMode === 'access' && (
            <form
              onSubmit={handleSavePurchaseInvoice}
              className="flex-1 min-h-0 flex flex-col bg-slate-200 border-2 border-slate-400 rounded-sm shadow-xs overflow-hidden select-none"
            >
              {/* Combined Access Window Title Bar & Ribbon Toolbar */}
              <div className="bg-gradient-to-r from-slate-800 via-slate-850 to-slate-900 text-white px-2.5 py-0.5 flex flex-wrap items-center justify-between gap-1 border-b border-slate-700 text-[11px] shrink-0 select-none">
                <div className="flex items-center gap-2 font-mono">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className="font-bold text-slate-200 tracking-tight">frm_PurchaseInvoice : Form</span>
                  <span className="text-[10px] bg-slate-700 px-1.5 py-0.2 rounded text-emerald-300 font-bold uppercase">
                    Goods Receipt
                  </span>
                  <span className="font-bold text-amber-300">{billNumber}</span>
                  {editingPurchaseId && (
                    <span className="bg-amber-600 text-white text-[9px] px-1.5 py-0.2 rounded font-bold">
                      EDIT #{editingPurchaseId}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-400 hidden xl:inline ml-1">
                    (F2: Save &amp; Post · Tab/Enter: Next Cell · Arrows: Navigate)
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={addLineRow}
                    className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                    title="Add Medicine Line Item Row"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Row</span>
                  </button>
                  <button
                    type="button"
                    onClick={resetInvoiceForm}
                    className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white font-semibold text-[10px] flex items-center gap-1 cursor-pointer"
                    title="New Purchase Bill (Ctrl+N)"
                  >
                    <Plus className="w-3 h-3 text-emerald-400" />
                    <span>New Bill</span>
                  </button>
                  <button
                    type="submit"
                    disabled={savingInvoice}
                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    title="Save &amp; Post Purchase Invoice (F2)"
                  >
                    <Save className="w-3 h-3" />
                    <span>{savingInvoice ? 'Posting...' : editingPurchaseId ? 'Update (F2)' : 'Save & Post (F2)'}</span>
                  </button>
                  {selectedSupplier && (
                    <button
                      type="button"
                      onClick={handleOpenSupplierLedger}
                      className="px-2 py-0.5 rounded bg-teal-700 hover:bg-teal-600 text-white font-semibold text-[10px] flex items-center gap-1 cursor-pointer"
                      title="Open Detailed Supplier Ledger"
                    >
                      <Scale className="w-3 h-3 text-teal-200" />
                      <span>Ledger ↗</span>
                    </button>
                  )}
                  {purchases.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleOpenPrintInvoice(purchases[0].id)}
                      className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-white font-semibold text-[10px] flex items-center gap-1 cursor-pointer"
                      title="Print Last Confirmed A4 Purchase Invoice"
                    >
                      <Printer className="w-3 h-3 text-emerald-400" />
                      <span>Print A4</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSubTab('advance-tax')}
                    className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 text-[10px] flex items-center gap-1 cursor-pointer"
                    title="Configure FBR Section 236G/236H Advance Tax Rates"
                  >
                    <ShieldCheck className="w-3 h-3 text-amber-400" />
                    <span>Adv Tax</span>
                  </button>
                  {editingPurchaseId && (
                    <button
                      type="button"
                      onClick={resetInvoiceForm}
                      className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold cursor-pointer"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>
              </div>

              {/* Dense Aligned Form Header */}
              <div className="bg-slate-100 border-b border-slate-300 px-2 py-0.5 shrink-0 select-none">
                {/* Row 1: Core Invoice Meta */}
                <div className="grid grid-cols-12 gap-1 items-center text-[11px]">
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="text-[10px] font-bold text-slate-700 w-9 shrink-0">Bill #:</label>
                    <input
                      type="text"
                      required
                      value={billNumber}
                      onChange={(e) => setBillNumber(e.target.value)}
                      className="w-full px-1 py-0 text-[11px] font-mono font-black rounded border border-slate-300 bg-white text-slate-900 h-5"
                    />
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="text-[10px] font-bold text-slate-700 w-8 shrink-0">Date:</label>
                    <input
                      type="date"
                      required
                      value={billDate}
                      onChange={(e) => setBillDate(e.target.value)}
                      className="w-full px-1 py-0 text-[11px] font-mono font-semibold rounded border border-slate-300 bg-white text-slate-900 h-5"
                    />
                  </div>
                  <div className="col-span-4 flex items-center gap-1">
                    <label className="text-[10px] font-bold text-slate-700 w-12 shrink-0">Supplier:</label>
                    <select
                      required
                      value={supplierId}
                      onChange={(e) => handleSupplierChange(e.target.value)}
                      className="w-full px-1 py-0 text-[11px] font-bold rounded border border-emerald-500 bg-white text-slate-900 focus:outline-none h-5"
                    >
                      <option value="">— Select Supplier —</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          [{s.account_code}] {s.account_name} ({s.filer_status || 'Filer'})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="text-[10px] font-bold text-slate-700 w-12 shrink-0">Supp Inv:</label>
                    <input
                      type="text"
                      value={supplierInvoiceNumber}
                      onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                      placeholder="e.g. INV-8891"
                      className="w-full px-1 py-0 text-[11px] font-mono rounded border border-slate-300 bg-white text-slate-900 h-5"
                    />
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="text-[10px] font-bold text-slate-700 w-8 shrink-0">FBR:</label>
                    <select
                      value={supplierFilerStatus}
                      onChange={(e) => setSupplierFilerStatus(e.target.value as FilerStatus)}
                      className={`w-full px-1 py-0 text-[10px] font-bold rounded border h-5 ${
                        supplierFilerStatus === 'Filer'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                          : supplierFilerStatus === 'Non-Filer'
                          ? 'border-amber-500 bg-amber-50 text-amber-900'
                          : 'border-blue-500 bg-blue-50 text-blue-900'
                      }`}
                    >
                      <option value="Filer">Filer ({taxSettings?.filer_rate ?? 0.5}%)</option>
                      <option value="Non-Filer">Non-Filer ({taxSettings?.non_filer_rate ?? 2.5}%)</option>
                      <option value="Exempt">Exempt (0%)</option>
                    </select>
                  </div>
                </div>

                {/* Row 2: Payment Mode, Disbursing Account, Remarks & Live Balance Summary Strip */}
                <div className="grid grid-cols-12 gap-1 items-center text-[11px] mt-0.5 pt-0.5 border-t border-slate-200">
                  <div className="col-span-2 flex items-center gap-1">
                    <label className="text-[10px] font-bold text-slate-700 w-9 shrink-0">Mode:</label>
                    <select
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value as PurchasePaymentMode)}
                      className="w-full px-1 py-0 text-[10px] font-bold rounded border border-slate-300 bg-white text-slate-900 h-5"
                    >
                      <option value="Credit">Credit Purchase</option>
                      <option value="Cash">Cash in Hand</option>
                      <option value="Bank">Bank Transfer</option>
                      <option value="Partial">Partial Cash/Credit</option>
                    </select>
                  </div>
                  {paymentMode !== 'Credit' ? (
                    <div className="col-span-2 flex items-center gap-1">
                      <label className="text-[10px] font-bold text-slate-700 w-8 shrink-0">A/C:</label>
                      <select
                        value={paymentAccountId}
                        onChange={(e) => setPaymentAccountId(e.target.value)}
                        className="w-full px-1 py-0 text-[10px] rounded border border-slate-300 bg-white text-slate-900 h-5"
                      >
                        <option value="">Auto ({paymentMode === 'Bank' ? 'Meezan Bank' : 'Cash in Hand'})</option>
                        {financialAccounts.map((fa) => (
                          <option key={fa.id} value={fa.id}>
                            [{fa.account_code}] {fa.account_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="col-span-2 flex items-center gap-1">
                      <span className="text-[10px] font-mono text-slate-600 bg-slate-200 px-1 py-0 rounded border border-slate-300 w-full text-center h-5 flex items-center justify-center">
                        Credit Purchase (A/P)
                      </span>
                    </div>
                  )}
                  <div className="col-span-4 flex items-center gap-1">
                    <label className="text-[10px] font-bold text-slate-700 w-12 shrink-0">Remarks:</label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Challan #, distributor or cold-chain notes..."
                      className="w-full px-1 py-0 text-[10px] rounded border border-slate-300 bg-white text-slate-900 h-5"
                    />
                  </div>
                  <div className="col-span-4 flex items-center justify-end">
                    {selectedSupplier ? (
                      <div className="w-full flex items-center justify-between gap-1 bg-slate-900 text-white px-2 py-0 rounded font-mono text-[10px] h-5">
                        <span>
                          Ledger: <strong className="text-amber-300">{formatPKR(previousSupplierBalance)} ({previousBalanceType})</strong>
                        </span>
                        <span>
                          Payable: <strong className="text-sky-300">{formatPKR(totalPayable)}</strong>
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-500 italic">Select supplier for live ledger balance</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Center Full-Screen Datasheet Grid */}
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto relative bg-white border-b border-slate-400">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead className="sticky top-0 z-10 bg-slate-200 border-b-2 border-slate-400 text-slate-800 uppercase text-[10px] font-bold tracking-wider select-none shadow-2xs">
                    <tr>
                      <th className="py-0.5 px-1 w-7 text-center bg-slate-300 border-r border-slate-400 font-mono">#</th>
                      <th className="py-0.5 px-1.5 min-w-[220px]">Medicine Item (Code &amp; Name)</th>
                      <th className="py-0.5 px-1.5 min-w-[100px]">Company</th>
                      <th className="py-0.5 px-1 w-14">Packing</th>
                      <th className="py-0.5 px-1.5 w-22">Batch #</th>
                      <th className="py-0.5 px-1.5 w-22">Mfg Date</th>
                      <th className="py-0.5 px-1.5 w-22">Expiry Date</th>
                      <th className="py-0.5 px-1 w-18 text-right">Qty (Packs)</th>
                      <th className="py-0.5 px-1 w-16 text-right">Bonus</th>
                      <th className="py-0.5 px-1 w-18 text-right">Pur. Rate</th>
                      <th className="py-0.5 px-1 w-14 text-right">Disc %</th>
                      <th className="py-0.5 px-1 w-18 text-right">Disc Amt</th>
                      <th className="py-0.5 px-1 w-14 text-right">GST %</th>
                      <th className="py-0.5 px-1.5 w-22 text-right">Net Amount</th>
                      <th className="py-0.5 px-1 w-7 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-sans">
                    {lines.map((line, idx) => (
                      <tr
                        key={idx}
                        onClick={() => setSelectedPurchaseLineIndex(idx)}
                        className={`hover:bg-blue-50/40 ${idx === selectedPurchaseLineIndex ? 'bg-blue-50/70 ring-1 ring-blue-300' : ''}`}
                      >
                        {/* Row Selector Indicator */}
                        <td className="py-0 px-1 text-center font-mono text-[10px] bg-slate-100 border-r border-slate-300 font-bold select-none text-slate-700">
                          {idx === selectedPurchaseLineIndex ? '▶' : ''} {idx + 1}
                        </td>

                        {/* Item Selector */}
                        <td className="py-0.5 px-1">
                          <select
                            id={`pur_cell_${idx}_item_id`}
                            value={line.item_id || ''}
                            onChange={(e) => handleSelectItemOnRow(idx, e.target.value)}
                            onKeyDown={(e) => handlePurchaseCellKeyDown(e, idx, 'item_id')}
                            className="w-full px-1 py-0 text-[11px] font-semibold rounded border border-slate-300 bg-white text-slate-900 focus:ring-1 focus:ring-blue-500 h-5"
                          >
                            <option value="">— Select Medicine —</option>
                            {items.map((it) => (
                              <option key={it.id} value={it.id}>
                                [{it.item_code}] {it.item_name} ({it.packing})
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Company */}
                        <td className="py-0.5 px-1">
                          <input
                            type="text"
                            value={line.company_name}
                            onChange={(e) => handleLineChange(idx, 'company_name', e.target.value)}
                            placeholder="Company"
                            className="w-full px-1 py-0 text-[10px] rounded border border-slate-200 bg-slate-50 text-slate-700 h-5"
                          />
                        </td>

                        {/* Packing */}
                        <td className="py-0.5 px-0.5">
                          <input
                            type="text"
                            value={line.packing}
                            onChange={(e) => handleLineChange(idx, 'packing', e.target.value)}
                            className="w-full px-1 py-0 text-[10px] font-mono font-bold rounded border border-slate-200 bg-slate-50 text-slate-900 text-center h-5"
                          />
                        </td>

                        {/* Batch Number */}
                        <td className="py-0.5 px-1">
                          <input
                            id={`pur_cell_${idx}_batch_number`}
                            type="text"
                            value={line.batch_number}
                            onChange={(e) => handleLineChange(idx, 'batch_number', e.target.value)}
                            onKeyDown={(e) => handlePurchaseCellKeyDown(e, idx, 'batch_number')}
                            placeholder="Batch #"
                            className="w-full px-1 py-0 text-[11px] font-mono font-bold rounded border border-slate-300 bg-white text-slate-900 h-5"
                          />
                        </td>

                        {/* Manufacturing Date */}
                        <td className="py-0.5 px-1">
                          <input
                            type="date"
                            value={line.manufacturing_date}
                            onChange={(e) => handleLineChange(idx, 'manufacturing_date', e.target.value)}
                            className="w-full px-1 py-0 text-[10px] font-mono rounded border border-slate-300 bg-white text-slate-900 h-5"
                          />
                        </td>

                        {/* Expiry Date */}
                        <td className="py-0.5 px-1">
                          <input
                            id={`pur_cell_${idx}_expiry_date`}
                            type="date"
                            value={line.expiry_date}
                            onChange={(e) => handleLineChange(idx, 'expiry_date', e.target.value)}
                            onKeyDown={(e) => handlePurchaseCellKeyDown(e, idx, 'expiry_date')}
                            className="w-full px-1 py-0 text-[10px] font-mono font-bold rounded border border-slate-300 bg-white text-slate-900 h-5"
                          />
                        </td>

                        {/* Quantity */}
                        <td className="py-0.5 px-0.5">
                          <NumericInput
                            id={`pur_cell_${idx}_quantity`}
                            step="0.01"
                            min="0"
                            value={line.quantity}
                            onChange={(e) => handleLineChange(idx, 'quantity', parseFloat(e.target.value) || 0)}
                            onKeyDown={(e) => handlePurchaseCellKeyDown(e, idx, 'quantity')}
                            className="w-full px-1 py-0 text-right font-mono font-black rounded border border-emerald-400 bg-white text-slate-900 text-[11px] h-5"
                          />
                        </td>

                        {/* Bonus Quantity */}
                        <td className="py-0.5 px-0.5">
                          <NumericInput
                            id={`pur_cell_${idx}_bonus_quantity`}
                            step="0.01"
                            min="0"
                            value={line.bonus_quantity}
                            onChange={(e) => handleLineChange(idx, 'bonus_quantity', parseFloat(e.target.value) || 0)}
                            onKeyDown={(e) => handlePurchaseCellKeyDown(e, idx, 'bonus_quantity')}
                            className="w-full px-1 py-0 text-right font-mono font-bold rounded border border-slate-300 bg-emerald-50/40 text-emerald-900 text-[11px] h-5"
                          />
                        </td>

                        {/* Purchase Rate */}
                        <td className="py-0.5 px-0.5">
                          <NumericInput
                            id={`pur_cell_${idx}_purchase_rate`}
                            step="0.01"
                            min="0"
                            value={line.purchase_rate}
                            onChange={(e) => handleLineChange(idx, 'purchase_rate', parseFloat(e.target.value) || 0)}
                            onKeyDown={(e) => handlePurchaseCellKeyDown(e, idx, 'purchase_rate')}
                            className="w-full px-1 py-0 text-right font-mono font-bold rounded border border-slate-300 bg-white text-slate-900 text-[11px] h-5"
                          />
                        </td>

                        {/* Discount % */}
                        <td className="py-0.5 px-0.5">
                          <NumericInput
                            id={`pur_cell_${idx}_discount_percent`}
                            step="0.01"
                            min="0"
                            max="100"
                            value={line.discount_percent}
                            onChange={(e) => handleLineChange(idx, 'discount_percent', parseFloat(e.target.value) || 0)}
                            onKeyDown={(e) => handlePurchaseCellKeyDown(e, idx, 'discount_percent')}
                            className="w-full px-1 py-0 text-right font-mono rounded border border-slate-300 bg-white text-slate-900 text-[11px] h-5"
                          />
                        </td>

                        {/* Discount Amount */}
                        <td className="py-0.5 px-0.5">
                          <NumericInput
                            step="0.01"
                            min="0"
                            value={line.discount_amount}
                            onChange={(e) => handleLineChange(idx, 'discount_amount', parseFloat(e.target.value) || 0)}
                            className="w-full px-1 py-0 text-right font-mono text-rose-700 rounded border border-slate-300 bg-white text-[11px] h-5"
                          />
                        </td>

                        {/* Tax % (GST) */}
                        <td className="py-0.5 px-0.5">
                          <NumericInput
                            id={`pur_cell_${idx}_tax_percent`}
                            step="0.01"
                            min="0"
                            max="100"
                            value={line.tax_percent}
                            onChange={(e) => handleLineChange(idx, 'tax_percent', parseFloat(e.target.value) || 0)}
                            onKeyDown={(e) => handlePurchaseCellKeyDown(e, idx, 'tax_percent')}
                            className="w-full px-1 py-0 text-right font-mono rounded border border-slate-300 bg-white text-slate-900 text-[11px] h-5"
                          />
                        </td>

                        {/* Net Amount */}
                        <td className="py-0.5 px-1.5 text-right font-mono font-black text-slate-900 text-[11px]">
                          {line.line_total > 0 ? line.line_total.toFixed(2) : ''}
                        </td>

                        {/* Delete Row */}
                        <td className="py-0 px-0.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeLineRow(idx)}
                            disabled={lines.length <= 1}
                            className="p-0.5 text-slate-400 hover:text-rose-600 disabled:opacity-30 cursor-pointer"
                            title="Delete Row"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Traditional Microsoft Access Record Navigator Bar */}
              <div className="bg-slate-200 border-t border-slate-400 px-2.5 py-0.5 flex flex-wrap items-center justify-between text-[11px] text-slate-700 select-none shrink-0">
                <div className="flex items-center gap-1">
                  <span className="font-bold text-[10px] text-slate-700 mr-1">Record:</span>
                  <button
                    type="button"
                    onClick={() => setSelectedPurchaseLineIndex(0)}
                    disabled={selectedPurchaseLineIndex === 0}
                    className="px-1.5 py-0 rounded bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                    title="First Record"
                  >
                    |&lt;
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPurchaseLineIndex(Math.max(0, selectedPurchaseLineIndex - 1))}
                    disabled={selectedPurchaseLineIndex === 0}
                    className="px-1.5 py-0 rounded bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                    title="Previous Record"
                  >
                    &lt;
                  </button>
                  <span className="font-mono px-2 py-0 bg-white border border-slate-400 rounded text-[10px] font-bold text-slate-900">
                    {selectedPurchaseLineIndex + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedPurchaseLineIndex(Math.min(lines.length - 1, selectedPurchaseLineIndex + 1))}
                    disabled={selectedPurchaseLineIndex >= lines.length - 1}
                    className="px-1.5 py-0 rounded bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                    title="Next Record"
                  >
                    &gt;
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPurchaseLineIndex(lines.length - 1)}
                    disabled={selectedPurchaseLineIndex >= lines.length - 1}
                    className="px-1.5 py-0 rounded bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                    title="Last Record"
                  >
                    &gt;|
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      addLineRow();
                      setSelectedPurchaseLineIndex(lines.length);
                    }}
                    className="px-1.5 py-0 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-400 text-[10px] font-bold flex items-center gap-0.5 cursor-pointer ml-1"
                    title="New Record (*)"
                  >
                    <span>* New</span>
                  </button>
                  <span className="text-[10px] text-slate-500 ml-1">of {lines.length}</span>
                </div>

                <div className="flex items-center gap-3 font-mono text-[10px] text-slate-600">
                  <span>Items: <strong className="text-slate-900">{lines.filter((l) => l.item_id > 0).length}</strong></span>
                  <span>Packs: <strong className="text-slate-900">{lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)}</strong></span>
                  <span>Gross Total: <strong className="text-slate-900">{formatPKR(grossTotal)}</strong></span>
                </div>
              </div>

              {/* Organized Ultra-Compact Bottom Footer */}
              <div className="bg-slate-200 border-t border-slate-400 p-1 text-[11px] shrink-0 select-none">
                <div className="grid grid-cols-12 gap-1 items-stretch">
                  {/* Left 7 cols: Advance Tax calculation, Paid Amount & Action Buttons */}
                  <div className="col-span-7 bg-slate-100 rounded border border-slate-300 px-2 py-0.5 flex flex-col justify-between gap-0.5">
                    {/* Row 1: Advance tax + Paid Amount + Payable */}
                    <div className="grid grid-cols-12 gap-1 items-center">
                      <div className="col-span-5 flex items-center justify-between bg-white px-1.5 py-0 rounded border border-slate-300 h-5">
                        <div className="flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3 text-amber-700" />
                          <span className="font-bold text-slate-800 text-[10px]">Adv Tax:</span>
                          <span className="font-mono font-bold text-amber-900 text-[10px]">{appliedAdvanceTaxRate}%</span>
                        </div>
                        <label className="flex items-center gap-1 text-[10px] font-bold text-amber-900 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isTaxOverridden}
                            onChange={(e) => {
                              setIsTaxOverridden(e.target.checked);
                              if (e.target.checked) {
                                setCustomAdvanceTaxRate(getStatutoryAdvanceTaxRate());
                              }
                            }}
                            className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                          />
                          <span>Override</span>
                        </label>
                      </div>

                      <div className="col-span-4 flex items-center gap-1">
                        <label className="text-[10px] font-bold text-slate-700 whitespace-nowrap">Paid (PKR):</label>
                        <NumericInput
                          step="0.01"
                          min="0"
                          disabled={paymentMode === 'Credit'}
                          value={paidAmount}
                          onChange={(e) => setPaidAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-full px-1 py-0 text-[11px] font-mono font-black rounded border border-emerald-500 bg-white text-slate-900 disabled:bg-slate-200 h-5"
                        />
                      </div>

                      <div className="col-span-3 flex items-center justify-end gap-1 font-mono text-[10px]">
                        <span className="text-slate-500">Bal:</span>
                        <strong className="text-rose-700 text-[11px]">{formatPKR(remainingBalance)}</strong>
                      </div>
                    </div>

                    {isTaxOverridden && (
                      <div className="bg-amber-50 border border-amber-300 rounded px-1.5 py-0.5 grid grid-cols-3 gap-1 text-[10px]">
                        <div className="flex items-center gap-1">
                          <label className="font-bold text-amber-950 whitespace-nowrap">Rate %:</label>
                          <NumericInput
                            step="0.01"
                            min="0"
                            max="100"
                            required
                            value={customAdvanceTaxRate}
                            onChange={(e) => setCustomAdvanceTaxRate(parseFloat(e.target.value) || 0)}
                            className="w-full px-1 py-0 text-[10px] font-mono font-bold rounded border border-amber-400 bg-white h-4"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="font-bold text-amber-950 whitespace-nowrap">Auth:</label>
                          <input
                            type="text"
                            required
                            value={taxOverrideAuthorizedBy}
                            onChange={(e) => setTaxOverrideAuthorizedBy(e.target.value)}
                            className="w-full px-1 py-0 text-[10px] rounded border border-amber-400 bg-white h-4"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="font-bold text-amber-950 whitespace-nowrap">Ref:</label>
                          <input
                            type="text"
                            required
                            value={taxOverrideReason}
                            onChange={(e) => setTaxOverrideReason(e.target.value)}
                            placeholder="Cert #"
                            className="w-full px-1 py-0 text-[10px] rounded border border-amber-400 bg-white h-4"
                          />
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 pt-0.5 border-t border-slate-200">
                      <button
                        type="submit"
                        disabled={savingInvoice}
                        className="px-2.5 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-[10px] flex items-center justify-center gap-1 shadow-2xs cursor-pointer disabled:opacity-50"
                      >
                        <Save className="w-3 h-3" />
                        <span>{savingInvoice ? 'Posting...' : editingPurchaseId ? 'Update & Re-Post (F2)' : 'Confirm & Post Purchase (F2)'}</span>
                      </button>
                      {purchases.length > 0 && (
                        <button
                          type="button"
                          onClick={() => handleOpenPrintInvoice(purchases[0].id)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                        >
                          <Printer className="w-3 h-3 text-emerald-400" />
                          <span>Print A4</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={resetInvoiceForm}
                        className="px-2 py-0.5 rounded border border-slate-400 bg-white hover:bg-slate-100 text-slate-700 font-bold text-[10px] cursor-pointer ml-auto"
                      >
                        Reset Form
                      </button>
                    </div>
                  </div>

                  {/* Right 5 cols: Ultra-Compact Totals Breakdown */}
                  <div className="col-span-5 bg-slate-900 text-white rounded px-2 py-0.5 text-[10px] flex flex-col justify-between gap-0.5 font-mono">
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0 text-[9px] border-b border-slate-800 pb-0.5">
                      <div className="flex justify-between items-center text-slate-300">
                        <span>Gross:</span>
                        <span className="font-bold text-white">{formatPKR(grossTotal)}</span>
                      </div>
                      <div className="flex justify-between items-center text-slate-300">
                        <span>Item Disc:</span>
                        <span className="text-rose-400">-{formatPKR(itemDiscountTotal)}</span>
                      </div>
                      <div className="flex justify-between items-center text-slate-300">
                        <span>Inv Disc %:</span>
                        <div className="flex items-center gap-1">
                          <NumericInput
                            step="0.01"
                            min="0"
                            max="100"
                            value={invoiceDiscountPercent}
                            onChange={(e) => {
                              const pct = Math.max(0, parseFloat(e.target.value) || 0);
                              setInvoiceDiscountPercent(pct);
                              setInvoiceDiscountAmount(round2(subtotalAfterItemDisc * (pct / 100)));
                            }}
                            className="w-10 px-1 py-0 text-right text-[9px] rounded bg-slate-800 border border-slate-700 text-white h-4"
                            placeholder="%"
                          />
                          <span className="text-rose-400">-{formatPKR(computedInvoiceDiscAmt)}</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center text-slate-300">
                        <span>GST + AdvTax:</span>
                        <span className="text-amber-300">+{formatPKR(gstTotal + advanceTaxAmount)}</span>
                      </div>
                    </div>

                    {/* Bottom line: Net Purchase, Total Payable & Remaining Balance */}
                    <div className="grid grid-cols-3 gap-1.5 items-center">
                      <div>
                        <span className="text-[8px] font-sans uppercase font-bold text-emerald-400 block leading-none">Net Purchase</span>
                        <span className="text-xs font-black text-emerald-300">{formatPKR(netInvoiceAmount)}</span>
                      </div>
                      <div className="text-center">
                        <span className="text-[8px] font-sans uppercase font-bold text-slate-400 block leading-none">Total Payable</span>
                        <span className="text-xs font-bold text-sky-300">{formatPKR(totalPayable)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[8px] font-sans uppercase font-bold text-amber-300 block leading-none">Remaining Bal</span>
                        <span className="text-xs font-black text-amber-300">{formatPKR(remainingBalance)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* TAB 2: PURCHASE REGISTER & HISTORY */}
      {subTab === 'register' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold">Confirmed Purchase Invoices Register</h3>
              <p className="text-[11px] text-slate-400">
                Historical Advance Tax rates are permanently preserved on every invoice • Supports
                A4 Print, Safe Edit & Reversal Cancellation
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                resetInvoiceForm();
                setSubTab('new-invoice');
              }}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Purchase Invoice</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-700 uppercase text-[10px] border-b border-slate-200">
                  <th className="py-3 px-3">Bill #</th>
                  <th className="py-3 px-2.5">Date</th>
                  <th className="py-3 px-2.5">Supplier</th>
                  <th className="py-3 px-2.5">Sup. Inv #</th>
                  <th className="py-3 px-2.5">Tax Status & Rate</th>
                  <th className="py-3 px-2.5 text-right">Taxable</th>
                  <th className="py-3 px-2.5 text-right">GST</th>
                  <th className="py-3 px-2.5 text-right">Advance Tax</th>
                  <th className="py-3 px-2.5 text-right">Net Total</th>
                  <th className="py-3 px-2.5 text-right">Paid</th>
                  <th className="py-3 px-2.5 text-center">Status</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {purchases.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-10 text-center text-slate-500">
                      No purchase invoices recorded yet.
                    </td>
                  </tr>
                ) : (
                  purchases.map((p) => (
                    <tr
                      key={p.id}
                      className={
                        p.status === 'cancelled'
                          ? 'bg-rose-50/40 text-slate-400'
                          : 'hover:bg-slate-50'
                      }
                    >
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                        {p.bill_number}
                      </td>
                      <td className="py-2.5 px-2.5 font-mono">{p.bill_date}</td>
                      <td className="py-2.5 px-2.5">
                        <div className="font-bold text-slate-900">{p.supplier_name}</div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {p.supplier_code}
                        </div>
                      </td>
                      <td className="py-2.5 px-2.5 font-mono">
                        {p.supplier_invoice_number || '—'}
                      </td>
                      <td className="py-2.5 px-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            p.supplier_filer_status === 'Filer'
                              ? 'bg-emerald-100 text-emerald-800'
                              : p.supplier_filer_status === 'Non-Filer'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {p.supplier_filer_status} ({Number(p.advance_tax_rate).toFixed(2)}%)
                        </span>
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono">
                        {formatPKR(p.taxable_amount)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono">
                        {formatPKR(p.gst_amount)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono font-semibold text-amber-800">
                        {formatPKR(p.advance_tax_amount)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono font-black text-slate-900">
                        {formatPKR(p.net_total)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-emerald-700 font-semibold">
                        {formatPKR(p.paid_amount)}
                        <div className="text-[9px] text-slate-400 uppercase">{p.payment_mode}</div>
                      </td>
                      <td className="py-2.5 px-2.5 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            p.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenPrintInvoice(p.id)}
                            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
                            title="View / Print A4 Invoice & Journal Entry"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          {p.status === 'completed' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleEditPurchase(p.id)}
                                className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 cursor-pointer"
                                title="Edit Invoice (with Reversal Entry)"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelPurchase(p)}
                                className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 cursor-pointer"
                                title="Cancel Invoice (with Stock & Accounting Reversal)"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: PURCHASE RETURN (DEBIT NOTE) */}
      {subTab === 'purchase-return' && (
        <PurchaseReturnPanel
          suppliers={suppliers}
          financialAccounts={financialAccounts}
          purchases={purchases}
          returns={returns}
          nextReturnNumber={nextReturnNo}
          onReturnCreated={async (newRetId) => {
            await fetchWorkspaceData();
            handleOpenPrintReturn(newRetId);
          }}
          onPrintReturn={handleOpenPrintReturn}
        />
      )}

      {/* TAB 4: BATCH-WISE INVENTORY & STOCK LEDGER */}
      {subTab === 'batch-stock' && (
        <BatchInventoryPanel
          batches={batches}
          loading={loading}
          onRefresh={fetchWorkspaceData}
        />
      )}

      {/* TAB 5: CONFIGURABLE ADVANCE TAX SETTINGS */}
      {subTab === 'advance-tax' && (
        <AdvanceTaxSettingsPanel
          settings={taxSettings}
          history={taxHistory}
          onUpdated={(newSet, newHist) => {
            setTaxSettings(newSet);
            setTaxHistory(newHist);
          }}
        />
      )}

      {/* TAB 6: 8 PURCHASE & TAX REPORTS */}
      {subTab === 'reports' && (
        <PurchaseReportsPanel suppliers={suppliers} items={items} />
      )}

      {/* A4 Print Modal (Purchase Invoice & Purchase Return) */}
      <PurchasePrintModal
        isOpen={printModalOpen}
        onClose={() => setPrintModalOpen(false)}
        mode={printMode}
        invoice={printInvoice}
        invoiceItems={printInvoiceItems}
        purchaseReturn={printReturn}
        returnItems={printReturnItems}
        journalLines={printJournalLines}
      />

      {/* Supplier Detailed Account Ledger Modal */}
      {supplierLedgerModalOpen && selectedSupplier && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden text-xs">
            <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">
                  Supplier Account Ledger — [{selectedSupplier.account_code}]{' '}
                  {selectedSupplier.account_name}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Previous Balance: {formatPKR(previousSupplierBalance)} ({previousBalanceType}) •
                  Current Purchase Net: {formatPKR(netInvoiceAmount)} • Total Payable:{' '}
                  {formatPKR(totalPayable)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSupplierLedgerModalOpen(false)}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {loadingSupplierLedger ? (
                <div className="py-10 text-center text-slate-500">
                  Loading supplier ledger entries...
                </div>
              ) : supplierLedgerEntries.length === 0 ? (
                <div className="py-10 text-center text-slate-500">
                  No posted ledger entries found for this supplier yet.
                </div>
              ) : (
                <table className="w-full text-left border-collapse border border-slate-200 text-[11px]">
                  <thead className="bg-slate-100 text-slate-700 uppercase text-[10px]">
                    <tr>
                      <th className="p-2 border-b border-slate-200">Date</th>
                      <th className="p-2 border-b border-slate-200">Voucher / Ref #</th>
                      <th className="p-2 border-b border-slate-200">Type</th>
                      <th className="p-2 border-b border-slate-200">Description / Narration</th>
                      <th className="p-2 border-b border-slate-200 text-right">Debit (Paid/Ret)</th>
                      <th className="p-2 border-b border-slate-200 text-right">Credit (Billed)</th>
                      <th className="p-2 border-b border-slate-200 text-right">Running Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {supplierLedgerEntries.map((row: any, i: number) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="p-2 font-mono">{row.entry_date || row.date || '—'}</td>
                        <td className="p-2 font-mono font-bold text-slate-900">
                          {row.voucher_no || row.reference_no || '—'}
                        </td>
                        <td className="p-2">{row.voucher_type || row.transaction_type || '—'}</td>
                        <td className="p-2 text-slate-600">{row.narration || row.description || '—'}</td>
                        <td className="p-2 text-right font-mono text-emerald-700">
                          {Number(row.debit_amount || row.debit || 0) > 0
                            ? formatPKR(Number(row.debit_amount || row.debit || 0))
                            : '—'}
                        </td>
                        <td className="p-2 text-right font-mono text-rose-700 font-semibold">
                          {Number(row.credit_amount || row.credit || 0) > 0
                            ? formatPKR(Number(row.credit_amount || row.credit || 0))
                            : '—'}
                        </td>
                        <td className="p-2 text-right font-mono font-bold text-slate-900">
                          {formatPKR(
                            Math.abs(
                              Number(
                                row.running_balance ?? row.balance ?? prevSupplierNetPayable
                              )
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
