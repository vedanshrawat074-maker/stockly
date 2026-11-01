export type Pagination = {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
};

export type Page<T> = {
  data: T[];
  pagination: Pagination;
};

export type Product = {
  _id: string;
  store: string;
  name: string;
  sku: string;
  barcode?: string;
  category: string;
  baseUnit: string;
  sellingPrice: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InventoryRecord = {
  _id: string;
  store: string;
  product: string;
  minimumStockThreshold: string;
  onHandQuantity: string;
  createdAt: string;
  updatedAt: string;
};

export type InventoryDetail = {
  inventory: InventoryRecord | null;
  product: Product;
  onHandQuantity: string;
};

export type Batch = {
  _id: string;
  batchNumber: string;
  receivedQuantity: string;
  remainingQuantity: string;
  unitCost: string;
  receivedDate: string;
  expiryDate?: string;
  createdAt: string;
};

export type StockMovement = {
  _id: string;
  movementType: string;
  quantityDelta: string;
  reason: string;
  timestamp: string;
};

export type SaleLineItem = {
  product: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  allocations: Array<{ batch: string; quantity: string }>;
};

export type Sale = {
  _id: string;
  saleIdentifier: string;
  lineItems: SaleLineItem[];
  totalAmount: string;
  status: "completed";
  createdAt: string;
};

export type Alert = {
  _id: string;
  type: "LOW_STOCK" | "EXPIRING_SOON" | "EXPIRED_STOCK";
  product: string;
  batch?: string;
  status: "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  details: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt?: string;
};

export type DemandDay = {
  date: string;
  unitsSold: string;
};

export type DemandSeries = {
  storeId: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  isActive: boolean;
  availability: null;
  availabilityNote: string;
  dailyDemand: DemandDay[];
};

export type DemandHistoryResponse = Page<DemandSeries> & {
  period: {
    startDate: string;
    endDate: string;
    timezone: "UTC";
    dateBoundary: string;
  };
};

export type ForecastPoint = {
  date: string;
  predictedUnits: string;
  previousWeekUnits?: string | null;
};

export type Forecast = {
  storeId: string;
  productId: string;
  unit: string;
  status: "ok" | "insufficient_history" | "zero_demand";
  method: string;
  horizonDays: number;
  minimumHistoryDays: number;
  observedHistoryDays: number;
  historyThrough: string;
  forecasts: ForecastPoint[];
  comparison: string;
  limitations: string[];
};

export type RestockingRecommendation = {
  productId: string;
  productName: string;
  unit: string;
  status:
    | "NO_RESTOCK_NEEDED"
    | "RESTOCK_RECOMMENDED"
    | "INSUFFICIENT_HISTORY"
    | "FORECAST_UNAVAILABLE";
  currentUsableStock: string;
  forecastStatus: "ok" | "insufficient_history" | "zero_demand" | "unavailable";
  forecastDemand: string | null;
  safetyBuffer: string | null;
  suggestedRestockQuantity: string | null;
  lowStockFallback: { threshold: string | null; triggered: boolean } | null;
  reason: string;
};

export type HealthResponse = {
  status: string;
  database: string;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
};

export type AuthResponse = {
  data: {
    user: AuthUser;
    csrfToken: string;
  };
};

export type StoreSummary = {
  id: string;
  name: string;
  address: string;
  timezone: string;
  currency: string;
  role: "OWNER" | "STAFF";
};

export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
