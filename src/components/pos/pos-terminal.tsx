"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Check,
  CreditCard,
  Minus,
  Pause,
  Plus,
  Printer,
  Receipt as ReceiptIcon,
  RefreshCw,
  Search,
  ShoppingCart,
  Smartphone,
  Trash2,
  UserPlus,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Modal, toast } from "@/components/ui/misc";
import { cn, formatCurrency } from "@/lib/utils";
import { enqueueSale, listQueue, newIdempotencyKey, newLocalNumber, syncQueue, updateQueuedSale, type QueuedSale } from "@/lib/offline-queue";

export type PosProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: string;
  taxRate: string;
  categoryName: string | null;
  stock: string;
};

export type PosCustomer = { id: string; name: string; phone: string | null; balanceOwed: string; creditLimit: string };
type CartLine = { key: string; productId: string; name: string; sku: string; quantity: number; unitPrice: number; taxRate: number; stock: number; discount: number };
type PaymentLine = { method: "cash" | "card" | "transfer" | "paystack" | "flutterbank" | "credit"; amount: string };

const METHOD_LABEL: Record<string, string> = { cash: "Cash", card: "Card", transfer: "Transfer", paystack: "Paystack", credit: "On credit" };

export function PosTerminal({
  products,
  customers,
  currency,
  branchId,
  branchName,
  cashierName,
  taxRate,
}: {
  products: PosProduct[];
  customers: PosCustomer[];
  currency: string;
  branchId: string;
  branchName: string;
  cashierName: string;
  taxRate: number;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderDiscount, setOrderDiscount] = useState("0");
  const [customerId, setCustomerId] = useState("");
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: "cash", amount: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<{ number: string; total: string; change: string; id?: string; queued?: boolean } | null>(null);
  const [suspended, setSuspended] = useState<{ label: string; cart: CartLine[] }[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => ["all", ...Array.from(new Set(products.map((p) => p.categoryName).filter(Boolean) as string[]))], [products]);
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products
      .filter((p) => (category === "all" ? true : p.categoryName === category))
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || (p.barcode ?? "").toLowerCase() === term)
      .slice(0, 60);
  }, [products, query, category]);

  const subtotal = cart.reduce((acc, l) => acc + l.quantity * l.unitPrice - l.discount, 0);
  const discountValue = Math.min(Number(orderDiscount) || 0, subtotal);
  const taxable = Math.max(0, subtotal - discountValue);
  const taxTotal = Math.round(taxable * (taxRate / 100) * 100) / 100;
  const total = Math.round((taxable + taxTotal) * 100) / 100;
  const paid = payments.filter((p) => p.method !== "credit").reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  const credit = payments.filter((p) => p.method === "credit").reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  const due = Math.max(0, Math.round((total - paid - credit) * 100) / 100);
  const change = Math.max(0, Math.round((paid - total) * 100) / 100);

  /* ── connectivity + queue ─────────────────────────────────────────────── */
  const refreshQueue = useCallback(async () => {
    setQueue(await listQueue());
  }, []);

  const doSync = useCallback(async () => {
    if (typeof window === "undefined") return;
    setSyncing(true);
    try {
      const result = await syncQueue();
      if (result.synced) toast.success(`${result.synced} offline sale${result.synced > 1 ? "s" : ""} synchronised`);
      if (result.failed) toast.error(`${result.failed} sale(s) still pending — retry from the queue`);
    } finally {
      setSyncing(false);
      await refreshQueue();
    }
  }, [refreshQueue]);

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void doSync();
    };
    update();
    void refreshQueue();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const interval = setInterval(() => {
      if (navigator.onLine) void doSync();
    }, 45_000);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      clearInterval(interval);
    };
  }, [doSync, refreshQueue]);

  // keyboard: F2 focus search, F4 open payment, Esc close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "F4") {
        e.preventDefault();
        if (cart.length) setPayOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.length]);

  /* ── cart actions ─────────────────────────────────────────────────────── */
  const addProduct = (p: PosProduct) => {
    const stock = Number(p.stock);
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        if (existing.quantity + 1 > stock) {
          toast.error(`${p.name}: only ${stock} in stock at ${branchName}`);
          return prev;
        }
        return prev.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      if (stock <= 0) {
        toast.error(`${p.name} is out of stock at ${branchName}`);
        return prev;
      }
      return [
        ...prev,
        { key: p.id, productId: p.id, name: p.name, sku: p.sku, quantity: 1, unitPrice: Number(p.price), taxRate: Number(p.taxRate), stock, discount: 0 },
      ];
    });
  };

  const changeQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, quantity: Math.min(l.stock, Math.max(0, l.quantity + delta)) } : l))
        .filter((l) => l.quantity > 0),
    );
  };

  const resetSale = () => {
    setCart([]);
    setOrderDiscount("0");
    setCustomerId("");
    setPayments([{ method: "cash", amount: "" }]);
  };

  const openPayment = () => {
    if (!cart.length) return toast.error("Cart is empty");
    setPayments([{ method: "cash", amount: total.toFixed(2) }]);
    setPayOpen(true);
  };

  const finalise = async () => {
    if (!cart.length) return;
    if (due > 0 && !customerId) return toast.error("Select a customer for credit or complete the payment");
    setSubmitting(true);
    const idempotencyKey = newIdempotencyKey();
    const payload = {
      branchId,
      customerId: customerId || null,
      items: cart.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity.toFixed(3), unitPrice: l.unitPrice.toFixed(2), discount: l.discount.toFixed(2) })),
      payments: payments
        .filter((p) => Number(p.amount) > 0)
        .map((p) => ({ method: p.method === "flutterbank" ? "transfer" : p.method, amount: Number(p.amount).toFixed(2) })),
      orderDiscount: discountValue.toFixed(2),
      idempotencyKey,
      source: online ? "pos" : "offline_sync",
      registerId: `terminal-${branchId.slice(0, 8)}`,
    };

    const settleLocally = (number: string, queued: boolean) => {
      setReceipt({ number, total: total.toFixed(2), change: change.toFixed(2), queued });
      resetSale();
      setPayOpen(false);
      void refreshQueue();
    };

    if (!online) {
      const localNumber = newLocalNumber();
      await enqueueSale({
        id: idempotencyKey,
        idempotencyKey,
        payload,
        createdAt: new Date().toISOString(),
        status: "pending",
        attempts: 0,
        localNumber,
        total: total.toFixed(2),
      });
      settleLocally(localNumber, true);
      toast.info("Saved offline — will sync automatically when the network returns");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/pos/sales", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const json = (await res.json()) as { ok: boolean; data?: { number: string; saleId: string; changeDue: string }; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Sale failed");
      setReceipt({ number: json.data!.number, total: total.toFixed(2), change: json.data!.changeDue, id: json.data!.saleId });
      resetSale();
      setPayOpen(false);
      toast.success(`Sale ${json.data!.number} completed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      // never lose a transaction: queue it and let the sync loop retry
      const localNumber = newLocalNumber();
      await enqueueSale({
        id: idempotencyKey,
        idempotencyKey,
        payload,
        createdAt: new Date().toISOString(),
        status: "pending",
        attempts: 0,
        localNumber,
        total: total.toFixed(2),
      });
      settleLocally(localNumber, true);
      toast.error(`${message}. Sale was queued and will retry automatically.`);
    } finally {
      setSubmitting(false);
    }
  };

  const suspend = () => {
    if (!cart.length) return;
    setSuspended((prev) => [{ label: `Held ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`, cart }, ...prev].slice(0, 8));
    resetSale();
    toast.info("Transaction suspended");
  };

  const pendingCount = queue.filter((q) => q.status !== "failed").length;
  const failedCount = queue.filter((q) => q.status === "failed").length;

  return (
    <div className="flex min-h-[calc(100vh-58px)] flex-col lg:flex-row">
      {/* catalogue */}
      <div className="flex-1 border-r p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="absolute left-3 top-3 text-[var(--fg-muted)]" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value.length > 3) {
                  const exact = products.find((p) => (p.barcode ?? "").toLowerCase() === e.target.value.trim().toLowerCase());
                  if (exact) {
                    addProduct(exact);
                    setQuery("");
                  }
                }
              }}
              placeholder="Scan barcode or search products…  (F2)"
              className="pl-9"
              aria-label="Search products"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
                online ? "bg-brand/10 text-brand-dark dark:text-brand" : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
              )}
            >
              {online ? <Wifi size={12} /> : <WifiOff size={12} />}
              {online ? "Online" : "Offline mode"}
            </span>
            {pendingCount + failedCount > 0 ? (
              <button onClick={() => void doSync()} className="inline-flex items-center gap-1.5 rounded-md bg-charcoal px-2 py-1 text-[11px] font-medium text-white">
                <RefreshCw size={11} className={syncing ? "animate-spin" : ""} />
                {syncing ? "Syncing" : `${pendingCount + failedCount} queued`}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand-dark dark:text-brand">
                <Check size={11} /> Synchronised
              </span>
            )}
          </div>
        </div>

        <div className="scroll-thin mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={cn(
                "whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                category === cat ? "border-charcoal bg-charcoal text-white dark:border-white dark:bg-white dark:text-charcoal" : "hover:bg-black/5 dark:hover:bg-white/10",
              )}
            >
              {cat === "all" ? "All products" : cat}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {visible.map((p) => {
            const stock = Number(p.stock);
            return (
              <button
                key={p.id}
                onClick={() => addProduct(p)}
                disabled={stock <= 0}
                className={cn(
                  "focus-ring group flex flex-col rounded-xl border bg-[var(--bg-elevated)] p-3 text-left transition-all hover:border-brand hover:shadow-card disabled:cursor-not-allowed disabled:opacity-45",
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="line-clamp-2 text-[12px] font-medium leading-snug">{p.name}</span>
                  {stock <= 0 ? <Badge tone="danger">Out</Badge> : stock < 5 ? <Badge tone="warning">{stock}</Badge> : null}
                </div>
                <span className="mt-2 text-sm font-semibold tracking-tight">{formatCurrency(Number(p.price), currency)}</span>
                <span className="mt-0.5 flex items-center justify-between text-[10px] muted">
                  <span className="truncate">{p.categoryName ?? "Uncategorised"}</span>
                  <span>{stock > 0 ? `${stock} in stock` : "—"}</span>
                </span>
              </button>
            );
          })}
          {!visible.length ? <p className="col-span-full py-16 text-center text-xs muted">No products match “{query}”.</p> : null}
        </div>

        {suspended.length ? (
          <div className="mt-4 rounded-xl border p-3">
            <p className="text-[11px] font-semibold">Suspended transactions</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {suspended.map((s, i) => (
                <button
                  key={`${s.label}-${i}`}
                  onClick={() => {
                    setCart(s.cart);
                    setSuspended((prev) => prev.filter((_, idx) => idx !== i));
                  }}
                  className="rounded-md border px-2 py-1 text-[11px] hover:border-brand"
                >
                  {s.label} · {s.cart.length} item(s)
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {failedCount ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
            <p className="text-[11px] font-semibold text-red-700 dark:text-red-400">{failedCount} sale(s) failed to sync — nothing was discarded</p>
            <div className="mt-2 space-y-1">
              {queue
                .filter((q) => q.status === "failed")
                .map((q) => (
                  <div key={q.id} className="flex items-center justify-between gap-2 text-[10.5px]">
                    <span className="truncate">{q.localNumber} · {q.lastError ?? "error"}</span>
                    <button
                      className="rounded border px-1.5 py-0.5"
                      onClick={async () => {
                        await updateQueuedSale(q.id, { status: "pending", lastError: undefined });
                        await doSync();
                      }}
                    >
                      Retry
                    </button>
                  </div>
                ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* cart */}
      <div className="flex w-full flex-col border-t bg-[var(--bg-elevated)] lg:w-[400px] lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <ShoppingCart size={15} />
            <p className="text-xs font-semibold">Current sale</p>
            <Badge tone="neutral">{cart.reduce((a, l) => a + l.quantity, 0)} items</Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={suspend} aria-label="Suspend transaction" title="Suspend (hold)">
              <Pause size={14} />
            </Button>
            <Button variant="ghost" size="icon" onClick={resetSale} aria-label="Clear cart" title="Clear cart">
              <Trash2 size={14} />
            </Button>
          </div>
        </div>

        <div className="scroll-thin max-h-[38vh] flex-1 overflow-y-auto px-3 py-2 lg:max-h-none">
          {cart.length ? (
            <ul className="space-y-1.5">
              {cart.map((l) => (
                <li key={l.key} className="rounded-lg border px-2.5 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-medium">{l.name}</p>
                      <p className="text-[10px] muted">
                        {formatCurrency(l.unitPrice, currency)} · {l.taxRate}% tax
                      </p>
                    </div>
                    <button onClick={() => setCart((prev) => prev.filter((x) => x.key !== l.key))} className="text-[var(--fg-muted)] hover:text-red-500" aria-label={`Remove ${l.name}`}>
                      <X size={13} />
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button onClick={() => changeQty(l.key, -1)} className="rounded border p-1 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Decrease quantity">
                        <Minus size={11} />
                      </button>
                      <span className="w-8 text-center text-[11px] font-medium">{l.quantity}</span>
                      <button onClick={() => changeQty(l.key, 1)} className="rounded border p-1 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Increase quantity">
                        <Plus size={11} />
                      </button>
                    </div>
                    <span className="text-[12px] font-semibold">{formatCurrency(l.quantity * l.unitPrice - l.discount, currency)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
              <ShoppingCart size={22} className="text-[var(--fg-muted)]" />
              <p className="text-xs muted">Tap products to build a sale</p>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t px-4 py-3">
          <div className="flex items-center gap-2">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Customer" className="h-8 text-[11px]">
              <option value="">Walk-in customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {Number(c.balanceOwed) > 0 ? ` · owes ${formatCurrency(Number(c.balanceOwed), currency)}` : ""}
                </option>
              ))}
            </Select>
            <a href="/customers?new=1" className="shrink-0 rounded-lg border p-1.5" title="Add customer" aria-label="Add customer">
              <UserPlus size={13} />
            </a>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="muted">Order discount</span>
            <Input value={orderDiscount} onChange={(e) => setOrderDiscount(e.target.value.replace(/[^0-9.]/g, ""))} className="h-7 w-24 text-right text-[11px]" inputMode="decimal" aria-label="Order discount" />
          </div>
          <dl className="space-y-1 border-t pt-2 text-[11.5px]">
            <div className="flex justify-between"><dt className="muted">Subtotal</dt><dd>{formatCurrency(subtotal, currency)}</dd></div>
            {discountValue > 0 ? <div className="flex justify-between"><dt className="muted">Discount</dt><dd className="text-red-500">-{formatCurrency(discountValue, currency)}</dd></div> : null}
            <div className="flex justify-between"><dt className="muted">Tax ({taxRate}%)</dt><dd>{formatCurrency(taxTotal, currency)}</dd></div>
            <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd>{formatCurrency(total, currency)}</dd></div>
          </dl>
          <Button className="w-full" size="lg" onClick={openPayment} disabled={!cart.length}>
            <CreditCard size={15} /> Charge {formatCurrency(total, currency)} <span className="ml-1 text-[10px] opacity-60">F4</span>
          </Button>
        </div>
      </div>

      {/* payment modal */}
      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Complete payment"
        description={`${branchName} · ${cashierName} · ${cart.length} line item(s)`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button onClick={finalise} loading={submitting} disabled={due > 0}>
              <Check size={14} /> Complete sale
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border bg-[var(--bg)] p-3">
            <div className="flex items-center justify-between text-sm font-semibold">
              <span>Amount due</span>
              <span>{formatCurrency(total, currency)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] muted">
              <span>Tendered {formatCurrency(paid + credit, currency)}</span>
              <span>{due > 0 ? `Remaining ${formatCurrency(due, currency)}` : change > 0 ? `Change ${formatCurrency(change, currency)}` : "Exact"}</span>
            </div>
          </div>

          <div className="space-y-2">
            {payments.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  value={p.method === "flutterbank" ? "transfer" : p.method}
                  onChange={(e) => setPayments((prev) => prev.map((x, idx) => (idx === i ? { ...x, method: e.target.value as PaymentLine["method"] } : x)))}
                  className="h-9 w-[130px] text-[11px]"
                  aria-label="Payment method"
                >
                  {Object.entries(METHOD_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
                <Input
                  value={p.amount}
                  onChange={(e) => setPayments((prev) => prev.map((x, idx) => (idx === i ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, "") } : x)))}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="h-9 flex-1 text-right text-[12px]"
                  aria-label="Amount"
                />
                {payments.length > 1 ? (
                  <button onClick={() => setPayments((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove payment" className="p-1 muted hover:text-red-500">
                    <X size={13} />
                  </button>
                ) : null}
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setPayments((prev) => [...prev, { method: "transfer", amount: due.toFixed(2) }])}>
                <Plus size={12} /> Split payment
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPayments([{ method: "cash", amount: due.toFixed(2) }])}>
                <Banknote size={12} /> Exact cash
              </Button>
              {due > 0 && customerId ? (
                <Button variant="outline" size="sm" onClick={() => setPayments((prev) => [...prev, { method: "credit", amount: due.toFixed(2) }])}>
                  <Smartphone size={12} /> Put balance on credit
                </Button>
              ) : null}
            </div>
            {due > 0 && !customerId ? <p className="text-[11px] text-amber-600 dark:text-amber-400">Select a customer above to sell on credit.</p> : null}
          </div>
        </div>
      </Modal>

      {/* receipt */}
      <Modal
        open={Boolean(receipt)}
        onClose={() => setReceipt(null)}
        title={receipt?.queued ? "Sale saved offline" : "Sale complete"}
        footer={
          <>
            {receipt?.id ? (
              <Button variant="outline" onClick={() => window.open(`/receipt/${receipt.id}?print=1`, "_blank")}>
                <Printer size={14} /> Print receipt
              </Button>
            ) : null}
            <Button onClick={() => setReceipt(null)}>
              <ReceiptIcon size={14} /> Next sale
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Check size={22} />
          </div>
          <p className="text-lg font-semibold">{formatCurrency(Number(receipt?.total ?? 0), currency)}</p>
          <p className="text-xs muted">
            {receipt?.number} {receipt?.queued ? "· queued for sync" : "· recorded in the ledger"}
          </p>
          {Number(receipt?.change ?? 0) > 0 ? <p className="text-xs">Change due: <span className="font-semibold">{formatCurrency(Number(receipt!.change), currency)}</span></p> : null}
          {receipt?.queued ? (
            <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              The receipt will be issued once the sale synchronises. No transaction was lost.
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
