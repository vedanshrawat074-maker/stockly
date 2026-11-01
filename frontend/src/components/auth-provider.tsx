"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClientError, setCsrfToken, stocklyApi } from "@/lib/api-client";
import type { AuthUser, StoreSummary } from "@/lib/types";

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";
type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  stores: StoreSummary[];
  currentStore: StoreSummary | null;
  error: string | null;
  refresh: () => Promise<void>;
  selectStore: (storeId: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The backend API could not be reached.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [currentStore, setCurrentStore] = useState<StoreSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      const me = await stocklyApi.auth.me();
      setCsrfToken(me.data.csrfToken);
      const [storeList, selectedStore] = await Promise.all([
        stocklyApi.stores.list(),
        stocklyApi.stores.current(),
      ]);
      setUser(me.data.user);
      setStores(storeList.data);
      setCurrentStore(selectedStore.data);
      setError(null);
      setStatus("authenticated");
    } catch (loadError) {
      setCsrfToken(null);
      setUser(null);
      setStores([]);
      setCurrentStore(null);
      if (loadError instanceof ApiClientError && loadError.status === 401) {
        setError(null);
        setStatus("unauthenticated");
      } else {
        setError(errorMessage(loadError));
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setCsrfToken(null);
      setUser(null);
      setStores([]);
      setCurrentStore(null);
      setStatus("unauthenticated");
    };
    window.addEventListener("stockly:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("stockly:unauthorized", handleUnauthorized);
  }, []);

  const selectStore = useCallback(async (storeId: string) => {
    await stocklyApi.stores.select(storeId);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await stocklyApi.auth.logout();
    setCsrfToken(null);
    setUser(null);
    setStores([]);
    setCurrentStore(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo(
    () => ({ status, user, stores, currentStore, error, refresh, selectStore, logout }),
    [status, user, stores, currentStore, error, refresh, selectStore, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
