import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const formatCurrency = (amount: string | number, currency = "NGN") => {
  const value = typeof amount === "string" ? Number(amount) : amount;
  const symbols: Record<string, string> = { NGN: "₦", USD: "$", EUR: "€", GBP: "£", KES: "KSh", GHS: "₵", ZAR: "R" };
  const symbol = symbols[currency] ?? `${currency} `;
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe < 0 ? "-" : ""}${symbol}${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(safe))}`;
};

export const compactCurrency = (amount: string | number, currency = "NGN") => {
  const value = typeof amount === "string" ? Number(amount) : amount;
  const symbols: Record<string, string> = { NGN: "₦", USD: "$", EUR: "€", GBP: "£" };
  const symbol = symbols[currency] ?? `${currency} `;
  if (Math.abs(value) >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${symbol}${(value / 1_000).toFixed(1)}k`;
  return formatCurrency(value, currency);
};

export const formatNumber = (n: number | string) => {
  const value = typeof n === "string" ? Number(n) : n;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number.isFinite(value) ? value : 0);
};

export const titleCase = (s: string) => s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const shortDate = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const dateTime = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export const relativeTime = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return "just now";
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days}d ago`;
  return shortDate(date);
};

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

export const cx = cn;
