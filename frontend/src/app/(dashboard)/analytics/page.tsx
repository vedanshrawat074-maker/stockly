"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ErrorState, LoadingState, PageHeading, StatusBadge } from "@/components/dashboard-ui";
import { ApiClientError, stocklyApi } from "@/lib/api-client";
import type { DemandSeries, Forecast, Product } from "@/lib/types";
import { formatQuantity } from "@/lib/utils";

function message(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The backend API could not be reached.";
}

function dateOffset(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export default function AnalyticsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [startDate, setStartDate] = useState(dateOffset(35));
  const [endDate, setEndDate] = useState(dateOffset(1));
  const [horizonDays, setHorizonDays] = useState(7);
  const [series, setSeries] = useState<DemandSeries | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedProduct = useMemo(() => products.find((product) => product._id === productId), [products, productId]);

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

  const runAnalysis = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setFormError(null);
    setError(null);
    if (!productId) {
      setFormError("Select a product to request its daily history and forecast.");
      return;
    }
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      setFormError("Choose valid UTC calendar dates, with the start date on or before the end date.");
      return;
    }
    const rangeDays = (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000 + 1;
    if (rangeDays > 366) {
      setFormError("Choose a date range of 366 days or fewer.");
      return;
    }
    setLoadingData(true);
    setSeries(null);
    setForecast(null);
    try {
      const [history, forecastResult] = await Promise.all([
        stocklyApi.demandHistory({ startDate, endDate, productId, page: 1, limit: 1 }),
        stocklyApi.forecast({ productId, startDate, endDate, horizonDays, rollingWindowDays: 7 }),
      ]);
      setSeries(history.data[0] ?? null);
      setForecast(forecastResult.data);
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoadingData(false);
    }
  };

  const retry = () => {
    if (!productId) {
      setLoadingProducts(true);
      setError(null);
      void loadProducts();
    } else {
      void runAnalysis();
    }
  };

  return (
    <div className="page-width">
      <PageHeading eyebrow="Demand analysis" title="Analytics" description="Explore recorded daily sales and request a baseline demand forecast." />
      <section className="surface mb-5 p-5">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end" onSubmit={(event) => void runAnalysis(event)}>
          <label className="text-xs font-medium text-slate-700 sm:col-span-2 lg:col-span-1">Product
            <select className="field mt-1.5" required disabled={loadingProducts} value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">{loadingProducts ? "Loading products…" : "Select product"}</option>
              {products.map((product) => <option key={product._id} value={product._id}>{product.name} · {product.sku}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">Start date (UTC)<input className="field mt-1.5" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label className="text-xs font-medium text-slate-700">End date (UTC)<input className="field mt-1.5" type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          <label className="text-xs font-medium text-slate-700">Forecast horizon
            <select className="field mt-1.5" value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value))}>
              {[7, 14, 30].map((days) => <option key={days} value={days}>{days} days</option>)}
            </select>
          </label>
          <button className="button-primary" type="submit" disabled={loadingProducts || loadingData || products.length === 0}>{loadingData ? "Analyzing…" : "Load analytics"}</button>
        </form>
        {formError && <p role="alert" className="mt-3 text-xs text-red-700">{formError}</p>}
      </section>

      {error && <div className="mb-5"><ErrorState message={error} onRetry={retry} /></div>}
      {loadingData && <LoadingState rows={4} />}
      {!loadingData && !error && !series && !forecast && !loadingProducts && products.length === 0 && <section className="surface"><div className="px-5 py-12 text-center"><p className="text-sm font-semibold">No active products available</p><p className="mt-1 text-sm text-slate-500">Create an active product before requesting demand analysis.</p></div></section>}

      {series && forecast && !loadingData && (
        <div className="space-y-5">
          <section className="surface overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div><h2 className="text-sm font-semibold">Recorded daily demand</h2><p className="mt-1 text-xs text-slate-500">{series.productName} · {series.unit} · {startDate} through {endDate} UTC</p></div>
              <StatusBadge tone="gray">Historical sales</StatusBadge>
            </div>
            <p className="px-5 pt-4 text-xs leading-5 text-amber-800">{series.availabilityNote} No-sales dates are recorded as zero; the API cannot distinguish store closures or stockouts from zero customer demand.</p>
            <DemandChart series={series} />
          </section>

          <section className="surface overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div><h2 className="text-sm font-semibold">Forecast demand</h2><p className="mt-1 text-xs text-slate-500">{forecast.method} · {forecast.horizonDays}-day horizon · History through {forecast.historyThrough}</p></div>
              <StatusBadge tone={forecast.status === "ok" ? "green" : forecast.status === "zero_demand" ? "yellow" : "red"}>{forecast.status.replaceAll("_", " ")}</StatusBadge>
            </div>
            <div className="p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <ForecastMetric label="Observed history days" value={`${forecast.observedHistoryDays}`} />
                <ForecastMetric label="Minimum required" value={`${forecast.minimumHistoryDays} days`} />
                <ForecastMetric label="Previous-week comparison" value={forecast.comparison} />
              </div>
              {forecast.forecasts.length > 0 ? (
                <div className="table-wrap mt-5">
                  <table className="table"><thead><tr><th>Date (UTC)</th><th>Forecast units</th><th>Previous-week units</th></tr></thead>
                    <tbody>{forecast.forecasts.map((point) => <tr key={point.date}><td>{point.date}</td><td className="font-semibold">{formatQuantity(point.predictedUnits)} {forecast.unit}</td><td>{point.previousWeekUnits == null ? "—" : `${formatQuantity(point.previousWeekUnits)} ${forecast.unit}`}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : <p className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">The service did not return forecast values for this product and date range. No estimate is substituted.</p>}
              {forecast.limitations.length > 0 && <div className="mt-4"><p className="text-xs font-semibold text-slate-700">Limitations</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-500">{forecast.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></div>}
              <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500">This baseline has not been demonstrated accurate for your store. Historical availability, closures, and stockouts are unknown; this forecast is not a trained ML model.</p>
            </div>
          </section>
        </div>
      )}
      {!loadingData && !error && series && !forecast && <p className="text-sm text-slate-500">No forecast was returned for the selected period.</p>}
      {!loadingData && !error && forecast && !series && <p className="text-sm text-slate-500">No recorded demand history was returned for this product and range.</p>}
      {selectedProduct && !loadingData && !series && !forecast && <p className="mt-6 text-center text-sm text-slate-500">Choose dates and load analytics for {selectedProduct.name}.</p>}
    </div>
  );
}

function DemandChart({ series }: { series: DemandSeries }) {
  const values = series.dailyDemand.map((day) => Number(day.unitsSold));
  const maximum = Math.max(...values, 0);
  if (values.length === 0 || maximum === 0) {
    return <p className="px-5 py-10 text-center text-sm text-slate-500">No units were recorded during this date range. Availability was not tracked in the history response.</p>;
  }
  const barWidth = Math.max(3, Math.min(20, 700 / values.length - 4));
  return (
    <div className="overflow-x-auto px-5 py-6">
      <div role="img" aria-label={`Daily recorded units sold for ${series.productName}`} className="flex h-52 min-w-[560px] items-end gap-1 border-b border-l border-slate-200 px-2">
        {series.dailyDemand.map((day) => {
          const value = Number(day.unitsSold);
          const height = Math.max(value > 0 ? 2 : 0, (value / maximum) * 100);
          return <div key={day.date} title={`${day.date}: ${formatQuantity(day.unitsSold)} ${series.unit}`} className="rounded-t bg-emerald-500/80 hover:bg-emerald-600" style={{ height: `${height}%`, width: `${barWidth}px`, minWidth: `${barWidth}px` }} />;
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-400"><span>{series.dailyDemand[0]?.date}</span><span>{series.dailyDemand.at(-1)?.date}</span></div>
      <p className="mt-2 text-[11px] text-slate-500">Daily units sold · UTC calendar days · missing sale dates are zero-filled by the backend</p>
    </div>
  );
}

function ForecastMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-800">{value}</p></div>;
}
