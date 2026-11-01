"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ErrorState, LoadingState } from "@/components/dashboard-ui";
import { useAuth } from "@/components/auth-provider";

export function ProtectedDashboard({ children }: { children: ReactNode }) {
  const { status, currentStore, error, refresh } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    if (status === "authenticated" && !currentStore) router.replace("/onboarding");
  }, [status, currentStore, router]);

  if (status === "loading") return <div className="page-width"><LoadingState rows={5} /></div>;
  if (status === "error") return <div className="page-width"><ErrorState message={error ?? "Unable to verify your session."} onRetry={() => void refresh()} /></div>;
  if (status !== "authenticated" || !currentStore) return null;
  return children;
}

export function OnboardingGuard({ children }: { children: ReactNode }) {
  const { status, currentStore, error, refresh } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
    if (status === "authenticated" && currentStore) router.replace("/dashboard");
  }, [status, currentStore, router]);

  if (status === "loading") return <div className="page-width"><LoadingState rows={3} /></div>;
  if (status === "error") return <div className="page-width"><ErrorState message={error ?? "Unable to verify your session."} onRetry={() => void refresh()} /></div>;
  if (status !== "authenticated" || currentStore) return null;
  return children;
}
