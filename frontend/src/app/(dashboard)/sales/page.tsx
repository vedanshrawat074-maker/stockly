"use client";

import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ErrorState, LoadingState, PageHeading, Pagination, StatusBadge } from "@/components/dashboard-ui";
import { useAuth } from "@/components/auth-provider";
import { ApiClientError, stocklyApi } from "@/lib/api-client";
import type { Product, Sale } from "@/lib/types";
import { formatAmount, formatDate, formatQuantity } from "@/lib/utils";

type SaleDraft = { productId: string; quantity: string };
type PendingSale = { snapshot: string; key: string };

function message(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The backend API could not be reached.";
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export default function SalesPage() {
  const { currentStore } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<SaleDraft[]>([{ productId: "", quantity: "" }]);
  const [pendingSale, setPendingSale] = useState<PendingSale | null>(null);

  const productById = useMemo(() => new Map(products.map((product) => [product._id, product])), [products]);

  const load = useCallback(async () => {
    try {
      const [salesPage, productPage] = await Promise.all([
        stocklyApi.sales(page, 20),
        stocklyApi.products({ limit: 100, isActive: true }),
      ]);
      setSales(salesPage.data);
      setTotalPages(salesPage.pagination.totalPages);
      setProducts(productPage.data);
      setError(null);
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const submitSale = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    const items = draft.map((item) => ({ productId: item.productId, quantity: item.quantity.trim() }));
    if (items.some((item) => !item.productId || !/^\d+(?:\.\d+)?$/.test(item.quantity) || Number(item.quantity) <= 0)) {
      setSubmitError("Choose a product and enter a quantity greater than zero for every line.");
      return;
    }
    const snapshot = JSON.stringify({ items });
    const key = pendingSale?.snapshot === snapshot ? pendingSale.key : newIdempotencyKey();
    setPendingSale({ snapshot, key });
    setSaving(true);
    try {
      const result = await stocklyApi.createSale(items, key);
      setNotice(result.meta.idempotentReplay ? "This sale was already recorded; the existing sale was returned." : "Sale recorded.");
      setDraft([{ productId: "", quantity: "" }]);
      setPendingSale(null);
      setLoading(true);
      await load();
    } catch (saveError) {
      setSubmitError(`${message(saveError)} Retry without changing the sale to reuse its idempotency key.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-width">
      <PageHeading eyebrow="Transactions" title="Sales" description="Review completed sales or record a sale using current server-side product prices." action={<button className="button-secondary" onClick={() => { setLoading(true); void load(); }}><RefreshCw size={14} /> Refresh</button>} />
      {notice && <div role="status" className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,.8fr)]">
        <section className="surface overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4">
            <p className="text-sm font-semibold">Completed sales</p>
            <p className="mt-1 text-xs text-slate-500">The API lists store sales, newest first. Sale status and timestamps are server-provided.</p>
          </div>
          {loading ? <div className="p-4"><LoadingState rows={5} /></div> : error ? <div className="p-4"><ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} /></div> : sales.length === 0 ? (
            <div className="px-5 py-12 text-center"><p className="text-sm font-semibold">No sales recorded</p><p className="mt-1 text-sm text-slate-500">Completed sales will be shown here.</p></div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Sale</th><th>Products</th><th>Status</th><th>Total</th><th>Created</th></tr></thead>
                  <tbody>{sales.map((sale) => (
                    <tr key={sale._id}>
                      <td><span className="block max-w-32 truncate font-mono text-xs font-semibold text-slate-700" title={sale.saleIdentifier}>{sale.saleIdentifier}</span><span className="mt-1 block max-w-36 truncate text-[10px] text-slate-400" title={sale._id}>{sale._id}</span></td>
                      <td>
                        <div className="space-y-1">
                          {sale.lineItems.map((line) => (
                            <p key={line.product} className="text-xs text-slate-600">
                              {productById.get(line.product)?.name ?? `Product ${line.product.slice(-6)}`}
                              <span className="text-slate-400"> · {formatQuantity(line.quantity)} × {formatAmount(line.unitPrice, currentStore?.currency ?? "INR")}</span>
                            </p>
                          ))}
                        </div>
                      </td>
                      <td><StatusBadge tone="green">{sale.status}</StatusBadge></td>
                      <td className="font-semibold">{formatAmount(sale.totalAmount, currentStore?.currency ?? "INR")}</td>
                      <td className="text-slate-500">{formatDate(sale.createdAt)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <Pagination page={page} totalPages={totalPages} onChange={(nextPage) => { setLoading(true); setPage(nextPage); }} />
            </>
          )}
        </section>

        <section className="surface p-5">
          <div className="mb-4">
            <p className="text-sm font-semibold">Record a sale</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">The backend applies product prices and allocates stock. Prices cannot be set by this form; the API does not include currency.</p>
          </div>
          <form onSubmit={(event) => void submitSale(event)}>
            <div className="space-y-3">
              {draft.map((line, index) => (
                <div key={index} className="rounded-xl border border-slate-100 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">Item {index + 1}</span>
                    {draft.length > 1 && <button type="button" className="button-quiet text-red-600" aria-label="Remove item" onClick={() => setDraft((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button>}
                  </div>
                  <label className="block text-xs font-medium text-slate-700">Product
                    <select className="field mt-1.5" required value={line.productId} onChange={(event) => setDraft((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, productId: event.target.value } : item))}>
                      <option value="">Select a product</option>
                      {products.filter((product) => !draft.some((other, otherIndex) => otherIndex !== index && other.productId === product._id)).map((product) => <option key={product._id} value={product._id}>{product.name} · {product.sku} · {formatAmount(product.sellingPrice, currentStore?.currency ?? "INR")}</option>)}
                    </select>
                  </label>
                  <label className="mt-3 block text-xs font-medium text-slate-700">Quantity
                    <input className="field mt-1.5" required inputMode="decimal" placeholder="e.g. 1.5" value={line.quantity} onChange={(event) => setDraft((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} />
                  </label>
                </div>
              ))}
            </div>
            {submitError && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{submitError}</p>}
            <button type="button" className="button-quiet mt-3" disabled={draft.length >= 100} onClick={() => setDraft((items) => [...items, { productId: "", quantity: "" }])}><Plus size={14} /> Add another item</button>
            <button className="button-primary mt-4 w-full" type="submit" disabled={saving || products.length === 0}>{saving ? "Recording sale…" : pendingSale ? "Retry sale" : "Complete sale"}</button>
            {products.length === 0 && !loading && <p className="mt-2 text-center text-xs text-slate-500">Create an active product before recording a sale.</p>}
          </form>
        </section>
      </div>
    </div>
  );
}