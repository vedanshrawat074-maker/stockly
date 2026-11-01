import type {
  Alert,
  AuthResponse,
  AuthUser,
  Batch,
  DemandHistoryResponse,
  Forecast,
  HealthResponse,
  InventoryDetail,
  InventoryRecord,
  Page,
  Product,
  RestockingRecommendation,
  Sale,
  StockMovement,
  StoreSummary,
} from "./types";

const defaultApiBaseUrl = "http://localhost:4000/api";
const requestTimeoutMs = 12_000;
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function getApiBaseUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "development") return defaultApiBaseUrl;
  throw new ApiClientError(
    "Set NEXT_PUBLIC_API_BASE_URL to the backend API URL before deploying the frontend.",
    0,
    "API_CONFIGURATION_MISSING",
  );
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (csrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes((init.method ?? "GET").toUpperCase())) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers,
      credentials: "include",
      signal: init.signal
        ? AbortSignal.any([controller.signal, init.signal])
        : controller.signal,
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = payload as { error?: { code?: string; message?: string } } | null;
      if (response.status === 401 && typeof window !== "undefined") {
        window.dispatchEvent(new Event("stockly:unauthorized"));
      }
      throw new ApiClientError(
        error?.error?.message ?? `Request failed with status ${response.status}.`,
        response.status,
        error?.error?.code ?? "REQUEST_FAILED",
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (controller.signal.aborted) {
      throw new ApiClientError("The request timed out. Please try again.", 408, "REQUEST_TIMEOUT");
    }
    throw new ApiClientError(
      error instanceof Error ? error.message : "The backend API could not be reached.",
      0,
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export const stocklyApi = {
  auth: {
    me: () => request<{ data: { user: AuthUser; csrfToken: string } }>("/auth/me"),
    register: (input: { name: string; email: string; password: string }) =>
      request<AuthResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      }).then((result) => {
        setCsrfToken(result.data.csrfToken);
        return result;
      }),
    login: (input: { email: string; password: string }) =>
      request<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      }).then((result) => {
        setCsrfToken(result.data.csrfToken);
        return result;
      }),
    logout: async () => {
      await request<void>("/auth/logout", { method: "POST" });
      setCsrfToken(null);
    },
  },
  stores: {
    list: () => request<{ data: StoreSummary[] }>("/stores"),
    current: () => request<{ data: StoreSummary | null }>("/stores/current"),
    create: (input: { name: string; address: string; timezone: string; currency: string }) =>
      request<{ data: StoreSummary }>("/stores", { method: "POST", body: JSON.stringify(input) }),
    select: (storeId: string) =>
      request<{ data: StoreSummary }>("/stores/current", {
        method: "POST",
        body: JSON.stringify({ storeId }),
      }),
  },
  health: () => request<HealthResponse>("/health"),
  products: (options: {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  } = {}) =>
    request<Page<Product>>(
      `/products${queryString({
        page: options.page ?? 1,
        limit: options.limit ?? 20,
        search: options.search,
        isActive: options.isActive === undefined ? undefined : String(options.isActive),
      })}`,
    ),
  product: (productId: string) =>
    request<{ data: Product }>(`/products/${encodeURIComponent(productId)}`),
  createProduct: (input: {
    name: string;
    sku: string;
    category: string;
    baseUnit: string;
    sellingPrice: string;
    barcode?: string;
  }) =>
    request<{ data: Product }>("/products", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProduct: (
    productId: string,
    input: Partial<{
      name: string;
      sku: string;
      category: string;
      baseUnit: string;
      sellingPrice: string;
      barcode?: string;
    }>,
  ) =>
    request<{ data: Product }>(`/products/${encodeURIComponent(productId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deactivateProduct: (productId: string) =>
    request<{ data: { id: string; action: "deactivated" | "deleted" } }>(
      `/products/${encodeURIComponent(productId)}`,
      { method: "DELETE" },
    ),
  inventory: (page = 1, limit = 100) =>
    request<Page<InventoryRecord>>(`/inventory${queryString({ page, limit })}`),
  inventoryDetail: (productId: string) =>
    request<{ data: InventoryDetail }>(`/inventory/${encodeURIComponent(productId)}`),
  batches: (productId: string, page = 1, limit = 20) =>
    request<Page<Batch>>(
      `/inventory/${encodeURIComponent(productId)}/batches${queryString({ page, limit })}`,
    ),
  receiveBatch: (
    productId: string,
    input: {
      batchNumber: string;
      quantity: string;
      unitCost: string;
      receivedDate?: string;
      expiryDate?: string;
    },
  ) =>
    request<{ data: { inventory: InventoryRecord; batch: Batch; movement: StockMovement } }>(
      `/inventory/${encodeURIComponent(productId)}/batches`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  sales: (page = 1, limit = 20) =>
    request<Page<Sale>>(`/sales${queryString({ page, limit })}`),
  createSale: (
    items: Array<{ productId: string; quantity: string }>,
    idempotencyKey: string,
  ) =>
    request<{ data: Sale; meta: { idempotentReplay: boolean } }>("/sales", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ items }),
    }),
  alerts: (options: {
    page?: number;
    limit?: number;
    type?: Alert["type"];
    status?: Alert["status"];
  } = {}) =>
    request<Page<Alert>>(
      `/alerts${queryString({
        page: options.page ?? 1,
        limit: options.limit ?? 20,
        type: options.type,
        status: options.status,
      })}`,
    ),
  acknowledgeAlert: (alertId: string) =>
    request<{ data: Alert }>(`/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
      method: "PATCH",
    }),
  runAlertCheck: (expiryWarningDays?: number) =>
    request<{
      data: { created: number; refreshed: number; resolved: number; activeConditions: number };
    }>("/alerts/run-check", {
      method: "POST",
      body: JSON.stringify(expiryWarningDays === undefined ? {} : { expiryWarningDays }),
    }),
  demandHistory: (options: {
    startDate: string;
    endDate: string;
    productId?: string;
    page?: number;
    limit?: number;
  }) =>
    request<DemandHistoryResponse>(`/demand/history${queryString(options)}`),
  forecast: (input: {
    productId: string;
    startDate: string;
    endDate: string;
    horizonDays?: number;
    rollingWindowDays?: number;
  }) =>
    request<{ data: Forecast }>("/forecasts", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  restocking: (options: { productId?: string; page?: number; limit?: number } = {}) =>
    request<Page<RestockingRecommendation>>(
      `/restocking/recommendations${queryString({
        productId: options.productId,
        page: options.page ?? 1,
        limit: options.limit ?? 20,
      })}`,
    ),
};