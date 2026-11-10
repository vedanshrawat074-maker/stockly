import type { SaleLineItem } from "./types";

export function formatAmount(value: string | number, currency = "INR"): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function summarizeSaleProducts(
  lineItems: Pick<SaleLineItem, "productName" | "quantity">[],
): { items: Array<{ name: string; quantity: string }>; moreCount: number } {
  return {
    items: lineItems.slice(0, 2).map((line) => ({
      name: line.productName?.trim() || "Product name unavailable",
      quantity: line.quantity,
    })),
    moreCount: Math.max(0, lineItems.length - 2),
  };
}

export function formatQuantity(value: string | number, maximumFractionDigits = 3): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits }).format(amount);
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

export function dateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}