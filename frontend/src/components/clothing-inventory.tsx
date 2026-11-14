"use client";

import { CirclePlus, PackagePlus, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeading,
  Pagination,
  SearchField,
  StatusBadge,
} from "@/components/dashboard-ui";
import { useAuth } from "@/components/auth-provider";
import { ApiClientError, stocklyApi } from "@/lib/api-client";
import type { ClothingVariant, Product } from "@/lib/types";
import { formatAmount, formatQuantity } from "@/lib/utils";

type VariantDraft = {
  size: string;
  colour: string;
  designIdentifier: string;
  sku: string;
  stockQuantity: string;
  lowStockThreshold: string;
};

const categories = ["Men", "Women", "Kids", "Accessories"] as const;

function emptyVariant(): VariantDraft {
  return {
    size: "",
    colour: "",
    designIdentifier: "",
    sku: "",
    stockQuantity: "0",
    lowStockThreshold: "0",
  };
}

function errorText(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The backend API could not be reached.";
}

function decimalParts(value: string): { whole: string; fraction: string } | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match || (!match[2] && !match[3])) return null;
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  let scale = fraction.length - exponent;
  if (!Number.isSafeInteger(scale)) return null;
  let digits = `${match[2] || "0"}${fraction}`;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  digits = digits.padStart(scale + 1, "0");
  const splitAt = digits.length - scale;
  const whole = digits.slice(0, splitAt).replace(/^0+(?=\d)/, "");
  const normalizedFraction = digits.slice(splitAt).replace(/0+$/, "");
  return { whole, fraction: normalizedFraction };
}

function isAtOrBelow(value: string, threshold: string): boolean {
  const left = decimalParts(value);
  const right = decimalParts(threshold);
  if (!left || !right) return false;
  if (left.whole.length !== right.whole.length) return left.whole.length < right.whole.length;
  if (left.whole !== right.whole) return left.whole < right.whole;
  const fractionLength = Math.max(left.fraction.length, right.fraction.length);
  return left.fraction.padEnd(fractionLength, "0") <= right.fraction.padEnd(fractionLength, "0");
}

