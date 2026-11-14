import { Types } from "mongoose";
import { ClothingExchangeModel } from "../models/clothing-exchange";
import { ClothingReturnModel } from "../models/clothing-return";
import { ClothingVariantModel } from "../models/clothing-variant";
import { ProductModel } from "../models/product";
import { SaleModel } from "../models/sale";
import { StoreModel } from "../models/store";
import { ApiError } from "../utils/api-error";
import {
  addDecimals,
  compareDecimals,
  subtractDecimals,
} from "../utils/decimal-arithmetic";
import type { ClothingAnalyticsQuery } from "../validators/clothing-analytics-validator";
import { clothingCategories } from "../validators/clothing-validator";

type LineGroup = {
  _id: {
    product?: Types.ObjectId;
    productName?: string;
    size?: string;
    colour?: string;
    exchange?: Types.ObjectId | null;
  };
  units: Types.Decimal128;
  revenue: Types.Decimal128;
};

type SummaryGroup = {
  _id: null;
  revenue?: Types.Decimal128;
  transactions?: number;
  additionalPayments?: Types.Decimal128;
  refunds?: Types.Decimal128;
  replacementValue?: Types.Decimal128;
};

type DailyGroup = {
  _id: string;
  grossSales?: Types.Decimal128;
  additionalPayments?: Types.Decimal128;
  refunds?: Types.Decimal128;
  transactions?: number;
};

type RankAccumulator = {
  name: string;
  grossUnits: Types.Decimal128;
  returnedUnits: Types.Decimal128;
  replacementUnits: Types.Decimal128;
  grossRevenue: Types.Decimal128;
  returnedRevenue: Types.Decimal128;
  replacementRevenue: Types.Decimal128;
};

function zero(): Types.Decimal128 {
  return Types.Decimal128.fromString("0");
}

function decimalString(value: Types.Decimal128 | string | number | undefined): string {
  return value === undefined ? "0" : String(value);
}

function total(values: Array<Types.Decimal128 | string | number | undefined>): Types.Decimal128 {
  return values.reduce<Types.Decimal128>(
    (sum, value) => addDecimals(sum, decimalString(value)),
    zero(),
  );
}

function addRank(
  target: Map<string, RankAccumulator>,
  key: string | undefined,
  name: string | undefined,
  row: LineGroup,
  kind: "sale" | "return" | "replacement",
): void {
  if (!key) return;
  const entry = target.get(key) ?? {
    name: name?.trim() || "Unspecified",
    grossUnits: zero(),
    returnedUnits: zero(),
    replacementUnits: zero(),
    grossRevenue: zero(),
    returnedRevenue: zero(),
    replacementRevenue: zero(),
  };

  if (kind === "sale") {
    entry.grossUnits = addDecimals(entry.grossUnits, row.units);
    entry.grossRevenue = addDecimals(entry.grossRevenue, row.revenue);
  } else if (kind === "return") {
    entry.returnedUnits = addDecimals(entry.returnedUnits, row.units);
    entry.returnedRevenue = addDecimals(entry.returnedRevenue, row.revenue);
  } else {
    entry.replacementUnits = addDecimals(entry.replacementUnits, row.units);
    entry.replacementRevenue = addDecimals(entry.replacementRevenue, row.revenue);
  }
  target.set(key, entry);
}

function rankRows(
  sales: LineGroup[],
  returns: LineGroup[],
  replacements: LineGroup[],
  dimension: "product" | "size" | "colour",
) {
  const grouped = new Map<string, RankAccumulator>();
  const addRows = (rows: LineGroup[], kind: "sale" | "return" | "replacement") => {
    for (const row of rows) {
      const key = dimension === "product"
        ? row._id.product?.toHexString()
        : dimension === "size"
          ? row._id.size
          : row._id.colour;
      const name = dimension === "product"
        ? row._id.productName
        : dimension === "size"
          ? row._id.size
          : row._id.colour;
      addRank(grouped, key, name, row, kind);
    }
  };
  addRows(sales, "sale");
  addRows(returns, "return");
  addRows(replacements, "replacement");

  return [...grouped.values()]
    .map((row) => ({
      name: row.name,
      unitsSold: subtractDecimals(
        addDecimals(row.grossUnits, row.replacementUnits),
        row.returnedUnits,
      ).toString(),
      netRevenue: subtractDecimals(
        addDecimals(row.grossRevenue, row.replacementRevenue),
        row.returnedRevenue,
      ).toString(),
    }))
    .filter((row) => compareDecimals(row.unitsSold, "0") > 0)
    .sort((left, right) => {
      const unitsComparison = compareDecimals(right.unitsSold, left.unitsSold);
      return unitsComparison || compareDecimals(right.netRevenue, left.netRevenue);
    })
    .slice(0, 5);
}

