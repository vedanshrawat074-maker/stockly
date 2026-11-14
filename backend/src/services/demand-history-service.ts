import { Types } from "mongoose";
import { ClothingVariantModel } from "../models/clothing-variant";
import { ProductModel } from "../models/product";
import { SaleModel } from "../models/sale";
import { StoreModel } from "../models/store";
import { ApiError } from "../utils/api-error";

export type DemandHistoryQuery = {
  startDate: string;
  endDate: string;
  productId?: string;
  variantId?: string;
  page: number;
  limit: number;
};

type DailyDemand = {
  _id: {
    product: Types.ObjectId;
    date: string;
    variant?: Types.ObjectId;
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
  const store = await StoreModel.findById(storeId).select({ shopType: 1 }).lean();
  if (!store) throw new ApiError(404, "STORE_NOT_FOUND", "Store was not found.");

  const selectedVariant = query.variantId
    ? await ClothingVariantModel.findOne({
        _id: new Types.ObjectId(query.variantId),
        store: storeId,
      }).select({ product: 1, sku: 1, size: 1, colour: 1, designIdentifier: 1 }).lean()
    : null;
  if (query.variantId && store.shopType !== "clothing") {
    throw new ApiError(403, "SHOP_TYPE_NOT_SUPPORTED", "Variant demand history requires a clothing store.");
  }
  if (query.variantId && !selectedVariant) {
    throw new ApiError(404, "VARIANT_NOT_FOUND", "Clothing variant was not found in this store.");
  }
  if (
    selectedVariant &&
    query.productId &&
    !selectedVariant.product.equals(new Types.ObjectId(query.productId))
  ) {
    throw new ApiError(404, "VARIANT_NOT_FOUND", "Clothing variant was not found in this store.");
  }

  const productFilter: { store: Types.ObjectId; _id?: Types.ObjectId } = { store: storeId };

  if (query.productId) {
    const productId = new Types.ObjectId(query.productId);
    productFilter._id = productId;
  }

  if (selectedVariant) productFilter._id = selectedVariant.product;

  const [products, totalItems] = selectedVariant
    ? await Promise.all([
        ProductModel.find(productFilter)
          .select({ _id: 1, name: 1, sku: 1, baseUnit: 1, isActive: 1 })
          .lean(),
        ProductModel.countDocuments(productFilter),
      ])
    : await Promise.all([
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
  const clothingStore = store.shopType === "clothing";
  const dateRange = { $gte: start, $lt: endExclusive };
  const saleDateMatch = clothingStore
    ? {
        businessType: "clothing",
        $or: [
          { soldAt: dateRange },
          { soldAt: null, createdAt: dateRange },
        ],
      }
    : { createdAt: dateRange };
  const saleDateExpression = clothingStore
    ? { $ifNull: ["$soldAt", "$createdAt"] }
    : "$createdAt";
  const variantMatch = selectedVariant ? { "lineItems.variant": selectedVariant._id } : {};
  const dailyRows =
    selectedProductIds.length === 0
      ? []
      : await SaleModel.aggregate<DailyDemand>([
          {
            $match: {
              store: storeId,
              status: "completed",
              ...saleDateMatch,
              "lineItems.product": { $in: selectedProductIds },
              ...variantMatch,
            },
          },
          { $unwind: "$lineItems" },
          {
            $match: {
              "lineItems.product": { $in: selectedProductIds },
              ...variantMatch,
            },
          },
          {
            $group: {
              _id: {
                product: "$lineItems.product",
                ...(selectedVariant ? { variant: "$lineItems.variant" } : {}),
                date: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: saleDateExpression,
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
    const productKey = row._id.variant
      ? `${row._id.product.toHexString()}:${row._id.variant.toHexString()}`
      : row._id.product.toHexString();
    const byDate = dailyByProduct.get(productKey) ?? new Map<string, string>();
    byDate.set(row._id.date, row.unitsSold.toString());
    dailyByProduct.set(productKey, byDate);
  }

  const dates = getUtcDates(query.startDate, query.endDate);
  return {
    data: products.map((product) => {
      const byDate = dailyByProduct.get(
        selectedVariant
          ? `${product._id.toHexString()}:${selectedVariant._id.toHexString()}`
          : product._id.toHexString(),
      );
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
        ...(selectedVariant
          ? {
              variantId: selectedVariant._id.toHexString(),
              variantSku: selectedVariant.sku,
              size: selectedVariant.size,
              colour: selectedVariant.colour,
              ...(selectedVariant.designIdentifier
                ? { designIdentifier: selectedVariant.designIdentifier }
                : {}),
            }
          : {}),
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
      dateBoundary: clothingStore
        ? "Inclusive UTC calendar dates; sale.soldAt is used with createdAt as a legacy fallback."
        : "Inclusive UTC calendar dates; sale.createdAt determines the demand date.",
    },
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  };
}
