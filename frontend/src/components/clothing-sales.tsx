"use client";

import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ErrorState, LoadingState, PageHeading, Pagination, StatusBadge } from "@/components/dashboard-ui";
import { useAuth } from "@/components/auth-provider";
import { ApiClientError, stocklyApi } from "@/lib/api-client";
import type {
  ClothingExchange,
  ClothingReturn,
  ClothingVariant,
  PaymentMethod,
  Product,
  Sale,
} from "@/lib/types";
import { formatAmount, formatDate, formatQuantity } from "@/lib/utils";

type SaleDraft = { productId: string; variantId: string; quantity: string; unitPrice: string; discountPerUnit: string };
type PendingOperation = { snapshot: string; key: string };
const paymentMethods: PaymentMethod[] = ["cash", "card", "upi", "other"];

function message(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The backend API could not be reached.";
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function emptySaleDraft(): SaleDraft {
  return { productId: "", variantId: "", quantity: "", unitPrice: "", discountPerUnit: "" };
}

export default function ClothingSalesPage() {
  const { currentStore } = useAuth();
  const currency = currentStore?.currency ?? "INR";
  const [products, setProducts] = useState<Product[]>([]);
  const [variantsByProduct, setVariantsByProduct] = useState<Record<string, ClothingVariant[]>>({});
  const [variantsLoading, setVariantsLoading] = useState<Set<string>>(new Set());
  const [sales, setSales] = useState<Sale[]>([]);
  const [returns, setReturns] = useState<ClothingReturn[]>([]);
  const [exchanges, setExchanges] = useState<ClothingExchange[]>([]);
  const [page, setPage] = useState(1);
  const [returnsPage, setReturnsPage] = useState(1);
  const [exchangesPage, setExchangesPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [returnTotalPages, setReturnTotalPages] = useState(1);
  const [exchangeTotalPages, setExchangeTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingOperations, setPendingOperations] = useState<Record<string, PendingOperation>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saleDraft, setSaleDraft] = useState<SaleDraft[]>([emptySaleDraft()]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [returnLineIndex, setReturnLineIndex] = useState("");
  const [returnQuantity, setReturnQuantity] = useState("");
  const [returnCondition, setReturnCondition] = useState<"saleable" | "damaged">("saleable");
  const [returnReason, setReturnReason] = useState("");
  const [refundPaymentMethod, setRefundPaymentMethod] = useState<PaymentMethod>("cash");
  const [exchangeReturnQuantity, setExchangeReturnQuantity] = useState("");
  const [exchangeReturnCondition, setExchangeReturnCondition] = useState<"saleable" | "damaged">("saleable");
  const [exchangeReason, setExchangeReason] = useState("");
  const [replacementProductId, setReplacementProductId] = useState("");
  const [replacementVariantId, setReplacementVariantId] = useState("");
  const [replacementQuantity, setReplacementQuantity] = useState("");
  const [replacementPaymentMethod, setReplacementPaymentMethod] = useState<PaymentMethod>("cash");

  const productById = useMemo(() => new Map(products.map((product) => [product._id, product])), [products]);
  const variants = useMemo(() => Object.values(variantsByProduct).flat(), [variantsByProduct]);
  const variantById = useMemo(() => new Map(variants.map((variant) => [variant._id, variant])), [variants]);
  const selectedReturnLine = selectedSale && returnLineIndex !== ""
    ? selectedSale.lineItems[Number(returnLineIndex)]
    : undefined;
  const returnableQuantity = selectedReturnLine
    ? Math.max(0, Number(selectedReturnLine.quantity) - Number(selectedReturnLine.returnedQuantity ?? "0"))
    : 0;

  const idempotencyKeyFor = (operation: string, input: unknown): string => {
    const snapshot = JSON.stringify(input);
    const pending = pendingOperations[operation];
    if (pending?.snapshot === snapshot) return pending.key;
    const key = newIdempotencyKey();
    setPendingOperations((current) => ({ ...current, [operation]: { snapshot, key } }));
    return key;
  };

  const clearPendingOperation = (operation: string) => {
    setPendingOperations((current) => {
      const remaining = { ...current };
      delete remaining[operation];
      return remaining;
    });
  };

  const load = useCallback(async () => {
    try {
      const [firstProductPage, salesPage, returnPage, exchangePage] = await Promise.all([
        stocklyApi.products({ limit: 100, isActive: true }),
        stocklyApi.clothingSales(page, 20),
        stocklyApi.clothingReturns({ page: returnsPage, limit: 20 }),
        stocklyApi.clothingExchanges({ page: exchangesPage, limit: 20 }),
      ]);
      const remainingProductPages = await Promise.all(
        Array.from({ length: Math.max(0, firstProductPage.pagination.totalPages - 1) }, (_, index) =>
          stocklyApi.products({ page: index + 2, limit: 100, isActive: true }),
        ),
      );
      const clothingProducts = [firstProductPage, ...remainingProductPages]
        .flatMap((result) => result.data)
        .filter((product) =>
        ["Men", "Women", "Kids", "Accessories"].includes(product.category),
      );
      setProducts(clothingProducts);
      setSales(salesPage.data);
      setSelectedSale((current) => current
        ? salesPage.data.find((sale) => sale._id === current._id) ?? current
        : null);
      setReturns(returnPage.data);
      setExchanges(exchangePage.data);
      setTotalPages(salesPage.pagination.totalPages);
      setReturnTotalPages(returnPage.pagination.totalPages);
      setExchangeTotalPages(exchangePage.pagination.totalPages);
      setError(null);
    } catch (loadError) {
      setError(message(loadError));
    } finally {
      setLoading(false);
    }
  }, [exchangesPage, page, returnsPage]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const loadProductVariants = useCallback(async (productId: string, force = false) => {
    if (!productId || (!force && variantsByProduct[productId]) || variantsLoading.has(productId)) return;
    setVariantsLoading((current) => new Set(current).add(productId));
    try {
      const result = await stocklyApi.clothingVariants(productId);
      setVariantsByProduct((current) => ({ ...current, [productId]: result.data }));
    } catch (loadError) {
      setActionError(message(loadError));
    } finally {
      setVariantsLoading((current) => {
        const remaining = new Set(current);
        remaining.delete(productId);
        return remaining;
      });
    }
  }, [variantsByProduct, variantsLoading]);

  const saleTotal = saleDraft.reduce((total, line) => {
    const variant = variantById.get(line.variantId);
    const product = variant ? productById.get(variant.product) : undefined;
    const price = line.unitPrice.trim() ? Number(line.unitPrice) : Number(product?.sellingPrice ?? 0);
    const discount = line.discountPerUnit.trim() ? Number(line.discountPerUnit) : 0;
    const quantity = Number(line.quantity);
    return total + Math.max(0, quantity * (price - discount));
  }, 0);

  const refresh = async () => {
    setLoading(true);
    await load();
  };

  const recordSale = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError(null);
    const items = saleDraft.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity.trim(),
      ...(line.unitPrice.trim() ? { unitPrice: line.unitPrice.trim() } : {}),
      ...(line.discountPerUnit.trim() ? { discountPerUnit: line.discountPerUnit.trim() } : {}),
    }));
    if (items.some((item) =>
      !item.variantId || !/^\d+(?:\.\d+)?$/.test(item.quantity) || Number(item.quantity) <= 0 ||
      (item.unitPrice !== undefined && (!/^\d+(?:\.\d+)?$/.test(item.unitPrice) || Number(item.unitPrice) < 0)) ||
      (item.discountPerUnit !== undefined && (!/^\d+(?:\.\d+)?$/.test(item.discountPerUnit) || Number(item.discountPerUnit) < 0)),
    )) {
      setActionError("Select each variant and enter valid positive quantities, prices, and discounts.");
      return;
    }
    setSaving(true);
    const input = { items, paymentMethod };
    try {
      const result = await stocklyApi.createClothingSale(input, idempotencyKeyFor("sale", input));
      clearPendingOperation("sale");
      const affectedProducts = [...new Set(items
        .map((item) => variantById.get(item.variantId)?.product)
        .filter((productId): productId is string => Boolean(productId)))];
      await Promise.all(affectedProducts.map((productId) => loadProductVariants(productId, true)));
      setNotice(result.meta.idempotentReplay ? "This sale was already recorded." : "Clothing sale recorded.");
      setSaleDraft([emptySaleDraft()]);
      setLoading(true);
      await load();
    } catch (saveError) {
      setActionError(message(saveError));
    } finally {
      setSaving(false);
    }
  };

  const recordReturn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError(null);
    if (!selectedSale || !selectedReturnLine || !returnLineIndex ||
      !/^\d+(?:\.\d+)?$/.test(returnQuantity) ||
      Number(returnQuantity) <= 0 || Number(returnQuantity) > returnableQuantity ||
      !returnReason.trim()) {
      setActionError("Choose an unreturned sale item, enter a valid quantity, and provide a return reason.");
      return;
    }
    setSaving(true);
    try {
      const input = {
        saleId: selectedSale._id,
        items: [{
          saleLineIndex: Number(returnLineIndex),
          quantity: returnQuantity.trim(),
          condition: returnCondition,
          reason: returnReason.trim(),
        }],
        refundPaymentMethod,
      };
      const result = await stocklyApi.createClothingReturn(input, idempotencyKeyFor("return", input));
      clearPendingOperation("return");
      setNotice(`Return recorded. Refund: ${formatAmount(result.data.refundAmount, currency)}.`);
      try {
        const updatedSale = await stocklyApi.clothingSale(selectedSale._id);
        setSelectedSale(updatedSale.data);
      } catch (refreshError) {
        setActionError(`Return recorded, but the sale details could not be refreshed: ${message(refreshError)}`);
      }
      await loadProductVariants(selectedReturnLine.product, true);
      setReturnQuantity("");
      setReturnReason("");
      setLoading(true);
      await load();
    } catch (saveError) {
      setActionError(message(saveError));
    } finally {
      setSaving(false);
    }
  };

  const recordExchange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError(null);
    if (!selectedSale || !selectedReturnLine || !returnLineIndex || !replacementVariantId ||
      !/^\d+(?:\.\d+)?$/.test(exchangeReturnQuantity) ||
      !/^\d+(?:\.\d+)?$/.test(replacementQuantity) ||
      Number(exchangeReturnQuantity) <= 0 || Number(exchangeReturnQuantity) > returnableQuantity ||
      Number(replacementQuantity) <= 0 || !exchangeReason.trim()) {
      setActionError("Choose the original and replacement variants, valid quantities, and a reason.");
      return;
    }
    setSaving(true);
    try {
      const input = {
        saleId: selectedSale._id,
        returnedItems: [{
          saleLineIndex: Number(returnLineIndex),
          quantity: exchangeReturnQuantity.trim(),
          condition: exchangeReturnCondition,
          reason: exchangeReason.trim(),
        }],
        replacementItems: [{ variantId: replacementVariantId, quantity: replacementQuantity.trim() }],
        paymentMethod: replacementPaymentMethod,
        refundPaymentMethod,
      };
      const result = await stocklyApi.createClothingExchange(input, idempotencyKeyFor("exchange", input));
      clearPendingOperation("exchange");
      const balance = Number(result.data.priceDifference);
      setNotice(balance > 0
        ? `Exchange recorded. Additional payment: ${formatAmount(result.data.additionalPaymentAmount, currency)}.`
        : balance < 0
          ? `Exchange recorded. Refund: ${formatAmount(result.data.refundAmount, currency)}.`
          : "Exchange recorded with no price difference.");
      try {
        const updatedSale = await stocklyApi.clothingSale(selectedSale._id);
        setSelectedSale(updatedSale.data);
      } catch (refreshError) {
        setActionError(`Exchange recorded, but the sale details could not be refreshed: ${message(refreshError)}`);
      }
      await Promise.all([
        loadProductVariants(selectedReturnLine.product, true),
        loadProductVariants(variantById.get(replacementVariantId)?.product ?? "", true),
      ]);
      setReturnQuantity("");
      setReplacementQuantity("");
      setExchangeReturnQuantity("");
      setExchangeReason("");
      setLoading(true);
      await load();
    } catch (saveError) {
      setActionError(message(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-width">
      <PageHeading
        eyebrow="Clothing transactions"
        title="Sales, returns & exchanges"
        description="Sell exact size-colour variants, track stock changes, and keep returns and exchanges linked to the original sale."
        action={<button className="button-secondary" onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</button>}
      />
      {notice && <div role="status" className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}
      {actionError && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
      {error ? <ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} /> : (
        <div className="space-y-5">
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,.8fr)]">
            <section className="surface overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold">Recent clothing sales</h2>
                <p className="mt-1 text-xs text-slate-500">Each item records its exact variant and server-calculated total.</p>
              </div>
              {loading ? <div className="p-4"><LoadingState rows={4} /></div> : sales.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-500">No clothing sales recorded yet.</div>
              ) : (
                <>
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Sale</th><th>Items</th><th>Payment</th><th>Total</th><th>Date</th></tr></thead>
                      <tbody>{sales.map((sale) => (
                        <tr key={sale._id}>
                          <td>
                            <span className="block max-w-36 truncate font-mono text-xs font-semibold" title={sale.saleIdentifier}>{sale.saleIdentifier}</span>
                            <button type="button" className="mt-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900 focus-visible:outline-2 focus-visible:outline-emerald-600" onClick={() => { setSelectedSale(sale); setReturnLineIndex(""); setReturnQuantity(""); setExchangeReturnQuantity(""); }}>
                              Return / exchange
                            </button>
                          </td>
                          <td><div className="space-y-1">{sale.lineItems.map((line, index) => (
                            <p key={`${line.variant ?? line.product}-${index}`} className="text-xs text-slate-700">
                              <span className="font-medium">{line.productName ?? "Product name unavailable"}</span>
                              <span className="text-slate-500"> · {line.size ?? "—"} / {line.colour ?? "—"} · × {formatQuantity(line.quantity)}</span>
                            </p>
                          ))}</div></td>
                          <td className="text-xs capitalize text-slate-500">{sale.paymentMethod ?? "—"}</td>
                          <td className="font-semibold">{formatAmount(sale.totalAmount, currency)}</td>
                          <td className="text-xs text-slate-500">{formatDate(sale.soldAt ?? sale.createdAt)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <Pagination page={page} totalPages={totalPages} onChange={(nextPage) => { setLoading(true); setPage(nextPage); }} />
                </>
              )}
            </section>

            <section className="surface p-5">
              <h2 className="text-sm font-semibold">Record a clothing sale</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">Select a size-colour variant. The server verifies stock and records the stock movement.</p>
              <form className="mt-4" onSubmit={(event) => void recordSale(event)}>
                <div className="space-y-3">
                  {saleDraft.map((line, index) => {
                    const selectedVariant = variantById.get(line.variantId);
                    const selectedProduct = selectedVariant ? productById.get(selectedVariant.product) : undefined;
                    return (
                      <div key={index} className="rounded-xl border border-slate-100 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-600">Item {index + 1}</span>
                          {saleDraft.length > 1 && <button type="button" className="button-quiet text-red-600" aria-label={`Remove item ${index + 1}`} onClick={() => setSaleDraft((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button>}
                        </div>
                        <label className="block text-xs font-medium text-slate-700">Product
                          <select className="field mt-1.5" required value={line.productId} onChange={(event) => {
                            const productId = event.target.value;
                            setSaleDraft((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, productId, variantId: "" } : item));
                            void loadProductVariants(productId);
                          }}>
                            <option value="">Select a product</option>
                            {products.map((product) => <option key={product._id} value={product._id}>{product.name} · {product.category}</option>)}
                          </select>
                        </label>
                        <label className="mt-3 block text-xs font-medium text-slate-700">Size and colour
                          <select className="field mt-1.5" required value={line.variantId} disabled={!line.productId || variantsLoading.has(line.productId)} onChange={(event) => setSaleDraft((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, variantId: event.target.value } : item))}>
                            <option value="">{variantsLoading.has(line.productId) ? "Loading variants…" : "Select a variant"}</option>
                            {(variantsByProduct[line.productId] ?? []).filter((variant) =>
                              Number(variant.stockQuantity) > 0 &&
                              !saleDraft.some((other, otherIndex) => otherIndex !== index && other.variantId === variant._id),
                            ).map((variant) => <option key={variant._id} value={variant._id}>{variant.size} / {variant.colour} · {formatQuantity(variant.stockQuantity)} available · {variant.sku}</option>)}
                          </select>
                        </label>
                        {selectedVariant && <p className="mt-1 text-[11px] text-slate-500">SKU {selectedVariant.sku} · configured price {formatAmount(selectedProduct?.sellingPrice ?? "0", currency)}</p>}
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <label className="text-xs font-medium text-slate-700">Quantity
                            <input className="field mt-1.5" inputMode="decimal" required min="0.001" step="any" value={line.quantity} onChange={(event) => setSaleDraft((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} />
                          </label>
                          <label className="text-xs font-medium text-slate-700">Unit price override
                            <input className="field mt-1.5" inputMode="decimal" min="0" step="any" placeholder="Use configured" value={line.unitPrice} onChange={(event) => setSaleDraft((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, unitPrice: event.target.value } : item))} />
                          </label>
                          <label className="col-span-2 text-xs font-medium text-slate-700">Discount per unit
                            <input className="field mt-1.5" inputMode="decimal" min="0" step="any" placeholder="0" value={line.discountPerUnit} onChange={(event) => setSaleDraft((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, discountPerUnit: event.target.value } : item))} />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button type="button" className="button-quiet mt-3" disabled={saleDraft.length >= 100} onClick={() => setSaleDraft((items) => [...items, emptySaleDraft()])}><Plus size={14} /> Add another variant</button>
                <label className="mt-3 block text-xs font-medium text-slate-700">Payment method
                  <select className="field mt-1.5" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                    {paymentMethods.map((method) => <option key={method} value={method}>{method.toUpperCase()}</option>)}
                  </select>
                </label>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-sm font-medium text-slate-600">Estimated total</span>
                  <strong className="text-base text-slate-900">{formatAmount(saleTotal, currency)}</strong>
                </div>
                <button className="button-primary mt-4 w-full" type="submit" disabled={saving || products.length === 0}>{saving ? "Recording sale…" : "Complete sale"}</button>
                {products.length === 0 && !loading && <p className="mt-2 text-center text-xs text-slate-500">Add clothing products and variants before recording a sale.</p>}
              </form>
            </section>
          </div>

          <section className="surface p-5">
            <h2 className="text-sm font-semibold">Returns and exchanges</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">Choose a completed sale, select the original item and record its return or replacement.</p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <label className="block text-xs font-medium text-slate-700">Original sale
                <select className="field mt-1.5" value={selectedSale?._id ?? ""} onChange={(event) => { setSelectedSale(sales.find((sale) => sale._id === event.target.value) ?? null); setReturnLineIndex(""); setReturnQuantity(""); setExchangeReturnQuantity(""); }}>
                  <option value="">Select a sale</option>
                  {sales.map((sale) => <option key={sale._id} value={sale._id}>{sale.saleIdentifier} · {formatDate(sale.soldAt ?? sale.createdAt)} · {formatAmount(sale.totalAmount, currency)}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-700">Original item
                <select className="field mt-1.5" value={returnLineIndex} onChange={(event) => { setReturnLineIndex(event.target.value); setReturnQuantity(""); }}>
                  <option value="">Select an item</option>
                  {selectedSale?.lineItems.map((line, index) => {
                    const remaining = Math.max(0, Number(line.quantity) - Number(line.returnedQuantity ?? "0"));
                    return <option key={`${line.variant ?? line.product}-${index}`} value={index} disabled={remaining <= 0}>{line.productName ?? "Product"} · {line.size ?? "—"} / {line.colour ?? "—"} · {formatQuantity(remaining)} returnable</option>;
                  })}
                </select>
              </label>
            </div>
            {selectedSale && selectedReturnLine && (
              <div className="mt-4 grid gap-5 xl:grid-cols-2">
                <form className="rounded-xl border border-slate-100 p-4" onSubmit={(event) => void recordReturn(event)}>
                  <h3 className="text-sm font-semibold">Process return</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-medium text-slate-700">Quantity (up to {formatQuantity(returnableQuantity)})
                      <input className="field mt-1.5" inputMode="decimal" min="0.001" max={returnableQuantity} step="any" required value={returnQuantity} onChange={(event) => setReturnQuantity(event.target.value)} />
                    </label>
                    <label className="text-xs font-medium text-slate-700">Item condition
                      <select className="field mt-1.5" value={returnCondition} onChange={(event) => setReturnCondition(event.target.value as "saleable" | "damaged")}><option value="saleable">Saleable</option><option value="damaged">Damaged / unsaleable</option></select>
                    </label>
                    <label className="text-xs font-medium text-slate-700">Refund method
                      <select className="field mt-1.5" value={refundPaymentMethod} onChange={(event) => setRefundPaymentMethod(event.target.value as PaymentMethod)}>{paymentMethods.map((method) => <option key={method} value={method}>{method.toUpperCase()}</option>)}</select>
                    </label>
                    <label className="text-xs font-medium text-slate-700">Reason
                      <input className="field mt-1.5" required maxLength={200} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Customer return reason" />
                    </label>
                  </div>
                  <button className="button-secondary mt-4 w-full" type="submit" disabled={saving || returnableQuantity <= 0}>Record return</button>
                </form>
                <form className="rounded-xl border border-slate-100 p-4" onSubmit={(event) => void recordExchange(event)}>
                  <h3 className="text-sm font-semibold">Process exchange</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-medium text-slate-700">Replacement product
                      <select className="field mt-1.5" value={replacementProductId} onChange={(event) => {
                        const productId = event.target.value;
                        setReplacementProductId(productId);
                        setReplacementVariantId("");
                        void loadProductVariants(productId);
                      }}>
                        <option value="">Select product</option>
                        {products.map((product) => <option key={product._id} value={product._id}>{product.name} · {product.category}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-slate-700">Replacement variant
                      <select className="field mt-1.5" required value={replacementVariantId} disabled={!replacementProductId || variantsLoading.has(replacementProductId)} onChange={(event) => setReplacementVariantId(event.target.value)}>
                        <option value="">Select size and colour</option>
                        {(variantsByProduct[replacementProductId] ?? []).filter((variant) => Number(variant.stockQuantity) > 0).map((variant) => <option key={variant._id} value={variant._id}>{variant.size} / {variant.colour} · {formatQuantity(variant.stockQuantity)} available · {variant.sku}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-slate-700">Replacement quantity
                      <input className="field mt-1.5" inputMode="decimal" min="0.001" step="any" required value={replacementQuantity} onChange={(event) => setReplacementQuantity(event.target.value)} />
                    </label>
                    <label className="text-xs font-medium text-slate-700">Returned quantity (up to {formatQuantity(returnableQuantity)})
                      <input className="field mt-1.5" inputMode="decimal" min="0.001" max={returnableQuantity} step="any" required value={exchangeReturnQuantity} onChange={(event) => setExchangeReturnQuantity(event.target.value)} />
                    </label>
                    <label className="text-xs font-medium text-slate-700">Additional payment method
                      <select className="field mt-1.5" value={replacementPaymentMethod} onChange={(event) => setReplacementPaymentMethod(event.target.value as PaymentMethod)}>{paymentMethods.map((method) => <option key={method} value={method}>{method.toUpperCase()}</option>)}</select>
                    </label>
                    <label className="text-xs font-medium text-slate-700">Returned item condition
                      <select className="field mt-1.5" value={exchangeReturnCondition} onChange={(event) => setExchangeReturnCondition(event.target.value as "saleable" | "damaged")}><option value="saleable">Saleable</option><option value="damaged">Damaged / unsaleable</option></select>
                    </label>
                    <label className="col-span-full text-xs font-medium text-slate-700">Exchange reason
                      <input className="field mt-1.5" required maxLength={200} value={exchangeReason} onChange={(event) => setExchangeReason(event.target.value)} placeholder="Customer exchange reason" />
                    </label>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">Any additional payment or refund is calculated by the server.</p>
                  <button className="button-primary mt-4 w-full" type="submit" disabled={saving || returnableQuantity <= 0}>Record exchange</button>
                </form>
              </div>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <TransactionHistory title="Return history" empty="No returns recorded." page={returnsPage} totalPages={returnTotalPages} onChange={(nextPage) => { setLoading(true); setReturnsPage(nextPage); }} rows={returns.map((record) => ({
              key: record._id,
              identifier: record.returnIdentifier,
              sale: saleReference(record.originalSale, sales),
              date: record.returnedAt,
              amount: record.refundAmount,
              badge: record.lineItems.map((line) => `${line.productName} × ${formatQuantity(line.quantity)}`).join(", "),
              currency,
            }))} />
            <TransactionHistory title="Exchange history" empty="No exchanges recorded." page={exchangesPage} totalPages={exchangeTotalPages} onChange={(nextPage) => { setLoading(true); setExchangesPage(nextPage); }} rows={exchanges.map((record) => ({
              key: record._id,
              identifier: record.exchangeIdentifier,
              sale: saleReference(record.originalSale, sales),
              date: record.exchangedAt,
              amount: record.priceDifference,
              badge: record.replacementItems.map((line) => `${line.productName} · ${line.size} / ${line.colour} × ${formatQuantity(line.quantity)}`).join(", "),
              currency,
            }))} />
          </div>
        </div>
      )}
    </div>
  );
}

function saleReference(saleId: string, sales: Sale[]): string {
  return sales.find((sale) => sale._id === saleId)?.saleIdentifier ?? `Sale …${saleId.slice(-6)}`;
}

function TransactionHistory({
  title,
  empty,
  rows,
  page,
  totalPages,
  onChange,
}: {
  title: string;
  empty: string;
  rows: Array<{ key: string; identifier: string; sale: string; date: string; amount: string; badge: string; currency: string }>;
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <section className="surface overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold">{title}</h2></div>
      {rows.length === 0 ? <p className="px-5 py-8 text-sm text-slate-500">{empty}</p> : (
        <div className="divide-y divide-slate-100">
          {rows.map((row) => <div key={row.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-800">{row.badge}</p>
              <p className="mt-1 text-[11px] text-slate-500">{row.identifier} · Sale {row.sale} · {formatDate(row.date)}</p>
            </div>
            <div className="text-right">
              <StatusBadge tone="gray">{formatAmount(row.amount, row.currency)}</StatusBadge>
            </div>
          </div>)}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} onChange={onChange} />
    </section>
  );
}
