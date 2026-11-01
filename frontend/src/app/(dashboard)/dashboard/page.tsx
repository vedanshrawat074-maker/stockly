"use client";

import Link from "next/link";
import { Activity, ArrowDownRight, ArrowRight, BellRing, Boxes, CircleDollarSign, PackageCheck, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiClientError, stocklyApi } from "@/lib/api-client";
import type { RestockingRecommendation, Sale } from "@/lib/types";
import { formatAmount, formatDate, formatQuantity } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingState, PageHeading, StatCard, StatusBadge } from "@/components/dashboard-ui";
import { useAuth } from "@/components/auth-provider";

type DashboardData = {
  productCount: number;
  lowStockCount: number;
  expiryCount: number;
  recentSales: Sale[];
  recommendations: RestockingRecommendation[];
};

function message(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The backend API could not be reached.";
}

export default function DashboardPage() {
  const { currentStore } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [products, lowStock, expiring, expired, sales, restocking] = await Promise.all([
        stocklyApi.products({ limit: 1, isActive: true }),
        stocklyApi.alerts({ limit: 1, status: "ACTIVE", type: "LOW_STOCK" }),
        stocklyApi.alerts({ limit: 1, status: "ACTIVE", type: "EXPIRING_SOON" }),
        stocklyApi.alerts({ limit: 1, status: "ACTIVE", type: "EXPIRED_STOCK" }),
        stocklyApi.sales(1, 5),
        stocklyApi.restocking({ limit: 20 }),
      ]);
      setData({
        productCount: products.pagination.totalItems,
        lowStockCount: lowStock.pagination.totalItems,
        expiryCount: expiring.pagination.totalItems + expired.pagination.totalItems,
        recentSales: sales.data,
        recommendations: restocking.data,
      });
      setError(null);
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  return (
    <div className="page-width">
      <PageHeading
        eyebrow="Store overview"
        title="Overview"
        description="A clear view of today’s stock, sales, and store priorities."
        action={<button className="button-secondary" onClick={() => { setLoading(true); void load(); }}><RefreshCw size={14} /> Refresh</button>}
      />
      {error && <div className="mb-5"><ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} /></div>}

      <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Store summary">
        <StatCard icon={Boxes} label="Active products" value={loading ? null : data?.productCount.toLocaleString("en-IN")} helper="Across your product list" tone="green" />
        <StatCard icon={BellRing} label="Low-stock alerts" value={loading ? null : data?.lowStockCount.toLocaleString("en-IN")} helper="Active alerts" tone="amber" />
        <StatCard icon={Activity} label="Expiry alerts" value={loading ? null : data?.expiryCount.toLocaleString("en-IN")} helper="Expiring soon and expired" tone="rose" />
        <StatCard icon={CircleDollarSign} label="Recent sales" value={loading ? null : data?.recentSales.length.toLocaleString("en-IN")} helper="Most recent records shown below" tone="slate" />
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <section className="surface overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Recent sales</p>
              <p className="mt-1 text-xs text-slate-500">Latest completed sales recorded by the backend</p>
            </div>
            <Link href="/sales" className="button-quiet">All sales <ArrowRight size={14} /></Link>
          </div>
          {loading && <div className="p-4"><LoadingState rows={3} /></div>}
          {!loading && data?.recentSales.length === 0 && <EmptyState title="No sales yet" message="Completed sales will appear here after they are recorded." />}
          {!loading && data && data.recentSales.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Sale</th><th>Items</th><th>Total</th><th>Recorded</th></tr></thead>
                <tbody>{data.recentSales.map((sale) => (
                  <tr key={sale._id}>
                    <td className="font-medium text-slate-800">{sale.saleIdentifier}</td>
                    <td>{sale.lineItems.length} items</td>
                    <td className="font-semibold">{formatAmount(sale.totalAmount, currentStore?.currency ?? "INR")}</td>
                    <td className="text-slate-500">{formatDate(sale.createdAt)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>

        <section className="surface overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-semibold">Smart restocking</p>
              <p className="mt-1 text-xs text-slate-500">Forecast-supported suggestions</p>
            </div>
            <Link href="/restocking" className="button-quiet">View all <ArrowRight size={14} /></Link>
          </div>
          {loading && <div className="p-4"><LoadingState rows={3} /></div>}
          {!loading && data?.recommendations.length === 0 && <EmptyState title="Nothing to review" message="No active products have restocking recommendations on this page." />}
          {!loading && data && data.recommendations.length > 0 && (
            <div className="divide-y divide-slate-100">
              {data.recommendations.slice(0, 5).map((recommendation) => (
                <div key={recommendation.productId} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{recommendation.productName}</p>
                    <p className="mt-1 text-xs text-slate-500">Usable stock {formatQuantity(recommendation.currentUsableStock)} {recommendation.unit}</p>
                  </div>
                  <RecommendationStatus status={recommendation.status} />
                </div>
              ))}
            </div>
          )}
          <div className="border-t border-slate-100 px-5 py-3">
            <p className="text-[11px] leading-5 text-slate-500">Recommendations use a rolling-average baseline. Historical closures and stockouts are unknown.</p>
          </div>
        </section>
      </div>

      <section className="mt-5 grid gap-4 md:grid-cols-3">
        <QuickLink href="/inventory" icon={<Boxes size={17} />} title="Manage inventory" text="Review products, batches, and expiry dates" />
        <QuickLink href="/restocking" icon={<PackageCheck size={17} />} title="Review restocking" text="See suggested quantities and assumptions" />
        <QuickLink href="/alerts" icon={<BellRing size={17} />} title="Check alerts" text="Acknowledge active store alerts" />
      </section>
    </div>
  );
}

function RecommendationStatus({ status }: { status: RestockingRecommendation["status"] }) {
  const tone = status === "RESTOCK_RECOMMENDED" ? "yellow" : status === "NO_RESTOCK_NEEDED" ? "green" : status === "INSUFFICIENT_HISTORY" ? "gray" : "red";
  const label = status === "RESTOCK_RECOMMENDED" ? "Review" : status === "NO_RESTOCK_NEEDED" ? "On track" : status === "INSUFFICIENT_HISTORY" ? "Cold start" : "Unavailable";
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

function QuickLink({ href, icon, title, text }: { href: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <Link href={href} className="surface flex items-center gap-4 p-4 transition hover:border-emerald-200 hover:shadow-sm">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs text-slate-500">{text}</span></span>
      <ArrowDownRight size={15} className="text-slate-400" />
    </Link>
  );
}