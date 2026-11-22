/**
 * Decimal-safe money arithmetic.
 *
 * Every amount is a decimal string with 2 places (the DB representation).
 * Internally we work on BigInt minor units so no floating point error can ever
 * enter a financial calculation.
 */
export type Amount = string;

const MINOR = 2n;
const SCALE = 100n;

export function toMinor(amount: Amount | number | null | undefined): bigint {
  if (amount === null || amount === undefined || amount === "") return 0n;
  const raw = typeof amount === "number" ? amount.toFixed(2) : String(amount).trim();
  const neg = raw.startsWith("-");
  const clean = raw.replace(/^[+-]/, "").replace(/,/g, "");
  if (!/^\d*(\.\d*)?$/.test(clean)) throw new Error(`Invalid amount: ${raw}`);
  const [intPart = "0", fracRaw = ""] = clean.split(".");
  const frac = (fracRaw + "00").slice(0, Number(MINOR));
  // round half-up on the third decimal if present
  let minor = BigInt(intPart || "0") * SCALE + BigInt(frac || "0");
  const rest = fracRaw.slice(Number(MINOR));
  if (rest && Number(rest[0]) >= 5) minor += 1n;
  return neg ? -minor : minor;
}

export function fromMinor(minor: bigint): Amount {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const int = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${int}.${frac}`;
}

export const money = (v: Amount | number | null | undefined): Amount => fromMinor(toMinor(v));

export function add(...vals: (Amount | number)[]): Amount {
  return fromMinor(vals.reduce((acc, v) => acc + toMinor(v), 0n));
}
export function sub(a: Amount | number, b: Amount | number): Amount {
  return fromMinor(toMinor(a) - toMinor(b));
}
export function neg(a: Amount | number): Amount {
  return fromMinor(-toMinor(a));
}
export function abs(a: Amount | number): Amount {
  const m = toMinor(a);
  return fromMinor(m < 0n ? -m : m);
}
/** multiply an amount by a decimal factor (e.g. quantity 2.5 or rate "0.075") */
export function multiply(a: Amount | number, factor: Amount | number): Amount {
  const am = toMinor(a);
  const fm = toMinor(factor);
  return fromMinor(roundHalfUpDiv(am * fm, SCALE));
}
function roundHalfUpDiv(n: bigint, d: bigint): bigint {
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = an / ad;
  const r = an % ad;
  const rounded = r * 2n >= ad ? q + 1n : q;
  return neg ? -rounded : rounded;
}
/** Basis points: 7.5% → 750. Keeps rates exact (2dp money would lose 0.075). */
export function toBasisPoints(percent: Amount | number): bigint {
  const raw = typeof percent === "number" ? percent.toString() : String(percent).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new Error(`Invalid percentage: ${raw}`);
  const [intPart = "0", fracRaw = ""] = raw.split(".");
  const frac = (fracRaw + "00").slice(0, 2);
  let bp = BigInt(intPart) * 100n + BigInt(frac || "0");
  if (fracRaw.length > 2 && Number(fracRaw[2]) >= 5) bp += BigInt(Math.sign(Number(raw)) || 1) * 1n;
  return bp;
}

/** Exact percentage of an amount: percentOf("200.00", "7.5") === "15.00". */
export function percentOf(a: Amount | number, percent: Amount | number): Amount {
  return fromMinor(roundHalfUpDiv(toMinor(a) * toBasisPoints(percent), 10_000n));
}

/** Extract the tax already contained in a tax-inclusive amount. */
export function taxPortionOf(inclusiveAmount: Amount | number, percent: Amount | number): Amount {
  const bp = toBasisPoints(percent);
  const base = 10_000n;
  return fromMinor(roundHalfUpDiv(toMinor(inclusiveAmount) * bp, base + bp));
}

/** Net amount inside a tax-inclusive price. */
export function netOfTax(inclusiveAmount: Amount | number, percent: Amount | number): Amount {
  return sub(inclusiveAmount, taxPortionOf(inclusiveAmount, percent));
}
export function sum(vals: (Amount | number)[]): Amount {
  return fromMinor(vals.reduce((acc, v) => acc + toMinor(v), 0n));
}
export function cmp(a: Amount | number, b: Amount | number): number {
  const am = toMinor(a);
  const bm = toMinor(b);
  return am === bm ? 0 : am < bm ? -1 : 1;
}
export const eq = (a: Amount | number, b: Amount | number) => cmp(a, b) === 0;
export const gt = (a: Amount | number, b: Amount | number) => cmp(a, b) > 0;
export const gte = (a: Amount | number, b: Amount | number) => cmp(a, b) >= 0;
export const lt = (a: Amount | number, b: Amount | number) => cmp(a, b) < 0;
export const lte = (a: Amount | number, b: Amount | number) => cmp(a, b) <= 0;
export const isZero = (a: Amount | number) => toMinor(a) === 0n;
export const isPositive = (a: Amount | number) => toMinor(a) > 0n;

/** split an amount into n parts whose sum is exactly the original */
export function allocate(total: Amount | number, weights: number[]): Amount[] {
  const tm = toMinor(total);
  const wSum = weights.reduce((a, b) => a + b, 0);
  if (wSum === 0) return weights.map(() => "0.00");
  const parts: bigint[] = [];
  let allocated = 0n;
  for (let i = 0; i < weights.length; i++) {
    if (i === weights.length - 1) {
      parts.push(tm - allocated);
    } else {
      const share = (tm * BigInt(Math.round((weights[i] ?? 0) * 1e6))) / BigInt(Math.round(wSum * 1e6));
      parts.push(share);
      allocated += share;
    }
  }
  return parts.map(fromMinor);
}

const SYMBOLS: Record<string, string> = { NGN: "₦", USD: "$", EUR: "€", GBP: "£", KES: "KSh", GHS: "₵", ZAR: "R" };
export function formatMoney(amount: Amount | number, currency = "NGN", opts: { compact?: boolean } = {}): string {
  const minor = toMinor(amount);
  const sym = SYMBOLS[currency] ?? `${currency} `;
  const value = Number(minor) / 100;
  if (opts.compact && Math.abs(value) >= 1_000_000) return `${sym}${(value / 1_000_000).toFixed(1)}M`;
  if (opts.compact && Math.abs(value) >= 10_000) return `${sym}${(value / 1_000).toFixed(1)}k`;
  const formatted = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.abs(value),
  );
  return `${minor < 0n ? "-" : ""}${sym}${formatted}`;
}

/* ───────────────────────────── quantities (3dp) ─────────────────────────── */

const QTY_SCALE = 1000n;
export function toQty(v: string | number | null | undefined): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  const raw = typeof v === "number" ? v.toFixed(3) : String(v).trim();
  const neg = raw.startsWith("-");
  const clean = raw.replace(/^[+-]/, "");
  if (!/^\d*(\.\d*)?$/.test(clean)) throw new Error(`Invalid quantity: ${raw}`);
  const [intPart = "0", fracRaw = ""] = clean.split(".");
  const frac = (fracRaw + "000").slice(0, 3);
  let q = BigInt(intPart || "0") * QTY_SCALE + BigInt(frac || "0");
  const rest = fracRaw.slice(3);
  if (rest && Number(rest[0]) >= 5) q += 1n;
  return neg ? -q : q;
}
export function fromQty(q: bigint): string {
  const neg = q < 0n;
  const a = neg ? -q : q;
  return `${neg ? "-" : ""}${a / QTY_SCALE}.${(a % QTY_SCALE).toString().padStart(3, "0")}`;
}
export const addQty = (a: string | number, b: string | number) => fromQty(toQty(a) + toQty(b));
export const subQty = (a: string | number, b: string | number) => fromQty(toQty(a) - toQty(b));
export const mulQty = (a: string | number, b: string | number) => fromQty((toQty(a) * toQty(b)) / QTY_SCALE);
export const cmpQty = (a: string | number, b: string | number) => {
  const x = toQty(a);
  const y = toQty(b);
  return x === y ? 0 : x < y ? -1 : 1;
};
export const gtQty = (a: string | number, b: string | number) => cmpQty(a, b) > 0;
export const ltQty = (a: string | number, b: string | number) => cmpQty(a, b) < 0;
export const qtyZero = (a: string | number) => toQty(a) === 0n;
export const formatQty = (a: string | number) => {
  const s = fromQty(toQty(a));
  return s.replace(/\.?0+$/, "") || "0";
};
/** value of quantity × unit price */
export function lineValue(quantity: string | number, unitPrice: Amount): Amount {
  return fromMinor(roundHalfUpDiv(toQty(quantity) * toMinor(unitPrice), QTY_SCALE));
}
