"use client";

import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState, PageHeading, Pagination, StatusBadge } from "@/components/dashboard-ui";
import { ApiClientError, stocklyApi } from "@/lib/api-client";
import type { Product, RestockingRecommendation } from "@/lib/types";
import { formatQuantity } from "@/lib/utils";

function message(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The backend API could not be reached.";
}

function recommendationStyle(status: RestockingRecommendation["status"]): { label: string; tone: "green" | "yellow" | "red" | "gray" } {
  switch (status) {
    case "RESTOCK_RECOMMENDED": return { label: "Restock recommended", tone: "yellow" };
    case "NO_RESTOCK_NEEDED": return { label: "No restock needed", tone: "green" };
    case "INSUFFICIENT_HISTORY": return { label: "Insufficient history", tone: "gray" };
    case "FORECAST_UNAVAILABLE": return { label: "Forecast unavailable", tone: "red" };
  }
}

export default function RestockingPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<RestockingRecommendation[]>([]);
  const [productId, setProductId] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [productError, setProductError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    try {
      const result = await stocklyApi.products({ limit: 100, isActive: true });
      setProducts(result.data);
      setProductError(null);
    } catch (loadError) {
      setProductError(message(loadError));
    }
  }, []);

  const loadRecommendations = useCallback(async () => {
    try {
      const result = await stocklyApi.restocking({ productId: productId || undefined, page, limit: 20 });
      setItems(result.data);
      setTotalPages(result.pagination.totalPages);
      setError(null);
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoading(false);
    }
  }, [page, productId]);

  useEffect(() => { void Promise.resolve().then(loadProducts); }, [loadProducts]);
  useEffect(() => { void Promise.resolve().then(loadRecommendations); }, [loadRecommendations]);

  return (
    <div className="page-width">
      <PageHeading eyebrow="Demand planning" title="Smart restocking" description="Review backend-calculated suggestions, forecast confidence, and stock assumptions." action={<button className="button-secondary" onClick={() => { setLoading(true); void loadRecommendations(); }}><RefreshCw size={14} /> Refresh</button>} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-xs leading-5 text-slate-500">The backend’s recommendation formula is used as provided. Historical shop closures and stockouts are unknown; forecasts are baseline estimates, not accuracy guarantees. This page does not create purchase orders or change stock.</p>
        <label className="min-w-[220px] text-xs font-medium text-slate-700">Filter product
          <span className="relative mt-1.5 block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select className="field !pl-9" value={productId} onChange={(event) => { setLoading(true); setProductId(event.target.value); setPage(1); }}>
              <option value="">All active products</option>
              {products.map((product) => <option key={product._id} value={product._id}>{product.name} · {product.sku}</option>)}
            </select>
          </span>
          {productError && <span role="alert" className="mt-1 block max-w-64 text-xs text-amber-700">Product filters could not be loaded: {productError} <button type="button" className="underline" onClick={() => void loadProducts()}>Try again</button></span>}
        </label>
      </div>
      <section className="surface overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-sm font-semibold">Recommendations</p>
          <p className="mt-1 text-xs text-slate-500">Use each reason to understand the returned status; do not treat unavailable forecasts as quantities.</p>
        </div>
        {loading ? <div className="p-4"><LoadingState rows={5} /></div> : error ? <div className="p-4"><ErrorState message={error} onRetry={() => { setLoading(true); void loadRecommendations(); }} /></div> : items.length === 0 ? (
          <div className="px-5 py-12 text-center"><p className="text-sm font-semibold">No recommendations to show</p><p className="mt-1 text-sm text-slate-500">{productId ? "No result was returned for this product." : "Active products will appear as the backend evaluates their demand."}</p></div>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {items.map((item) => {
                const badge = recommendationStyle(item.status);
                return (
                  <article key={item.productId} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><h2 className="text-sm font-semibold text-slate-800">{item.productName}</h2><p className="mt-1 text-xs text-slate-500">Unit: {item.unit}</p></div>
                      <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Metric label="Usable stock" value={`${formatQuantity(item.currentUsableStock)} ${item.unit}`} />
                      <Metric label="Forecast demand" value={item.forecastDemand === null ? "Unavailable" : `${formatQuantity(item.forecastDemand)} ${item.unit}`} />
                      <Metric label="Safety buffer" value={item.safetyBuffer === null ? "Unavailable" : `${formatQuantity(item.safetyBuffer)} ${item.unit}`} />
                      <Metric label="Suggested restock" value={item.suggestedRestockQuantity === null ? "Not calculated" : `${formatQuantity(item.suggestedRestockQuantity)} ${item.unit}`} prominent={item.status === "RESTOCK_RECOMMENDED"} />
                    </div>
                    {item.lowStockFallback && <p className="mt-3 text-xs text-slate-500">Low-stock fallback: {item.lowStockFallback.triggered ? "threshold triggered" : "not triggered"}{item.lowStockFallback.threshold !== null ? ` (threshold ${formatQuantity(item.lowStockFallback.threshold)} ${item.unit})` : ""}. This is separate from the forecast calculation.</p>}
                    <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">{item.reason}</p>
                  </article>
                );
              })}
            </div>
            <Pagination page={page} totalPages={totalPages} onChange={(nextPage) => { setLoading(true); setPage(nextPage); }} />
          </>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, prominent = false }: { label: string; value: string; prominent?: boolean }) {
  return <div className={`rounded-lg p-3 ${prominent ? "bg-emerald-50" : "bg-slate-50"}`}><p className="text-[11px] text-slate-500">{label}</p><p className={`mt-1 text-sm font-semibold ${prominent ? "text-emerald-800" : "text-slate-800"}`}>{value}</p></div>;
}