function groupedLinePipeline(
  match: Record<string, unknown>,
  source: "sale" | "return" | "exchange",
) {
  const collection = source === "sale" ? "$lineItems" : source === "return" ? "$lineItems" : "$replacementItems";
  const product = source === "sale" ? "$lineItems.product" : source === "return" ? "$lineItems.product" : "$replacementItems.product";
  const productName = source === "sale" ? "$lineItems.productName" : source === "return" ? "$lineItems.productName" : "$replacementItems.productName";
  const size = source === "sale" ? "$lineItems.size" : source === "return" ? "$lineItems.size" : "$replacementItems.size";
  const colour = source === "sale" ? "$lineItems.colour" : source === "return" ? "$lineItems.colour" : "$replacementItems.colour";
  const quantity = source === "sale" ? "$lineItems.quantity" : source === "return" ? "$lineItems.quantity" : "$replacementItems.quantity";
  const value = source === "sale" ? "$lineItems.lineTotal" : source === "return" ? "$lineItems.lineValue" : "$replacementItems.lineTotal";

  return [
    { $match: match },
    { $unwind: collection },
    {
      $group: {
        _id: {
          product,
          productName,
          size,
          colour,
          ...(source === "return" ? { exchange: "$exchange" } : {}),
        },
        units: { $sum: quantity },
        revenue: { $sum: value },
      },
    },
  ];
}

function buildTrend(
  startDate: string,
  endDate: string,
  sales: DailyGroup[],
  returns: DailyGroup[],
  exchanges: DailyGroup[],
) {
  const daily = new Map<string, { gross: Types.Decimal128; refunds: Types.Decimal128; additions: Types.Decimal128 }>();
  const entry = (date: string) => {
    const current = daily.get(date) ?? { gross: zero(), refunds: zero(), additions: zero() };
    daily.set(date, current);
    return current;
  };
  for (const row of sales) entry(row._id).gross = addDecimals(entry(row._id).gross, decimalString(row.grossSales));
  for (const row of returns) entry(row._id).refunds = addDecimals(entry(row._id).refunds, decimalString(row.refunds));
  for (const row of exchanges) {
    entry(row._id).refunds = addDecimals(entry(row._id).refunds, decimalString(row.refunds));
    entry(row._id).additions = addDecimals(entry(row._id).additions, decimalString(row.additionalPayments));
  }

  const points = [];
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  for (let timestamp = start; timestamp <= end; timestamp += 86_400_000) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    const values = entry(date);
    points.push({
      date,
      grossSales: values.gross.toString(),
      refunds: values.refunds.toString(),
      exchangeAdditionalPayments: values.additions.toString(),
      netRevenue: subtractDecimals(
        addDecimals(values.gross, values.additions),
        values.refunds,
      ).toString(),
    });
  }
  return points;
}

