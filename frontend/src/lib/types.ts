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

export type ClothingVariant = {
  _id: string;
  store: string;
  product: string;
  size: string;
  colour: string;
  designIdentifier?: string;
  sku: string;
  stockQuantity: string;
  lowStockThreshold: string;
  createdAt: string;
  updatedAt: string;
};

export type ClothingVariantInput = {
  size: string;
  colour: string;
  designIdentifier?: string;
  sku: string;
  stockQuantity?: string;
  lowStockThreshold?: string;
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
  productName?: string;
  variant?: string;
  variantSku?: string;
  size?: string;
  colour?: string;
  designIdentifier?: string;
  quantity: string;
  unitPrice: string;
  discountPerUnit?: string;
  unitNetPrice?: string;
  lineTotal: string;
  returnedQuantity?: string;
  allocations: Array<{ batch: string; quantity: string }>;
};

export type Sale = {
  _id: string;
  saleIdentifier: string;
  lineItems: SaleLineItem[];
  totalAmount: string;
  status: "completed";
  businessType?: "clothing";
  subtotal?: string;
  discountAmount?: string;
  paymentMethod?: PaymentMethod;
  soldAt?: string;
  createdAt: string;
};

export type PaymentMethod = "cash" | "card" | "upi" | "other";

export type ClothingSaleInput = {
  items: Array<{
    variantId: string;
    quantity: string;
    unitPrice?: string;
    discountPerUnit?: string;
  }>;
  paymentMethod: PaymentMethod;
};

export type ClothingReturn = {
  _id: string;
  originalSale: string;
  returnIdentifier: string;
  returnedAt: string;
  lineItems: Array<{
    saleLineIndex: number;
    product: string;
    productName: string;
    variant: string;
    variantSku: string;
    size: string;
    colour: string;
    designIdentifier?: string;
    quantity: string;
    condition: "saleable" | "damaged";
    reason: string;
    lineValue: string;
  }>;
  refundAmount: string;
  refundPaymentMethod?: PaymentMethod;
  exchangeCreditAmount?: string;
  exchange?: string;
};

export type ClothingExchange = {
  _id: string;
  originalSale: string;
  return: string;
  exchangeIdentifier: string;
  exchangedAt: string;
  replacementItems: Array<{
    product: string;
    productName: string;
    variant: string;
    variantSku: string;
    size: string;
    colour: string;
    designIdentifier?: string;
    quantity: string;
    unitPrice: string;
    discountPerUnit: string;
    lineTotal: string;
  }>;
  returnedValue: string;
  replacementValue: string;
  priceDifference: string;
  additionalPaymentAmount: string;
  refundAmount: string;
  paymentMethod?: PaymentMethod;
  refundPaymentMethod?: PaymentMethod;
};

export type Alert = {
  _id: string;
  type: "LOW_STOCK" | "EXPIRING_SOON" | "EXPIRED_STOCK";
  product: string;
  batch?: string;
  variant?: string;
  productName?: string;
  variantSku?: string;
  size?: string;
  colour?: string;
  availableStock?: string;
  lowStockThreshold?: string;
  status: "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  details: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt?: string;
};

export type ClothingAnalytics = {
  currency: string;
  period: {
    startDate: string;
    endDate: string;
    timezone: "UTC";
    dateBoundary: string;
  };
  revenue: {
    grossSales: string;
    refunds: string;
    directReturnRefunds: string;
    exchangeAdditionalPayments: string;
    exchangeRefunds: string;
    netRevenue: string;
  };
  units: {
    grossUnitsSold: string;
    returnedUnits: string;
    exchangeReplacementUnits: string;
    netUnitsSold: string;
  };
  transactions: { sales: number; returns: number; exchanges: number };
  returns: { transactions: number; unitsReturned: string; refundAmount: string };
  exchanges: {
    transactions: number;
    unitsReturned: string;
    replacementUnits: string;
    replacementValue: string;
    additionalPayments: string;
    refunds: string;
  };
  bestSellingProducts: Array<{ name: string; unitsSold: string; netRevenue: string }>;
  bestSellingSizes: Array<{ size: string; unitsSold: string }>;
  bestSellingColours: Array<{ colour: string; unitsSold: string }>;
  revenueTrend: Array<{
    date: string;
    grossSales: string;
    refunds: string;
    exchangeAdditionalPayments: string;
    netRevenue: string;
  }>;
  currentInventory: { retailValue: string; lowStockVariants: number };
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
  variantId?: string;
  variantSku?: string;
  size?: string;
  colour?: string;
  designIdentifier?: string;
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
  variantId?: string | null;
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
  currentStock?: string;
  lowStockThreshold?: string;
  potentialShortage?: string | null;
  suggestedRestockQuantity?: string | null;
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

export type ClothingSellingTrend =
  | "FAST_SELLING"
  | "SLOW_SELLING"
  | "STEADY"
  | "INSUFFICIENT_HISTORY";

export type ClothingRestockingRecommendation = {
  productId: string;
  productName: string;
  productSku: string;
  productTrend: ClothingSellingTrend;
  variantId: string;
  variantSku: string;
  size: string;
  colour: string;
  designIdentifier?: string;
  unit: "piece";
  status:
    | "NO_RESTOCK_NEEDED"
    | "RESTOCK_RECOMMENDED"
    | "INSUFFICIENT_HISTORY"
    | "FORECAST_UNAVAILABLE";
  currentStock: string;
  lowStockThreshold: string;
  lowStockTriggered: boolean;
  forecastStatus: "ok" | "insufficient_history" | "zero_demand" | "unavailable";
  forecastDemand: string | null;
  safetyBuffer: string | null;
  potentialShortage: string | null;
  suggestedRestockQuantity: string | null;
  reason: string;
};

export type ClothingRestockingResponse = {
  data: ClothingRestockingRecommendation[];
  pagination: { page: number; limit: number; totalItems: number; totalPages: number };
  trendRule: string;
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
  shopType: "grocery" | "clothing";
  role: "OWNER" | "STAFF";
};

export type CreateStoreInput = Pick<
  StoreSummary,
  "name" | "address" | "timezone" | "currency" | "shopType"
>;

export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
