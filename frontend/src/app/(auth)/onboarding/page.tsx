"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { OnboardingGuard } from "@/components/auth-guards";
import { useAuth } from "@/components/auth-provider";
import { CreateShopForm } from "@/components/create-shop-form";
import { ApiClientError } from "@/lib/api-client";

export default function OnboardingPage() {
  const router = useRouter();
  const { logout, stores, selectStore } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [signOutError, setSignOutError] = useState<string | null>(null);

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
        <CreateShopForm onCreated={() => router.replace("/dashboard")} buttonLabel="Create store" />
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {signOutError && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{signOutError}</p>}
      </AuthFrame>
    </OnboardingGuard>
  );
}
