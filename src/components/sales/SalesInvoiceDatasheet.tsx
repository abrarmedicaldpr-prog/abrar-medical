import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../services/api';
import {
  CustomerItemHistoryResponse,
  DatasheetRow,
  DeliverymanRecord,
  FastSearchItem,
  SalesInvoiceRecord,
  SalesInvoiceType,
  SalesmanRecord,
  SalesPaymentMode,
} from '../../types/sales';
import { formatPKR } from '../../utils/formatters';
import { SalesPrintModal } from './SalesPrintModal';
import { NumericInput } from '../common/NumericInput';
import {
  Search,
  Plus,
  Trash2,
  Copy,
  ClipboardPaste,
  Save,
  PauseCircle,
  PlayCircle,
  Printer,
  Percent,
  Users2,
  BookOpen,
  Banknote,
  UserPlus,
  Info,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Barcode,
  X,
  History,
  Truck,
  UserCheck,
  Sparkles,
  PackageSearch,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ShoppingCart,
  FileSpreadsheet,
  Calculator,
  Zap,
  Minus,
} from 'lucide-react';

const ACTIVE_DRAFT_STORAGE_KEY = 'ams_active_sales_invoice_draft_v1';

function round2(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function createEmptyRow(): DatasheetRow {
  return {
    row_id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    item_id: null,
    inventory_id: null,
    item_code: '',
    company_name: '',
    item_name: '',
    packing: '',
    strips_per_box: 1,
    units_per_strip: 1,
    units_per_pack: 1,
    batch_number: '',
    expiry_date: '',
    available_stock_packs: 0,
    available_stock_units: 0,
    quantity: 0,
    unit_price: 0,
    discount_percent: 0,
    discount_amount: 0,
    loose_quantity: 0,
    loose_rate: 0,
    total_units: 0,
    gross_amount: 0,
    taxable_amount: 0,
    tax_percent: 0,
    tax_amount: 0,
    line_total: 0,
    retail_price_ref: 0,
    wholesale_price_ref: 0,
    batches: [],
    isRateManuallyEdited: false,
    isLooseRateManuallyEdited: false,
    rateSuggestionSource: 'standard_retail',
    lastCustomerSaleRate: null,
    lastCustomerDiscountPercent: null,
    lastCustomerSaleDate: null,
    lastCustomerInvoiceNo: null,
    lastCustomerSoldQty: null,
    previousCustomerSaleRateBeforeLast: null,
    lastPurchaseCostRate: null,
    lastPurchaseDate: null,
    lastSupplierName: null,
  };
}

const MIN_DATASHEET_ROWS = 20;

function ensureMinimumRows(list: DatasheetRow[], minCount: number = MIN_DATASHEET_ROWS): DatasheetRow[] {
  const result = [...list];
  while (result.length < minCount) {
    result.push(createEmptyRow());
  }
  return result;
}

export function isSyrupItem(
  itemOrRow:
    | {
        item_name?: string;
        category?: string;
        category_name?: string;
        packing?: string;
        units_per_pack?: number;
      }
    | null
    | undefined
): boolean {
  if (!itemOrRow) return false;
  const name = String(itemOrRow.item_name || '').toLowerCase();
  const cat = String((itemOrRow as any).category || (itemOrRow as any).category_name || '').toLowerCase();
  const pack = String(itemOrRow.packing || '').toLowerCase();

  return (
    name.includes('syrup') ||
    name.includes('syp') ||
    name.includes('susp') ||
    name.includes('suspension') ||
    name.includes('drops') ||
    name.includes('liquid') ||
    name.includes('solution') ||
    name.includes('elixir') ||
    name.includes('emulsion') ||
    name.includes('lotion') ||
    cat.includes('syrup') ||
    cat.includes('susp') ||
    cat.includes('liquid') ||
    cat.includes('drops') ||
    pack.includes('bot') ||
    pack.includes('syrup') ||
    pack.includes('ml') ||
    pack.includes('fl oz')
  );
}

function recalcRow(row: DatasheetRow): DatasheetRow {
  const isSyrup = isSyrupItem(row);
  const unitsPerPack = Math.max(1, Number(row.units_per_pack || 1));
  const quantity = Math.max(0, Number(row.quantity || 0));
  // Syrups are strictly sold as complete bottles; loose units are forced to 0
  const looseQty = isSyrup ? 0 : Math.max(0, Number(row.loose_quantity || 0));
  const unitPrice = Math.max(0, Number(row.unit_price || 0));
  const looseRate = isSyrup
    ? 0
    : !row.item_id || row.isLooseRateManuallyEdited
    ? Math.max(0, round2(Number(row.loose_rate || 0)))
    : row.loose_rate !== undefined && row.loose_rate !== null && Number(row.loose_rate) > 0
    ? round2(Number(row.loose_rate))
    : Number(row.item_loose_rate_ref || 0) > 0
    ? round2(Number(row.item_loose_rate_ref))
    : round2(unitPrice / unitsPerPack);

  const totalUnits = isSyrup ? quantity : round2(quantity * unitsPerPack + looseQty);
  const gross = round2(quantity * unitPrice + (isSyrup ? 0 : looseQty * looseRate));
  const discPct = Math.max(0, Math.min(100, Number(row.discount_percent || 0)));
  const discAmt = round2((gross * discPct) / 100);
  const taxable = round2(Math.max(0, gross - discAmt));
  const taxPct = Math.max(0, Number(row.tax_percent || 0));
  const taxAmt = round2((taxable * taxPct) / 100);
  const lineTotal = round2(taxable + taxAmt);

  return {
    ...row,
    quantity,
    loose_quantity: looseQty,
    unit_price: unitPrice,
    loose_rate: looseRate,
    total_units: totalUnits,
    gross_amount: gross,
    discount_percent: discPct,
    discount_amount: discAmt,
    taxable_amount: taxable,
    tax_percent: taxPct,
    tax_amount: taxAmt,
    line_total: lineTotal,
  };
}

interface SalesInvoiceDatasheetProps {
  resumeInvoiceId?: number | null;
  onClearResume?: () => void;
  onDraftItemsStateChange?: (hasItems: boolean) => void;
  onNavigateToSalesReturn?: () => void;
}

export const SalesInvoiceDatasheet: React.FC<SalesInvoiceDatasheetProps> = ({
  resumeInvoiceId,
  onClearResume,
  onDraftItemsStateChange,
}) => {
  // Header State
  const [editingSaleId, setEditingSaleId] = useState<number | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string>('INV-2026-0001');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [customerAccountId, setCustomerAccountId] = useState<number>(0);
  const [customerSearchText, setCustomerSearchText] = useState<string>('');

  // Salesman & Deliveryman State (Strictly Separate)
  const [salesmenList, setSalesmenList] = useState<SalesmanRecord[]>([]);
  const [salesmanId, setSalesmanId] = useState<number | null>(null);
  const [salesman, setSalesman] = useState<string>('Counter Pharmacist');
  const [salesmanFilterText, setSalesmanFilterText] = useState<string>('');

  const [deliverymenList, setDeliverymenList] = useState<DeliverymanRecord[]>([]);
  const [deliverymanId, setDeliverymanId] = useState<number | null>(null);
  const [deliverymanName, setDeliverymanName] = useState<string>('');
  const [deliverymanFilterText, setDeliverymanFilterText] = useState<string>('');
  const [deliveryStatus, setDeliveryStatus] = useState<
    'Pending' | 'Assigned' | 'Out for Delivery' | 'Delivered' | 'Failed' | 'Returned'
  >('Pending');
  const [deliveryCharges, setDeliveryCharges] = useState<number>(0);
  const [deliveryNotes, setDeliveryNotes] = useState<string>('');

  const [invoiceType, setInvoiceType] = useState<SalesInvoiceType>('Retail');
  const [paymentMode, setPaymentMode] = useState<SalesPaymentMode>('Cash');
  const [paymentAccountId, setPaymentAccountId] = useState<number | null>(null);
  const [allowNegativeStock, setAllowNegativeStock] = useState<boolean>(false);
  const [remarks, setRemarks] = useState<string>('');

  // Datasheet Rows (14 initial compact rows so 12-15 rows are visible in MS Access View)
  const [rows, setRows] = useState<DatasheetRow[]>(() => ensureMinimumRows([]));
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(0);
  const [copiedRowData, setCopiedRowData] = useState<Partial<DatasheetRow> | null>(null);

  // Customer-Wise Item History & Purchase Cost Cache
  const [itemHistoryMap, setItemHistoryMap] = useState<Record<string, CustomerItemHistoryResponse>>({});
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyTab, setHistoryTab] = useState<'customer_sales' | 'item_purchases'>('customer_sales');
  const [showHistoryTable, setShowHistoryTable] = useState<boolean>(false);

  // Live Customer Balance Summary (from actual ledger + Last Payment Date/Amount)
  const [liveBalanceSummary, setLiveBalanceSummary] = useState<{
    previousBalance: number;
    previousBalanceAbs: number;
    previousBalanceType: 'Debit' | 'Credit';
    lastPayment: {
      payment_date: string;
      amount: number;
      reference_no: string;
      payment_mode: string;
      source: string;
    } | null;
  } | null>(null);

  // TWO INDEPENDENT INVOICE INTERFACES: Option 1 (POS View) vs Option 2 (MS Access View)
  const [invoiceViewMode, setInvoiceViewMode] = useState<'pos' | 'access'>(() => {
    try {
      const saved = localStorage.getItem('ams_sales_invoice_view_mode');
      return saved === 'access' ? 'access' : 'pos';
    } catch {
      return 'pos';
    }
  });

  const toggleInvoiceViewMode = (mode: 'pos' | 'access') => {
    setInvoiceViewMode(mode);
    try {
      localStorage.setItem('ams_sales_invoice_view_mode', mode);
    } catch {}
  };

  // Bill Level Discounts & Advance Tax
  const [invoiceDiscountPercent, setInvoiceDiscountPercent] = useState<number>(0);
  const [invoiceDiscountAmount, setInvoiceDiscountAmount] = useState<number>(0);
  const [discountOverrideBy, setDiscountOverrideBy] = useState<string>('');
  const [discountOverrideReason, setDiscountOverrideReason] = useState<string>('');

  const [advanceTaxApplicable, setAdvanceTaxApplicable] = useState<boolean>(false);
  const [advanceTaxRate, setAdvanceTaxRate] = useState<number>(0);
  const [isTaxOverridden, setIsTaxOverridden] = useState<boolean>(false);
  const [taxOverrideReason, setTaxOverrideReason] = useState<string>('');
  const [taxOverrideAuthorizedBy, setTaxOverrideAuthorizedBy] = useState<string>('Store Administrator');

  const [paidAmountInput, setPaidAmountInput] = useState<string>('');
  const [paidAmountManuallyEdited, setPaidAmountManuallyEdited] = useState<boolean>(false);

  // Reference Data
  const [customers, setCustomers] = useState<Array<Record<string, any>>>([]);
  const [financialAccounts, setFinancialAccounts] = useState<Array<Record<string, any>>>([]);
  const [taxSettings, setTaxSettings] = useState<Record<string, any> | null>(null);
  const [catalogItems, setCatalogItems] = useState<FastSearchItem[]>([]);
  const [heldInvoices, setHeldInvoices] = useState<SalesInvoiceRecord[]>([]);

  // Fast Item Search Bar & Floating Picker
  const [quickSearchQuery, setQuickSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<FastSearchItem[]>([]);
  const [searchHighlightIdx, setSearchHighlightIdx] = useState<number>(0);
  const [showSearchDropdown, setShowSearchDropdown] = useState<boolean>(false);
  const [activeSearchRowIdx, setActiveSearchRowIdx] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const posSearchInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFocusTargetRef = useRef<string | null>(null);

  // Shortcut Modals
  const [showAdvanceTaxModal, setShowAdvanceTaxModal] = useState<boolean>(false);
  const [activeCustomerShortcut, setActiveCustomerShortcut] = useState<
    null | 'ledger' | 'receive_payment' | 'add_customer' | 'account_details'
  >(null);
  const [customerLedgerData, setCustomerLedgerData] = useState<Record<string, any> | null>(null);
  const [showHeldDrawer, setShowHeldDrawer] = useState<boolean>(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState<boolean>(false);

  // Quick Receive Payment Form inside Customer Shortcut
  const [quickReceiptAmount, setQuickReceiptAmount] = useState<string>('');
  const [quickReceiptMethod, setQuickReceiptMethod] = useState<'Cash' | 'Bank Transfer'>('Cash');
  const [quickReceiptNotes, setQuickReceiptNotes] = useState<string>('');

  // Quick Add Customer Form inside Customer Shortcut
  const [newCustCode, setNewCustCode] = useState<string>('');
  const [newCustName, setNewCustName] = useState<string>('');
  const [newCustPhone, setNewCustPhone] = useState<string>('');
  const [newCustAddress, setNewCustAddress] = useState<string>('');
  const [newCustFilerStatus, setNewCustFilerStatus] = useState<'Filer' | 'Non-Filer' | 'Exempt'>('Non-Filer');

  // Printing State
  const [printInvoice, setPrintInvoice] = useState<SalesInvoiceRecord | null>(null);
  const [printFormat, setPrintFormat] = useState<'a4' | '80mm' | '58mm'>('a4');

  // Feedback Banner
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Load initial reference data + restore draft from localStorage
  const loadReferenceData = useCallback(async () => {
    try {
      const [accountsRes, taxRes, nextNumRes, fastItemsRes, heldRes, smRes, dmRes] = await Promise.all([
        api.getAccounts({ status: 'Active' }),
        api.getAdvanceTaxSettings(),
        api.getNextSalesNumbers(),
        api.fastSearchSalesItems('', 50),
        api.getSales({ status: 'held_or_draft', pageSize: 30 }),
        api.getSalesmen({ status: 'Active' }).catch(() => ({ data: [] })),
        api.getDeliverymen({ status: 'Active' }).catch(() => ({ data: [] })),
      ]);

      const allAccounts = accountsRes.accounts || accountsRes.data || [];
      const partyCusts = allAccounts.filter((a: any) =>
        ['Customer', 'Customer & Supplier'].includes(a.account_group)
      );
      const finAccs = allAccounts.filter((a: any) =>
        ['Cash in Hand', 'Bank'].includes(a.account_group)
      );

      setCustomers(partyCusts);
      setFinancialAccounts(finAccs);
      setTaxSettings(taxRes.settings || null);
      setCatalogItems(fastItemsRes.data || []);
      setHeldInvoices(heldRes.data || []);

      const activeSalesmen: SalesmanRecord[] = smRes.data || [];
      const activeDeliverymen: DeliverymanRecord[] = dmRes.data || [];
      setSalesmenList(activeSalesmen);
      setDeliverymenList(activeDeliverymen);

      // Restore draft from localStorage if present and not resuming a specific DB invoice
      const savedDraftRaw = localStorage.getItem(ACTIVE_DRAFT_STORAGE_KEY);
      if (savedDraftRaw && !resumeInvoiceId) {
        try {
          const parsed = JSON.parse(savedDraftRaw);
          if (parsed && Array.isArray(parsed.rows) && parsed.rows.length > 0) {
            setEditingSaleId(parsed.editingSaleId || null);
            setInvoiceNumber(parsed.invoiceNumber || nextNumRes.nextInvoiceNumber);
            setInvoiceDate(parsed.invoiceDate || new Date().toISOString().slice(0, 10));
            if (parsed.customerAccountId) setCustomerAccountId(Number(parsed.customerAccountId));
            setSalesmanId(parsed.salesmanId || (activeSalesmen[0]?.id ?? null));
            setSalesman(parsed.salesman || activeSalesmen[0]?.name || 'Counter Pharmacist');
            setDeliverymanId(parsed.deliverymanId || null);
            setDeliverymanName(parsed.deliverymanName || '');
            setDeliveryStatus(parsed.deliveryStatus || 'Pending');
            setDeliveryCharges(Number(parsed.deliveryCharges || 0));
            setDeliveryNotes(parsed.deliveryNotes || '');
            setInvoiceType(parsed.invoiceType || 'Retail');
            setPaymentMode(parsed.paymentMode || 'Cash');
            setInvoiceDiscountPercent(Number(parsed.invoiceDiscountPercent || 0));
            setInvoiceDiscountAmount(Number(parsed.invoiceDiscountAmount || 0));
            setAdvanceTaxApplicable(Boolean(parsed.advanceTaxApplicable));
            setAdvanceTaxRate(Number(parsed.advanceTaxRate || 0));
            setIsTaxOverridden(Boolean(parsed.isTaxOverridden));
            setTaxOverrideReason(parsed.taxOverrideReason || '');
            setAllowNegativeStock(Boolean(parsed.allowNegativeStock));
            setRemarks(parsed.remarks || '');
            setRows(ensureMinimumRows(parsed.rows.map((r: DatasheetRow) => recalcRow(r))));
            return;
          }
        } catch {
          // ignore malformed localStorage draft
        }
      }

      setInvoiceNumber(nextNumRes.nextInvoiceNumber);
      const defaultWalkIn =
        partyCusts.find((c: any) => c.account_code === 'CUS-1001') || partyCusts[0];
      if (defaultWalkIn && !customerAccountId) {
        setCustomerAccountId(Number(defaultWalkIn.id));
      }
      if (activeSalesmen.length > 0 && !salesmanId) {
        setSalesmanId(activeSalesmen[0].id);
        setSalesman(activeSalesmen[0].name);
      }
      const defaultCash = finAccs.find((f: any) => f.account_code === 'FIN-1010') || finAccs[0];
      if (defaultCash && !paymentAccountId) {
        setPaymentAccountId(Number(defaultCash.id));
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [resumeInvoiceId]);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  // Fetch live Customer Previous Balance & Last Payment whenever customerAccountId or editingSaleId changes
  const refreshCustomerBalanceSummary = useCallback(
    async (custId: number, saleIdToExclude: number | null) => {
      if (!custId || custId <= 0) {
        setLiveBalanceSummary(null);
        return;
      }
      try {
        const res = await api.getAccountBalanceSummary(custId, {
          role: 'customer',
          excludeSaleId: saleIdToExclude,
        });
        setLiveBalanceSummary({
          previousBalance: round2(res.previousBalance),
          previousBalanceAbs: round2(res.previousBalanceAbs),
          previousBalanceType: res.previousBalanceType || 'Debit',
          lastPayment: res.lastPayment || null,
        });
      } catch {
        // Fallback to account object if endpoint fails
      }
    },
    []
  );

  useEffect(() => {
    if (customerAccountId > 0) {
      refreshCustomerBalanceSummary(customerAccountId, editingSaleId);
    }
  }, [customerAccountId, editingSaleId, refreshCustomerBalanceSummary]);

  // Fetch Customer-Specific Item Sale History & Last Purchase Cost
  const fetchAndApplyItemHistory = useCallback(
    async (rowIndex: number, itemId: number, custId: number, currentInvType: SalesInvoiceType) => {
      if (!itemId) return;
      const cacheKey = `${itemId}_${custId || 0}`;
      try {
        setHistoryLoading(true);
        const res: CustomerItemHistoryResponse = await api.getItemCustomerHistory(itemId, custId);
        setItemHistoryMap((prev) => ({ ...prev, [cacheKey]: res }));

        const lastSale = res.lastCustomerSale;
        const prevBeforeLast = res.previousCustomerSaleBeforeLast;
        const lastPur = res.lastPurchase;

        setRows((prev) => {
          const next = [...prev];
          const target = next[rowIndex];
          if (!target || target.item_id !== itemId) return prev;

          const updatedRow: DatasheetRow = {
            ...target,
            lastCustomerSaleRate: lastSale ? round2(lastSale.unit_price) : null,
            lastCustomerDiscountPercent: lastSale ? round2(lastSale.discount_percent || 0) : null,
            lastCustomerSaleDate: lastSale ? String(lastSale.invoice_date) : null,
            lastCustomerInvoiceNo: lastSale ? String(lastSale.invoice_number) : null,
            lastCustomerSoldQty: lastSale ? Number(lastSale.quantity || 0) : null,
            previousCustomerSaleRateBeforeLast: prevBeforeLast ? round2(prevBeforeLast.unit_price) : null,
            lastPurchaseCostRate: lastPur ? round2(lastPur.purchase_price) : null,
            lastPurchaseDate: lastPur ? String(lastPur.bill_date) : null,
            lastSupplierName: lastPur ? String(lastPur.supplier_name || '') : null,
          };

          // CRITICAL RULE: Only auto-suggest the rate if the user has NOT manually edited the rate on this row!
          if (!target.isRateManuallyEdited && !target.isLooseRateManuallyEdited) {
            if (lastSale && Number(lastSale.unit_price) > 0) {
              const suggestedPrice = round2(lastSale.unit_price);
              const suggestedLoose =
                Number(lastSale.loose_rate) > 0
                  ? round2(lastSale.loose_rate)
                  : Number(target.item_loose_rate_ref || 0) > 0
                  ? round2(Number(target.item_loose_rate_ref))
                  : round2(suggestedPrice / Math.max(1, target.units_per_pack));
              updatedRow.unit_price = suggestedPrice;
              updatedRow.loose_rate = suggestedLoose;
              updatedRow.discount_percent = round2(lastSale.discount_percent || 0);
              updatedRow.rateSuggestionSource = 'customer_last_sale';
            } else {
              // Customer has never bought this item before -> fallback to normal selling price & Item Master loose rate
              const fallbackPrice =
                currentInvType === 'Wholesale'
                  ? round2(target.wholesale_price_ref || target.unit_price)
                  : round2(target.retail_price_ref || target.unit_price);
              updatedRow.unit_price = fallbackPrice;
              updatedRow.loose_rate =
                Number(target.item_loose_rate_ref || 0) > 0
                  ? round2(Number(target.item_loose_rate_ref))
                  : round2(fallbackPrice / Math.max(1, target.units_per_pack));
              updatedRow.rateSuggestionSource =
                currentInvType === 'Wholesale' ? 'standard_wholesale' : 'standard_retail';
            }
          }

          next[rowIndex] = recalcRow(updatedRow);
          return next;
        });
      } catch {
        // ignore network hiccup
      } finally {
        setHistoryLoading(false);
      }
    },
    []
  );

  // When Customer changes, refresh Customer-Wise Last Sale History for all existing item rows
  const prevCustomerIdRef = useRef<number>(customerAccountId);
  useEffect(() => {
    if (customerAccountId > 0 && prevCustomerIdRef.current !== customerAccountId) {
      prevCustomerIdRef.current = customerAccountId;
      rows.forEach((r, idx) => {
        if (r.item_id) {
          fetchAndApplyItemHistory(idx, r.item_id, customerAccountId, invoiceType);
        }
      });
    }
  }, [customerAccountId, rows, invoiceType, fetchAndApplyItemHistory]);

  // Also ensure the currently selected row has its history loaded if it has an item_id
  useEffect(() => {
    const activeRow = rows[selectedRowIndex];
    if (activeRow?.item_id && customerAccountId > 0) {
      const cacheKey = `${activeRow.item_id}_${customerAccountId}`;
      if (!itemHistoryMap[cacheKey]) {
        fetchAndApplyItemHistory(selectedRowIndex, activeRow.item_id, customerAccountId, invoiceType);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRowIndex, customerAccountId]);

  // Persist active invoice state to localStorage so changing menus never loses entered items
  useEffect(() => {
    const validItemCount = rows.filter((r) => r.item_id !== null).length;
    if (onDraftItemsStateChange) {
      onDraftItemsStateChange(validItemCount > 0);
    }
    const payload = {
      editingSaleId,
      invoiceNumber,
      invoiceDate,
      customerAccountId,
      salesmanId,
      salesman,
      deliverymanId,
      deliverymanName,
      deliveryStatus,
      deliveryCharges,
      deliveryNotes,
      invoiceType,
      paymentMode,
      invoiceDiscountPercent,
      invoiceDiscountAmount,
      advanceTaxApplicable,
      advanceTaxRate,
      isTaxOverridden,
      taxOverrideReason,
      allowNegativeStock,
      remarks,
      rows,
    };
    localStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  }, [
    editingSaleId,
    invoiceNumber,
    invoiceDate,
    customerAccountId,
    salesmanId,
    salesman,
    deliverymanId,
    deliverymanName,
    deliveryStatus,
    deliveryCharges,
    deliveryNotes,
    invoiceType,
    paymentMode,
    invoiceDiscountPercent,
    invoiceDiscountAmount,
    advanceTaxApplicable,
    advanceTaxRate,
    isTaxOverridden,
    taxOverrideReason,
    allowNegativeStock,
    remarks,
    rows,
    onDraftItemsStateChange,
  ]);

  // Load specific Held/Draft invoice when resumeInvoiceId is passed
  const handleResumeInvoice = useCallback(
    async (idToResume: number) => {
      try {
        setErrorMsg(null);
        const res = await api.getSaleDetails(idToResume);
        const inv = res.data as SalesInvoiceRecord;
        setEditingSaleId(inv.id);
        setInvoiceNumber(inv.invoice_number);
        setInvoiceDate(inv.invoice_date);
        setCustomerAccountId(Number(inv.customer_account_id));
        setSalesmanId(inv.salesman_id ? Number(inv.salesman_id) : null);
        setSalesman(inv.salesman || 'Counter Pharmacist');
        setDeliverymanId(inv.deliveryman_id ? Number(inv.deliveryman_id) : null);
        setDeliverymanName(inv.deliveryman_name || '');
        setDeliveryStatus((inv.delivery_status as any) || 'Pending');
        setDeliveryCharges(Number(inv.delivery_charges || 0));
        setDeliveryNotes(inv.delivery_notes || '');
        setInvoiceType(inv.invoice_type || 'Retail');
        setPaymentMode(inv.payment_mode || 'Cash');
        setPaymentAccountId(inv.payment_account_id || null);
        setInvoiceDiscountPercent(Number(inv.invoice_discount_percent || 0));
        setInvoiceDiscountAmount(Number(inv.invoice_discount_amount || 0));
        setAdvanceTaxApplicable(Boolean(inv.advance_tax_applicable));
        setAdvanceTaxRate(Number(inv.advance_tax_rate || 0));
        setIsTaxOverridden(Boolean(inv.is_tax_overridden));
        setTaxOverrideReason(inv.tax_override_reason || '');
        setAllowNegativeStock(Boolean(inv.allow_negative_stock));
        setRemarks(inv.remarks || '');

        if (Array.isArray(inv.items) && inv.items.length > 0) {
          const loadedRows: DatasheetRow[] = inv.items.map((line: any) => {
            const catMatch = catalogItems.find((c) => c.id === Number(line.item_id));
            return recalcRow({
              row_id: `row_${line.id}_${Math.random().toString(36).slice(2, 6)}`,
              item_id: Number(line.item_id),
              inventory_id: line.inventory_id ? Number(line.inventory_id) : null,
              item_code: String(line.item_code),
              company_name: String(line.company_name || ''),
              item_name: String(line.item_name),
              packing: String(line.packing || '1x1'),
              strips_per_box: catMatch?.strips_per_box || 1,
              units_per_strip: catMatch?.units_per_strip || Number(line.units_per_pack || 1),
              units_per_pack: Number(line.units_per_pack || 1),
              batch_number: String(line.batch_number),
              expiry_date: String(line.expiry_date),
              available_stock_packs: Number(line.available_stock_packs || catMatch?.total_available_packs || 0),
              available_stock_units: Number(line.available_stock_units || catMatch?.total_available_units || 0),
              quantity: Number(line.quantity || 0),
              unit_price: Number(line.unit_price || 0),
              discount_percent: Number(line.discount_percent || 0),
              discount_amount: Number(line.discount_amount || 0),
              loose_quantity: Number(line.loose_quantity || 0),
              loose_rate: Number(line.loose_rate || 0),
              total_units: Number(line.total_units || 0),
              gross_amount: Number(line.gross_amount || 0),
              taxable_amount: Number(line.taxable_amount || 0),
              tax_percent: Number(line.tax_percent || 0),
              tax_amount: Number(line.tax_amount || 0),
              line_total: Number(line.line_total || 0),
              retail_price_ref: Number(catMatch?.retail_price || line.unit_price || 0),
              wholesale_price_ref: Number(catMatch?.wholesale_price || line.unit_price || 0),
              batches: catMatch?.batches || [],
              isRateManuallyEdited: true,
              isLooseRateManuallyEdited: true,
              rateSuggestionSource: 'manual',
            });
          });
          setRows(ensureMinimumRows(loadedRows));
        }
        setShowHeldDrawer(false);
        setSuccessMsg(`Loaded Invoice ${inv.invoice_number} (${inv.status.toUpperCase()}) into datasheet.`);
        if (onClearResume) onClearResume();
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [catalogItems, onClearResume]
  );

  useEffect(() => {
    if (resumeInvoiceId) {
      handleResumeInvoice(resumeInvoiceId);
    }
  }, [resumeInvoiceId, handleResumeInvoice]);

  // Selected Customer Object
  const selectedCustomer =
    customers.find((c) => Number(c.id) === Number(customerAccountId)) || customers[0] || null;
  const customerFilerStatus: 'Filer' | 'Non-Filer' | 'Exempt' =
    (selectedCustomer?.filer_status as 'Filer' | 'Non-Filer' | 'Exempt') || 'Non-Filer';

  // Configured Advance Tax Rate based on Customer Filer Status
  const configuredTaxRate =
    customerFilerStatus === 'Filer'
      ? round2(taxSettings?.filer_rate ?? 0.5)
      : customerFilerStatus === 'Non-Filer'
      ? round2(taxSettings?.non_filer_rate ?? 2.5)
      : round2(taxSettings?.exempt_rate ?? 0);

  useEffect(() => {
    if (!isTaxOverridden) {
      setAdvanceTaxRate(configuredTaxRate);
    }
  }, [configuredTaxRate, isTaxOverridden]);

  // Switch Retail / Wholesale Pricing automatically on existing rows (without overwriting manual or customer-history rates!)
  const handleInvoiceTypeChange = (newType: SalesInvoiceType) => {
    setInvoiceType(newType);
    setRows((prev) =>
      prev.map((row) => {
        if (!row.item_id) return row;
        if (row.isRateManuallyEdited || row.rateSuggestionSource === 'customer_last_sale') {
          return row;
        }
        const targetPrice =
          newType === 'Wholesale'
            ? row.wholesale_price_ref || row.unit_price
            : row.retail_price_ref || row.unit_price;
        const targetLoose = round2(targetPrice / Math.max(1, row.units_per_pack));
        return recalcRow({
          ...row,
          unit_price: targetPrice,
          loose_rate: targetLoose,
          rateSuggestionSource: newType === 'Wholesale' ? 'standard_wholesale' : 'standard_retail',
        });
      })
    );
  };

  // Fast Item Search Handler
  const runFastSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim().toLowerCase();
      if (!trimmed) {
        setSearchResults(catalogItems.slice(0, 20));
        setSearchHighlightIdx(0);
        return;
      }
      const localMatches = catalogItems.filter(
        (item) =>
          item.item_code.toLowerCase().includes(trimmed) ||
          (item.barcode && item.barcode.toLowerCase().includes(trimmed)) ||
          item.item_name.toLowerCase().includes(trimmed) ||
          item.company_name.toLowerCase().includes(trimmed) ||
          (item.generic_name && item.generic_name.toLowerCase().includes(trimmed))
      );
      setSearchResults(localMatches);
      setSearchHighlightIdx(0);

      try {
        const res = await api.fastSearchSalesItems(query, 25);
        if (res.data) {
          setSearchResults(res.data);
        }
      } catch {
        // fallback to localMatches
      }
    },
    [catalogItems]
  );

  // Execute pending focus after React commits newly appended rows
  useEffect(() => {
    if (pendingFocusTargetRef.current) {
      const targetId = pendingFocusTargetRef.current;
      pendingFocusTargetRef.current = null;
      requestAnimationFrame(() => {
        const el = document.getElementById(targetId) as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select?.();
        }
      });
    }
  }, [rows.length, selectedRowIndex]);

  // Populate a datasheet row with a selected FastSearchItem + trigger Customer-Wise Item History lookup
  const populateRowWithItem = (rowIdx: number, item: FastSearchItem, focusQuantityAfter: boolean = true) => {
    const defaultPrice =
      invoiceType === 'Wholesale'
        ? round2(item.wholesale_price || item.trade_price || item.retail_price)
        : round2(item.retail_price);
    const itemMasterLooseRate =
      Number(item.loose_rate || item.retail_loose_rate || 0) > 0
        ? round2(Number(item.loose_rate || item.retail_loose_rate))
        : round2(defaultPrice / Math.max(1, item.units_per_pack));
    const defaultLooseRate =
      invoiceType === 'Wholesale'
        ? round2(item.wholesale_loose_rate || itemMasterLooseRate)
        : itemMasterLooseRate;
    const batch = item.default_batch;

    setRows((prev) => {
      const updated = [...prev];
      while (updated.length <= rowIdx) {
        updated.push(createEmptyRow());
      }
      const targetRow = updated[rowIdx] || createEmptyRow();
      const preserveManual = targetRow.item_id === item.id && targetRow.isRateManuallyEdited;
      const preserveManualLoose = targetRow.item_id === item.id && targetRow.isLooseRateManuallyEdited;
      const effectivePrice = preserveManual ? targetRow.unit_price : defaultPrice;
      const effectiveLoose = preserveManualLoose ? targetRow.loose_rate : defaultLooseRate;

      updated[rowIdx] = recalcRow({
        ...targetRow,
        item_id: item.id,
        inventory_id: batch.inventory_id,
        item_code: item.item_code,
        company_name: item.company_name || '',
        item_name: item.item_name,
        packing: item.packing || '1x1',
        strips_per_box: item.strips_per_box || 1,
        units_per_strip: item.units_per_strip || 1,
        units_per_pack: item.units_per_pack || 1,
        batch_number: batch.batch_number,
        expiry_date: batch.expiry_date,
        available_stock_packs: batch.available_packs,
        available_stock_units: batch.available_units,
        quantity: targetRow.item_id === item.id && targetRow.quantity > 0 ? targetRow.quantity : 1,
        unit_price: effectivePrice,
        discount_percent: preserveManual ? targetRow.discount_percent : Number(item.discount_percent || 0),
        loose_quantity: targetRow.item_id === item.id ? targetRow.loose_quantity || 0 : 0,
        loose_rate: effectiveLoose,
        tax_percent: Number(item.tax_percent || 0),
        retail_price_ref: round2(item.retail_price),
        wholesale_price_ref: round2(item.wholesale_price || item.trade_price || item.retail_price),
        item_loose_rate_ref: itemMasterLooseRate,
        batches: item.batches || [],
        isRateManuallyEdited: Boolean(preserveManual),
        isLooseRateManuallyEdited: Boolean(preserveManualLoose),
        rateSuggestionSource: preserveManual
          ? 'manual'
          : invoiceType === 'Wholesale'
          ? 'standard_wholesale'
          : 'standard_retail',
      });
      return updated;
    });

    setSelectedRowIndex(rowIdx);
    setShowSearchDropdown(false);
    setQuickSearchQuery('');
    setActiveSearchRowIdx(null);

    // Fetch Customer-Specific Last Sale Rate, Discount, Date, Invoice#, and Last Purchase Cost
    fetchAndApplyItemHistory(rowIdx, item.id, customerAccountId, invoiceType);

    if (focusQuantityAfter) {
      const targetId = invoiceViewMode === 'pos' ? 'pos_active_quantity' : `cell_${rowIdx}_quantity`;
      pendingFocusTargetRef.current = targetId;
      setTimeout(() => {
        const qtyEl = document.getElementById(targetId) as HTMLInputElement | null;
        if (qtyEl) {
          qtyEl.focus();
          qtyEl.select?.();
        }
      }, 30);
    }
  };

  // Add item from top Quick Search / Barcode Scanner Bar (NEVER replaces an already-populated item row!)
  const handleSelectFromTopSearch = (item: FastSearchItem) => {
    let targetIdx = -1;
    if (
      activeSearchRowIdx !== null &&
      rows[activeSearchRowIdx] &&
      rows[activeSearchRowIdx].item_id === null
    ) {
      targetIdx = activeSearchRowIdx;
    } else {
      targetIdx = rows.findIndex((r) => r.item_id === null);
    }

    if (targetIdx >= 0) {
      populateRowWithItem(targetIdx, item, true);
    } else {
      const newIdx = rows.length;
      populateRowWithItem(newIdx, item, true);
    }
  };

  // Apply Customer's Last Sale Rate on demand
  const applyCustomerLastRateToRow = (rowIdx: number) => {
    setRows((prev) => {
      const next = [...prev];
      const r = next[rowIdx];
      if (!r || !r.lastCustomerSaleRate) return prev;
      const newPrice = round2(r.lastCustomerSaleRate);
      const newLoose = r.isLooseRateManuallyEdited
        ? r.loose_rate
        : Number(r.item_loose_rate_ref || 0) > 0
        ? round2(Number(r.item_loose_rate_ref))
        : round2(newPrice / Math.max(1, r.units_per_pack));
      next[rowIdx] = recalcRow({
        ...r,
        unit_price: newPrice,
        loose_rate: newLoose,
        discount_percent: round2(r.lastCustomerDiscountPercent ?? r.discount_percent),
        isRateManuallyEdited: false,
        rateSuggestionSource: 'customer_last_sale',
      });
      return next;
    });
  };

  // Row Field Update
  const updateRowField = (rowIndex: number, field: keyof DatasheetRow, value: any) => {
    setRows((prev) => {
      const next = [...prev];
      const current = { ...next[rowIndex] };

      if (field === 'batch_number') {
        const matchedBatch = current.batches.find((b) => b.batch_number === value);
        if (matchedBatch) {
          current.inventory_id = matchedBatch.id;
          current.batch_number = matchedBatch.batch_number;
          current.expiry_date = matchedBatch.expiry_date;
          current.available_stock_packs = matchedBatch.current_pack_qty;
          current.available_stock_units = matchedBatch.total_stock_units;
        } else {
          current.batch_number = String(value);
        }
      } else if (field === 'unit_price') {
        const newPrice = Math.max(0, Number(value || 0));
        current.unit_price = newPrice;
        // PreserveLooseRate if edited manually or explicitly set from Item Master
        if (!current.isLooseRateManuallyEdited && !(Number(current.item_loose_rate_ref || 0) > 0)) {
          current.loose_rate = round2(newPrice / Math.max(1, current.units_per_pack));
        }
        current.isRateManuallyEdited = true;
        current.rateSuggestionSource = 'manual';
      } else if (field === 'loose_rate') {
        current.loose_rate = Math.max(0, Number(value || 0));
        current.isLooseRateManuallyEdited = true;
        current.isRateManuallyEdited = true;
        current.rateSuggestionSource = 'manual';
      } else if (field === 'loose_quantity') {
        current.loose_quantity = isSyrupItem(current) ? 0 : Math.max(0, Number(value || 0));
      } else if (field === 'discount_amount') {
        const discAmt = Math.max(0, Number(value || 0));
        const gross = round2(
          current.quantity * current.unit_price + current.loose_quantity * current.loose_rate
        );
        current.discount_amount = discAmt;
        current.discount_percent = gross > 0 ? round2((discAmt / gross) * 100) : 0;
      } else if (field === 'quantity') {
        current.quantity = Math.max(0, Number(value || 0));
      } else if (field === 'discount_percent') {
        current.discount_percent = Math.max(0, Math.min(100, Number(value || 0)));
      } else {
        (current as any)[field] = value;
      }

      next[rowIndex] = recalcRow(current);
      return next;
    });
  };

  // Row Actions: Insert, Delete, Copy, Paste
  const handleInsertRow = () => {
    setRows((prev) => {
      const next = [...prev, createEmptyRow()];
      setSelectedRowIndex(next.length - 1);
      return next;
    });
  };

  const handleDeleteRow = (index: number) => {
    setRows((prev) => {
      const filtered = prev.filter((_, idx) => idx !== index);
      const next = ensureMinimumRows(filtered);
      setSelectedRowIndex(Math.max(0, Math.min(selectedRowIndex, next.length - 1)));
      return next;
    });
  };

  const handleCopyRow = (index: number) => {
    const r = rows[index];
    if (!r) return;
    setCopiedRowData({
      quantity: r.quantity,
      unit_price: r.unit_price,
      discount_percent: r.discount_percent,
      loose_quantity: r.loose_quantity,
      loose_rate: r.loose_rate,
    });
    setSuccessMsg(`Copied values (Qty, Price, Discount %, Loose Qty) from Row #${index + 1}.`);
  };

  const handlePasteRow = (index: number) => {
    if (!copiedRowData) return;
    setRows((prev) => {
      const next = [...prev];
      next[index] = recalcRow({
        ...next[index],
        ...copiedRowData,
      });
      return next;
    });
    setSuccessMsg(`Pasted values into Row #${index + 1}.`);
  };

  // Automatic Bill Calculations
  const validRows = rows.filter((r) => r.item_id !== null);
  const grossAmount = round2(validRows.reduce((s, r) => s + r.gross_amount, 0));
  const itemDiscountTotal = round2(validRows.reduce((s, r) => s + r.discount_amount, 0));
  const subtotalAfterItemDisc = round2(Math.max(0, grossAmount - itemDiscountTotal));

  const computedInvoiceDiscAmt =
    invoiceDiscountPercent > 0
      ? round2((subtotalAfterItemDisc * invoiceDiscountPercent) / 100)
      : round2(Math.min(subtotalAfterItemDisc, invoiceDiscountAmount));

  const totalDiscount = round2(itemDiscountTotal + computedInvoiceDiscAmt);
  const taxableAmount = round2(Math.max(0, grossAmount - totalDiscount));
  const gstAmount = round2(validRows.reduce((s, r) => s + r.tax_amount, 0));

  const effectiveAdvTaxRate = advanceTaxApplicable ? round2(advanceTaxRate) : 0;
  const advanceTaxAmount = advanceTaxApplicable
    ? round2(((taxableAmount + gstAmount) * effectiveAdvTaxRate) / 100)
    : 0;

  const totalTax = round2(gstAmount + advanceTaxAmount);
  const netInvoiceAmount = round2(taxableAmount + totalTax);

  // Previous Customer Balance from actual account ledger (before posting current invoice)
  const prevCustomerBalance =
    liveBalanceSummary !== null
      ? liveBalanceSummary.previousBalanceAbs
      : round2(selectedCustomer?.current_balance || 0);
  const prevBalanceType: 'Debit' | 'Credit' =
    liveBalanceSummary !== null
      ? liveBalanceSummary.previousBalanceType
      : selectedCustomer?.current_balance_type || 'Debit';
  const signedPrevBalance =
    liveBalanceSummary !== null
      ? liveBalanceSummary.previousBalance
      : prevBalanceType === 'Debit'
      ? prevCustomerBalance
      : -prevCustomerBalance;

  // Calculation: Total Receivable = Previous Customer Balance + Current Invoice Net Amount
  const totalReceivable = round2(signedPrevBalance + netInvoiceAmount);

  useEffect(() => {
    if (!paidAmountManuallyEdited) {
      if (paymentMode === 'Cash' || paymentMode === 'Bank') {
        setPaidAmountInput(netInvoiceAmount > 0 ? String(netInvoiceAmount) : '');
      } else if (paymentMode === 'Credit') {
        setPaidAmountInput('');
      }
    }
  }, [paymentMode, netInvoiceAmount, paidAmountManuallyEdited]);

  const paidAmount = round2(Math.max(0, Number(paidAmountInput || 0)));
  // Calculation: Remaining Balance = Total Receivable - Amount Received
  const remainingBalance = round2(totalReceivable - paidAmount);

  // Reset Invoice to Blank
  const resetToNewInvoice = async () => {
    localStorage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
    setEditingSaleId(null);
    setRows(ensureMinimumRows([]));
    setSelectedRowIndex(0);
    setInvoiceDiscountPercent(0);
    setInvoiceDiscountAmount(0);
    setAdvanceTaxApplicable(false);
    setIsTaxOverridden(false);
    setTaxOverrideReason('');
    setPaidAmountManuallyEdited(false);
    setDeliverymanId(null);
    setDeliverymanName('');
    setDeliveryStatus('Pending');
    setDeliveryCharges(0);
    setDeliveryNotes('');
    setRemarks('');
    setShowDiscardConfirm(false);
    try {
      const nextNums = await api.getNextSalesNumbers();
      setInvoiceNumber(nextNums.nextInvoiceNumber);
      await loadReferenceData();
      if (customerAccountId > 0) {
        await refreshCustomerBalanceSummary(customerAccountId, null);
      }
    } catch {
      // ignore
    }
  };

  // Save / Complete / Hold Invoice
  const handleSaveInvoice = async (
    targetStatus: 'completed' | 'held' | 'draft',
    autoPrintFormat?: 'a4' | '80mm' | '58mm'
  ) => {
    try {
      setErrorMsg(null);
      setSuccessMsg(null);

      const activeLines = rows.filter((r) => r.item_id !== null);
      if (activeLines.length === 0) {
        setErrorMsg('Please add at least one medicine item to the datasheet before saving.');
        return;
      }

      if (targetStatus === 'completed' && !allowNegativeStock) {
        for (let i = 0; i < activeLines.length; i++) {
          const r = activeLines[i];
          if (r.total_units > r.available_stock_units) {
            setErrorMsg(
              `Stock Shortage on Row #${i + 1} (${r.item_name} - Batch ${r.batch_number}): Available ${r.available_stock_packs} Packs (${r.available_stock_units} Units), Requested ${r.total_units} Units.`
            );
            return;
          }
        }
      }

      setSubmitting(true);

      const clientRequestId = `SAL-${invoiceNumber}-${Date.now()}`;
      const payload = {
        client_request_id: clientRequestId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        customer_account_id: customerAccountId,
        customer_name: selectedCustomer?.account_name || 'Walk-in Cash Customer',
        customer_filer_status: customerFilerStatus,
        salesman_id: salesmanId,
        salesman,
        deliveryman_id: deliverymanId,
        deliveryman_name: deliverymanName || null,
        delivery_status: deliveryStatus,
        delivery_charges: deliveryCharges,
        delivery_notes: deliveryNotes || null,
        invoice_type: invoiceType,
        payment_mode: paymentMode,
        payment_account_id: paymentAccountId,
        invoice_discount_percent: invoiceDiscountPercent,
        invoice_discount_amount: computedInvoiceDiscAmt,
        discount_override_by: discountOverrideBy || null,
        discount_override_reason: discountOverrideReason || null,
        advance_tax_applicable: advanceTaxApplicable ? 1 : 0,
        advance_tax_rate: effectiveAdvTaxRate,
        is_tax_overridden: isTaxOverridden ? 1 : 0,
        tax_override_reason: taxOverrideReason || null,
        tax_override_authorized_by: taxOverrideAuthorizedBy || null,
        paid_amount: paidAmount,
        allow_negative_stock: allowNegativeStock ? 1 : 0,
        status: targetStatus,
        remarks,
        items: activeLines.map((r) => ({
          item_id: r.item_id,
          inventory_id: r.inventory_id,
          item_code: r.item_code,
          company_name: r.company_name,
          item_name: r.item_name,
          packing: r.packing,
          batch_number: r.batch_number,
          expiry_date: r.expiry_date,
          quantity: r.quantity,
          unit_price: r.unit_price,
          discount_percent: r.discount_percent,
          discount_amount: r.discount_amount,
          loose_quantity: r.loose_quantity,
          loose_rate: r.loose_rate,
          tax_percent: r.tax_percent,
        })),
      };

      const res = editingSaleId
        ? await api.updateSale(editingSaleId, payload)
        : await api.createSale(payload);

      const savedInvoice = res.data as SalesInvoiceRecord;

      setSuccessMsg(
        targetStatus === 'completed'
          ? `Sales Invoice ${savedInvoice.invoice_number} confirmed! Stock & Customer Ledger Balance updated.`
          : `Invoice ${savedInvoice.invoice_number} saved as ${targetStatus.toUpperCase()}.`
      );

      if (autoPrintFormat) {
        const fullDetails = await api.getSaleDetails(savedInvoice.id);
        setPrintFormat(autoPrintFormat);
        setPrintInvoice(fullDetails.data);
      }

      await resetToNewInvoice();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Reprint Previous Invoice
  const handleReprintLastInvoice = async () => {
    try {
      setErrorMsg(null);
      const listRes = await api.getSales({ status: 'completed', pageSize: 1 });
      const last = listRes.data?.[0];
      if (!last) {
        setErrorMsg('No previous completed Sales Invoice found to reprint.');
        return;
      }
      const details = await api.getSaleDetails(last.id);
      setPrintFormat('a4');
      setPrintInvoice(details.data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Open Customer Shortcut Drawer
  const openCustomerShortcut = async (
    mode: 'ledger' | 'receive_payment' | 'add_customer' | 'account_details'
  ) => {
    setActiveCustomerShortcut(mode);
    if (mode === 'ledger' && customerAccountId) {
      try {
        const res = await api.getAccountLedger({
          ledgerType: 'customer',
          accountId: customerAccountId,
        });
        setCustomerLedgerData(res);
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    } else if (mode === 'add_customer') {
      setNewCustCode(`CUS-${Math.floor(1000 + Math.random() * 9000)}`);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustAddress('');
    }
  };

  // Submit Quick Receive Payment inside Customer Shortcut
  const handleQuickReceivePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const amt = round2(quickReceiptAmount);
      if (amt <= 0) {
        setErrorMsg('Please enter a valid payment amount greater than 0.');
        return;
      }
      await api.createPaymentVoucher({
        voucher_type: 'receive_payment',
        party_account_id: customerAccountId,
        amount: amt,
        payment_method: quickReceiptMethod,
        description: quickReceiptNotes || `Quick receipt from POS Billing Screen`,
      });
      setQuickReceiptAmount('');
      setQuickReceiptNotes('');
      setActiveCustomerShortcut(null);
      await loadReferenceData();
      await refreshCustomerBalanceSummary(customerAccountId, editingSaleId);
      setSuccessMsg(`Received ${formatPKR(amt)} from ${selectedCustomer?.account_name}. Balance updated.`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Submit Quick Add Customer inside Customer Shortcut
  const handleQuickAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!newCustName.trim()) {
        setErrorMsg('Customer Name is required.');
        return;
      }
      const res = await api.createAccount({
        account_code: newCustCode.trim(),
        account_name: newCustName.trim(),
        main_group: 'PARTY ACCOUNTS',
        account_group: 'Customer',
        opening_balance: 0,
        opening_balance_type: 'Debit',
        phone: newCustPhone.trim(),
        address: newCustAddress.trim(),
        filer_status: newCustFilerStatus,
        status: 'Active',
      });
      await loadReferenceData();
      const createdId = res.account?.id || res.data?.id;
      if (createdId) {
        setCustomerAccountId(Number(createdId));
      }
      setActiveCustomerShortcut(null);
      setSuccessMsg(`Customer "${newCustName}" created and selected for this invoice.`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Column Widths for Microsoft Access-Style Resizable Datasheet Grid
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    selector: 32,
    item_code: 95,
    company: 110,
    item_name: 210,
    packing: 68,
    quantity: 68,
    discount: 68,
    unit_price: 82,
    loose_quantity: 80,
    loose_rate: 78,
    amount: 95,
    actions: 76,
  });

  const handleColResizeMouseDown = (colKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[colKey] || 100;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const diff = moveEvent.clientX - startX;
      setColWidths((prev) => ({
        ...prev,
        [colKey]: Math.max(40, startWidth + diff),
      }));
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Keyboard Navigation in Access Datasheet Grid & POS View
  // Required sequence: Item Search -> 1. Quantity -> 2. Discount -> 3. Price -> 4. Loose Quantity -> 5. Loose Rate -> 6. Press Enter -> New Row & Item Search
  const colOrder = [
    'item_code',
    'item_name',
    'quantity',
    'discount_percent',
    'unit_price',
    'loose_quantity',
    'loose_rate',
  ];

  const focusCell = (rIdx: number, cName: string) => {
    const targetId = `cell_${rIdx}_${cName}`;
    pendingFocusTargetRef.current = targetId;
    const el = document.getElementById(targetId) as HTMLInputElement | HTMLSelectElement | null;
    if (el) {
      el.focus();
      if ('select' in el && typeof el.select === 'function') {
        el.select();
      }
    }
  };

  // Create/move to a new empty item row and focus Item Search without replacing any existing items
  const advanceToNewRowItemSearch = (fromRowIdx: number, mode: 'pos' | 'access') => {
    const existingEmptyIdx = rows.findIndex((r, idx) => idx > fromRowIdx && r.item_id === null);
    const targetRowIdx = existingEmptyIdx >= 0 ? existingEmptyIdx : rows.length;

    if (existingEmptyIdx < 0) {
      setRows((prev) => [...prev, createEmptyRow()]);
    }

    setSelectedRowIndex(targetRowIdx);
    setShowSearchDropdown(false);
    setQuickSearchQuery('');

    if (mode === 'pos') {
      setActiveSearchRowIdx(targetRowIdx);
      pendingFocusTargetRef.current = 'pos_item_search_input';
      setTimeout(() => {
        const searchEl =
          posSearchInputRef.current ||
          (document.getElementById('pos_item_search_input') as HTMLInputElement | null);
        if (searchEl) {
          searchEl.focus();
          searchEl.select?.();
        }
      }, 25);
    } else {
      setActiveSearchRowIdx(targetRowIdx);
      const cellId = `cell_${targetRowIdx}_item_code`;
      pendingFocusTargetRef.current = cellId;
      setTimeout(() => {
        const el = document.getElementById(cellId) as HTMLInputElement | null;
        if (el) {
          el.focus();
          el.select?.();
        }
      }, 25);
    }
  };

  // POS View Keyboard Navigation: 1. Quantity -> 2. Discount -> 3. Price -> 4. Loose Quantity -> 5. Loose Rate -> Enter -> New Row & Item Search
  const handlePosFieldKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    fieldName: 'quantity' | 'discount_percent' | 'unit_price' | 'loose_quantity' | 'loose_rate',
    isTableInput: boolean = false
  ) => {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    if (e.key === 'Tab' && e.shiftKey) return;

    const row = rows[rowIdx];
    const prefix = isTableInput ? `pos_row_${rowIdx}` : 'pos_active';
    const posOrder: Array<'quantity' | 'discount_percent' | 'unit_price' | 'loose_quantity' | 'loose_rate'> = [
      'quantity',
      'discount_percent',
      'unit_price',
      'loose_quantity',
      'loose_rate',
    ];
    const curIdx = posOrder.indexOf(fieldName);

    // For Syrup items, Loose Quantity and Loose Rate are disabled -> Enter on Price finishes the item
    if (fieldName === 'unit_price' && isSyrupItem(row)) {
      e.preventDefault();
      advanceToNewRowItemSearch(rowIdx, 'pos');
      return;
    }

    if (curIdx >= 0 && curIdx < posOrder.length - 1) {
      e.preventDefault();
      const nextField = posOrder[curIdx + 1];
      const nextId = `${prefix}_${nextField}`;
      const nextEl = document.getElementById(nextId) as HTMLInputElement | null;
      if (nextEl) {
        nextEl.focus();
        nextEl.select?.();
      }
    } else if (fieldName === 'loose_rate') {
      e.preventDefault();
      advanceToNewRowItemSearch(rowIdx, 'pos');
    }
  };

  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    rowIndex: number,
    colName: string
  ) => {
    const row = rows[rowIndex];

    // Direct Item Code / Barcode / Search Selection on Enter or Tab
    if ((colName === 'item_code' || colName === 'item_name') && (e.key === 'Enter' || e.key === 'Tab')) {
      const typedCode = String(
        colName === 'item_code' ? row?.item_code || '' : row?.item_name || ''
      )
        .trim()
        .toLowerCase();
      if (typedCode && !row?.item_id) {
        const exactMatch =
          catalogItems.find(
            (it) =>
              it.item_code.toLowerCase() === typedCode ||
              (it.barcode && it.barcode.toLowerCase() === typedCode) ||
              it.item_name.toLowerCase() === typedCode
          ) ||
          (showSearchDropdown && searchResults[searchHighlightIdx] ? searchResults[searchHighlightIdx] : null);
        if (exactMatch) {
          e.preventDefault();
          populateRowWithItem(rowIndex, exactMatch, true);
          return;
        }
      } else if (showSearchDropdown && searchResults[searchHighlightIdx] && e.key === 'Enter') {
        e.preventDefault();
        populateRowWithItem(rowIndex, searchResults[searchHighlightIdx], true);
        return;
      }
    }

    // Up/Down inside Search Dropdown when open on item_code or item_name
    if ((colName === 'item_code' || colName === 'item_name') && showSearchDropdown && searchResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSearchHighlightIdx((prev) => Math.min(searchResults.length - 1, prev + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSearchHighlightIdx((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.key === 'Escape') {
        setShowSearchDropdown(false);
        return;
      }
    }

    // Enter key -> Move in exact sequence: 1. Quantity -> 2. Discount -> 3. Price -> 4. Loose Quantity -> 5. Loose Rate -> 6. New Row & Item Search
    if (e.key === 'Enter') {
      e.preventDefault();
      const enterOrder = [
        'item_code',
        'item_name',
        'quantity',
        'discount_percent',
        'unit_price',
        'loose_quantity',
        'loose_rate',
      ];
      const currentEnterIdx = enterOrder.indexOf(colName);

      // For Syrup items (where Loose Qty and Loose Rate are N/A), pressing Enter on Price advances to a new row
      if (colName === 'unit_price' && isSyrupItem(row)) {
        advanceToNewRowItemSearch(rowIndex, 'access');
        return;
      }

      if (currentEnterIdx >= 0 && currentEnterIdx < enterOrder.length - 1) {
        const nextCol = enterOrder[currentEnterIdx + 1];
        focusCell(rowIndex, nextCol);
      } else {
        // Completed the final field (Loose Rate) -> create a new empty row and focus Item Search
        advanceToNewRowItemSearch(rowIndex, 'access');
      }
      return;
    }

    // Tab / Shift+Tab navigation
    if (e.key === 'Tab') {
      const curColIdx = colOrder.indexOf(colName);
      if (!e.shiftKey) {
        if (colName === 'unit_price' && isSyrupItem(row)) {
          e.preventDefault();
          advanceToNewRowItemSearch(rowIndex, 'access');
          return;
        }
        if (curColIdx >= 0 && curColIdx < colOrder.length - 1) {
          e.preventDefault();
          focusCell(rowIndex, colOrder[curColIdx + 1]);
        } else if (curColIdx === colOrder.length - 1) {
          e.preventDefault();
          advanceToNewRowItemSearch(rowIndex, 'access');
        }
      } else {
        if (curColIdx > 0) {
          e.preventDefault();
          focusCell(rowIndex, colOrder[curColIdx - 1]);
        } else if (curColIdx === 0 && rowIndex > 0) {
          e.preventDefault();
          setSelectedRowIndex(rowIndex - 1);
          focusCell(rowIndex - 1, colOrder[colOrder.length - 1]);
        }
      }
      return;
    }

    // ArrowUp / ArrowDown across rows (Excel/Access vertical navigation)
    if (e.key === 'ArrowUp' && rowIndex > 0) {
      e.preventDefault();
      setSelectedRowIndex(rowIndex - 1);
      focusCell(rowIndex - 1, colName);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rowIndex < rows.length - 1) {
        setSelectedRowIndex(rowIndex + 1);
        focusCell(rowIndex + 1, colName);
      } else {
        handleInsertRow();
        setTimeout(() => {
          focusCell(rowIndex + 1, colName);
        }, 30);
      }
      return;
    }

    // ArrowLeft / ArrowRight across columns
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const target = e.currentTarget as HTMLInputElement;
      const isText = target.tagName === 'INPUT' && target.type === 'text';
      const atRightEdge =
        !isText || target.selectionStart === null || target.selectionStart >= (target.value?.length || 0);
      const atLeftEdge = !isText || target.selectionStart === null || target.selectionStart <= 0;

      const curColIdx = colOrder.indexOf(colName);
      if (e.key === 'ArrowRight' && atRightEdge && curColIdx >= 0 && curColIdx < colOrder.length - 1) {
        e.preventDefault();
        focusCell(rowIndex, colOrder[curColIdx + 1]);
      } else if (e.key === 'ArrowLeft' && atLeftEdge && curColIdx > 0) {
        e.preventDefault();
        focusCell(rowIndex, colOrder[curColIdx - 1]);
      }
    }
  };

  // Global Keyboard Shortcuts (F2 / Ctrl+S: Save, Ctrl+P: Print, Ctrl+N: New, F3: Search, F9: Hold)
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveInvoice('completed');
      } else if (e.key === 'F2') {
        e.preventDefault();
        handleSaveInvoice('completed');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handleSaveInvoice('completed', 'a4');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        resetToNewInvoice();
      } else if (e.key === 'F3') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select?.();
      } else if (e.key === 'F9') {
        e.preventDefault();
        handleSaveInvoice('held');
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [handleSaveInvoice, resetToNewInvoice]);

  const filteredCustomers = customers.filter((c) => {
    if (!customerSearchText.trim()) return true;
    const t = customerSearchText.toLowerCase();
    return (
      String(c.account_name || '').toLowerCase().includes(t) ||
      String(c.account_code || '').toLowerCase().includes(t) ||
      String(c.phone || '').toLowerCase().includes(t)
    );
  });

  const filteredSalesmen = salesmenList.filter((sm) => {
    if (!salesmanFilterText.trim()) return true;
    const t = salesmanFilterText.toLowerCase();
    return sm.name.toLowerCase().includes(t) || sm.salesman_code.toLowerCase().includes(t);
  });

  const filteredDeliverymen = deliverymenList.filter((dm) => {
    if (!deliverymanFilterText.trim()) return true;
    const t = deliverymanFilterText.toLowerCase();
    return dm.name.toLowerCase().includes(t) || dm.deliveryman_code.toLowerCase().includes(t);
  });

  // Active row & its Customer-Wise Item History
  const activeRow = rows[selectedRowIndex] || rows[0];
  const activeHistoryKey = activeRow?.item_id ? `${activeRow.item_id}_${customerAccountId || 0}` : '';
  const activeItemHistory = activeHistoryKey ? itemHistoryMap[activeHistoryKey] : null;

  // POS Mode Helpers
  const handleQuickCash = (amt: number) => {
    setPaidAmountManuallyEdited(true);
    setPaidAmountInput(amt.toString());
  };

  const handleExactCash = () => {
    setPaidAmountManuallyEdited(true);
    const exact = totalReceivable > 0 ? totalReceivable : netInvoiceAmount;
    setPaidAmountInput(exact.toString());
  };

  const handleIncrementQty = (idx: number) => {
    const current = Number(rows[idx]?.quantity || 0);
    updateRowField(idx, 'quantity', current + 1);
  };

  const handleDecrementQty = (idx: number) => {
    const current = Number(rows[idx]?.quantity || 0);
    if (current > 1 || (current === 1 && Number(rows[idx]?.loose_quantity || 0) > 0)) {
      updateRowField(idx, 'quantity', Math.max(0, current - 1));
    }
  };

  const handleAddStripToRow = (idx: number, stripsCount: number = 1) => {
    const r = rows[idx];
    if (!r || isSyrupItem(r)) return;
    const strip = r.units_per_strip > 1 ? r.units_per_strip : 1;
    updateRowField(idx, 'loose_quantity', Number(r.loose_quantity || 0) + strip * stripsCount);
  };

  return (
    <div className="flex-1 h-full max-h-full flex flex-col min-h-0 overflow-hidden">
      {/* Status Banners */}
      {errorMsg && (
        <div className="px-2.5 py-1 rounded bg-rose-50 border border-rose-200 text-rose-800 flex items-center justify-between text-xs shadow-2xs shrink-0 mb-1">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-600 hover:text-rose-900 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {successMsg && (
        <div className="px-2.5 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between text-xs shadow-2xs shrink-0 mb-1">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-700 hover:text-emerald-950 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* ================= TOP INTERFACE SELECTOR BAR (POS VIEW vs MS ACCESS VIEW) ================= */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 text-white rounded border border-slate-700/80 shadow-2xs shrink-0 px-2 py-0.5 mb-0.5">
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">
            Sales Invoice Interface:
          </span>
          <div className="inline-flex rounded p-0.5 bg-slate-800 border border-slate-700">
            <button
              type="button"
              onClick={() => toggleInvoiceViewMode('pos')}
              className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                invoiceViewMode === 'pos'
                  ? 'bg-emerald-600 text-white shadow-2xs ring-1 ring-emerald-400'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
              title="Switch to Traditional Desktop POS Billing Interface"
            >
              <ShoppingCart className="w-3 h-3" />
              <span>1. POS View</span>
            </button>
            <button
              type="button"
              onClick={() => toggleInvoiceViewMode('access')}
              className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                invoiceViewMode === 'access'
                  ? 'bg-blue-600 text-white shadow-2xs ring-1 ring-blue-400'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
              }`}
              title="Switch to Microsoft Access-Style Desktop Datasheet Form"
            >
              <FileSpreadsheet className="w-3 h-3" />
              <span>2. MS Access View</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2.5 text-[10px] text-slate-400">
          <span className="bg-slate-800 px-2 py-0.5 rounded text-emerald-400 font-mono font-bold">
            {rows.filter((r) => r.item_id).length} Active Items
          </span>
          <span className="text-slate-400 hidden sm:inline">
            (Switching views never clears entered items or calculations)
          </span>
        </div>
      </div>

      {/* ================= OPTION 1: TRADITIONAL POS INTERFACE ================= */}
      {invoiceViewMode === 'pos' && (
        <div className="flex-1 min-h-0 flex flex-col gap-1 overflow-hidden">
          {/* POS Header: Customer, Salesman, Deliveryman, Type & Mode */}
          <div className="bg-white rounded border border-slate-200 shadow-2xs px-2.5 py-1 space-y-1 shrink-0">
            {/* Top row: Badges, Bill #, Date & Action Shortcuts */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1 border-b border-slate-100">
              <div className="flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded bg-emerald-700 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-300" />
                  {invoiceType} POS COUNTER
                </span>
                <span className="font-mono text-[11px] font-black text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-300">
                  {invoiceNumber}
                </span>
                {editingSaleId && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                    EDIT #{editingSaleId}
                  </span>
                )}
                <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-1.5 py-0">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Date:</span>
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="text-[11px] font-mono font-semibold text-slate-800 bg-transparent outline-none cursor-pointer h-5"
                  />
                </div>
              </div>

              {/* Quick Header Actions */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={resetToNewInvoice}
                  className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  title="New Invoice (Ctrl+N)"
                >
                  <Plus className="w-3 h-3 text-emerald-600" />
                  New (Ctrl+N)
                </button>
                <button
                  type="button"
                  onClick={() => setShowHeldDrawer(true)}
                  className="px-2 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  title="View Held Invoices"
                >
                  <History className="w-3 h-3 text-amber-700" />
                  Held ({heldInvoices.length})
                </button>
                <button
                  type="button"
                  onClick={handleReprintLastInvoice}
                  className="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  title="Reprint Last Invoice"
                >
                  <Printer className="w-3 h-3 text-blue-700" />
                  Reprint
                </button>
              </div>
            </div>

            {/* Middle row: Customer Selection with Live Previous Ledger Balance */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
              {/* Customer Selector */}
              <div className="md:col-span-5 flex items-center gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1 shrink-0">
                  <Users2 className="w-3 h-3 text-emerald-600" />
                  <span>Customer:</span>
                </label>
                <select
                  value={customerAccountId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setCustomerAccountId(id);
                    if (id > 0) {
                      refreshCustomerBalanceSummary(id, null);
                    }
                  }}
                  className="w-full px-2 py-0.5 text-xs font-bold rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 h-6"
                >
                  <option value={0}>— Walk-in Counter Customer (Cash) —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      [{c.account_code}] {c.account_name} ({c.phone || 'No phone'})
                    </option>
                  ))}
                </select>
                {customerAccountId > 0 && (
                  <button
                    type="button"
                    onClick={() => setCustomerAccountId(0)}
                    className="text-[10px] text-slate-500 hover:text-slate-800 cursor-pointer shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Live Customer Previous Balance & Last Payment Badge */}
              <div className="md:col-span-4 bg-slate-900 text-white rounded px-2 py-0.5 flex items-center justify-between shadow-2xs h-6">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 shrink-0">
                    Prev Bal:
                  </span>
                  <span
                    className={`font-mono text-[11px] font-black ${
                      prevCustomerBalance > 0
                        ? 'text-amber-400'
                        : prevCustomerBalance < 0
                        ? 'text-emerald-400'
                        : 'text-slate-300'
                    }`}
                  >
                    {formatPKR(Math.abs(prevCustomerBalance))} ({prevBalanceType})
                  </span>
                  {liveBalanceSummary?.lastPayment && (
                    <span className="text-[9px] text-slate-400 hidden sm:inline truncate">
                      • Last: {formatPKR(liveBalanceSummary.lastPayment.amount)}
                    </span>
                  )}
                </div>
                {customerAccountId > 0 && (
                  <button
                    type="button"
                    onClick={() => openCustomerShortcut('ledger')}
                    className="px-1.5 py-0 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[9px] font-bold flex items-center gap-0.5 cursor-pointer shrink-0"
                    title="Open Detailed Ledger for this Customer"
                  >
                    <BookOpen className="w-2.5 h-2.5" />
                    <span>Ledger</span>
                  </button>
                )}
              </div>

              {/* Type Toggle & Payment Mode */}
              <div className="md:col-span-3 flex items-center justify-end gap-1.5">
                {/* Retail / Wholesale */}
                <div className="inline-flex rounded p-0.5 bg-slate-100 border border-slate-300">
                  <button
                    type="button"
                    onClick={() => setInvoiceType('Retail')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                      invoiceType === 'Retail'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    Retail
                  </button>
                  <button
                    type="button"
                    onClick={() => setInvoiceType('Wholesale')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                      invoiceType === 'Wholesale'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    Wholesale
                  </button>
                </div>

                {/* Payment Mode */}
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value as SalesPaymentMode)}
                  className="px-2 py-0.5 text-[11px] font-bold rounded border border-slate-300 bg-white text-slate-900 h-6"
                >
                  <option value="Cash">Cash</option>
                  <option value="Bank">Bank / Online</option>
                  <option value="Credit">Credit (Udhar)</option>
                </select>
              </div>
            </div>

            {/* Bottom Header row: Salesman & Deliveryman (Strictly Separate) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-1.5 pt-0.5 border-t border-slate-100 text-[11px]">
              <div className="flex items-center gap-1">
                <UserCheck className="w-3 h-3 text-blue-600 shrink-0" />
                <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">Salesman:</span>
                <select
                  value={salesmanId || ''}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    setSalesmanId(id);
                    const sm = salesmenList.find((s) => s.id === id);
                    if (sm) setSalesman(sm.name);
                  }}
                  className="w-full px-1.5 py-0 text-[11px] font-semibold rounded border border-slate-200 bg-slate-50 h-5"
                >
                  <option value="">— Counter Pharmacist —</option>
                  {salesmenList.map((sm) => (
                    <option key={sm.id} value={sm.id}>
                      {sm.name} ({sm.salesman_code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1">
                <Truck className="w-3 h-3 text-amber-600 shrink-0" />
                <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">Delivery:</span>
                <select
                  value={deliverymanId || ''}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    setDeliverymanId(id);
                    const dm = deliverymenList.find((d) => d.id === id);
                    if (dm) setDeliverymanName(dm.name);
                  }}
                  className="w-full px-1.5 py-0 text-[11px] font-semibold rounded border border-slate-200 bg-slate-50 h-5"
                >
                  <option value="">— No Delivery / Counter Pickup —</option>
                  {deliverymenList.map((dm) => (
                    <option key={dm.id} value={dm.id}>
                      {dm.name} ({dm.deliveryman_code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">Delivery Fee:</span>
                <NumericInput
                  value={deliveryCharges}
                  onChange={(e) => setDeliveryCharges(Math.max(0, Number(e.target.value || 0)))}
                  className="w-full px-1.5 py-0 text-[11px] font-mono font-bold rounded border border-slate-200 bg-slate-50 text-right h-5"
                />
              </div>

              <div className="flex items-center gap-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">Prescription:</span>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Dr. note / Patient ref..."
                  className="w-full px-1.5 py-0 text-[11px] rounded border border-slate-200 bg-slate-50 h-5"
                />
              </div>
            </div>
          </div>

          {/* Fast Item Search & Barcode Scan Bar */}
          <div className="relative bg-slate-900 rounded px-2 py-1 shadow-2xs text-white shrink-0">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Barcode className="w-4 h-4 text-emerald-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  id="pos_item_search_input"
                  ref={posSearchInputRef}
                  type="text"
                  value={quickSearchQuery}
                  onFocus={() => {
                    setShowSearchDropdown(true);
                    runFastSearch(quickSearchQuery);
                  }}
                  onChange={(e) => {
                    const q = e.target.value;
                    setQuickSearchQuery(q);
                    setShowSearchDropdown(true);
                    runFastSearch(q);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSearchHighlightIdx((prev) =>
                        Math.min(searchResults.length - 1, prev + 1)
                      );
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSearchHighlightIdx((prev) => Math.max(0, prev - 1));
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      const chosen =
                        searchResults[searchHighlightIdx] || searchResults[0];
                      if (chosen) {
                        handleSelectFromTopSearch(chosen);
                      }
                    } else if (e.key === 'Escape') {
                      setShowSearchDropdown(false);
                    }
                  }}
                  placeholder="Scan Barcode or Search Medicine Name / Formula / Company (Press Enter)..."
                  className="w-full pl-8 pr-3 py-1 rounded bg-slate-800 border border-slate-700 text-white placeholder-slate-400 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-slate-750 h-6"
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={() => advanceToNewRowItemSearch(rows.length - 1, 'pos')}
                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0 shadow-2xs h-6"
                title="Add New Empty Row to Bill"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Blank Line</span>
              </button>
            </div>

            {/* Fast Search Dropdown Results */}
            {showSearchDropdown && searchResults.length > 0 && (
              <div className="absolute left-2 right-2 top-full mt-1 z-30 bg-white text-slate-900 rounded-lg border border-slate-300 shadow-2xl max-h-60 overflow-y-auto">
                <div className="p-1.5 bg-slate-100 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600 flex justify-between">
                  <span>Matching Medicines ({searchResults.length})</span>
                  <span>Click or Press Enter to Add</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {searchResults.map((it, idx) => (
                    <button
                      key={it.id}
                      type="button"
                      onMouseDown={() => handleSelectFromTopSearch(it)}
                      onMouseEnter={() => setSearchHighlightIdx(idx)}
                      className={`w-full px-3 py-1.5 text-left flex items-center justify-between text-xs cursor-pointer transition-colors ${
                        idx === searchHighlightIdx ? 'bg-emerald-50 font-semibold' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <span className="font-mono text-emerald-700">[{it.item_code}]</span>
                          <span>{it.item_name}</span>
                          <span className="text-[10px] text-slate-500 font-normal">({it.packing})</span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {it.company_name} • Formula: {it.generic_name || 'N/A'} • Rack: {it.rack_number || '-'}
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <div className="font-mono font-bold text-slate-900">
                          Rs. {it.retail_price.toFixed(2)} • Loose: Rs. {(it.loose_rate || it.retail_loose_rate || 0).toFixed(2)}
                        </div>
                        <div className="text-[10px] font-semibold text-emerald-600">
                          Stock: {it.default_batch?.available_packs || 0} Packs
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Active Item Counter Entry Strip */}
          {activeRow && activeRow.item_id ? (
            <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border border-emerald-500/80 rounded px-2.5 py-1 shadow-2xs space-y-1 shrink-0">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0 rounded bg-emerald-700 text-white font-mono text-[10px] font-bold">
                    Active Line #{selectedRowIndex + 1}
                  </span>
                  <span className="font-bold text-slate-900 text-xs">
                    [{activeRow.item_code}] {activeRow.item_name}
                  </span>
                  <span className="text-[11px] text-slate-600 font-medium">
                    ({activeRow.packing}) • {activeRow.company_name}
                  </span>
                  <span className="px-1.5 py-0 rounded bg-emerald-200 text-emerald-950 font-mono text-[10px] font-bold">
                    Stock: {activeRow.available_stock_packs} Packs ({activeRow.available_stock_units} Units)
                  </span>
                </div>

                {/* Customer-Wise Last Sale History Badge right in the Entry Strip */}
                {activeItemHistory?.hasCustomerHistory && activeItemHistory.lastCustomerSale && (
                  <div className="flex items-center gap-1 bg-amber-100 border border-amber-300 rounded px-1.5 py-0 text-[10px] text-amber-950">
                    <span className="font-bold uppercase">Customer Last Sale:</span>
                    <span className="font-mono font-bold">
                      Rs. {activeItemHistory.lastCustomerSale.unit_price} (Disc {activeItemHistory.lastCustomerSale.discount_percent}%) on {activeItemHistory.lastCustomerSale.invoice_date}
                    </span>
                    <button
                      type="button"
                      onClick={() => applyCustomerLastRateToRow(selectedRowIndex)}
                      className="ml-1 px-1.5 py-0 rounded bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-bold cursor-pointer"
                      title="Apply this customer's previous purchase rate"
                    >
                      Apply Rate
                    </button>
                  </div>
                )}
              </div>

              {/* Fast Stepper Controls for Active Row — Ordered: 1. Quantity -> 2. Discount -> 3. Price -> 4. Loose Quantity -> 5. Loose Rate -> Enter (Next Item) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-1.5 items-end">
                {/* 1. Quantity */}
                <div>
                  <label className="block text-[9px] font-bold uppercase text-slate-700 leading-none mb-0.5">
                    1. Quantity (Packs)
                  </label>
                  <div className="flex items-center border border-slate-300 rounded bg-white overflow-hidden h-5">
                    <button
                      type="button"
                      onClick={() => handleDecrementQty(selectedRowIndex)}
                      className="px-1.5 py-0 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer border-r border-slate-300 h-full"
                    >
                      -
                    </button>
                    <NumericInput
                      id="pos_active_quantity"
                      value={activeRow.quantity}
                      onChange={(e) => updateRowField(selectedRowIndex, 'quantity', e.target.value)}
                      onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'quantity', false)}
                      className="w-full text-center font-mono font-bold text-[11px] text-slate-900 outline-none py-0 h-full"
                    />
                    <button
                      type="button"
                      onClick={() => handleIncrementQty(selectedRowIndex)}
                      className="px-1.5 py-0 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer border-l border-slate-300 h-full"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* 2. Discount % */}
                <div>
                  <label className="block text-[9px] font-bold uppercase text-slate-700 leading-none mb-0.5">
                    2. Discount %
                  </label>
                  <NumericInput
                    id="pos_active_discount_percent"
                    value={activeRow.discount_percent}
                    onChange={(e) => updateRowField(selectedRowIndex, 'discount_percent', e.target.value)}
                    onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'discount_percent', false)}
                    className="w-full px-1.5 py-0 font-mono font-semibold text-[11px] text-right rounded border border-slate-300 bg-white focus:border-emerald-600 outline-none h-5"
                  />
                </div>

                {/* 3. Price (PKR) */}
                <div>
                  <label className="block text-[9px] font-bold uppercase text-slate-700 leading-none mb-0.5">
                    3. Price (PKR)
                  </label>
                  <NumericInput
                    id="pos_active_unit_price"
                    value={activeRow.unit_price}
                    onChange={(e) => updateRowField(selectedRowIndex, 'unit_price', e.target.value)}
                    onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'unit_price', false)}
                    className="w-full px-1.5 py-0 font-mono font-bold text-[11px] text-right rounded border border-slate-300 bg-white focus:border-emerald-600 outline-none h-5"
                  />
                </div>

                {/* 4. Loose Quantity */}
                <div>
                  <label className="block text-[9px] font-bold uppercase text-teal-800 leading-none mb-0.5">
                    {isSyrupItem(activeRow) ? '4. Loose Mode' : '4. Loose Qty'}
                  </label>
                  {isSyrupItem(activeRow) ? (
                    <div className="px-1.5 py-0 rounded bg-amber-50/80 border border-amber-300 text-amber-900 text-[10px] font-bold text-center select-none h-5 flex items-center justify-center">
                      Bottle Only
                    </div>
                  ) : (
                    <div className="flex items-center border border-teal-300 rounded bg-white overflow-hidden h-5">
                      <NumericInput
                        id="pos_active_loose_quantity"
                        value={activeRow.loose_quantity}
                        onChange={(e) => updateRowField(selectedRowIndex, 'loose_quantity', e.target.value)}
                        onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'loose_quantity', false)}
                        className="w-full text-center font-mono font-bold text-[11px] text-teal-950 outline-none py-0 h-full"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddStripToRow(selectedRowIndex, 1)}
                        className="px-1 py-0 bg-teal-600 hover:bg-teal-700 text-white font-mono text-[9px] font-bold cursor-pointer shrink-0 h-full"
                        title={`Add 1 Strip (+${activeRow.units_per_strip || 1} Tabs)`}
                      >
                        +1S
                      </button>
                    </div>
                  )}
                </div>

                {/* 5. Loose Rate */}
                <div>
                  <label className="block text-[9px] font-bold uppercase text-blue-800 leading-none mb-0.5">
                    5. Loose Rate
                  </label>
                  <NumericInput
                    id="pos_active_loose_rate"
                    disabled={isSyrupItem(activeRow)}
                    value={activeRow.loose_rate}
                    onChange={(e) => updateRowField(selectedRowIndex, 'loose_rate', e.target.value)}
                    onKeyDown={(e) => handlePosFieldKeyDown(e, selectedRowIndex, 'loose_rate', false)}
                    className="w-full px-1.5 py-0 font-mono font-bold text-[11px] text-right rounded border border-blue-400 bg-blue-50/30 focus:bg-white text-blue-950 focus:border-blue-600 outline-none disabled:opacity-50 h-5"
                    title="Edit Loose Rate for this line item and press Enter to add next item"
                  />
                </div>

                {/* Line Total Preview */}
                <div>
                  <label className="block text-[9px] font-bold uppercase text-slate-500 leading-none mb-0.5">
                    Line Total
                  </label>
                  <div className="px-1.5 py-0 bg-emerald-100/70 border border-emerald-300 rounded font-mono font-black text-[11px] text-emerald-950 text-right h-5 flex items-center justify-end">
                    {formatPKR(activeRow.line_total)}
                  </div>
                </div>

                {/* Add Next Item Button */}
                <div>
                  <button
                    type="button"
                    onClick={() => advanceToNewRowItemSearch(selectedRowIndex, 'pos')}
                    className="w-full rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer shadow-2xs h-5"
                    title="Add a new empty row and focus Item Search (or press Enter in Loose Rate)"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Next Item ↵</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-dashed border-slate-300 rounded px-2.5 py-0.5 text-center text-[11px] text-slate-500 shrink-0">
              Scan a barcode or type in the search bar above to load an item into the counter billing strip.
            </div>
          )}

          {/* Compact Invoice Items Grid (~20 Visible Rows, Internal Scroll, Fixed Headers) */}
          <div className="bg-white rounded border border-slate-300 shadow-2xs overflow-hidden flex flex-col shrink-0">
            <div className="px-2.5 py-0.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-[11px] shrink-0">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                Counter Invoice Items ({rows.filter((r) => r.item_id).length} Active / {rows.length} Rows)
              </span>
              <span className="font-mono text-slate-600 text-[10px]">
                Total Units: {rows.reduce((s, r) => s + (r.total_units || 0), 0)}
              </span>
            </div>

            <div className="h-[338px] max-h-[calc(100vh-335px)] overflow-y-auto overflow-x-auto relative">
              <table className="w-full text-left text-[11px] border-collapse leading-none">
                <thead className="sticky top-0 z-10 bg-slate-200 border-b border-slate-300 text-slate-700 text-[10px] font-bold uppercase tracking-wider leading-none shadow-2xs">
                  <tr className="h-[18px]">
                    <th className="py-0 px-1.5 w-8 text-center h-[18px]">#</th>
                    <th className="py-0 px-1.5 h-[18px]">Item Description & Company</th>
                    <th className="py-0 px-1.5 w-18 text-center h-[18px]">Pack</th>
                    <th className="py-0 px-1.5 w-22 h-[18px]">Batch</th>
                    <th className="py-0 px-1.5 w-22 text-center h-[18px]">1. Qty</th>
                    <th className="py-0 px-1.5 w-18 text-right h-[18px]">2. Disc %</th>
                    <th className="py-0 px-1.5 w-22 text-right h-[18px]">3. Price</th>
                    <th className="py-0 px-1.5 w-22 text-center h-[18px]">4. Loose Qty</th>
                    <th className="py-0 px-1.5 w-22 text-right text-blue-900 h-[18px]">5. Loose Rate</th>
                    <th className="py-0 px-1.5 w-26 text-right h-[18px]">Total (PKR)</th>
                    <th className="py-0 px-1 w-8 text-center h-[18px]"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {rows.map((row, rIdx) => {
                    const isSelected = rIdx === selectedRowIndex;

                    return (
                      <tr
                        key={row.row_id}
                        onClick={() => setSelectedRowIndex(rIdx)}
                        className={`cursor-pointer transition-colors h-[16px] leading-none ${
                          isSelected
                            ? 'bg-emerald-50/90 font-medium'
                            : rIdx % 2 === 0
                            ? 'bg-white hover:bg-slate-50'
                            : 'bg-slate-50/50 hover:bg-slate-100/60'
                        }`}
                      >
                        <td className="py-0 px-1 text-center font-mono text-slate-500 text-[10px] h-[16px] align-middle">
                          {rIdx + 1}
                        </td>
                        <td className="py-0 px-1.5 h-[16px] align-middle truncate max-w-[260px]">
                          {row.item_name ? (
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="font-bold text-slate-900 text-[11px] truncate">
                                {row.item_name}
                              </span>
                              {row.company_name && (
                                <span className="text-[9.5px] text-slate-500 truncate">
                                  ({row.company_name} • {row.item_code})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-300 italic text-[10px]">—</span>
                          )}
                        </td>
                        <td className="py-0 px-1 text-center font-mono text-[10px] text-slate-700 h-[16px] align-middle">
                          {row.packing}
                        </td>
                        <td className="py-0 px-1 font-mono text-[10px] text-slate-600 h-[16px] align-middle truncate">
                          {row.batch_number || ''}
                        </td>

                        {/* 1. Qty */}
                        <td className="p-0 h-[16px] align-middle">
                          <NumericInput
                            id={`pos_row_${rIdx}_quantity`}
                            value={row.quantity}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'quantity', e.target.value)}
                            onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'quantity', true)}
                            className="w-full px-1 py-0 text-center font-mono font-bold text-[11px] text-slate-900 border border-transparent focus:border-emerald-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none"
                          />
                        </td>

                        {/* 2. Disc % */}
                        <td className="p-0 text-right h-[16px] align-middle">
                          <NumericInput
                            id={`pos_row_${rIdx}_discount_percent`}
                            value={row.discount_percent}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'discount_percent', e.target.value)}
                            onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'discount_percent', true)}
                            className="w-full px-1 py-0 text-right font-mono text-[11px] text-slate-800 border border-transparent focus:border-blue-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none"
                          />
                        </td>

                        {/* 3. Price */}
                        <td className="p-0 text-right h-[16px] align-middle">
                          <NumericInput
                            id={`pos_row_${rIdx}_unit_price`}
                            value={row.unit_price}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'unit_price', e.target.value)}
                            onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'unit_price', true)}
                            className="w-full px-1 py-0 text-right font-mono font-bold text-[11px] text-slate-900 border border-transparent focus:border-blue-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none"
                          />
                        </td>

                        {/* 4. Loose Qty */}
                        <td className="p-0 text-center h-[16px] align-middle">
                          {isSyrupItem(row) ? (
                            <span className="text-[9px] font-bold text-amber-800">Bottle</span>
                          ) : (
                            <NumericInput
                              id={`pos_row_${rIdx}_loose_quantity`}
                              value={row.loose_quantity}
                              onFocus={() => setSelectedRowIndex(rIdx)}
                              onChange={(e) => updateRowField(rIdx, 'loose_quantity', e.target.value)}
                              onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'loose_quantity', true)}
                              className="w-full px-1 py-0 text-center font-mono font-bold text-[11px] text-teal-950 border border-transparent focus:border-teal-500 bg-transparent focus:bg-white h-[15px] leading-none outline-none"
                            />
                          )}
                        </td>

                        {/* 5. Loose Rate */}
                        <td className="p-0 text-right h-[16px] align-middle">
                          <NumericInput
                            id={`pos_row_${rIdx}_loose_rate`}
                            disabled={isSyrupItem(row)}
                            value={row.loose_rate}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'loose_rate', e.target.value)}
                            onKeyDown={(e) => handlePosFieldKeyDown(e, rIdx, 'loose_rate', true)}
                            className="w-full px-1 py-0 text-right font-mono font-bold text-[11px] text-blue-950 border border-transparent focus:border-blue-500 bg-blue-50/20 focus:bg-white h-[15px] leading-none outline-none disabled:opacity-40"
                          />
                        </td>

                        <td className="py-0 px-1.5 text-right font-mono font-black text-slate-900 text-[11px] h-[16px] align-middle">
                          {row.line_total > 0 ? formatPKR(row.line_total) : ''}
                        </td>
                        <td className="py-0 px-1 text-center h-[16px] align-middle">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRow(rIdx);
                            }}
                            className="p-0 text-slate-400 hover:text-rose-600 cursor-pointer leading-none"
                            title="Delete item"
                          >
                            <Trash2 className="w-3 h-3 inline" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* POS Bottom Payment Section — Positioned Immediately Below Sales Items Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-1.5 shrink-0">
            {/* Left 7 cols: Quick Cash Tender & Live Change / Remaining */}
            <div className="lg:col-span-7 bg-white rounded border border-slate-200 px-2.5 py-1.5 shadow-2xs space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1 border-b border-slate-100">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1">
                  <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Payment Settlement & Cash Tender</span>
                  <span className="text-[10px] font-mono text-slate-500 ml-1">
                    (Mode: <strong className="text-slate-800">{paymentMode}</strong>)
                  </span>
                </span>

                {/* Quick Cash Buttons Inline */}
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={handleExactCash}
                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[10px] font-black cursor-pointer shadow-2xs"
                  >
                    Exact Amount
                  </button>
                  {[100, 500, 1000, 5000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => handleQuickCash(amt)}
                      className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 font-mono text-[10px] font-bold text-slate-800 cursor-pointer"
                    >
                      Rs. {amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount Received Input & Live Balance */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold text-slate-700 whitespace-nowrap">
                    Received (PKR):
                  </label>
                  <NumericInput
                    value={paidAmountInput}
                    onChange={(e) => {
                      setPaidAmountManuallyEdited(true);
                      setPaidAmountInput(e.target.value);
                    }}
                    className="w-full px-2.5 py-1 rounded border-2 border-emerald-500 text-sm font-mono font-black text-emerald-950 bg-emerald-50/20 text-right outline-none h-7"
                  />
                </div>

                {/* High Contrast Live Change / Remaining Banner */}
                <div
                  className={`px-2.5 py-1 rounded border flex items-center justify-between ${
                    paidAmount >= totalReceivable
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                      : 'bg-amber-50 border-amber-300 text-amber-950'
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    {paidAmount >= totalReceivable ? 'Change to Return:' : 'Remaining Balance:'}
                  </span>
                  <span className="text-sm font-mono font-black">
                    {formatPKR(Math.abs(paidAmount - totalReceivable))}
                  </span>
                </div>
              </div>

              {/* Extra Discounts & Notes */}
              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100 text-[11px]">
                <div className="flex items-center gap-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase whitespace-nowrap">
                    Bill Disc %:
                  </label>
                  <NumericInput
                    value={invoiceDiscountPercent}
                    onChange={(e) => setInvoiceDiscountPercent(Math.max(0, Number(e.target.value || 0)))}
                    className="w-full px-1.5 py-0.5 rounded border border-slate-200 font-mono text-[11px] h-5 text-right"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase whitespace-nowrap">
                    Auth By:
                  </label>
                  <input
                    type="text"
                    value={discountOverrideBy}
                    onChange={(e) => setDiscountOverrideBy(e.target.value)}
                    placeholder="Pharmacist"
                    className="w-full px-1.5 py-0.5 rounded border border-slate-200 text-[11px] h-5"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <label className="text-[10px] font-bold text-slate-600 uppercase whitespace-nowrap">
                    Deliv Note:
                  </label>
                  <input
                    type="text"
                    value={deliveryNotes}
                    onChange={(e) => setDeliveryNotes(e.target.value)}
                    placeholder="Rider notes..."
                    className="w-full px-1.5 py-0.5 rounded border border-slate-200 text-[11px] h-5"
                  />
                </div>
              </div>
            </div>

            {/* Right 5 cols: Invoice Totals & Large Action Buttons */}
            <div className="lg:col-span-5 bg-slate-900 text-white rounded px-2.5 py-1.5 shadow-2xs flex flex-col justify-between gap-1">
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                <div className="flex justify-between text-slate-400">
                  <span>Gross Subtotal:</span>
                  <span className="font-mono font-bold text-slate-200">{formatPKR(grossAmount)}</span>
                </div>
                <div className="flex justify-between text-rose-400">
                  <span>Total Discounts:</span>
                  <span className="font-mono font-bold">-{formatPKR(itemDiscountTotal + computedInvoiceDiscAmt)}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Prev Ledger ({prevBalanceType}):</span>
                  <span className="font-mono font-semibold text-amber-300">
                    {formatPKR(prevCustomerBalance)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Adv Tax / Deliv:</span>
                  <span className="font-mono font-bold text-amber-300">
                    +{formatPKR(advanceTaxAmount + deliveryCharges)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-800 pt-0.5 items-baseline">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                    Net Invoice:
                  </span>
                  <span className="text-sm font-mono font-black text-emerald-400">
                    {formatPKR(netInvoiceAmount)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-800 pt-0.5 items-baseline">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-sky-300">
                    Total Receivable:
                  </span>
                  <span className="font-mono text-sm font-black text-sky-300">{formatPKR(totalReceivable)}</span>
                </div>
              </div>

              {/* Clearly accessible Save and Print Actions */}
              <div className="pt-1 border-t border-slate-800 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed')}
                  className="flex-1 py-1.5 px-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[11px] flex items-center justify-center gap-1 cursor-pointer shadow-xs"
                  title="Complete & Save Invoice (F2)"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Invoice (F2)</span>
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', 'a4')}
                  className="py-1.5 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold text-[11px] flex items-center justify-center gap-1 cursor-pointer border border-slate-700"
                  title="Save & Print A4 Invoice (Ctrl+P)"
                >
                  <Printer className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Print A4</span>
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', '80mm')}
                  className="py-1.5 px-2 rounded bg-teal-800 hover:bg-teal-700 text-teal-100 font-bold text-[10px] flex items-center justify-center gap-1 cursor-pointer"
                  title="Print 80mm Thermal Receipt"
                >
                  <Printer className="w-3 h-3 text-teal-300" />
                  <span>80mm</span>
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', '58mm')}
                  className="py-1.5 px-2 rounded bg-amber-800 hover:bg-amber-700 text-amber-100 font-bold text-[10px] flex items-center justify-center gap-1 cursor-pointer"
                  title="Print 58mm Thermal Receipt"
                >
                  <Printer className="w-3 h-3 text-amber-300" />
                  <span>58mm</span>
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('held')}
                  className="py-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-[10px] flex items-center justify-center gap-1 cursor-pointer border border-slate-700"
                  title="Hold Bill (F3)"
                >
                  <PauseCircle className="w-3 h-3 text-amber-400" />
                  <span>Hold</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= OPTION 2: MICROSOFT ACCESS-STYLE INTERFACE (FULL-SCREEN DESKTOP FORM) ================= */}
      {invoiceViewMode === 'access' && (
        <div className="flex flex-col min-h-0 max-h-full bg-slate-200 border-2 border-slate-400 rounded-sm shadow-xs overflow-hidden select-none">
          {/* Access Window Title Bar & Ribbon Toolbar Combined Compact Strip */}
          <div className="bg-gradient-to-r from-slate-800 via-slate-850 to-slate-900 text-white px-2.5 py-0.5 flex flex-wrap items-center justify-between gap-1 border-b border-slate-700 text-[11px] shrink-0 select-none">
            <div className="flex items-center gap-2 font-mono">
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="font-bold text-slate-200 tracking-tight">frm_SalesInvoice : Form</span>
              <span className="text-[10px] bg-emerald-700 px-1.5 py-0.2 rounded text-white font-bold uppercase">
                {invoiceType}
              </span>
              <span className="font-bold text-amber-300">{invoiceNumber}</span>
              {editingSaleId && (
                <span className="bg-amber-600 text-white text-[9px] px-1.5 py-0.2 rounded font-bold">
                  EDIT #{editingSaleId}
                </span>
              )}
              <span className="text-[10px] text-slate-400 hidden xl:inline ml-1">
                (F2: Save · F3: Hold · Ctrl+P: Print · Tab/Enter: Next Cell · Arrows: Navigate)
              </span>
            </div>

            {/* Action & Navigation Buttons */}
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setEditingSaleId(null);
                  setRows(ensureMinimumRows([]));
                  setSelectedRowIndex(0);
                  setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
                  setPaidAmountInput('');
                  setPaidAmountManuallyEdited(false);
                  setRemarks('');
                  setDeliveryNotes('');
                }}
                className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="New Sales Invoice (Ctrl+N)"
              >
                <Plus className="w-3 h-3 text-emerald-400" />
                New
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveInvoice('completed')}
                className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Complete & Save Invoice (F2)"
              >
                <Save className="w-3 h-3" />
                Save (F2)
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveInvoice('completed', 'a4')}
                className="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Save & Print A4 Invoice (Ctrl+P)"
              >
                <Printer className="w-3 h-3 text-emerald-400" />
                A4
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveInvoice('completed', '80mm')}
                className="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Print 80mm Thermal Receipt"
              >
                <Printer className="w-3 h-3 text-teal-400" />
                80mm
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveInvoice('completed', '58mm')}
                className="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Print 58mm Thermal Receipt"
              >
                <Printer className="w-3 h-3 text-amber-400" />
                58mm
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveInvoice('held')}
                className="px-1.5 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Hold this invoice (F3)"
              >
                <PauseCircle className="w-3 h-3" />
                Hold
              </button>
              <button
                type="button"
                onClick={() => setShowHeldDrawer(true)}
                className="px-1.5 py-0.5 rounded bg-indigo-700 hover:bg-indigo-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <PlayCircle className="w-3 h-3 text-indigo-200" />
                Drafts ({heldInvoices.length})
              </button>
              <button
                type="button"
                onClick={() => openCustomerShortcut('ledger')}
                className="px-1.5 py-0.5 rounded bg-teal-700 hover:bg-teal-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                title="Open selected customer ledger"
              >
                <BookOpen className="w-3 h-3 text-teal-200" />
                Ledger
              </button>
              <button
                type="button"
                onClick={() => setShowAdvanceTaxModal(true)}
                className={`px-1.5 py-0.5 rounded border text-[10px] font-bold flex items-center gap-1 cursor-pointer ${
                  advanceTaxApplicable
                    ? 'bg-amber-500 border-amber-300 text-slate-950'
                    : 'bg-slate-700 hover:bg-slate-600 border-slate-600 text-slate-200'
                }`}
              >
                <Percent className="w-3 h-3 text-amber-300" />
                Adv Tax {advanceTaxApplicable ? `(${effectiveAdvTaxRate}%)` : ''}
              </button>
            </div>
          </div>

          {/* Dense MS Access Form Header Controls */}
          <div className="px-2 py-0.5 bg-slate-100 border-b border-slate-300 shrink-0">
            <div className="grid grid-cols-12 gap-1 items-center text-[11px]">
              {/* Inv # */}
              <div className="col-span-2 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-9">
                  Inv #:
                </label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  className="w-full px-1 py-0 rounded border border-slate-300 font-mono font-bold text-slate-900 bg-white text-[11px] h-5"
                />
              </div>

              {/* Date */}
              <div className="col-span-2 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-8">
                  Date:
                </label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full px-1 py-0 rounded border border-slate-300 font-mono text-slate-900 bg-white text-[11px] h-5"
                />
              </div>

              {/* Customer Selection */}
              <div className="col-span-4 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-13">
                  Customer:
                </label>
                <div className="flex-1 flex gap-1">
                  <input
                    type="text"
                    placeholder="Find..."
                    value={customerSearchText}
                    onChange={(e) => setCustomerSearchText(e.target.value)}
                    className="w-14 px-1 py-0 rounded border border-slate-300 text-[10px] bg-white h-5"
                  />
                  <select
                    value={customerAccountId}
                    onChange={(e) => setCustomerAccountId(Number(e.target.value))}
                    className="flex-1 px-1 py-0 rounded border border-slate-300 font-bold text-slate-900 bg-white text-[11px] h-5"
                  >
                    {filteredCustomers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.account_name} ({c.account_code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Invoice Type */}
              <div className="col-span-2 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-8">
                  Type:
                </label>
                <select
                  value={invoiceType}
                  onChange={(e) => handleInvoiceTypeChange(e.target.value as SalesInvoiceType)}
                  className="w-full px-1 py-0 rounded border border-slate-300 font-bold text-slate-900 bg-white text-[11px] h-5"
                >
                  <option value="Retail">Retail</option>
                  <option value="Wholesale">Wholesale</option>
                </select>
              </div>

              {/* Payment Mode */}
              <div className="col-span-2 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-9">
                  Mode:
                </label>
                <select
                  value={paymentMode}
                  onChange={(e) => {
                    setPaidAmountManuallyEdited(false);
                    setPaymentMode(e.target.value as SalesPaymentMode);
                  }}
                  className="w-full px-1 py-0 rounded border border-slate-300 font-bold text-slate-900 bg-white text-[11px] h-5"
                >
                  <option value="Cash">Cash</option>
                  <option value="Credit">Credit</option>
                  <option value="Partial">Partial</option>
                  <option value="Bank">Bank</option>
                </select>
              </div>
            </div>

            {/* Row 2: Salesman, Deliveryman, Charges & Customer Live Ledger Strip */}
            <div className="grid grid-cols-12 gap-1 items-center text-[11px] pt-0.5 mt-0.5 border-t border-slate-200">
              {/* Salesman */}
              <div className="col-span-3 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-14 flex items-center gap-0.5">
                  <UserCheck className="w-3 h-3 text-emerald-600" />
                  Salesman:
                </label>
                <select
                  value={salesmanId || ''}
                  onChange={(e) => {
                    const idVal = e.target.value ? Number(e.target.value) : null;
                    setSalesmanId(idVal);
                    const found = salesmenList.find((s) => s.id === idVal);
                    if (found) setSalesman(found.name);
                  }}
                  className="w-full px-1 py-0 rounded border border-slate-300 font-semibold text-slate-900 bg-white text-[11px] h-5"
                >
                  <option value="">-- No Salesman --</option>
                  {filteredSalesmen.map((sm) => (
                    <option key={sm.id} value={sm.id}>
                      {sm.name} ({sm.salesman_code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Deliveryman */}
              <div className="col-span-3 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-16 flex items-center gap-0.5">
                  <Truck className="w-3 h-3 text-sky-600" />
                  Delivery:
                </label>
                <select
                  value={deliverymanId || ''}
                  onChange={(e) => {
                    const idVal = e.target.value ? Number(e.target.value) : null;
                    setDeliverymanId(idVal);
                    const found = deliverymenList.find((d) => d.id === idVal);
                    setDeliverymanName(found ? found.name : '');
                    if (idVal && deliveryStatus === 'Pending') {
                      setDeliveryStatus('Assigned');
                    } else if (!idVal) {
                      setDeliveryStatus('Pending');
                    }
                  }}
                  className="w-full px-1 py-0 rounded border border-slate-300 font-semibold text-slate-900 bg-white text-[11px] h-5"
                >
                  <option value="">Counter Pickup</option>
                  {filteredDeliverymen.map((dm) => (
                    <option key={dm.id} value={dm.id}>
                      {dm.name} ({dm.deliveryman_code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Delivery Status */}
              <div className="col-span-2 flex items-center gap-1">
                <label className="text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-9">
                  Status:
                </label>
                <select
                  value={deliveryStatus}
                  onChange={(e) => setDeliveryStatus(e.target.value as any)}
                  className="w-full px-1 py-0 rounded border border-slate-300 font-semibold text-slate-900 bg-white text-[11px] h-5"
                >
                  <option value="Pending">Pending</option>
                  <option value="Assigned">Assigned</option>
                  <option value="Out for Delivery">Out</option>
                  <option value="Delivered">Delivered</option>
                  <option value="Failed">Failed</option>
                  <option value="Returned">Returned</option>
                </select>
              </div>

              {/* Customer Previous Balance & Live Ledger Strip */}
              <div className="col-span-4 bg-slate-900 text-white rounded px-2 py-0 flex items-center justify-between text-[10px] h-5">
                <div className="flex items-center gap-1">
                  <span className="text-slate-400">Prev Bal:</span>
                  <span className="font-mono font-bold text-amber-300">
                    {formatPKR(prevCustomerBalance)}
                  </span>
                </div>
                <div className="flex items-center gap-1 border-l border-slate-700 pl-1.5">
                  <span className="text-slate-400">Total Rec:</span>
                  <span className="font-mono font-black text-emerald-300">
                    {formatPKR(totalReceivable)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => openCustomerShortcut('ledger')}
                  className="px-1 py-0 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 text-[9px] font-mono border border-slate-700 cursor-pointer"
                  title="Open full ledger in new view"
                >
                  Ledger ↗
                </button>
              </div>
            </div>
          </div>

          {/* ================= 2. COMPACT BARCODE SCANNER & ROW CONTROLS ================= */}
          <div className="bg-slate-800 px-2 py-0.5 text-white border-b border-slate-700 relative shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              {/* Quick Search & Barcode Scan Input */}
              <div className="flex-1 min-w-[260px] relative">
                <div className="flex items-center bg-slate-900 border border-slate-700 rounded px-2 py-0 focus-within:border-emerald-400 h-5">
                  <Search className="w-3 h-3 text-emerald-400 mr-1.5 shrink-0" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={quickSearchQuery}
                    onFocus={() => {
                      setShowSearchDropdown(true);
                      runFastSearch(quickSearchQuery);
                    }}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQuickSearchQuery(val);
                      setShowSearchDropdown(true);
                      runFastSearch(val);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setSearchHighlightIdx((prev) =>
                          Math.min(searchResults.length - 1, prev + 1)
                        );
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setSearchHighlightIdx((prev) => Math.max(0, prev - 1));
                      } else if (e.key === 'Enter' && searchResults[searchHighlightIdx]) {
                        e.preventDefault();
                        handleSelectFromTopSearch(searchResults[searchHighlightIdx]);
                      } else if (e.key === 'Escape') {
                        setShowSearchDropdown(false);
                      }
                    }}
                    placeholder="Barcode Scanner / Fast Medicine Search (Type Code, Barcode, Name, or Generic)..."
                    className="w-full bg-transparent text-[11px] text-white placeholder-slate-400 focus:outline-none"
                  />
                  <Barcode className="w-3.5 h-3.5 text-slate-400 ml-1.5 shrink-0" />
                </div>

                {/* Instant Search Dropdown */}
                {showSearchDropdown && searchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-white text-slate-900 rounded-lg shadow-2xl border border-slate-300 max-h-60 overflow-y-auto">
                    <table className="w-full text-left text-[11px] border-collapse">
                      <thead className="bg-slate-100 text-slate-600 sticky top-0 border-b border-slate-200">
                        <tr>
                          <th className="px-2 py-1">Code</th>
                          <th className="px-2 py-1">Medicine Name</th>
                          <th className="px-2 py-1">Generic</th>
                          <th className="px-2 py-1">Company</th>
                          <th className="px-2 py-1 text-center">Packing</th>
                          <th className="px-2 py-1 text-right">Stock</th>
                          <th className="px-2 py-1 text-right">Retail</th>
                          <th className="px-2 py-1 text-right">Wholesale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchResults.map((item, idx) => {
                          const isHighlighted = idx === searchHighlightIdx;
                          return (
                            <tr
                              key={item.id}
                              onMouseDown={() => handleSelectFromTopSearch(item)}
                              onMouseEnter={() => setSearchHighlightIdx(idx)}
                              className={`cursor-pointer border-b border-slate-100 ${
                                isHighlighted ? 'bg-emerald-50 font-semibold' : 'hover:bg-slate-50'
                              }`}
                            >
                              <td className="px-2 py-1 font-mono font-bold text-emerald-700">
                                {item.item_code}
                              </td>
                              <td className="px-2 py-1 font-bold text-slate-900">
                                {item.item_name}
                              </td>
                              <td className="px-2 py-1 text-slate-500">{item.generic_name}</td>
                              <td className="px-2 py-1 text-slate-600">{item.company_name}</td>
                              <td className="px-2 py-1 text-center font-mono">
                                {item.packing} ({item.units_per_pack}u)
                              </td>
                              <td className="px-2 py-1 text-right font-mono font-bold">
                                <span
                                  className={
                                    item.total_available_units > 0
                                      ? 'text-emerald-700'
                                      : 'text-rose-600'
                                  }
                                >
                                  {item.total_available_packs}P ({item.total_available_units}U)
                                </span>
                              </td>
                              <td className="px-2 py-1 text-right font-mono font-bold">
                                {formatPKR(item.retail_price)}
                              </td>
                              <td className="px-2 py-1 text-right font-mono">
                                {formatPKR(item.wholesale_price)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Row Actions Toolbar */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleInsertRow}
                  className="px-2 py-0 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer h-5"
                  title="Add a new line item"
                >
                  <Plus className="w-3 h-3" />
                  Add Row
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteRow(selectedRowIndex)}
                  className="px-2 py-0 rounded bg-rose-700 hover:bg-rose-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer h-5"
                  title="Delete active row"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyRow(selectedRowIndex)}
                  className="px-1.5 py-0 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 text-[10px] font-semibold flex items-center gap-1 cursor-pointer h-5"
                  title="Copy active row"
                >
                  <Copy className="w-3 h-3" />
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => handlePasteRow(selectedRowIndex)}
                  disabled={!copiedRowData}
                  className="px-1.5 py-0 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 border border-slate-600 text-[10px] font-semibold flex items-center gap-1 cursor-pointer h-5"
                  title="Paste into active row"
                >
                  <ClipboardPaste className="w-3 h-3" />
                  Paste
                </button>
                <label className="ml-1 flex items-center gap-1 text-[10px] text-amber-300 bg-slate-900 px-1.5 py-0 rounded border border-slate-700 cursor-pointer h-5">
                  <input
                    type="checkbox"
                    checked={allowNegativeStock}
                    onChange={(e) => setAllowNegativeStock(e.target.checked)}
                    className="rounded text-amber-500"
                  />
                  <ShieldAlert className="w-3 h-3 text-amber-400" />
                  <span>Neg Stock</span>
                </label>
              </div>
            </div>
          </div>

          {/* ================= 3. MICROSOFT ACCESS-STYLE DATASHEET GRID (COMPACT ~20 VISIBLE ROWS) ================= */}
          <div className="flex flex-col bg-white overflow-hidden select-none border-b border-slate-400 shrink-0">
            {/* Vertical scrolling inside the item grid only after 20 visible rows, sticky column headers */}
            <div className="h-[338px] max-h-[calc(100vh-215px)] overflow-y-auto overflow-x-auto relative">
              <table className="w-full border-collapse text-[11px] font-sans leading-none">
                <thead className="sticky top-0 z-10 bg-slate-200 border-b border-slate-400 text-slate-800 text-[10px] font-bold select-none shadow-2xs leading-none">
                  <tr className="h-[18px]">
                    {/* Access Row Selector column */}
                    <th
                      style={{ width: `${colWidths.selector}px`, minWidth: `${colWidths.selector}px` }}
                      className="bg-slate-300/80 border-r border-slate-400 px-1 py-0 text-center font-mono relative h-[18px]"
                    >
                      #
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('selector', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 1. Item Code */}
                    <th
                      style={{ width: `${colWidths.item_code}px`, minWidth: `${colWidths.item_code}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-left relative h-[18px]"
                    >
                      Item Code
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('item_code', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 2. Company */}
                    <th
                      style={{ width: `${colWidths.company}px`, minWidth: `${colWidths.company}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-left relative h-[18px]"
                    >
                      Company
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('company', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 3. Item Name */}
                    <th
                      style={{ width: `${colWidths.item_name}px`, minWidth: `${colWidths.item_name}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-left relative h-[18px]"
                    >
                      Item Name
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('item_name', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 4. Packing */}
                    <th
                      style={{ width: `${colWidths.packing}px`, minWidth: `${colWidths.packing}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-center relative h-[18px]"
                    >
                      Packing
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('packing', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 5. Qty (Box / Pack) */}
                    <th
                      style={{ width: `${colWidths.quantity}px`, minWidth: `${colWidths.quantity}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right bg-emerald-100/60 text-emerald-950 relative h-[18px]"
                    >
                      Qty
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('quantity', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 6. Discount */}
                    <th
                      style={{ width: `${colWidths.discount}px`, minWidth: `${colWidths.discount}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right relative h-[18px]"
                    >
                      Discount
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('discount', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 7. Price */}
                    <th
                      style={{ width: `${colWidths.unit_price}px`, minWidth: `${colWidths.unit_price}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right relative h-[18px]"
                    >
                      Price
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('unit_price', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 8. Loose Qty */}
                    <th
                      style={{ width: `${colWidths.loose_quantity}px`, minWidth: `${colWidths.loose_quantity}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right bg-teal-100/60 text-teal-950 relative h-[18px]"
                    >
                      Loose Qty
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('loose_quantity', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 9. Loose Rate */}
                    <th
                      style={{ width: `${colWidths.loose_rate}px`, minWidth: `${colWidths.loose_rate}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right bg-blue-100/60 text-blue-950 relative h-[18px]"
                    >
                      Loose Rate
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('loose_rate', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* 10. Amount */}
                    <th
                      style={{ width: `${colWidths.amount}px`, minWidth: `${colWidths.amount}px` }}
                      className="border-r border-slate-300 px-1 py-0 text-right bg-slate-300/60 font-black relative h-[18px]"
                    >
                      Amount
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('amount', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>

                    {/* Actions / Batch */}
                    <th
                      style={{ width: `${colWidths.actions}px`, minWidth: `${colWidths.actions}px` }}
                      className="px-1 py-0 text-center relative h-[18px]"
                    >
                      Batch / Del
                      <div
                        onMouseDown={(e) => handleColResizeMouseDown('actions', e)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-emerald-600"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rIdx) => {
                    const isSelected = rIdx === selectedRowIndex;
                    const remainingUnits = round2(row.available_stock_units - row.total_units);
                    const isOverStock =
                      row.item_id !== null && !allowNegativeStock && remainingUnits < 0;

                    return (
                      <tr
                        key={row.row_id}
                        onClick={() => setSelectedRowIndex(rIdx)}
                        className={`border-b border-slate-300 font-sans transition-colors h-[16px] leading-none ${
                          isOverStock
                            ? 'bg-rose-100/90'
                            : isSelected
                            ? 'bg-amber-50/90 font-medium'
                            : rIdx % 2 === 0
                            ? 'bg-white hover:bg-slate-50'
                            : 'bg-slate-50/60 hover:bg-slate-100/60'
                        }`}
                      >
                        {/* Access Row Selector column showing ▶ on active row */}
                        <td className="border-r border-slate-300 px-0.5 py-0 text-center bg-slate-100 font-mono text-[9.5px] text-slate-700 h-[16px] align-middle">
                          {isSelected ? (
                            <span className="text-black font-black text-[8.5px]">▶</span>
                          ) : !row.item_id && rIdx === rows.length - 1 ? (
                            <span className="text-slate-400 font-bold">*</span>
                          ) : (
                            <span>{rIdx + 1}</span>
                          )}
                        </td>

                        {/* 1. Item Code */}
                        <td className="border-r border-slate-300 p-0 h-[16px] align-middle">
                          <input
                            id={`cell_${rIdx}_item_code`}
                            type="text"
                            value={row.item_code}
                            onFocus={() => {
                              setSelectedRowIndex(rIdx);
                              setActiveSearchRowIdx(rIdx);
                            }}
                            onChange={(e) => {
                              const val = e.target.value;
                              updateRowField(rIdx, 'item_code', val);
                              setActiveSearchRowIdx(rIdx);
                              setQuickSearchQuery(val);
                              setShowSearchDropdown(true);
                              runFastSearch(val);
                            }}
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'item_code')}
                            className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white font-mono font-bold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                          />
                        </td>

                        {/* 2. Company */}
                        <td className="border-r border-slate-300 px-1 py-0 text-slate-700 truncate text-[10px] h-[16px] align-middle max-w-[110px]">
                          {row.company_name || ''}
                        </td>

                        {/* 3. Item Name */}
                        <td className="border-r border-slate-300 p-0 h-[16px] align-middle">
                          <input
                            id={`cell_${rIdx}_item_name`}
                            type="text"
                            value={row.item_name}
                            onFocus={() => {
                              setSelectedRowIndex(rIdx);
                              setActiveSearchRowIdx(rIdx);
                            }}
                            onChange={(e) => {
                              const val = e.target.value;
                              updateRowField(rIdx, 'item_name', val);
                              setActiveSearchRowIdx(rIdx);
                              setQuickSearchQuery(val);
                              setShowSearchDropdown(true);
                              runFastSearch(val);
                            }}
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'item_name')}
                            className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white font-semibold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                          />
                        </td>

                        {/* 4. Packing */}
                        <td className="border-r border-slate-300 px-1 py-0 text-center font-mono text-[9.5px] text-slate-800 h-[16px] align-middle whitespace-nowrap">
                          <span>{row.packing}</span>
                          {row.item_id && row.units_per_pack > 1 && (
                            <span className="text-slate-500 ml-0.5">({row.units_per_pack}u)</span>
                          )}
                        </td>

                        {/* 5. Qty (Step 1 after item selection) */}
                        <td className="border-r border-slate-300 p-0 bg-emerald-50/20 h-[16px] align-middle">
                          <NumericInput
                            id={`cell_${rIdx}_quantity`}
                            value={row.quantity}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'quantity', e.target.value)}
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'quantity')}
                            className="w-full px-1 py-0 border border-transparent focus:border-emerald-600 focus:bg-white text-right font-mono font-bold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                          />
                        </td>

                        {/* 6. Discount (Step 2) */}
                        <td className="border-r border-slate-300 p-0 h-[16px] align-middle">
                          <NumericInput
                            id={`cell_${rIdx}_discount_percent`}
                            value={row.discount_percent}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'discount_percent', e.target.value)}
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'discount_percent')}
                            className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                          />
                        </td>

                        {/* 7. Price (Step 3) */}
                        <td className="border-r border-slate-300 p-0 h-[16px] align-middle">
                          <NumericInput
                            id={`cell_${rIdx}_unit_price`}
                            value={row.unit_price}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'unit_price', e.target.value)}
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'unit_price')}
                            className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono font-bold text-slate-900 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                          />
                        </td>

                        {/* 8. Loose Qty (Step 4) */}
                        <td className="border-r border-slate-300 p-0 bg-teal-50/20 h-[16px] align-middle">
                          {isSyrupItem(row) ? (
                            <div className="flex items-center justify-center h-[15px] select-none">
                              <span className="text-[8.5px] text-amber-800 bg-amber-100 border border-amber-300 px-1 py-0 rounded font-bold whitespace-nowrap">
                                Bottle
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center h-[15px]">
                              <NumericInput
                                id={`cell_${rIdx}_loose_quantity`}
                                value={row.loose_quantity}
                                onFocus={() => setSelectedRowIndex(rIdx)}
                                onChange={(e) => updateRowField(rIdx, 'loose_quantity', e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'loose_quantity')}
                                className="w-full px-1 py-0 border border-transparent focus:border-teal-600 focus:bg-white text-right font-mono font-bold text-teal-950 bg-transparent text-[11px] h-[15px] leading-none outline-none"
                              />
                              {row.item_id && row.units_per_strip > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateRowField(
                                      rIdx,
                                      'loose_quantity',
                                      Number(row.loose_quantity || 0) + row.units_per_strip
                                    )
                                  }
                                  title={`Add 1 Strip (+${row.units_per_strip} Loose Units)`}
                                  className="px-0.5 py-0 rounded bg-teal-100 hover:bg-teal-200 text-teal-800 font-mono text-[8px] font-bold shrink-0 cursor-pointer mr-0.5 leading-tight"
                                >
                                  +1S
                                </button>
                              )}
                            </div>
                          )}
                        </td>

                        {/* 9. Loose Rate (Step 5 -> Enter creates new row & focuses Item Search) */}
                        <td className="border-r border-slate-300 p-0 bg-blue-50/20 h-[16px] align-middle">
                          <NumericInput
                            id={`cell_${rIdx}_loose_rate`}
                            disabled={isSyrupItem(row)}
                            value={row.loose_rate}
                            onFocus={() => setSelectedRowIndex(rIdx)}
                            onChange={(e) => updateRowField(rIdx, 'loose_rate', e.target.value)}
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'loose_rate')}
                            className="w-full px-1 py-0 border border-transparent focus:border-blue-600 focus:bg-white text-right font-mono font-bold text-blue-950 bg-transparent text-[11px] h-[15px] leading-none outline-none disabled:opacity-40"
                            title="Loose Rate per unit (Press Enter to add next item row)"
                          />
                        </td>

                        {/* 10. Amount */}
                        <td className="border-r border-slate-300 px-1 py-0 text-right font-mono font-black text-slate-900 bg-slate-50/50 text-[11px] h-[16px] align-middle">
                          {row.line_total > 0 ? row.line_total.toFixed(2) : ''}
                        </td>

                        {/* Batch / Del */}
                        <td className="px-1 py-0 text-center h-[16px] align-middle">
                          <div className="flex items-center justify-center gap-0.5 h-[15px]">
                            {row.batches && row.batches.length > 0 ? (
                              <select
                                value={row.batch_number}
                                onChange={(e) => updateRowField(rIdx, 'batch_number', e.target.value)}
                                className="w-15 px-0.5 py-0 border border-slate-300 rounded font-mono text-[8.5px] bg-white h-[14px]"
                                title="Select Batch"
                              >
                                {row.batches.map((b) => (
                                  <option key={b.id} value={b.batch_number}>
                                    {b.batch_number} ({b.current_pack_qty}P)
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-[9px] font-mono text-slate-500 w-15 truncate">
                                {row.batch_number || ''}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(rIdx)}
                              className="text-rose-600 hover:text-rose-900 font-bold text-[9.5px] cursor-pointer px-0.5 leading-none"
                              title="Delete line"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Combined Microsoft Access Record Navigator & Customer History Strip */}
            <div className="bg-slate-200 border-t border-slate-400 px-2 py-0.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-700 shrink-0">
              <div className="flex items-center gap-1">
                <span className="font-bold text-[10px] text-slate-700 mr-0.5">Record:</span>
                <button
                  type="button"
                  onClick={() => setSelectedRowIndex(0)}
                  disabled={selectedRowIndex === 0}
                  className="px-1 py-0 rounded bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                  title="First Record"
                >
                  |◀
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRowIndex((prev) => Math.max(0, prev - 1))}
                  disabled={selectedRowIndex === 0}
                  className="px-1 py-0 rounded bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                  title="Previous Record"
                >
                  ◀
                </button>
                <span className="px-1.5 py-0 bg-white border border-slate-400 font-mono font-bold text-[10px] text-slate-900">
                  {selectedRowIndex + 1}
                </span>
                <span className="text-[10px] font-mono">of {rows.length}</span>
                <button
                  type="button"
                  onClick={() => setSelectedRowIndex((prev) => Math.min(rows.length - 1, prev + 1))}
                  disabled={selectedRowIndex >= rows.length - 1}
                  className="px-1 py-0 rounded bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                  title="Next Record"
                >
                  ▶
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRowIndex(rows.length - 1)}
                  disabled={selectedRowIndex >= rows.length - 1}
                  className="px-1 py-0 rounded bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-400 text-[10px] font-mono font-bold cursor-pointer"
                  title="Last Record"
                >
                  ▶|
                </button>
                <button
                  type="button"
                  onClick={handleInsertRow}
                  className="px-1.5 py-0 rounded bg-white hover:bg-slate-100 border border-slate-400 text-[10px] font-bold text-emerald-800 cursor-pointer ml-0.5"
                  title="New (Blank) Record"
                >
                  * New
                </button>
              </div>

              {/* Inline Customer Last Sale History Info */}
              <div className="flex items-center gap-1.5 truncate">
                {activeRow?.item_id && activeItemHistory?.lastCustomerSale ? (
                  <div className="flex items-center gap-1 font-mono text-[10px]">
                    <span className="px-1 py-0 rounded bg-slate-800 text-white text-[9px] font-bold">LAST SALE</span>
                    <span className="font-bold text-emerald-800">
                      {formatPKR(activeItemHistory.lastCustomerSale.unit_price)}
                    </span>
                    <span className="text-rose-700">
                      ({Number(activeItemHistory.lastCustomerSale.discount_percent || 0)}% Disc)
                    </span>
                    <span className="text-slate-600">{activeItemHistory.lastCustomerSale.invoice_date}</span>
                    <button
                      type="button"
                      onClick={() => applyCustomerLastRateToRow(selectedRowIndex)}
                      className="px-1.5 py-0 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[9px] cursor-pointer"
                    >
                      Apply Rate
                    </button>
                  </div>
                ) : activeRow?.item_id ? (
                  <span className="text-[10px] text-slate-600 italic">
                    [{activeRow.item_code}] Standard {invoiceType} rate applied
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500 hidden lg:inline">
                    Select item row for customer rate history
                  </span>
                )}
                {activeItemHistory?.lastPurchase && (
                  <span className="text-[10px] text-slate-600 font-mono hidden xl:inline">
                    | Cost: <strong>{formatPKR(activeItemHistory.lastPurchase.purchase_price)}</strong>
                  </span>
                )}
                {activeRow?.item_id && (
                  <button
                    type="button"
                    onClick={() => setShowHistoryTable((v) => !v)}
                    className="px-1.5 py-0 rounded bg-white hover:bg-slate-50 border border-slate-400 text-slate-700 font-bold text-[9px] cursor-pointer"
                  >
                    {showHistoryTable ? 'Hide History ▲' : 'History ▼'}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2.5 text-[10px] font-mono">
                <span>
                  Items: <strong className="text-slate-900">{validRows.length}</strong>
                </span>
                <span>
                  Units:{' '}
                  <strong className="text-slate-900">
                    {rows.reduce((sum, r) => sum + (r.total_units || 0), 0)}
                  </strong>
                </span>
                <span>
                  Gross: <strong className="text-emerald-800">{formatPKR(grossAmount)}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Expandable History Table if toggled */}
          {showHistoryTable && activeRow?.item_id && (
            <div className="bg-slate-100 border-b border-slate-300 px-2 py-1 text-[10px] shrink-0">
              <div className="flex items-center gap-1.5 mb-1">
                <button
                  type="button"
                  onClick={() => setHistoryTab('customer_sales')}
                  className={`px-2 py-0 rounded text-[10px] font-bold cursor-pointer ${
                    historyTab === 'customer_sales'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-white text-slate-700 border border-slate-300'
                  }`}
                >
                  Customer Sales ({activeItemHistory?.customerSalesHistory?.length || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryTab('item_purchases')}
                  className={`px-2 py-0 rounded text-[10px] font-bold cursor-pointer ${
                    historyTab === 'item_purchases'
                      ? 'bg-sky-700 text-white'
                      : 'bg-white text-slate-700 border border-slate-300'
                  }`}
                >
                  Store Purchases ({activeItemHistory?.purchaseHistory?.length || 0})
                </button>
              </div>
              <div className="max-h-20 overflow-y-auto border border-slate-300 rounded bg-white">
                {historyTab === 'customer_sales' ? (
                  <table className="w-full text-left border-collapse text-[10px]">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="px-2 py-0.5">Inv #</th>
                        <th className="px-2 py-0.5">Date</th>
                        <th className="px-2 py-0.5">Customer</th>
                        <th className="px-2 py-0.5">Batch</th>
                        <th className="px-2 py-0.5 text-right">Qty</th>
                        <th className="px-2 py-0.5 text-right">Rate</th>
                        <th className="px-2 py-0.5 text-right">Disc</th>
                        <th className="px-2 py-0.5 text-right">Total</th>
                        <th className="px-2 py-0.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeItemHistory?.customerSalesHistory || []).map((h, i) => (
                        <tr key={h.sale_item_id || i} className="border-b border-slate-100 hover:bg-slate-50 font-mono">
                          <td className="px-2 py-0.5 font-bold text-emerald-800">{h.invoice_number}</td>
                          <td className="px-2 py-0.5">{h.invoice_date}</td>
                          <td className="px-2 py-0.5 font-sans">{h.customer_name}</td>
                          <td className="px-2 py-0.5">{h.batch_number}</td>
                          <td className="px-2 py-0.5 text-right font-bold">{h.quantity}P</td>
                          <td className="px-2 py-0.5 text-right font-bold">{formatPKR(h.unit_price)}</td>
                          <td className="px-2 py-0.5 text-right text-rose-700">{Number(h.discount_percent || 0)}%</td>
                          <td className="px-2 py-0.5 text-right font-bold">{formatPKR(h.line_total)}</td>
                          <td className="px-2 py-0.5 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                updateRowField(selectedRowIndex, 'unit_price', round2(h.unit_price));
                                updateRowField(selectedRowIndex, 'discount_percent', round2(h.discount_percent || 0));
                              }}
                              className="px-1.5 py-0 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-[9px] cursor-pointer"
                            >
                              Use
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-left border-collapse text-[10px]">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="px-2 py-0.5">Bill #</th>
                        <th className="px-2 py-0.5">Date</th>
                        <th className="px-2 py-0.5">Supplier</th>
                        <th className="px-2 py-0.5">Batch</th>
                        <th className="px-2 py-0.5 text-right">Qty</th>
                        <th className="px-2 py-0.5 text-right">Pur. Cost</th>
                        <th className="px-2 py-0.5 text-right">Retail MRP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeItemHistory?.purchaseHistory || []).map((p, i) => (
                        <tr key={p.purchase_item_id || i} className="border-b border-slate-100 hover:bg-slate-50 font-mono">
                          <td className="px-2 py-0.5 font-bold text-sky-800">{p.bill_number}</td>
                          <td className="px-2 py-0.5">{p.bill_date}</td>
                          <td className="px-2 py-0.5 font-sans">{p.supplier_name}</td>
                          <td className="px-2 py-0.5">{p.batch_number}</td>
                          <td className="px-2 py-0.5 text-right font-bold">{p.quantity}P</td>
                          <td className="px-2 py-0.5 text-right font-bold text-sky-900">{formatPKR(p.purchase_price)}</td>
                          <td className="px-2 py-0.5 text-right">{formatPKR(p.retail_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ================= 4. COMPACT DESKTOP CALCULATION & ACTION FOOTER ================= */}
          <div className="p-1 bg-slate-200 grid grid-cols-12 gap-1 items-stretch text-[11px] shrink-0">
            {/* Col 1 & 2: Financial Account, Notes, Override, Primary Actions */}
            <div className="col-span-7 bg-slate-100 rounded border border-slate-300 px-2 py-0.5 flex flex-col justify-between gap-0.5">
              <div className="grid grid-cols-12 gap-1 items-center">
                <div className="col-span-4 flex items-center gap-1">
                  <label className="text-[9px] font-bold uppercase text-slate-600 whitespace-nowrap">
                    A/C:
                  </label>
                  <select
                    value={paymentAccountId || ''}
                    onChange={(e) => setPaymentAccountId(Number(e.target.value))}
                    className="w-full px-1 py-0 rounded border border-slate-300 bg-white font-semibold text-[10px] h-5"
                  >
                    {financialAccounts.map((fa) => (
                      <option key={fa.id} value={fa.id}>
                        {fa.account_name} ({fa.account_code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3 flex items-center gap-1">
                  <label className="text-[9px] font-bold uppercase text-slate-600 whitespace-nowrap">
                    Auth:
                  </label>
                  <input
                    type="text"
                    placeholder="Override by..."
                    value={discountOverrideBy}
                    onChange={(e) => setDiscountOverrideBy(e.target.value)}
                    className="w-full px-1 py-0 rounded border border-slate-300 bg-white text-[10px] h-5"
                  />
                </div>
                <div className="col-span-2 flex items-center gap-1">
                  <label className="text-[9px] font-bold uppercase text-slate-600 whitespace-nowrap">
                    Deliv:
                  </label>
                  <NumericInput
                    value={deliveryCharges}
                    onChange={(e) => setDeliveryCharges(Math.max(0, Number(e.target.value || 0)))}
                    className="w-full px-1 py-0 rounded border border-slate-300 font-mono bg-white text-[10px] h-5 text-right"
                  />
                </div>
                <div className="col-span-3 flex items-center gap-1">
                  <label className="text-[9px] font-bold uppercase text-slate-600 whitespace-nowrap">
                    Notes:
                  </label>
                  <input
                    type="text"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Rx / Patient note..."
                    className="w-full px-1 py-0 rounded border border-slate-300 bg-white text-[10px] h-5"
                  />
                </div>
              </div>

              {/* Action Buttons Bar */}
              <div className="pt-0.5 border-t border-slate-200 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed')}
                  className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[10px] font-black flex items-center gap-1 cursor-pointer shadow-2xs"
                  title="Save Invoice (F2)"
                >
                  <Save className="w-3 h-3" />
                  Save (F2)
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', 'a4')}
                  className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  title="Save & Print A4 (Ctrl+P)"
                >
                  <Printer className="w-3 h-3 text-emerald-400" />
                  A4 Print
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', '80mm')}
                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  title="Print 80mm"
                >
                  <Printer className="w-3 h-3 text-teal-400" />
                  80mm
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('completed', '58mm')}
                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                  title="Print 58mm"
                >
                  <Printer className="w-3 h-3 text-amber-400" />
                  58mm
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('held')}
                  className="px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <PauseCircle className="w-3 h-3 text-amber-700" />
                  Hold (F3)
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveInvoice('draft')}
                  className="px-1.5 py-0.5 rounded bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Save className="w-3 h-3" />
                  Draft
                </button>
                <button
                  type="button"
                  onClick={handleReprintLastInvoice}
                  className="px-1.5 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3 h-3 text-blue-600" />
                  Reprint
                </button>
                <button
                  type="button"
                  onClick={() => setShowDiscardConfirm(true)}
                  className="px-1.5 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer ml-auto"
                >
                  <RotateCcw className="w-3 h-3" />
                  Discard
                </button>
              </div>
            </div>

            {/* Col 3 & 4: Ultra-Compact Bill Calculations & Ledger Summary */}
            <div className="col-span-5 bg-slate-900 text-white rounded px-2 py-0.5 shadow-2xs text-[10px] flex flex-col justify-between gap-0.5">
              {/* Top line: Gross, Disc %, Adv Tax, Net Invoice */}
              <div className="grid grid-cols-2 gap-x-2 gap-y-0 items-center border-b border-slate-800 pb-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[9px]">Gross ({validRows.length}):</span>
                  <span className="font-mono font-bold text-white">{formatPKR(grossAmount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[9px]">Prev Ledger:</span>
                  <span className="font-mono font-semibold text-amber-300">{formatPKR(prevCustomerBalance)}</span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-slate-400 text-[9px]">Inv Disc:</span>
                  <div className="flex items-center gap-1">
                    <NumericInput
                      value={invoiceDiscountPercent}
                      onChange={(e) => {
                        const pct = Math.max(0, Math.min(100, Number(e.target.value || 0)));
                        setInvoiceDiscountPercent(pct);
                        setInvoiceDiscountAmount(round2((subtotalAfterItemDisc * pct) / 100));
                      }}
                      className="w-10 px-1 py-0 rounded bg-slate-800 border border-slate-700 font-mono text-[9px] text-right h-4"
                      placeholder="%"
                    />
                    <NumericInput
                      value={invoiceDiscountAmount}
                      onChange={(e) => {
                        setInvoiceDiscountPercent(0);
                        setInvoiceDiscountAmount(Math.max(0, Number(e.target.value || 0)));
                      }}
                      className="w-14 px-1 py-0 rounded bg-slate-800 border border-slate-700 font-mono text-[9px] text-right h-4"
                      placeholder="PKR"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[9px]">Total Rec:</span>
                  <span className="font-mono font-bold text-white">{formatPKR(totalReceivable)}</span>
                </div>
              </div>

              {/* Bottom line: Net Invoice, Amount Received & Remaining Balance */}
              <div className="grid grid-cols-3 gap-1.5 items-center">
                <div>
                  <span className="text-[8px] uppercase font-bold text-emerald-400 block leading-none">Net Invoice</span>
                  <span className="font-mono text-xs font-black text-emerald-300">{formatPKR(netInvoiceAmount)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[8px] uppercase font-bold text-slate-300 whitespace-nowrap">Rec:</span>
                  <NumericInput
                    value={paidAmountInput}
                    onChange={(e) => {
                      setPaidAmountManuallyEdited(true);
                      setPaidAmountInput(e.target.value);
                    }}
                    className="w-full px-1 py-0 rounded bg-slate-800 border border-emerald-500 text-right font-mono font-bold text-emerald-300 text-[11px] h-5"
                  />
                </div>
                <div className="text-right">
                  <span className="text-[8px] uppercase font-bold text-amber-300 block leading-none">Remaining Bal</span>
                  <span className="font-mono text-xs font-black text-amber-300">{formatPKR(remainingBalance)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 1: ADVANCE TAX SHORTCUT ================= */}
      {showAdvanceTaxModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-md p-5 text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Advance Tax Shortcut (Sales Billing)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAdvanceTaxModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Customer Name:</span>
                <span className="font-bold text-slate-900">{selectedCustomer?.account_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Applicable Tax Category:</span>
                <span className="font-bold text-emerald-700">{customerFilerStatus}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Current Configured Rate:</span>
                <span className="font-mono font-bold">{configuredTaxRate}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Taxable Amount:</span>
                <span className="font-mono font-bold">{formatPKR(taxableAmount)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1">
                <span className="font-bold text-slate-800">Calculated Advance Tax:</span>
                <span className="font-mono font-black text-amber-700">
                  {formatPKR(advanceTaxAmount)}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-center justify-between p-2.5 rounded-lg border border-slate-300 bg-white cursor-pointer">
                <span className="font-bold text-slate-800">
                  Apply Advance Tax on this Sales Invoice
                </span>
                <input
                  type="checkbox"
                  checked={advanceTaxApplicable}
                  onChange={(e) => setAdvanceTaxApplicable(e.target.checked)}
                  className="w-4 h-4"
                />
              </label>

              {advanceTaxApplicable && (
                <>
                  <label className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                    <span className="font-semibold text-slate-700">
                      Authorized Tax Rate Override / Exemption
                    </span>
                    <input
                      type="checkbox"
                      checked={isTaxOverridden}
                      onChange={(e) => {
                        setIsTaxOverridden(e.target.checked);
                        if (!e.target.checked) setAdvanceTaxRate(configuredTaxRate);
                      }}
                      className="w-4 h-4"
                    />
                  </label>

                  {isTaxOverridden && (
                    <div className="space-y-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-900 mb-1">
                          Overridden Advance Tax Rate (%) — Set 0 for Exemption
                        </label>
                        <NumericInput
                          value={advanceTaxRate}
                          onChange={(e) => setAdvanceTaxRate(Math.max(0, Number(e.target.value || 0)))}
                          className="w-full px-2.5 py-1.5 rounded border border-amber-300 bg-white font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-900 mb-1">
                          Override Reason / Exemption Certificate #
                        </label>
                        <input
                          type="text"
                          value={taxOverrideReason}
                          onChange={(e) => setTaxOverrideReason(e.target.value)}
                          placeholder="e.g. Wholesale FBR Exemption Certificate..."
                          className="w-full px-2.5 py-1.5 rounded border border-amber-300 bg-white"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowAdvanceTaxModal(false)}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
              >
                Apply & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 2: CUSTOMER ACCOUNT SHORTCUTS ================= */}
      {activeCustomerShortcut && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-2xl p-5 text-xs space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Users2 className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900 uppercase">
                  {activeCustomerShortcut === 'ledger' && 'Customer Detailed Ledger Statement'}
                  {activeCustomerShortcut === 'receive_payment' && 'Quick Receive Payment from Customer'}
                  {activeCustomerShortcut === 'add_customer' && 'Add New Customer Account'}
                  {activeCustomerShortcut === 'account_details' && 'Customer Account Details & Balance'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveCustomerShortcut(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeCustomerShortcut === 'account_details' && selectedCustomer && (
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div>
                  <span className="text-slate-500">Account Code:</span>
                  <div className="font-mono font-bold text-slate-900">
                    {selectedCustomer.account_code}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Account Name:</span>
                  <div className="font-bold text-slate-900">{selectedCustomer.account_name}</div>
                </div>
                <div>
                  <span className="text-slate-500">Account Group:</span>
                  <div className="font-semibold">{selectedCustomer.account_group}</div>
                </div>
                <div>
                  <span className="text-slate-500">Filer Status:</span>
                  <div className="font-bold text-emerald-700">{selectedCustomer.filer_status}</div>
                </div>
                <div>
                  <span className="text-slate-500">Opening Balance:</span>
                  <div className="font-mono">
                    {formatPKR(selectedCustomer.opening_balance)} (
                    {selectedCustomer.opening_balance_type})
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Current Ledger Balance:</span>
                  <div className="font-mono font-black text-emerald-800">
                    {formatPKR(prevCustomerBalance)} ({prevBalanceType})
                  </div>
                </div>
                {liveBalanceSummary?.lastPayment && (
                  <div className="col-span-2 bg-white p-2.5 rounded border border-emerald-200">
                    <span className="text-slate-500">Last Payment Received:</span>
                    <div className="font-mono font-bold text-emerald-700">
                      {formatPKR(liveBalanceSummary.lastPayment.amount)} on{' '}
                      {liveBalanceSummary.lastPayment.payment_date} (Ref:{' '}
                      {liveBalanceSummary.lastPayment.reference_no})
                    </div>
                  </div>
                )}
                <div className="col-span-2">
                  <span className="text-slate-500">Phone & Address:</span>
                  <div className="text-slate-800">
                    {selectedCustomer.phone || 'N/A'} • {selectedCustomer.address || 'N/A'}
                  </div>
                </div>
              </div>
            )}

            {activeCustomerShortcut === 'ledger' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-slate-100 p-3 rounded-lg">
                  <div>
                    <div className="font-bold text-slate-900">
                      {customerLedgerData?.selectedAccount?.account_name ||
                        selectedCustomer?.account_name}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Opening: {formatPKR(customerLedgerData?.summary?.openingBalance || 0)} (
                      {customerLedgerData?.summary?.openingBalanceType || 'Debit'})
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase text-slate-500 font-bold">
                      Closing Ledger Balance
                    </div>
                    <div className="font-mono font-black text-sm text-emerald-700">
                      {formatPKR(customerLedgerData?.summary?.closingBalance || 0)} (
                      {customerLedgerData?.summary?.closingBalanceType || 'Debit'})
                    </div>
                  </div>
                </div>

                <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-slate-900 text-white">
                      <tr>
                        <th className="px-2.5 py-1.5">Date</th>
                        <th className="px-2.5 py-1.5">Ref #</th>
                        <th className="px-2.5 py-1.5">Narration</th>
                        <th className="px-2.5 py-1.5 text-right">Debit</th>
                        <th className="px-2.5 py-1.5 text-right">Credit</th>
                        <th className="px-2.5 py-1.5 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(customerLedgerData?.entries || []).length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-slate-400">
                            No posted ledger transactions yet for this customer.
                          </td>
                        </tr>
                      ) : (
                        (customerLedgerData?.entries || []).map((e: any) => (
                          <tr key={e.id} className="border-b border-slate-100">
                            <td className="px-2.5 py-1.5 font-mono">{e.entry_date}</td>
                            <td className="px-2.5 py-1.5 font-mono font-semibold">
                              {e.entry_number}
                            </td>
                            <td className="px-2.5 py-1.5">{e.narration || e.entry_description}</td>
                            <td className="px-2.5 py-1.5 text-right font-mono">
                              {e.debit_amount > 0 ? formatPKR(e.debit_amount) : '—'}
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-mono">
                              {e.credit_amount > 0 ? formatPKR(e.credit_amount) : '—'}
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-mono font-bold">
                              {formatPKR(e.running_balance)} {e.running_balance_type}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeCustomerShortcut === 'receive_payment' && (
              <form onSubmit={handleQuickReceivePayment} className="space-y-3">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex justify-between">
                  <span>
                    Customer: <strong>{selectedCustomer?.account_name}</strong>
                  </span>
                  <span className="font-mono font-bold">
                    Current Balance: {formatPKR(prevCustomerBalance)} ({prevBalanceType})
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Amount Received (PKR)
                    </label>
                    <NumericInput
                      min="1"
                      step="0.01"
                      required
                      value={quickReceiptAmount}
                      onChange={(e) => setQuickReceiptAmount(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Payment Method
                    </label>
                    <select
                      value={quickReceiptMethod}
                      onChange={(e) =>
                        setQuickReceiptMethod(e.target.value as 'Cash' | 'Bank Transfer')
                      }
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                    >
                      <option value="Cash">Cash Counter Drawer</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Narration / Receipt Note
                  </label>
                  <input
                    type="text"
                    value={quickReceiptNotes}
                    onChange={(e) => setQuickReceiptNotes(e.target.value)}
                    placeholder="Receipt against previous balance..."
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                  >
                    Post Customer Receipt
                  </button>
                </div>
              </form>
            )}

            {activeCustomerShortcut === 'add_customer' && (
              <form onSubmit={handleQuickAddCustomer} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Account Code
                    </label>
                    <input
                      type="text"
                      required
                      value={newCustCode}
                      onChange={(e) => setNewCustCode(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Customer Name
                    </label>
                    <input
                      type="text"
                      required
                      value={newCustName}
                      onChange={(e) => setNewCustName(e.target.value)}
                      placeholder="Clinic / Patient / Pharmacy Name"
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="text"
                      value={newCustPhone}
                      onChange={(e) => setNewCustPhone(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Filer Status
                    </label>
                    <select
                      value={newCustFilerStatus}
                      onChange={(e) =>
                        setNewCustFilerStatus(e.target.value as 'Filer' | 'Non-Filer' | 'Exempt')
                      }
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold"
                    >
                      <option value="Filer">Filer</option>
                      <option value="Non-Filer">Non-Filer</option>
                      <option value="Exempt">Exempt</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Address
                  </label>
                  <input
                    type="text"
                    value={newCustAddress}
                    onChange={(e) => setNewCustAddress(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                  >
                    Create & Select Customer
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ================= MODAL 3: HELD / DRAFT INVOICES DRAWER ================= */}
      {showHeldDrawer && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-2xl p-5 text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Held & Draft Sales Invoices ({heldInvoices.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowHeldDrawer(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-3 py-2">Invoice #</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Net Amount</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {heldInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-5 text-center text-slate-400">
                        No held or draft invoices currently saved.
                      </td>
                    </tr>
                  ) : (
                    heldInvoices.map((h) => (
                      <tr key={h.id} className="border-b border-slate-100">
                        <td className="px-3 py-2 font-mono font-bold">{h.invoice_number}</td>
                        <td className="px-3 py-2 font-mono">{h.invoice_date}</td>
                        <td className="px-3 py-2 font-semibold">{h.customer_name}</td>
                        <td className="px-3 py-2 uppercase font-bold text-amber-700">
                          {h.status}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold">
                          {formatPKR(h.net_total)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleResumeInvoice(h.id)}
                            className="px-2.5 py-1 rounded bg-emerald-600 text-white font-bold cursor-pointer"
                          >
                            Resume
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 4: CONFIRM DISCARD INVOICE ================= */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-sm p-5 text-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Confirm Discard Invoice</h3>
            <p className="text-slate-600">
              Are you sure you want to clear all entered items on this invoice and start a fresh
              Sales Invoice?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={resetToNewInvoice}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-bold cursor-pointer"
              >
                Yes, Discard Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 5: PRINT PREVIEW (A4 / 80mm / 58mm) ================= */}
      {printInvoice && (
        <SalesPrintModal
          invoice={printInvoice}
          initialFormat={printFormat}
          onClose={() => setPrintInvoice(null)}
        />
      )}
    </div>
  );
};
