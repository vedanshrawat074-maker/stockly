"use client";

import { AlertTriangle, PackageCheck, RefreshCw, Shirt } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ErrorState, LoadingState, PageHeading, StatCard, StatusBadge } from "@/components/dashboard-ui";
import { ApiClientError, stocklyApi } from "@/lib/api-client";
import type { ClothingVariant, Forecast, Product } from "@/lib/types";
import { formatDate, formatQuantity } from "@/lib/utils";

function message(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The backend API could not be reached.";
}

function defaultRange(): { startDate: string; endDate: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - 29);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export default function ClothingForecastPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [variants, setVariants] = useState<ClothingVariant[]>([]);
  const [variantId, setVariantId] = useState("");
  const [range, setRange] = useState(defaultRange);
  const [horizonDays, setHorizonDays] = useState(7);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedProduct = useMemo(
    () => products.find((product) => product._id === productId),
    [products, productId],
  );
  const selectedVariant = useMemo(
    () => variants.find((variant) => variant._id === variantId),
    [variants, variantId],
  );

  const loadProducts = useCallback(async () => {
    try {
      const result = await stocklyApi.products({ limit: 100, isActive: true });
      setProducts(result.data);
      setProductId((current) => current || result.data[0]?._id || "");
      setError(null);
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(loadProducts); }, [loadProducts]);

  useEffect(() => {
    let active = true;
    const loadVariants = async () => {
      if (!productId) {
        setVariants([]);
        setVariantId("");
        setForecast(null);
        setLoadingVariants(false);
        return;
      }
      setLoadingVariants(true);
      setVariants([]);
      setVariantId("");
      setForecast(null);
      try {
        const result = await stocklyApi.clothingVariants(productId);
        if (!active) return;
        setVariants(result.data);
        setVariantId(result.data[0]?._id ?? "");
        setError(null);
      } catch (loadError) {
        if (active) setError(message(loadError));
      } finally {
        if (active) setLoadingVariants(false);
      }
    };
    void Promise.resolve().then(loadVariants);
    return () => { active = false; };
  }, [productId]);

  const runForecast = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setFormError(null);
    setError(null);
    if (!productId || !variantId) {
      setFormError("Select a product and variant before requesting a forecast.");
      return;
    }
    if (!range.startDate || !range.endDate || range.startDate > range.endDate) {
      setFormError("Choose a date range with the start date on or before the end date.");
      return;
    }
    const days = (
      Date.parse(`${range.endDate}T00:00:00.000Z`) -
      Date.parse(`${range.startDate}T00:00:00.000Z`)
    ) / 86_400_000 + 1;
    if (days > 366) {
      setFormError("Date ranges are limited to 366 days.");
      return;
    }

    setLoadingForecast(true);
    setForecast(null);
    try {
      const result = await stocklyApi.forecast({
        productId,
        variantId,
        ...range,
        horizonDays,
        rollingWindowDays: 7,
      });
      setForecast(result.data);
    } catch (forecastError) {
      setError(message(forecastError));
    } finally {
      setLoadingForecast(false);
    }
  };

  return (
    <div className="page-width">
      <PageHeading
        eyebrow="Clothing demand"
        title="Variant forecasts"
        description="Review recent gross sales and a rolling-average demand estimate for an exact size and colour."
        action={<button className="button-secondary" onClick={() => void runForecast()} disabled={loadingForecast || !variantId}><RefreshCw size={14} /> Refresh</button>}
      />
      <form className="surface mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end" onSubmit={(event) => void runForecast(event)}>
        <label className="text-xs font-medium text-slate-700 lg:col-span-2">Product
          <select className="field mt-1.5" required disabled={loadingProducts} value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">{loadingProducts ? "Loading products…" : "Select product"}</option>
            {products.map((product) => <option key={product._id} value={product._id}>{product.name} · {product.sku}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700 lg:col-span-2">Size and colour
          <select className="field mt-1.5" required disabled={loadingVariants || variants.length === 0} value={variantId} onChange={(event) => setVariantId(event.target.value)}>
            <option value="">{loadingVariants ? "Loading variants…" : variants.length === 0 ? "No variants available" : "Select variant"}</option>
            {variants.map((variant) => <option key={variant._id} value={variant._id}>{variant.size} · {variant.colour} · {variant.sku}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-700">History from
          <input className="field mt-1.5" type="date" required value={range.startDate} onChange={(event) => setRange((current) => ({ ...current, startDate: event.target.value }))} />
        </label>
        <label className="text-xs font-medium text-slate-700">Through
          <input className="field mt-1.5" type="date" required value={range.endDate} onChange={(event) => setRange((current) => ({ ...current, endDate: event.target.value }))} />
        </label>
        <label className="text-xs font-medium text-slate-700">Forecast horizon
          <select className="field mt-1.5" value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value))}>
            {[7, 14, 30].map((days) => <option key={days} value={days}>{days} days</option>)}
          </select>
        </label>
        <button className="button-primary sm:col-span-2 lg:col-span-1" type="submit" disabled={loadingProducts || loadingVariants || loadingForecast || !variantId}>
          {loadingForecast ? "Forecasting…" : "Load forecast"}
        </button>
        {formError && <p role="alert" className="sm:col-span-2 lg:col-span-6 text-sm text-red-700">{formError}</p>}
      </form>

      {error && <div className="mb-5"><ErrorState message={error} onRetry={() => void runForecast()} /></div>}
      {loadingForecast && <LoadingState rows={3} />}
      {!loadingProducts && products.length === 0 && !error && (
        <section className="surface px-5 py-12 text-center">
          <Shirt size={24} className="mx-auto text-slate-400" />
          <p className="mt-3 text-sm font-semibold">No active clothing products</p>
          <p className="mt-1 text-sm text-slate-500">Create a clothing product with variants before requesting a forecast.</p>
        </section>
      )}
      {!loadingVariants && selectedProduct && variants.length === 0 && !error && (
        <section className="surface px-5 py-10 text-center text-sm text-slate-500">
          This product has no variants to forecast.
        </section>
      )}

      {forecast && !loadingForecast && selectedProduct && selectedVariant && (
        <div className="space-y-5">
          <section className="surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{selectedProduct.name}</h2>
                <p className="mt-1 text-xs text-slate-500">{selectedVariant.sku} · {selectedVariant.size} / {selectedVariant.colour}</p>
              </div>
              <StatusBadge tone={forecast.status === "ok" ? "green" : forecast.status === "zero_demand" ? "yellow" : "gray"}>
                {forecast.status.replaceAll("_", " ")}
              </StatusBadge>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={Shirt} label="Current variant stock" value={forecast.currentStock === undefined ? "—" : formatQuantity(forecast.currentStock)} helper="Live stock quantity" tone="slate" />
              <StatCard icon={PackageCheck} label="Predicted shortage" value={forecast.potentialShortage == null ? "—" : formatQuantity(forecast.potentialShortage)} helper="Forecast horizon demand less current stock" tone={forecast.potentialShortage && Number(forecast.potentialShortage) > 0 ? "amber" : "green"} />
              <StatCard icon={PackageCheck} label="Suggested restock" value={forecast.suggestedRestockQuantity == null ? "—" : formatQuantity(forecast.suggestedRestockQuantity)} helper={`Covers forecast demand and threshold ${formatQuantity(forecast.lowStockThreshold ?? selectedVariant.lowStockThreshold)}`} tone="green" />
              <StatCard icon={AlertTriangle} label="Low-stock threshold" value={formatQuantity(forecast.lowStockThreshold ?? selectedVariant.lowStockThreshold)} helper="Variant-specific threshold" tone="amber" />
            </div>
          </section>

          {forecast.status === "insufficient_history" && (
            <p role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              There is not enough sales history to estimate demand. No shortage quantity or restock amount is inferred.
            </p>
          )}
          {forecast.status === "zero_demand" && (
            <p role="status" className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              No gross sales were recorded in the supplied history. This does not confirm the store was open or this variant was available.
            </p>
          )}

          <section className="surface overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold">Daily variant demand estimate</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {forecast.method} · history through {formatDate(forecast.historyThrough)} · gross sold quantities; returns are separate
                </p>
              </div>
              <StatusBadge tone="gray">{forecast.observedHistoryDays} observed days</StatusBadge>
            </div>
            {forecast.forecasts.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-500">No forecast values are available for this history range.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Date</th><th>Predicted demand</th><th>Previous-week sales</th></tr></thead>
                  <tbody>{forecast.forecasts.map((point) => (
                    <tr key={point.date}>
                      <td>{formatDate(point.date)}</td>
                      <td className="font-semibold">{formatQuantity(point.predictedUnits)} pieces</td>
                      <td>{point.previousWeekUnits == null ? "—" : `${formatQuantity(point.previousWeekUnits)} pieces`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {forecast.limitations.length > 0 && (
              <ul className="space-y-1 border-t border-slate-100 px-5 py-4 text-xs leading-5 text-slate-500">
                {forecast.limitations.map((limitation) => <li key={limitation}>• {limitation}</li>)}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
