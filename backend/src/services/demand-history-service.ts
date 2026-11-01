import { Types } from "mongoose";
import { ProductModel } from "../models/product";
import { SaleModel } from "../models/sale";
import { ApiError } from "../utils/api-error";

export type DemandHistoryQuery = {
  startDate: string;
  endDate: string;
  productId?: string;
  page: number;
  limit: number;
};

type DailyDemand = {
  _id: {
    product: Types.ObjectId;
    date: string;
  };
  unitsSold: Types.Decimal128;
};

function getUtcDates(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const dates: string[] = [];

  for (let timestamp = start.getTime(); timestamp <= end.getTime(); timestamp += 86_400_000) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
  }

  return dates;
}

export async function getDailyDemandHistory(
  storeId: Types.ObjectId,
  query: DemandHistoryQuery,
) {
  const start = new Date(`${query.startDate}T00:00:00.000Z`);
  const endExclusive = new Date(`${query.endDate}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const productFilter: { store: Types.ObjectId; _id?: Types.ObjectId } = { store: storeId };

  if (query.productId) {
    const productId = new Types.ObjectId(query.productId);
    productFilter._id = productId;
  }

  const [products, totalItems] = await Promise.all([
    ProductModel.find(productFilter)
      .select({ _id: 1, name: 1, sku: 1, baseUnit: 1, isActive: 1 })
      .sort({ name: 1, _id: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    ProductModel.countDocuments(productFilter),
  ]);

  if (query.productId && totalItems === 0) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found in this store.");
  }

  const selectedProductIds = products.map((product) => product._id);
  const dailyRows =
    selectedProductIds.length === 0
      ? []
      : await SaleModel.aggregate<DailyDemand>([
          {
            $match: {
              store: storeId,
              status: "completed",
              createdAt: { $gte: start, $lt: endExclusive },
              "lineItems.product": { $in: selectedProductIds },
            },
          },
          { $unwind: "$lineItems" },
          { $match: { "lineItems.product": { $in: selectedProductIds } } },
          {
            $group: {
              _id: {
                product: "$lineItems.product",
                date: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$createdAt",
                    timezone: "UTC",
                  },
                },
              },
              unitsSold: { $sum: "$lineItems.quantity" },
            },
          },
          { $sort: { "_id.date": 1, "_id.product": 1 } },
        ]);

  const dailyByProduct = new Map<string, Map<string, string>>();
  for (const row of dailyRows) {
    const productKey = row._id.product.toHexString();
    const byDate = dailyByProduct.get(productKey) ?? new Map<string, string>();
    byDate.set(row._id.date, row.unitsSold.toString());
    dailyByProduct.set(productKey, byDate);
  }

  const dates = getUtcDates(query.startDate, query.endDate);
  return {
    data: products.map((product) => {
      const byDate = dailyByProduct.get(product._id.toHexString());
      return {
        storeId: storeId.toHexString(),
        productId: product._id.toHexString(),
        productName: product.name,
        sku: product.sku,
        unit: product.baseUnit,
        isActive: product.isActive,
        availability: null,
        availabilityNote:
          "Historical availability cannot be reliably derived because opening stock and stockout/closure intervals are not recorded.",
        dailyDemand: dates.map((date) => ({
          date,
          unitsSold: byDate?.get(date) ?? "0",
        })),
      };
    }),
    period: {
      startDate: query.startDate,
      endDate: query.endDate,
      timezone: "UTC",
      dateBoundary: "Inclusive UTC calendar dates; sale.createdAt determines the demand date.",
    },
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  };
}
