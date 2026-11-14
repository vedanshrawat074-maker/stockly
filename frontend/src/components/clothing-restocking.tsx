"use client";

import { AlertTriangle, PackageCheck, RefreshCw, Search, Shirt } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorState, LoadingState, PageHeading, Pagination, StatusBadge } from "@/components/dashboard-ui";
import { ApiClientError, stocklyApi } from "@/lib/api-client";
import type { ClothingRestockingRecommendation, ClothingRestockingResponse, Product } from "@/lib/types";
import { formatQuantity } from "@/lib/utils";

function message(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The backend API could not be reached.";
}

function statusStyle(status: ClothingRestockingRecommendation["status"]): {
  label: string;
  tone: "green" | "yellow" | "red" | "gray";
} {
  switch (status) {
    case "RESTOCK_RECOMMENDED": return { label: "Restock recommended", tone: "yellow" };
    case "NO_RESTOCK_NEEDED": return { label: "No restock needed", tone: "green" };
    case "INSUFFICIENT_HISTORY": return { label: "Insufficient history", tone: "gray" };
    case "FORECAST_UNAVAILABLE": return { label: "Forecast unavailable", tone: "red" };
  }
}

function trendStyle(trend: ClothingRestockingRecommendation["productTrend"]): {
  label: string;
  tone: "green" | "yellow" | "red" | "gray";
} {
  switch (trend) {
    case "FAST_SELLING": return { label: "Fast-selling", tone: "green" };
    case "SLOW_SELLING": return { label: "Slow-selling", tone: "yellow" };
    case "STEADY": return { label: "Steady", tone: "gray" };
    case "INSUFFICIENT_HISTORY": return { label: "Trend unavailable", tone: "gray" };
  }
}

