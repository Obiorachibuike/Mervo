"use client";

import { useMemo, useState, useTransition } from "react";
import { Minus, Plus, ShoppingBag, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Modal, toast } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";

type Product = { id: string; name: string; price: string; categoryName: string | null; description: string | null; stock: number };
type Line = { productId: string; quantity: number };

export function Storefront({
  slug,
  currency,
  deliveryFee,
  products,
  published,
}: {
  slug: string;
  currency: string;
  deliveryFee: string;
  products: Product[];
  published: boolean;
}) {
  const [cart, setCart] = useState<Line[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [confirmation, setConfirmation] = useState<{ number: string; total: string; message: string } | null>(null);

  const categories = useMemo(() => ["all", ...Array.from(new Set(products.map((p) => p.categoryName).filter(Boolean) as string[]))], [products]);
  const visible = products.filter(
    (p) => (category === "all" || p.categoryName === category) && (!query || p.name.toLowerCase().includes(query.toLowerCase())),
  );
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const subtotal = cart.reduce((sum, line) => sum + Number(byId.get(line.productId)?.price ?? 0) * line.quantity, 0);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);

  function add(productId: string) {
    const product = byId.get(productId);
    if (!product) return;
    setCart((prev) => {
      const existing = prev.find((line) => line.productId === productId);
      if (existing) {
        if (existing.quantity >= product.stock) {
          toast.error("That is all the stock we have for this item.");
          return prev;
        }
        return prev.map((line) => (line.productId === productId ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [...prev, { productId, quantity: 1 }];
    });
  }

  function change(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((line) => (line.productId === productId ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search products"
          className="h-9 min-w-[160px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-[12.5px] outline-none focus:border-brand"
          aria-label="Search products"
        />
        <div className="flex flex-wrap gap-1">
          {categories.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCategory(option)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                category === option ? "border-charcoal bg-charcoal text-white dark:border-white dark:bg-white dark:text-charcoal" : "border-[var(--border)]",
              )}
            >
              {option === "all" ? "All" : option}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setCartOpen(true)} className="ml-auto">
          <ShoppingBag className="size-3.5" /> Cart {count > 0 ? `(${count})` : ""}
        </Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((product) => {
          const inCart = cart.find((line) => line.productId === product.id)?.quantity ?? 0;
          const soldOut = product.stock <= 0;
          return (
            <div key={product.id} className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[13px] font-semibold">{product.name}</p>
                  <p className="text-[10.5px] uppercase tracking-wide muted">{product.categoryName ?? "Product"}</p>
                </div>
                {soldOut ? <Badge tone="danger">Sold out</Badge> : product.stock < 5 ? <Badge tone="warning">Low stock</Badge> : null}
              </div>
              {product.description ? <p className="mt-1.5 line-clamp-2 text-[11px] muted">{product.description}</p> : null}
              <div className="mt-auto flex items-center justify-between pt-3">
                <span className="text-[13px] font-semibold tabular-nums">{formatCurrency(product.price, currency)}</span>
                {inCart > 0 ? (
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" onClick={() => change(product.id, -1)} aria-label={`Remove one ${product.name}`}><Minus className="size-3.5" /></Button>
                    <span className="w-5 text-center text-[12px] tabular-nums">{inCart}</span>
                    <Button size="icon" variant="outline" onClick={() => add(product.id)} aria-label={`Add one ${product.name}`}><Plus className="size-3.5" /></Button>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" disabled={soldOut} onClick={() => add(product.id)}>Add</Button>
                )}
              </div>
            </div>
          );
        })}
        {visible.length === 0 ? <p className="text-[12px] muted">No products match that search.</p> : null}
      </div>

      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="Your basket" description={`${count} item${count === 1 ? "" : "s"} · delivery ${formatCurrency(deliveryFee, currency)}`} wide>
        {cart.length === 0 ? (
          <p className="text-[12px] muted">Your basket is empty. Add something you like.</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              startTransition(async () => {
                const response = await fetch(`/api/store/${slug}/order`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity.toFixed(3) })),
                    customerName: formData.get("customerName"),
                    phone: formData.get("phone"),
                    email: formData.get("email") || null,
                    address: formData.get("address"),
                    note: formData.get("note") || null,
                    paymentMethod: formData.get("paymentMethod"),
                    idempotencyKey: crypto.randomUUID(),
                  }),
                });
                const payload = (await response.json()) as { ok?: boolean; data?: { number: string; total: string; message: string }; error?: string };
                if (!response.ok || !payload.data) {
                  toast.error(payload.error ?? "Could not place the order");
                  return;
                }
                setConfirmation(payload.data);
                setCart([]);
                setCartOpen(false);
              });
            }}
          >
            <ul className="divide-y divide-[var(--border)]">
              {cart.map((line) => {
                const product = byId.get(line.productId);
                if (!product) return null;
                return (
                  <li key={line.productId} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px]">{product.name}</p>
                      <p className="text-[10.5px] muted">{formatCurrency(product.price, currency)} each</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button type="button" size="icon" variant="outline" onClick={() => change(line.productId, -1)} aria-label="Decrease"><Minus className="size-3.5" /></Button>
                      <span className="w-5 text-center text-[12px] tabular-nums">{line.quantity}</span>
                      <Button type="button" size="icon" variant="outline" onClick={() => add(line.productId)} aria-label="Increase"><Plus className="size-3.5" /></Button>
                      <Button type="button" size="icon" variant="ghost" onClick={() => change(line.productId, -line.quantity)} aria-label="Remove"><Trash2 className="size-3.5" /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="rounded-xl bg-black/[0.03] p-3 text-[12px] dark:bg-white/[0.04]">
              <div className="flex justify-between"><span className="muted">Subtotal</span><span className="tabular-nums">{formatCurrency(subtotal.toFixed(2), currency)}</span></div>
              <div className="flex justify-between"><span className="muted">Delivery</span><span className="tabular-nums">{formatCurrency(deliveryFee, currency)}</span></div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name *"><Input name="customerName" required /></Field>
              <Field label="Phone *"><Input name="phone" required inputMode="tel" /></Field>
              <Field label="Email"><Input name="email" type="email" /></Field>
              <Field label="Payment">
                <Select name="paymentMethod" defaultValue="cash_on_delivery">
                  <option value="cash_on_delivery">Pay on delivery</option>
                  <option value="transfer">Bank transfer</option>
                  <option value="paystack">Pay online (Paystack)</option>
                </Select>
              </Field>
              <Field label="Delivery address *" className="sm:col-span-2"><Textarea name="address" rows={2} required /></Field>
              <Field label="Delivery note" className="sm:col-span-2"><Input name="note" placeholder="Call when you arrive" /></Field>
            </div>

            <Button type="submit" className="w-full" loading={pending} disabled={!published}>
              <Truck className="size-3.5" /> {published ? "Place order" : "Store not accepting orders"}
            </Button>
          </form>
        )}
      </Modal>

      <Modal open={Boolean(confirmation)} onClose={() => setConfirmation(null)} title="Order received" description="We have sent your order to the store.">
        {confirmation ? (
          <div className="space-y-2 text-[12.5px]">
            <p className="text-[15px] font-semibold">{confirmation.number}</p>
            <p className="muted">{confirmation.message}</p>
            <p className="tabular-nums">Total: {formatCurrency(confirmation.total, currency)}</p>
            <Button className="mt-2 w-full" onClick={() => setConfirmation(null)}>Done</Button>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
