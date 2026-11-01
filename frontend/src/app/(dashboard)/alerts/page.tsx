"use client";

import { AlertTriangle, Check, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorState, FilterSelect, LoadingState, PageHeading, Pagination, StatusBadge } from "@/components/dashboard-ui";
import { ApiClientError, stocklyApi } from "@/lib/api-client";
import type { Alert, Product } from "@/lib/types";
import { formatDate } from "@/lib/utils";

function message(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The backend API could not be reached.";
}

function alertTone(severity: Alert["severity"]): "red" | "yellow" | "gray" {
  if (severity === "CRITICAL" || severity === "HIGH") return "red";
  if (severity === "MEDIUM") return "yellow";
  return "gray";
}

const typeLabels: Record<Alert["type"], string> = {
  LOW_STOCK: "Low stock",
  EXPIRING_SOON: "Expiring soon",
  EXPIRED_STOCK: "Expired stock",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [status, setStatus] = useState<Alert["status"] | "">("ACTIVE");
  const [type, setType] = useState<Alert["type"] | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const productById = useMemo(() => new Map(products.map((product) => [product._id, product])), [products]);

  const load = useCallback(async () => {
    try {
      const [result, productPage] = await Promise.all([
        stocklyApi.alerts({ page, limit: 20, status: status || undefined, type: type || undefined }),
        stocklyApi.products({ limit: 100 }),
      ]);
      setAlerts(result.data);
      setTotalPages(result.pagination.totalPages);
      setProducts(productPage.data);
      setError(null);
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoading(false);
    }
  }, [page, status, type]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const acknowledge = async (alert: Alert) => {
    setWorkingId(alert._id);
    setMutationError(null);
    try {
      await stocklyApi.acknowledgeAlert(alert._id);
      setNotice("Alert acknowledged.");
      setLoading(true);
      await load();
    } catch (acknowledgeError) {
      setMutationError(message(acknowledgeError));
    } finally {
      setWorkingId(null);
    }
  };

  const runCheck = async () => {
    if (!window.confirm("Run an alert check for this development store now? Existing alerts may be refreshed or resolved by the backend.")) return;
    setChecking(true);
    setMutationError(null);
    try {
      const result = await stocklyApi.runAlertCheck();
      const summary = result.data;
      setNotice(`Alert check complete: ${summary.created} created, ${summary.refreshed} refreshed, ${summary.resolved} resolved.`);
      setLoading(true);
      await load();
    } catch (checkError) {
      setMutationError(message(checkError));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="page-width">
      <PageHeading eyebrow="Store conditions" title="Alerts" description="Review stock and expiry conditions, acknowledge items, or run the backend alert check." action={<div className="flex gap-2"><button className="button-secondary" onClick={() => { setLoading(true); void load(); }}><RefreshCw size={14} /> Refresh</button><button className="button-primary" disabled={checking} onClick={() => void runCheck()}><Play size={14} />{checking ? "Checking…" : "Run alert check"}</button></div>} />
      <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">Alert checks evaluate the current store state. Review the effects before running; the backend may refresh or resolve existing conditions.</div>
      {notice && <div role="status" className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}
      {mutationError && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{mutationError}</p>}
      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <FilterSelect
            className="min-w-40"
            label="Status"
            value={status}
            options={[
              { label: "All statuses", value: "" },
              { label: "Active", value: "ACTIVE" },
              { label: "Acknowledged", value: "ACKNOWLEDGED" },
              { label: "Resolved", value: "RESOLVED" },
            ]}
            onChange={(value) => { setLoading(true); setStatus(value as Alert["status"] | ""); setPage(1); }}
          />
          <FilterSelect
            className="min-w-44"
            label="Alert type"
            value={type}
            options={[
              { label: "All alert types", value: "" },
              { label: "Low stock", value: "LOW_STOCK" },
              { label: "Expiring soon", value: "EXPIRING_SOON" },
              { label: "Expired stock", value: "EXPIRED_STOCK" },
            ]}
            onChange={(value) => { setLoading(true); setType(value as Alert["type"] | ""); setPage(1); }}
          />
        </div>
        {loading ? <div className="p-4"><LoadingState rows={5} /></div> : error ? <div className="p-4"><ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} /></div> : alerts.length === 0 ? (
          <div className="px-5 py-12 text-center"><AlertTriangle size={23} className="mx-auto text-slate-400" /><p className="mt-3 text-sm font-semibold">No alerts match these filters</p><p className="mt-1 text-sm text-slate-500">Run an alert check to evaluate current stock and expiry conditions.</p></div>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {alerts.map((alert) => (
                <article key={alert._id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-slate-800">{alert.title}</h2>
                      <StatusBadge tone={alertTone(alert.severity)}>{alert.severity}</StatusBadge>
                      <StatusBadge tone={alert.status === "ACTIVE" ? "yellow" : alert.status === "ACKNOWLEDGED" ? "green" : "gray"}>{alert.status}</StatusBadge>
                    </div>
                    <p className="mt-1.5 text-xs font-medium text-slate-500">{typeLabels[alert.type]} · {productById.get(alert.product)?.name ?? `Product ${alert.product.slice(-6)}`}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{alert.details}</p>
                    <p className="mt-2 text-[11px] text-slate-400">First detected {formatDate(alert.firstDetectedAt)} · Last detected {formatDate(alert.lastDetectedAt)}</p>
                  </div>
                  {alert.status === "ACTIVE" && <button className="button-secondary self-start" disabled={workingId === alert._id} onClick={() => void acknowledge(alert)}><Check size={14} />{workingId === alert._id ? "Saving…" : "Acknowledge"}</button>}
                </article>
              ))}
            </div>
            <Pagination page={page} totalPages={totalPages} onChange={(nextPage) => { setLoading(true); setPage(nextPage); }} />
          </>
        )}
      </section>
    </div>
  );
}