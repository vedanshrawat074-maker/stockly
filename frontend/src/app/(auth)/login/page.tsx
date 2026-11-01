"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { useAuth } from "@/components/auth-provider";
import { ApiClientError, stocklyApi } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const { status, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await stocklyApi.auth.login({ email, password });
      await refresh();
      router.replace("/dashboard");
    } catch (loginError) {
      setError(loginError instanceof ApiClientError ? loginError.message : "The backend API could not be reached.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame
      title="Welcome back"
      description="Sign in to manage your store’s inventory and daily operations."
      footer={<>New to Stockly? <Link href="/register" className="font-semibold text-emerald-800 hover:underline">Create an account</Link></>}
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-medium text-slate-700">Email address
          <input className="field mt-1.5" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-slate-700">Password
          <input className="field mt-1.5" type="password" autoComplete="current-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button className="button-primary w-full justify-center" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="mt-4 text-xs leading-5 text-slate-500">Password recovery and email verification are not available yet. Contact your administrator if you cannot sign in.</p>
    </AuthFrame>
  );
}
