"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { OnboardingGuard } from "@/components/auth-guards";
import { useAuth } from "@/components/auth-provider";
import { ApiClientError, stocklyApi } from "@/lib/api-client";

export default function OnboardingPage() {
  const router = useRouter();
  const { refresh, logout, stores, selectStore } = useAuth();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [currency, setCurrency] = useState("INR");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await stocklyApi.stores.create({ name, address, timezone, currency });
      await refresh();
      router.replace("/dashboard");
    } catch (createError) {
      setError(createError instanceof ApiClientError ? createError.message : "The backend API could not be reached.");
    } finally {
      setSubmitting(false);
    }
  };

  const selectExistingStore = async () => {
    if (!selectedStoreId) return;
    setError(null);
    setSubmitting(true);
    try {
      await selectStore(selectedStoreId);
      router.replace("/dashboard");
    } catch (selectError) {
      setError(selectError instanceof ApiClientError ? selectError.message : "The store could not be selected.");
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    setSignOutError(null);
    try {
      await logout();
      router.replace("/login");
    } catch {
      setSignOutError("Sign out could not reach the server. Please try again.");
    }
  };

  return (
    <OnboardingGuard>
      <AuthFrame
        title="Set up your store"
        description="Create the first store for your account. You’ll be added as its owner."
        footer={<button className="font-semibold text-slate-600 hover:text-slate-900" onClick={() => void signOut()}>Sign out</button>}
      >
        {stores.length > 0 && (
          <div className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
            <p className="text-sm font-semibold text-slate-800">Use a store you already belong to</p>
            <p className="mt-1 text-xs text-slate-600">Your available memberships are verified by the backend.</p>
            <label className="mt-3 block text-sm font-medium text-slate-700">Authorized store
              <select className="field mt-1.5" value={selectedStoreId} onChange={(event) => setSelectedStoreId(event.target.value)}>
                <option value="">Select a store</option>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name} · {store.role}</option>)}
              </select>
            </label>
            <button type="button" className="button-secondary mt-3 w-full justify-center" disabled={submitting || !selectedStoreId} onClick={() => void selectExistingStore()}>Continue with selected store</button>
          </div>
        )}
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <label className="block text-sm font-medium text-slate-700">Store name
            <input className="field mt-1.5" required minLength={1} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block text-sm font-medium text-slate-700">Address
            <input className="field mt-1.5" required minLength={1} maxLength={500} autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">Time zone
              <input className="field mt-1.5" required maxLength={100} placeholder="Asia/Kolkata" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
            </label>
            <label className="block text-sm font-medium text-slate-700">Currency code
              <input className="field mt-1.5 uppercase" required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
            </label>
          </div>
          <p className="text-xs leading-5 text-slate-500">Enter an IANA timezone such as Asia/Kolkata and a three-letter ISO currency code. These settings affect date handling and display.</p>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {signOutError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{signOutError}</p>}
          <button className="button-primary w-full justify-center" type="submit" disabled={submitting}>{submitting ? "Creating store…" : "Create store"}</button>
        </form>
      </AuthFrame>
    </OnboardingGuard>
  );
}