export default function ClothingInventoryPage() {
  const { currentStore } = useAuth();
  const storeId = currentStore?.id;
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [variants, setVariants] = useState<ClothingVariant[]>([]);
  const [variantLoading, setVariantLoading] = useState(false);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [variantFormOpen, setVariantFormOpen] = useState(false);
  const [drafts, setDrafts] = useState<VariantDraft[]>([emptyVariant()]);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    if (!storeId) {
      setLoading(false);
      return;
    }
    try {
      const result = await stocklyApi.products({ page, limit: 20, search, isActive: true });
      setProducts(result.data);
      setTotalPages(result.pagination.totalPages);
      setError(null);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, [page, search, storeId]);

  const loadVariants = useCallback(async (productId: string) => {
    setVariantLoading(true);
    setActionError(null);
    try {
      const result = await stocklyApi.clothingVariants(productId);
      setVariants(result.data);
    } catch (loadError) {
      setActionError(errorText(loadError));
      setVariants([]);
    } finally {
      setVariantLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadProducts);
  }, [loadProducts]);

  const openVariants = async (product: Product) => {
    setSelected(product);
    setVariants([]);
    setVariantFormOpen(false);
    await loadVariants(product._id);
  };

  const createProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setActionError(null);
    const category = categories.find((candidate) => candidate === String(form.get("category") ?? ""));
    if (!category) {
      setActionError("Select a valid clothing category.");
      setSaving(false);
      return;
    }
    const input = {
      name: String(form.get("name") ?? "").trim(),
      sku: String(form.get("sku") ?? "").trim(),
      category,
      sellingPrice: String(form.get("sellingPrice") ?? "").trim(),
      ...(String(form.get("barcode") ?? "").trim()
        ? { barcode: String(form.get("barcode")).trim() }
        : {}),
      variants: drafts.map(({ designIdentifier, ...variant }) => ({
        ...variant,
        ...(designIdentifier.trim() ? { designIdentifier: designIdentifier.trim() } : {}),
      })),
    };

    try {
      await stocklyApi.createClothingProduct(input);
      setProductFormOpen(false);
      setDrafts([emptyVariant()]);
      setNotice("Clothing product and variants created.");
      setLoading(true);
      await loadProducts();
    } catch (saveError) {
      setActionError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  };

  const createVariant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setActionError(null);
    const designIdentifier = String(form.get("designIdentifier") ?? "").trim();
    try {
      await stocklyApi.createClothingVariant(selected._id, {
        size: String(form.get("size") ?? "").trim(),
        colour: String(form.get("colour") ?? "").trim(),
        sku: String(form.get("sku") ?? "").trim(),
        stockQuantity: String(form.get("stockQuantity") ?? "0").trim(),
        lowStockThreshold: String(form.get("lowStockThreshold") ?? "0").trim(),
        ...(designIdentifier ? { designIdentifier } : {}),
      });
      setVariantFormOpen(false);
      setNotice("Variant created.");
      await loadVariants(selected._id);
    } catch (saveError) {
      setActionError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  };

  const adjustStock = async (event: FormEvent<HTMLFormElement>, variant: ClothingVariant) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const quantity = String(form.get("quantity") ?? "").trim();
    const direction = String(form.get("direction") ?? "add");
    setSaving(true);
    setActionError(null);
    try {
      await stocklyApi.adjustClothingVariantStock(variant._id, {
        quantityDelta: direction === "remove" ? `-${quantity}` : quantity,
        reason: String(form.get("reason") ?? "").trim(),
      });
      setNotice("Variant stock adjusted.");
      if (selected) await loadVariants(selected._id);
    } catch (saveError) {
      setActionError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  };

  const updateThreshold = async (event: FormEvent<HTMLFormElement>, variant: ClothingVariant) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setActionError(null);
    try {
      await stocklyApi.updateClothingVariant(variant._id, {
        lowStockThreshold: String(form.get("lowStockThreshold") ?? "").trim(),
      });
      setNotice("Low-stock threshold updated.");
      if (selected) await loadVariants(selected._id);
    } catch (saveError) {
      setActionError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-width">
      <PageHeading
        eyebrow="Clothing stock management"
        title="Inventory"
        description="Manage clothing products and track stock independently for each size and colour."
        action={
          <button
            className="button-primary"
            onClick={() => {
              setDrafts([emptyVariant()]);
              setActionError(null);
              setProductFormOpen(true);
            }}
          >
            <CirclePlus size={16} /> Add clothing product
          </button>
        }
      />
      {notice && (
        <div role="status" className="mb-4 flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span>{notice}</span>
          <button className="button-quiet" onClick={() => setNotice(null)} aria-label="Dismiss notification">
            <X size={14} />
          </button>
        </div>
      )}
      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <div>
            <p className="text-sm font-semibold">Active clothing products</p>
            <p className="mt-1 text-xs text-slate-500">Variant stock is tracked separately for each size and colour.</p>
          </div>
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              setLoading(true);
              setPage(1);
              setSearch(query.trim());
            }}
          >
            <SearchField
              className="w-full flex-1 sm:w-64"
              label="Search clothing products"
              placeholder="Search products..."
              value={query}
              onChange={setQuery}
            />
            <button type="submit" className="button-secondary">Search</button>
          </form>
        </div>
        {loading ? (
          <div className="p-4"><LoadingState rows={5} /></div>
        ) : error ? (
          <div className="p-4"><ErrorState message={error} onRetry={() => { setLoading(true); void loadProducts(); }} /></div>
        ) : products.length === 0 ? (
          <EmptyState
            title={search ? "No matching products" : "No clothing products yet"}
            message={search ? "Try another name, SKU, or barcode." : "Create a clothing product and add its size-colour variants."}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Product</th><th>Category</th><th>Selling price</th><th>State</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product._id}>
                      <td>
                        <span className="block font-semibold text-slate-800">{product.name}</span>
                        <span className="mt-1 block text-xs text-slate-500">{product.sku}</span>
                      </td>
                      <td>{product.category}</td>
                      <td>{formatAmount(product.sellingPrice, currentStore?.currency ?? "INR")}</td>
                      <td><StatusBadge tone="green">Active</StatusBadge></td>
                      <td className="text-right">
                        <button className="button-secondary" onClick={() => void openVariants(product)}>
                          Manage variants
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} onChange={(nextPage) => { setLoading(true); setPage(nextPage); }} />
          </>
        )}
      </section>

      {productFormOpen && (
        <Dialog title="Add a clothing product" onClose={() => setProductFormOpen(false)}>
          <form className="space-y-5" onSubmit={(event) => void createProduct(event)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Product name" name="name" required />
              <Field label="Product SKU" name="sku" required />
              <label className="block text-xs font-medium text-slate-700">
                Category
                <select className="field mt-1.5" name="category" required defaultValue="Men">
                  {categories.map((category) => <option key={category}>{category}</option>)}
                </select>
              </label>
              <Field label="Selling price" name="sellingPrice" required inputMode="decimal" />
              <Field label="Barcode (optional)" name="barcode" />
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Size-colour variants</h3>
                  <p className="mt-1 text-xs text-slate-500">Each variant has its own SKU, stock quantity, and low-stock threshold.</p>
                </div>
                <button type="button" className="button-secondary" onClick={() => setDrafts((value) => [...value, emptyVariant()])}>
                  <CirclePlus size={14} /> Add row
                </button>
              </div>
              <div className="space-y-3">
                {drafts.map((variant, index) => (
                  <div key={index} className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
                    <DraftField label="Size" value={variant.size} onChange={(value) => updateDraft(index, "size", value, setDrafts)} required />
                    <DraftField label="Colour" value={variant.colour} onChange={(value) => updateDraft(index, "colour", value, setDrafts)} required />
                    <DraftField label="Variant SKU" value={variant.sku} onChange={(value) => updateDraft(index, "sku", value, setDrafts)} required />
                    <DraftField label="Design/style (optional)" value={variant.designIdentifier} onChange={(value) => updateDraft(index, "designIdentifier", value, setDrafts)} />
                    <DraftField label="Initial stock" value={variant.stockQuantity} onChange={(value) => updateDraft(index, "stockQuantity", value, setDrafts)} inputMode="decimal" required />
                    <DraftField label="Low-stock threshold" value={variant.lowStockThreshold} onChange={(value) => updateDraft(index, "lowStockThreshold", value, setDrafts)} inputMode="decimal" required />
                    {drafts.length > 1 && (
                      <button
                        type="button"
                        className="button-quiet justify-self-start text-red-700 sm:col-span-2"
                        onClick={() => setDrafts((value) => value.filter((_, currentIndex) => currentIndex !== index))}
                      >
                        Remove variant
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {actionError && <p role="alert" className="text-sm text-red-700">{actionError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="button-secondary" onClick={() => setProductFormOpen(false)}>Cancel</button>
              <button type="submit" className="button-primary" disabled={saving}>{saving ? "Saving..." : "Create product"}</button>
            </div>
          </form>
        </Dialog>
      )}

      {selected && (
        <Dialog
          title={selected.name}
          subtitle={`${selected.sku} · ${selected.category} · price ${formatAmount(selected.sellingPrice, currentStore?.currency ?? "INR")}`}
          onClose={() => { setSelected(null); setVariantFormOpen(false); setActionError(null); }}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Stock and thresholds are maintained per variant.</p>
            <button className="button-primary" onClick={() => { setActionError(null); setVariantFormOpen((open) => !open); }}>
              <PackagePlus size={15} /> Add variant
            </button>
          </div>
          {variantFormOpen && (
            <form className="mb-5 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2" onSubmit={(event) => void createVariant(event)}>
              <Field label="Size" name="size" required />
              <Field label="Colour" name="colour" required />
              <Field label="Variant SKU" name="sku" required />
              <Field label="Design/style (optional)" name="designIdentifier" />
              <Field label="Initial stock" name="stockQuantity" inputMode="decimal" defaultValue="0" required />
              <Field label="Low-stock threshold" name="lowStockThreshold" inputMode="decimal" defaultValue="0" required />
              <div className="flex justify-end gap-2 sm:col-span-2">
                <button type="button" className="button-secondary" onClick={() => setVariantFormOpen(false)}>Cancel</button>
                <button type="submit" className="button-primary" disabled={saving}>{saving ? "Saving..." : "Save variant"}</button>
              </div>
            </form>
          )}
          {actionError && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
          {variantLoading ? <LoadingState rows={3} /> : variants.length === 0 ? (
            <EmptyState title="No variants yet" message="Add size-colour variants to start tracking clothing stock." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Size / colour</th><th>Variant SKU</th><th>Stock</th><th>Threshold</th><th>Actions</th></tr></thead>
                <tbody>
                  {variants.map((variant) => {
                    const threshold = decimalParts(variant.lowStockThreshold);
                    const low = !!threshold &&
                      (threshold.whole !== "0" || threshold.fraction !== "") &&
                      isAtOrBelow(variant.stockQuantity, variant.lowStockThreshold);
                    return (
                      <tr key={variant._id}>
                        <td>
                          <span className="block font-medium">{variant.size} · <span className="capitalize">{variant.colour}</span></span>
                          {variant.designIdentifier && <span className="mt-1 block text-xs text-slate-500">{variant.designIdentifier}</span>}
                          {low && <span className="mt-1 inline-block"><StatusBadge tone="yellow">Low stock</StatusBadge></span>}
                        </td>
                        <td>{variant.sku}</td>
                        <td className="font-semibold">{formatQuantity(variant.stockQuantity)} pcs</td>
                        <td>{formatQuantity(variant.lowStockThreshold)} pcs</td>
                        <td>
                          <details className="group">
                            <summary className="cursor-pointer text-xs font-semibold text-emerald-700 hover:text-emerald-800">Adjust stock</summary>
                            <form className="mt-2 min-w-56 space-y-2 rounded-lg border border-slate-200 bg-white p-3" onSubmit={(event) => void adjustStock(event, variant)}>
                              <label className="block text-xs font-medium text-slate-700">
                                Change
                                <select className="field mt-1" name="direction" defaultValue="add">
                                  <option value="add">Add stock</option>
                                  <option value="remove">Remove stock</option>
                                </select>
                              </label>
                              <Field label="Quantity" name="quantity" inputMode="decimal" required />
                              <Field label="Reason" name="reason" required />
                              <button type="submit" className="button-primary w-full" disabled={saving}>{saving ? "Saving..." : "Apply adjustment"}</button>
                            </form>
                          </details>
                          <details className="group mt-2">
                            <summary className="cursor-pointer text-xs font-semibold text-slate-600 hover:text-slate-800">Edit threshold</summary>
                            <form className="mt-2 min-w-56 space-y-2 rounded-lg border border-slate-200 bg-white p-3" onSubmit={(event) => void updateThreshold(event, variant)}>
                              <Field label="Low-stock threshold" name="lowStockThreshold" inputMode="decimal" defaultValue={variant.lowStockThreshold} required />
                              <button type="submit" className="button-secondary w-full" disabled={saving}>{saving ? "Saving..." : "Save threshold"}</button>
                            </form>
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

function updateDraft(
  index: number,
  key: keyof VariantDraft,
  value: string,
  setter: (update: (drafts: VariantDraft[]) => VariantDraft[]) => void,
) {
  setter((current) => current.map((draft, currentIndex) =>
    currentIndex === index ? { ...draft, [key]: value } : draft,
  ));
}

function Field({
  label,
  name,
  required,
  inputMode,
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  inputMode?: "decimal";
  defaultValue?: string;
}) {
  return (
    <label className="block text-xs font-medium text-slate-700">
      {label}
      <input className="field mt-1.5" name={name} required={required} inputMode={inputMode} defaultValue={defaultValue} />
    </label>
  );
}

function DraftField({
  label,
  value,
  onChange,
  required,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  inputMode?: "decimal";
}) {
  return (
    <label className="block text-xs font-medium text-slate-700">
      {label}
      <input className="field mt-1.5" value={value} onChange={(event) => onChange(event.target.value)} required={required} inputMode={inputMode} />
    </label>
  );
}

function Dialog({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button className="button-quiet" onClick={onClose} aria-label="Close dialog"><X size={17} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}