export async function getClothingAnalytics(
  storeId: Types.ObjectId,
  query: ClothingAnalyticsQuery,
) {
  const store = await StoreModel.findById(storeId).select({ shopType: 1, currency: 1 }).lean();
  if (!store) throw new ApiError(404, "STORE_NOT_FOUND", "Store was not found.");
  if (store.shopType !== "clothing") {
    throw new ApiError(403, "SHOP_TYPE_NOT_SUPPORTED", "Clothing analytics require a clothing store.");
  }

  const start = new Date(`${query.startDate}T00:00:00.000Z`);
  const endExclusive = new Date(`${query.endDate}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const range = { $gte: start, $lt: endExclusive };
  const salesMatch = {
    store: storeId,
    businessType: "clothing",
    status: "completed",
    $or: [
      { soldAt: range },
      { soldAt: { $exists: false }, createdAt: range },
    ],
  };
  const returnsMatch = { store: storeId, returnedAt: range };
  const exchangesMatch = { store: storeId, exchangedAt: range };
  const dateExpression = { $ifNull: ["$soldAt", "$createdAt"] };

  const [
    salesSummaryRows,
    salesLineRows,
    allReturnRows,
    directReturnSummaryRows,
    exchangeSummaryRows,
    replacementRows,
    salesTrendRows,
    returnsTrendRows,
    exchangeTrendRows,
    inventoryRows,
    lowStockRows,
  ] = await Promise.all([
    SaleModel.aggregate<SummaryGroup>([
      { $match: salesMatch },
      { $group: { _id: null, revenue: { $sum: "$totalAmount" }, transactions: { $sum: 1 } } },
    ]),
    SaleModel.aggregate<LineGroup>(groupedLinePipeline(salesMatch, "sale")),
    ClothingReturnModel.aggregate<LineGroup>(groupedLinePipeline(returnsMatch, "return")),
    ClothingReturnModel.aggregate<SummaryGroup>([
      { $match: { ...returnsMatch, exchange: { $exists: false } } },
      {
        $group: {
          _id: null,
          refunds: { $sum: "$refundAmount" },
          transactions: { $sum: 1 },
        },
      },
    ]),
    ClothingExchangeModel.aggregate<SummaryGroup>([
      { $match: exchangesMatch },
      {
        $group: {
          _id: null,
          transactions: { $sum: 1 },
          additionalPayments: { $sum: "$additionalPaymentAmount" },
          refunds: { $sum: "$refundAmount" },
          replacementValue: { $sum: "$replacementValue" },
        },
      },
    ]),
    ClothingExchangeModel.aggregate<LineGroup>(groupedLinePipeline(exchangesMatch, "exchange")),
    SaleModel.aggregate<DailyGroup>([
      { $match: salesMatch },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: dateExpression, timezone: "UTC" } },
          grossSales: { $sum: "$totalAmount" },
          transactions: { $sum: 1 },
        },
      },
    ]),
    ClothingReturnModel.aggregate<DailyGroup>([
      { $match: { ...returnsMatch, exchange: { $exists: false } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$returnedAt", timezone: "UTC" } },
          refunds: { $sum: "$refundAmount" },
        },
      },
    ]),
    ClothingExchangeModel.aggregate<DailyGroup>([
      { $match: exchangesMatch },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$exchangedAt", timezone: "UTC" } },
          additionalPayments: { $sum: "$additionalPaymentAmount" },
          refunds: { $sum: "$refundAmount" },
        },
      },
    ]),
    ClothingVariantModel.aggregate<{ _id: null; valuation: Types.Decimal128 }>([
      { $match: { store: storeId } },
      {
        $lookup: {
          from: ProductModel.collection.name,
          localField: "product",
          foreignField: "_id",
          as: "productRecord",
        },
      },
      { $unwind: "$productRecord" },
      { $match: { "productRecord.store": storeId } },
      {
        $group: {
          _id: null,
          valuation: {
            $sum: { $multiply: ["$stockQuantity", "$productRecord.sellingPrice"] },
          },
        },
      },
    ]),
    ClothingVariantModel.aggregate<{ count: number }>([
      { $match: { store: storeId } },
      {
        $lookup: {
          from: ProductModel.collection.name,
          localField: "product",
          foreignField: "_id",
          as: "productRecord",
        },
      },
      { $unwind: "$productRecord" },
      {
        $match: {
          "productRecord.store": storeId,
          "productRecord.isActive": true,
          "productRecord.category": { $in: clothingCategories },
          $expr: {
            $and: [
              { $gt: ["$lowStockThreshold", Types.Decimal128.fromString("0")] },
              { $lte: ["$stockQuantity", "$lowStockThreshold"] },
            ],
          },
        },
      },
      { $count: "count" },
    ]),
  ]);

  const grossSales = salesSummaryRows[0]?.revenue ?? zero();
  const saleTransactions = salesSummaryRows[0]?.transactions ?? 0;
  const directRefunds = directReturnSummaryRows[0]?.refunds ?? zero();
  const exchangeAdditionalPayments = exchangeSummaryRows[0]?.additionalPayments ?? zero();
  const exchangeRefunds = exchangeSummaryRows[0]?.refunds ?? zero();
  const refunds = addDecimals(directRefunds, exchangeRefunds);
  const netRevenue = subtractDecimals(addDecimals(grossSales, exchangeAdditionalPayments), refunds);
  const grossUnitsSold = total(salesLineRows.map((row) => row.units));
  const returnedUnits = total(allReturnRows.map((row) => row.units));
  const exchangeReplacementUnits = total(replacementRows.map((row) => row.units));
  const directReturnedUnits = total(
    allReturnRows.filter((row) => !row._id.exchange).map((row) => row.units),
  );
  const exchangeReturnedUnits = total(
    allReturnRows.filter((row) => Boolean(row._id.exchange)).map((row) => row.units),
  );
  const netUnitsSold = subtractDecimals(
    addDecimals(grossUnitsSold, exchangeReplacementUnits),
    returnedUnits,
  );

  return {
    currency: store.currency,
    period: {
      startDate: query.startDate,
      endDate: query.endDate,
      timezone: "UTC",
      dateBoundary: "Inclusive UTC calendar dates; sales use soldAt (or createdAt when absent), returns use returnedAt, and exchanges use exchangedAt.",
    },
    revenue: {
      grossSales: grossSales.toString(),
      refunds: refunds.toString(),
      directReturnRefunds: directRefunds.toString(),
      exchangeAdditionalPayments: exchangeAdditionalPayments.toString(),
      exchangeRefunds: exchangeRefunds.toString(),
      netRevenue: netRevenue.toString(),
    },
    units: {
      grossUnitsSold: grossUnitsSold.toString(),
      returnedUnits: returnedUnits.toString(),
      exchangeReplacementUnits: exchangeReplacementUnits.toString(),
      netUnitsSold: netUnitsSold.toString(),
    },
    transactions: {
      sales: saleTransactions,
      returns: directReturnSummaryRows[0]?.transactions ?? 0,
      exchanges: exchangeSummaryRows[0]?.transactions ?? 0,
    },
    returns: {
      transactions: directReturnSummaryRows[0]?.transactions ?? 0,
      unitsReturned: directReturnedUnits.toString(),
      refundAmount: directRefunds.toString(),
    },
    exchanges: {
      transactions: exchangeSummaryRows[0]?.transactions ?? 0,
      unitsReturned: exchangeReturnedUnits.toString(),
      replacementUnits: exchangeReplacementUnits.toString(),
      replacementValue: decimalString(exchangeSummaryRows[0]?.replacementValue),
      additionalPayments: exchangeAdditionalPayments.toString(),
      refunds: exchangeRefunds.toString(),
    },
    bestSellingProducts: rankRows(salesLineRows, allReturnRows, replacementRows, "product"),
    bestSellingSizes: rankRows(salesLineRows, allReturnRows, replacementRows, "size")
      .map(({ name, unitsSold }) => ({ size: name, unitsSold })),
    bestSellingColours: rankRows(salesLineRows, allReturnRows, replacementRows, "colour")
      .map(({ name, unitsSold }) => ({ colour: name, unitsSold })),
    revenueTrend: buildTrend(
      query.startDate,
      query.endDate,
      salesTrendRows,
      returnsTrendRows,
      exchangeTrendRows,
    ),
    currentInventory: {
      retailValue: (inventoryRows[0]?.valuation ?? zero()).toString(),
      lowStockVariants: lowStockRows[0]?.count ?? 0,
    },
  };
}
