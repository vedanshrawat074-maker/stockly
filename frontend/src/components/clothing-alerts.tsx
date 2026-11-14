"use client";

import { AlertTriangle, Check, Play, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState, PageHeading, Pagination, StatusBadge } from "@/components/dashboard-ui";
import { useAuth } from "@/components/auth-provider";
import { ApiClientError, stocklyApi } from "@/lib/api-client";
import type { Alert } from "@/lib/types";
import { formatDate, formatQuantity } from "@/lib/utils";

function message(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The backend API could not be reached.";
}

function severityTone(severity: Alert["severity"]): "red" | "yellow" | "gray" {
  if (severity === "CRITICAL" || severity === "HIGH") return "red";
  if (severity === "MEDIUM") return "yellow";
  return "gray";
}

export default function ClothingAlertsPage() {
  const { currentStore } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [status, setStatus] = useState<Alert["status"] | "">("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentStore) {
      setLoading(false);
      setAlerts([]);
      return;
    }
    try {
      const result = await stocklyApi.alerts({
        page,
        limit: 20,
        status: status || undefined,
        type: "LOW_STOCK",
      });
      setAlerts(result.data);
      setTotalPages(result.pagination.totalPages);
      setError(null);
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoading(false);
    }
  }, [currentStore, page, status]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const runCheck = async () => {
    if (!window.confirm("Reconcile low-stock variants for the selected clothing store?")) return;
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

  const updateStatus = async (alert: Alert, action: "acknowledge" | "resolve") => {
    setWorkingId(alert._id);
    setMutationError(null);
    try {
      if (action === "acknowledge") await stocklyApi.acknowledgeAlert(alert._id);
      else await stocklyApi.resolveAlert(alert._id);
      setNotice(action === "acknowledge" ? "Low-stock alert acknowledged." : "Low-stock alert resolved.");
      setLoading(true);
      await load();
    } catch (updateError) {
      setMutationError(message(updateError));
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="page-width">
      <PageHeading
        eyebrow="Clothing stock conditions"
        title="Variant alerts"
        description="Review low-stock conditions for individual sizes and colours. Alerts reconcile automatically when clothing stock changes."
        action={<div className="flex gap-2">
          <button className="button-secondary" onClick={() => { setLoading(true); void load(); }}><RefreshCw size={14} /> Refresh</button>
          <button className="button-primary" disabled={checking} onClick={() => void runCheck()}><Play size={14} />{checking ? "Checking…" : "Run alert check"}</button>
        </div>}
      />
      {notice && <div role="status" className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}
      {mutationError && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{mutationError}</p>}
      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <label className="block min-w-40 text-xs font-semibold text-slate-600">Status
            <select className="field mt-1.5" value={status} onChange={(event) => {
              setLoading(true);
              setStatus(event.target.value as Alert["status"] | "");
              setPage(1);
            }}>
              <option value="ACTIVE">Active</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="RESOLVED">Resolved</option>
              <option value="">All statuses</option>
            </select>
          </label>
        </div>
        {loading ? <div className="p-4"><LoadingState rows={5} /></div> : error ? (
          <div className="p-4"><ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} /></div>
        ) : alerts.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <AlertTriangle size={23} className="mx-auto text-slate-400" />
            <p className="mt-3 text-sm font-semibold">No variant alerts match these filters</p>
            <p className="mt-1 text-sm text-slate-500">Low-stock alerts are created when available stock reaches the variant threshold.</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {alerts.map((alert) => (
                <article key={alert._id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-slate-800">{alert.productName ?? alert.title}</h2>
                      <StatusBadge tone={severityTone(alert.severity)}>{alert.severity}</StatusBadge>
                      <StatusBadge tone={alert.status === "ACTIVE" ? "yellow" : alert.status === "ACKNOWLEDGED" ? "green" : "gray"}>{alert.status}</StatusBadge>
                    </div>
                    <p className="mt-1.5 text-xs font-medium text-slate-500">
                      {alert.variantSku ?? "Variant SKU unavailable"} · {alert.size ?? "—"} / {alert.colour ?? "—"}
                    </p>
                    <p className="mt-2 text-sm text-slate-700">
                      Available {formatQuantity(alert.availableStock ?? "0")} · Threshold {formatQuantity(alert.lowStockThreshold ?? "0")}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{alert.details}</p>
                    <p className="mt-2 text-[11px] text-slate-400">First detected {formatDate(alert.firstDetectedAt)} · Last detected {formatDate(alert.lastDetectedAt)}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {alert.status === "ACTIVE" && <button className="button-secondary" disabled={workingId === alert._id} onClick={() => void updateStatus(alert, "acknowledge")}><Check size={14} /> Acknowledge</button>}
                    {alert.status !== "RESOLVED" && <button className="button-quiet text-slate-600" disabled={workingId === alert._id} onClick={() => void updateStatus(alert, "resolve")}><XCircle size={14} /> Resolve</button>}
                  </div>
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
