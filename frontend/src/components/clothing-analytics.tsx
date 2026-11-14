"use client";

import { Activity, BellRing, CircleDollarSign, PackageCheck, RefreshCw, Shirt, Tag } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EmptyState, ErrorState, PageHeading, StatCard, StatusBadge } from "@/components/dashboard-ui";
import { useAuth } from "@/components/auth-provider";
import { ApiClientError, stocklyApi } from "@/lib/api-client";
import type { ClothingAnalytics } from "@/lib/types";
import { formatAmount, formatDate, formatQuantity } from "@/lib/utils";

type DateRange = { startDate: string; endDate: string };

function defaultRange(): DateRange {
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - 29);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function message(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The backend API could not be reached.";
}

export default function ClothingAnalyticsPage() {
  const { currentStore } = useAuth();
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [appliedRange, setAppliedRange] = useState<DateRange>(defaultRange);
  const [data, setData] = useState<ClothingAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentStore) {
      setLoading(false);
      setData(null);
      return;
    }
    try {
      const result = await stocklyApi.clothingAnalytics(appliedRange.startDate, appliedRange.endDate);
      setData(result.data);
      setError(null);
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoading(false);
    }
  }, [appliedRange, currentStore]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const applyRange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!range.startDate || !range.endDate || range.startDate > range.endDate) {
      setFilterError("Choose a valid date range with the start date on or before the end date.");
      return;
    }
    const start = new Date(`${range.startDate}T00:00:00.000Z`).getTime();
    const end = new Date(`${range.endDate}T00:00:00.000Z`).getTime();
    if ((end - start) / 86_400_000 + 1 > 366) {
      setFilterError("Date ranges are limited to 366 days.");
      return;
    }
    setFilterError(null);
    setLoading(true);
    setAppliedRange(range);
  };

  const currency = data?.currency ?? currentStore?.currency ?? "INR";
  const revenueTrend = data?.revenueTrend ?? [];
  const hasTransactions = (data?.transactions.sales ?? 0) + (data?.transactions.returns ?? 0) +
    (data?.transactions.exchanges ?? 0) > 0;

  return (
    <div className="page-width">
      <PageHeading
        eyebrow="Clothing store overview"
        title="Overview"
        description="Sales performance, variant demand, inventory value, returns, and low-stock conditions from this store’s recorded transactions."
        action={<button className="button-secondary" onClick={() => { setLoading(true); void load(); }}><RefreshCw size={14} /> Refresh</button>}
      />
      <form className="surface mb-5 flex flex-wrap items-end gap-3 p-4" onSubmit={applyRange}>
        <label className="block text-xs font-semibold text-slate-600">From
          <input className="field mt-1.5 min-w-40" type="date" value={range.startDate} onChange={(event) => setRange((current) => ({ ...current, startDate: event.target.value }))} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">To
          <input className="field mt-1.5 min-w-40" type="date" value={range.endDate} onChange={(event) => setRange((current) => ({ ...current, endDate: event.target.value }))} />
        </label>
        <button className="button-primary" type="submit" disabled={loading}>Apply range</button>
        {filterError && <p role="alert" className="basis-full text-sm text-red-700">{filterError}</p>}
        {data && <p className="basis-full text-xs text-slate-500">Sales, returns, and exchanges use inclusive UTC dates. Inventory values are current, not date-range snapshots.</p>}
      </form>

      {error ? <div className="mb-5"><ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} /></div> : null}
      <section className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Clothing store metrics">
        <StatCard icon={CircleDollarSign} label="Net revenue" value={loading ? null : data ? formatAmount(data.revenue.netRevenue, currency) : "—"} helper="Gross sales + exchange payments − refunds" tone="green" />
        <StatCard icon={Tag} label="Gross sales" value={loading ? null : data ? formatAmount(data.revenue.grossSales, currency) : "—"} helper="Recorded sales before return and exchange adjustments" tone="slate" />
        <StatCard icon={Shirt} label="Net units sold" value={loading ? null : data ? formatQuantity(data.units.netUnitsSold) : "—"} helper="Sales − returned units + exchange replacements" tone="green" />
        <StatCard icon={Activity} label="Sales transactions" value={loading ? null : data?.transactions.sales.toLocaleString("en-IN") ?? "—"} helper={`${data?.transactions.returns ?? 0} returns · ${data?.transactions.exchanges ?? 0} exchanges`} tone="slate" />
        <StatCard icon={PackageCheck} label="Inventory retail value" value={loading ? null : data ? formatAmount(data.currentInventory.retailValue, currency) : "—"} helper="Current variant stock × configured selling price" tone="green" />
        <StatCard icon={BellRing} label="Low-stock variants" value={loading ? null : data?.currentInventory.lowStockVariants.toLocaleString("en-IN") ?? "—"} helper="Active clothing variants at or below threshold" tone="amber" />
        <StatCard icon={RefreshCw} label="Refunds" value={loading ? null : data ? formatAmount(data.revenue.refunds, currency) : "—"} helper="Direct refunds plus exchange refunds" tone="rose" />
        <StatCard icon={PackageCheck} label="Units returned" value={loading ? null : data ? formatQuantity(data.units.returnedUnits) : "—"} helper={`${formatQuantity(data?.units.exchangeReplacementUnits ?? "0")} exchange replacements`} tone="slate" />
      </section>

      {loading ? <div className="surface p-8 text-sm text-slate-500" role="status">Loading clothing analytics…</div> : data && !hasTransactions ? (
        <div className="surface mb-5">
          <EmptyState title="No transactions in this date range" message="Sales, returns, and exchanges will appear here when recorded. Current inventory metrics are still shown above." />
        </div>
      ) : null}

      {data && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.8fr)]">
          <section className="surface overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold">Revenue trend</h2>
              <p className="mt-1 text-xs text-slate-500">Net revenue per UTC date, including return refunds and exchange settlement amounts.</p>
            </div>
            {revenueTrend.length === 0 || !hasTransactions ? (
              <div className="px-5 py-6 text-sm text-slate-500">No revenue activity in this range.</div>
            ) : (
              <div className="table-wrap max-h-[460px] overflow-auto">
                <table className="table">
                  <thead><tr><th>Date (UTC)</th><th>Gross sales</th><th>Refunds</th><th>Exchange payments</th><th>Net revenue</th></tr></thead>
                  <tbody>{revenueTrend.map((point) => (
                    <tr key={point.date}>
                      <td className="whitespace-nowrap">{formatDate(point.date)}</td>
                      <td>{formatAmount(point.grossSales, currency)}</td>
                      <td>{formatAmount(point.refunds, currency)}</td>
                      <td>{formatAmount(point.exchangeAdditionalPayments, currency)}</td>
                      <td className="font-semibold">{formatAmount(point.netRevenue, currency)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="surface overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold">Best-selling products</h2>
              <p className="mt-1 text-xs text-slate-500">Net units after returns and exchange replacements</p>
            </div>
            {data.bestSellingProducts.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">No product sales in this date range.</p> : (
              <div className="divide-y divide-slate-100">
                {data.bestSellingProducts.map((product, index) => (
                  <div key={`${product.name}-${index}`} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{product.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatQuantity(product.unitsSold)} units</p>
                    </div>
                    <strong className="shrink-0 text-sm">{formatAmount(product.netRevenue, currency)}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="surface overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold">Popular sizes</h2></div>
            <RankingList rows={data.bestSellingSizes.map((row) => ({ label: row.size, value: row.unitsSold }))} empty="No size sales in this date range." />
          </section>

          <section className="surface overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold">Popular colours</h2></div>
            <RankingList rows={data.bestSellingColours.map((row) => ({ label: row.colour, value: row.unitsSold }))} empty="No colour sales in this date range." />
          </section>

          <section className="surface overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold">Returns</h2></div>
            <div className="grid grid-cols-3 gap-3 p-5">
              <SummaryMetric label="Transactions" value={data.returns.transactions.toLocaleString("en-IN")} />
              <SummaryMetric label="Units returned" value={formatQuantity(data.returns.unitsReturned)} />
              <SummaryMetric label="Refunds" value={formatAmount(data.returns.refundAmount, currency)} />
            </div>
          </section>

          <section className="surface overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold">Exchanges</h2></div>
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
              <SummaryMetric label="Transactions" value={data.exchanges.transactions.toLocaleString("en-IN")} />
              <SummaryMetric label="Units replaced" value={formatQuantity(data.exchanges.replacementUnits)} />
              <SummaryMetric label="Value replaced" value={formatAmount(data.exchanges.replacementValue, currency)} />
              <SummaryMetric label="Returned units" value={formatQuantity(data.exchanges.unitsReturned)} />
              <SummaryMetric label="Extra payments" value={formatAmount(data.exchanges.additionalPayments, currency)} />
              <SummaryMetric label="Refunds" value={formatAmount(data.exchanges.refunds, currency)} />
            </div>
            <div className="px-5 pb-4"><StatusBadge tone="gray">Exchanges are not counted as new sales transactions</StatusBadge></div>
          </section>
        </div>
      )}
    </div>
  );
}

function RankingList({ rows, empty }: { rows: Array<{ label: string; value: string }>; empty: string }) {
  return rows.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">{empty}</p> : (
    <div className="divide-y divide-slate-100">
      {rows.map((row) => <div key={row.label} className="flex items-center justify-between px-5 py-3.5">
        <span className="text-sm font-medium text-slate-700">{row.label}</span>
        <span className="text-sm font-semibold">{formatQuantity(row.value)} units</span>
      </div>)}
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-medium text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value}</p></div>;
}
