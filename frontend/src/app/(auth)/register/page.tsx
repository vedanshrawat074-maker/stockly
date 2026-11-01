"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { useAuth } from "@/components/auth-provider";
import { ApiClientError, stocklyApi } from "@/lib/api-client";

export default function RegisterPage() {
  const router = useRouter();
  const { status, refresh } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/onboarding");
  }, [status, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await stocklyApi.auth.register({ name, email, password });
      await refresh();
      router.replace("/onboarding");
    } catch (registerError) {
      setError(registerError instanceof ApiClientError ? registerError.message : "The backend API could not be reached.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame
      title="Create your account"
      description="Set up your Stockly account, then create the store you manage."
      footer={<>Already registered? <Link href="/login" className="font-semibold text-emerald-800 hover:underline">Sign in</Link></>}
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-medium text-slate-700">Your name
          <input className="field mt-1.5" autoComplete="name" required minLength={1} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-slate-700">Email address
          <input className="field mt-1.5" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-slate-700">Password
          <input className="field mt-1.5" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
          <span className="mt-1 block text-xs font-normal text-slate-500">Use at least 12 characters. Password recovery is not available yet.</span>
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button className="button-primary w-full justify-center" type="submit" disabled={submitting}>{submitting ? "Creating account…" : "Create account"}</button>
      </form>
    </AuthFrame>
  );
}