export default function ClothingRestockingPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [result, setResult] = useState<ClothingRestockingResponse | null>(null);
  const [productId, setProductId] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [productError, setProductError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    try {
      const response = await stocklyApi.products({ limit: 100, isActive: true });
      setProducts(response.data);
      setProductError(null);
    } catch (loadError) {
      setProductError(message(loadError));
    }
  }, []);

  const loadRecommendations = useCallback(async () => {
    setLoading(true);
    try {
      const response = await stocklyApi.clothingRestocking({
        productId: productId || undefined,
        page,
        limit: 20,
      });
      setResult(response);
      setError(null);
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoading(false);
    }
  }, [page, productId]);

  useEffect(() => { void Promise.resolve().then(loadProducts); }, [loadProducts]);
  useEffect(() => { void Promise.resolve().then(loadRecommendations); }, [loadRecommendations]);

  const trendCounts = useMemo(() => {
    const trends = new Map<string, ClothingRestockingRecommendation["productTrend"]>();
    for (const item of result?.data ?? []) trends.set(item.productId, item.productTrend);
    return {
      fast: [...trends.values()].filter((trend) => trend === "FAST_SELLING").length,
      slow: [...trends.values()].filter((trend) => trend === "SLOW_SELLING").length,
    };
  }, [result]);
  const activeRestocks = result?.data.filter((item) => item.status === "RESTOCK_RECOMMENDED").length ?? 0;
  const lowStockVariants = result?.data.filter((item) => item.lowStockTriggered).length ?? 0;

  return (
    <div className="page-width">
      <PageHeading
        eyebrow="Clothing demand planning"
        title="Variant restocking"
        description="Review demand, shortage, and restock suggestions for each size-colour variant."
        action={<button className="button-secondary" onClick={() => void loadRecommendations()} disabled={loading}><RefreshCw size={14} /> Refresh</button>}
      />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-3xl text-xs leading-5 text-slate-500">
          Suggestions use each variant’s stock and low-stock threshold, plus the backend rolling-average forecast and configured safety buffer. They do not create purchase orders or change stock.
        </p>
        <label className="min-w-[220px] text-xs font-medium text-slate-700">Filter product
          <span className="relative mt-1.5 block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select className="field !pl-9" value={productId} onChange={(event) => { setProductId(event.target.value); setPage(1); }}>
              <option value="">All active clothing products</option>
              {products.map((product) => <option key={product._id} value={product._id}>{product.name} · {product.sku}</option>)}
            </select>
          </span>
          {productError && <span role="alert" className="mt-1 block max-w-64 text-xs text-amber-700">Product filters could not be loaded: {productError} <button type="button" className="underline" onClick={() => void loadProducts()}>Try again</button></span>}
        </label>
      </div>

      {result && (
        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Clothing restocking summary">
          <Summary icon={Shirt} label="Variants evaluated" value={result.pagination.totalItems.toLocaleString("en-IN")} />
          <Summary icon={PackageCheck} label="Restock recommendations" value={activeRestocks.toLocaleString("en-IN")} />
          <Summary icon={AlertTriangle} label="At or below threshold" value={lowStockVariants.toLocaleString("en-IN")} />
          <Summary icon={Shirt} label="Fast / slow products" value={`${trendCounts.fast} fast · ${trendCounts.slow} slow`} />
        </section>
      )}

      {error ? <div className="mb-5"><ErrorState message={error} onRetry={() => void loadRecommendations()} /></div> : null}
      <section className="surface overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-sm font-semibold">Variant recommendations</p>
          {result?.trendRule && <p className="mt-1 text-xs leading-5 text-slate-500">Selling trend: {result.trendRule}</p>}
        </div>
        {loading ? <div className="p-4"><LoadingState rows={5} /></div> : error ? (
          <div className="px-5 py-8 text-sm text-slate-500">Recommendations could not be loaded.</div>
        ) : !result || result.data.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Shirt size={24} className="mx-auto text-slate-400" />
            <p className="mt-3 text-sm font-semibold">No variant recommendations</p>
            <p className="mt-1 text-sm text-slate-500">{productId ? "No active variants were returned for this product." : "Active clothing variants will appear as the backend evaluates their demand."}</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {result.data.map((item) => {
                const status = statusStyle(item.status);
                const trend = trendStyle(item.productTrend);
                return (
                  <article key={item.variantId} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-800">{item.productName}</h2>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.variantSku} · Size {item.size} · {item.colour}
                          {item.designIdentifier ? ` · ${item.designIdentifier}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge tone={trend.tone}>{trend.label}</StatusBadge>
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                      <Metric label="Current stock" value={`${formatQuantity(item.currentStock)} ${item.unit}`} />
                      <Metric label="Forecast demand" value={item.forecastDemand === null ? "Unavailable" : `${formatQuantity(item.forecastDemand)} ${item.unit}`} />
                      <Metric label="Potential shortage" value={item.potentialShortage === null ? "Not calculated" : `${formatQuantity(item.potentialShortage)} ${item.unit}`} />
                      <Metric label="Restock suggestion" value={item.suggestedRestockQuantity === null ? "Not calculated" : `${formatQuantity(item.suggestedRestockQuantity)} ${item.unit}`} prominent={item.status === "RESTOCK_RECOMMENDED"} />
                      <Metric label="Variant threshold" value={`${formatQuantity(item.lowStockThreshold)} ${item.unit}`} warning={item.lowStockTriggered} />
                    </div>
                    <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">{item.reason}</p>
                  </article>
                );
              })}
            </div>
            <Pagination
              page={result.pagination.page}
              totalPages={result.pagination.totalPages}
              onChange={setPage}
            />
          </>
        )}
      </section>
    </div>
  );
}

function Summary({ icon: Icon, label, value }: { icon: typeof Shirt; label: string; value: string }) {
  return (
    <article className="surface flex items-center justify-between gap-3 p-4">
      <div><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{value}</p></div>
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-emerald-50 text-emerald-700"><Icon size={17} aria-hidden="true" /></span>
    </article>
  );
}

function Metric({ label, value, prominent = false, warning = false }: { label: string; value: string; prominent?: boolean; warning?: boolean }) {
  const style = warning ? "bg-amber-50 text-amber-800" : prominent ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-800";
  return <div className={`rounded-lg p-3 ${style}`}><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>;
}
