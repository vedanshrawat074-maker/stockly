import Link from "next/link";
import type { ReactNode } from "react";
import { Store } from "lucide-react";

export function AuthFrame({ title, description, children, footer }: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8f6] px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-7 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-700 text-white"><Store size={18} /></span>
          <span className="text-xl font-bold tracking-tight text-slate-800">stockly</span>
        </Link>
        <section className="surface p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
          <div className="mt-6">{children}</div>
        </section>
        <p className="mt-5 text-center text-sm text-slate-500">{footer}</p>
      </div>
    </main>
  );
}
