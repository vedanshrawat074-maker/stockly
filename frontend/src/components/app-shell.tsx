"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BellRing,
  Boxes,
  ChartNoAxesCombined,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageCheck,
  ReceiptText,
  Store,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ApiClientError } from "@/lib/api-client";

const navigation = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Inventory", href: "/inventory", icon: Boxes },
  { label: "Sales", href: "/sales", icon: ReceiptText },
  { label: "Smart restocking", href: "/restocking", icon: PackageCheck },
  { label: "Alerts", href: "/alerts", icon: BellRing },
  { label: "Analytics", href: "/analytics", icon: ChartNoAxesCombined },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, stores, currentStore, selectStore, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchingStore, setSwitchingStore] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  const switchToStore = async (storeId: string) => {
    if (!storeId || storeId === currentStore?.id) return;
    setSwitchingStore(true);
    setSwitchError(null);
    try {
      await selectStore(storeId);
    } catch (error) {
      setSwitchError(error instanceof ApiClientError ? error.message : "The store could not be changed.");
    } finally {
      setSwitchingStore(false);
    }
  };

  const signOut = async () => {
    try {
      await logout();
      router.replace("/login");
    } catch {
      setSwitchError("Sign out could not reach the server. Please try again.");
    }
  };

  const closeMobileNavigation = () => setMobileOpen(false);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-5">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-3" onClick={closeMobileNavigation}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-white shadow-sm shadow-emerald-900/10">
            <Store size={19} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-[18px] font-bold tracking-[-.04em] text-slate-900">stockly</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[.13em] text-slate-400">Store operations</span>
          </span>
        </Link>
        {mobileOpen && (
          <button type="button" className="button-quiet icon-button lg:hidden" aria-label="Close navigation" onClick={closeMobileNavigation}>
            <X size={19} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="px-3 pb-4 pt-3">
        <p className="px-3 pb-2.5 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Workspace</p>
        <nav className="space-y-1" aria-label="Main navigation">
          {navigation.map(({ label, href, icon: Icon }) => {
            const active = pathname === href || (href === "/analytics" && pathname === "/forecasts");
            return (
              <Link
                key={href}
                href={href}
                onClick={closeMobileNavigation}
                aria-current={active ? "page" : undefined}
                className={`nav-link ${active ? "nav-link-active" : ""}`}
              >
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{label}</span>
                {active && <span className="nav-active-mark" aria-hidden="true" />}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto border-t border-slate-100 p-4">
        <div className="rounded-xl border border-emerald-100/80 bg-emerald-50/60 p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <Activity size={14} className="text-emerald-700" aria-hidden="true" />
            <span>Workspace active</span>
          </div>
          <p className="mt-1.5 truncate text-xs font-medium text-slate-700">{currentStore?.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">{user?.email}</p>
        </div>
      </div>
    </div>
  );

  const initials = user?.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "S";

  return (
    <div className="min-h-screen">
      <aside className="sidebar fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r border-slate-200/90 bg-white lg:block">
        {sidebar}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/35 backdrop-blur-[2px]"
            aria-label="Close navigation"
            onClick={closeMobileNavigation}
          />
          <aside id="mobile-navigation" className="sidebar relative h-full w-[min(84vw,320px)] bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Mobile navigation">
            {sidebar}
          </aside>
        </div>
      )}
      <div className="lg:pl-[264px]">
        <header className="topbar sticky top-0 z-20 flex min-h-[68px] items-center justify-between border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="button-quiet icon-button lg:hidden"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls={mobileOpen ? "mobile-navigation" : undefined}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={19} aria-hidden="true" />
            </button>
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-sm font-semibold text-slate-800">{currentStore?.name}</p>
              <p className="text-[11px] text-slate-500">Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-4">
            <label className="store-picker">
              <Store size={15} className="shrink-0 text-emerald-700" aria-hidden="true" />
              <span className="sr-only">Select current store</span>
              <select
                aria-label="Select current store"
                className="max-w-[min(36vw,190px)] border-0 bg-transparent text-xs font-semibold text-slate-700 outline-none"
                disabled={switchingStore || stores.length < 2}
                value={currentStore?.id ?? ""}
                onChange={(event) => void switchToStore(event.target.value)}
              >
                {currentStore && <option value={currentStore.id}>{currentStore.name}</option>}
                {stores.filter((store) => store.id !== currentStore?.id).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
              <ChevronDown size={13} className="shrink-0 text-slate-400" aria-hidden="true" />
            </label>

            <details className="profile-menu relative">
              <summary className="profile-trigger" aria-label="Open user profile menu">
                <span className="profile-avatar" aria-hidden="true">{initials}</span>
                <span className="hidden min-w-0 text-left sm:block">
                  <span className="block max-w-36 truncate text-xs font-semibold text-slate-800">{user?.name}</span>
                  <span className="block max-w-36 truncate text-[10px] text-slate-500">{user?.email}</span>
                </span>
                <ChevronDown size={14} className="hidden text-slate-400 sm:block" aria-hidden="true" />
              </summary>
              <div className="profile-dropdown">
                <div className="border-b border-slate-100 px-4 py-3 sm:hidden">
                  <p className="truncate text-sm font-semibold text-slate-800">{user?.name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{user?.email}</p>
                </div>
                <button type="button" className="profile-action" onClick={() => void signOut()}>
                  <LogOut size={15} aria-hidden="true" />
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </header>
        {switchError && <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700 sm:px-6 lg:px-8">{switchError}</p>}
        <main className="min-h-[calc(100vh-68px)] py-7 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
