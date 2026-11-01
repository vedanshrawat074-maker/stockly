"use client";

import { ChevronRight, CirclePlus, PackagePlus, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ErrorState, LoadingState, PageHeading, Pagination, SearchField, StatusBadge } from "@/components/dashboard-ui";
import { ApiClientError, stocklyApi } from "@/lib/api-client";
import type { Batch, InventoryRecord, Product } from "@/lib/types";
import { formatAmount, formatDate, formatQuantity } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";

type ProductFormState = {
  name: string;
  sku: string;
  category: string;
  baseUnit: string;
  sellingPrice: string;
  barcode: string;
};

function errorText(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The backend API could not be reached.";
}

export default function InventoryPage() {
  const { currentStore } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchFormOpen, setBatchFormOpen] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const inventoryByProduct = useMemo(
    () => new Map(inventory.map((record) => [record.product, record])),
    [inventory],
  );

  const load = useCallback(async () => {
    try {
      const [productPage, inventoryPage] = await Promise.all([
        stocklyApi.products({ page, limit: 20, search, isActive: true }),
        stocklyApi.inventory(1, 100),
      ]);
      setProducts(productPage.data);
      setTotalPages(productPage.pagination.totalPages);
      setInventory(inventoryPage.data);
      setError(null);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const openDetails = async (product: Product) => {
    setSelected(product);
    setBatchLoading(true);
    setDetailsError(null);
    try {
      const result = await stocklyApi.batches(product._id, 1, 20);
      setBatches(result.data);
    } catch (loadError) {
      setDetailsError(errorText(loadError));
      setBatches([]);
    } finally {
      setBatchLoading(false);
    }
  };

  const startEdit = (product: Product) => {
    setEditing(product);
    setProductFormOpen(true);
  };

  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setActionError(null);
    const form = new FormData(event.currentTarget);
    const input: ProductFormState = {
      name: String(form.get("name") ?? "").trim(),
      sku: String(form.get("sku") ?? "").trim(),
      category: String(form.get("category") ?? "").trim(),
      baseUnit: String(form.get("baseUnit") ?? "").trim(),
      sellingPrice: String(form.get("sellingPrice") ?? "").trim(),
      barcode: String(form.get("barcode") ?? "").trim(),
    };
    try {
      if (editing) {
        await stocklyApi.updateProduct(editing._id, {
          name: input.name,
          sku: input.sku,
          category: input.category,
          baseUnit: input.baseUnit,
          sellingPrice: input.sellingPrice,
          ...(input.barcode ? { barcode: input.barcode } : {}),
        });
        setNotice("Product updated.");
      } else {
        await stocklyApi.createProduct({
          name: input.name,
          sku: input.sku,
          category: input.category,
          baseUnit: input.baseUnit,
          sellingPrice: input.sellingPrice,
          ...(input.barcode ? { barcode: input.barcode } : {}),
        });
        setNotice("Product created.");
      }
      setProductFormOpen(false);
      setEditing(null);
      setLoading(true);
      await load();
    } catch (saveError) {
      setActionError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  };

  const receiveBatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setActionError(null);
    try {
      await stocklyApi.receiveBatch(selected._id, {
        batchNumber: String(form.get("batchNumber") ?? "").trim(),
        quantity: String(form.get("quantity") ?? "").trim(),
        unitCost: String(form.get("unitCost") ?? "").trim(),
        ...(form.get("expiryDate") ? { expiryDate: String(form.get("expiryDate")) } : {}),
      });
      setNotice("Batch received and recorded.");
      setBatchFormOpen(false);
      await openDetails(selected);
      setLoading(true);
      await load();
    } catch (receiveError) {
      setActionError(errorText(receiveError));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (product: Product) => {
    if (!window.confirm(`Deactivate ${product.name}? Referenced stock and sales history will remain.`)) return;
    setActionError(null);
    try {
      await stocklyApi.deactivateProduct(product._id);
      setNotice("Product deactivated.");
      setSelected(null);
      setLoading(true);
      await load();
    } catch (deactivateError) {
      setActionError(errorText(deactivateError));
    }
  };

  return (
    <div className="page-width">
      <PageHeading
        eyebrow="Stock management"
        title="Inventory"
        description="Manage your products, review batches, and receive stock."
        action={<button className="button-primary" onClick={() => { setEditing(null); setProductFormOpen(true); }}><CirclePlus size={16} /> Add product</button>}
      />
      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
      {actionError && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>}
      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <div>
            <p className="text-sm font-semibold">Active products</p>
            <p className="mt-1 text-xs text-slate-500">Stock shown is batch-derived and read-only. Prices use this store’s configured currency.</p>
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
              label="Search products by name, SKU, or barcode"
              placeholder="Search products…"
              value={query}
              onChange={setQuery}
            />
            <button type="submit" className="button-secondary">Search</button>
          </form>
        </div>
        {loading ? <div className="p-4"><LoadingState rows={5} /></div> : error ? <div className="p-4"><ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} /></div> : products.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <PackagePlus size={24} className="mx-auto text-slate-400" />
            <p className="mt-3 text-sm font-semibold text-slate-800">{search ? "No matching products" : "No products yet"}</p>
            <p className="mt-1 text-sm text-slate-500">{search ? "Try another name, SKU, or barcode." : "Create a product to start managing batches and stock."}</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Product</th><th>Category</th><th>Unit</th><th>On hand</th><th>Selling price</th><th>State</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {products.map((product) => {
                    const stock = inventoryByProduct.get(product._id)?.onHandQuantity;
                    return (
                      <tr key={product._id}>
                        <td>
                          <button className="text-left" onClick={() => void openDetails(product)}>
                            <span className="block font-semibold text-slate-800">{product.name}</span>
                            <span className="mt-1 block text-xs text-slate-500">{product.sku}{product.barcode ? ` · ${product.barcode}` : ""}</span>
                          </button>
                        </td>
                        <td>{product.category}</td>
                        <td>{product.baseUnit}</td>
                        <td className="font-semibold">{stock === undefined ? "—" : `${formatQuantity(stock)} ${product.baseUnit}`}</td>
                        <td>{formatAmount(product.sellingPrice, currentStore?.currency ?? "INR")}</td>
                        <td><StatusBadge tone="green">Active</StatusBadge></td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            <button className="button-quiet" onClick={() => startEdit(product)} aria-label={`Edit ${product.name}`}><Pencil size={15} /></button>
                            <button className="button-quiet" onClick={() => void openDetails(product)} aria-label={`View ${product.name} batches`}><ChevronRight size={16} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} onChange={(nextPage) => { setLoading(true); setPage(nextPage); }} />
          </>
        )}
      </section>

      {productFormOpen && (
        <Modal title={editing ? "Edit product" : "Add a product"} onClose={() => { setProductFormOpen(false); setEditing(null); }}>
          <form className="space-y-4" onSubmit={(event) => void saveProduct(event)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Product name" name="name" required defaultValue={editing?.name} />
              <FormField label="SKU" name="sku" required defaultValue={editing?.sku} />
              <FormField label="Category" name="category" required defaultValue={editing?.category} />
              <FormField label="Base unit" name="baseUnit" required placeholder="each, kg, litre…" defaultValue={editing?.baseUnit} />
              <FormField label="Selling price" name="sellingPrice" required inputMode="decimal" defaultValue={editing?.sellingPrice} />
              <FormField label="Barcode (optional)" name="barcode" defaultValue={editing?.barcode} />
            </div>
            {actionError && <p role="alert" className="text-sm text-red-700">{actionError}</p>}
            <p className="text-xs text-slate-500">Enter prices as decimal text. Sale prices are taken from the product on the server.</p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="button-secondary" onClick={() => { setProductFormOpen(false); setEditing(null); }}>Cancel</button>
              <button className="button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create product"}</button>
            </div>
          </form>
        </Modal>
      )}

      {selected && (
        <Modal title={selected.name} subtitle={`${selected.sku} · ${selected.category} · ${selected.baseUnit}`} onClose={() => { setSelected(null); setBatchFormOpen(false); }}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">Batch remaining quantities are the stock source of truth.</p>
            <button className="button-primary" onClick={() => setBatchFormOpen(true)}><PackagePlus size={15} /> Receive batch</button>
          </div>
          {batchFormOpen && (
            <form className="mb-5 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2" onSubmit={(event) => void receiveBatch(event)}>
              <FormField label="Batch number" name="batchNumber" required />
              <FormField label={`Quantity (${selected.baseUnit})`} name="quantity" required inputMode="decimal" />
              <FormField label="Unit cost" name="unitCost" required inputMode="decimal" />
              <FormField label="Expiry date (optional)" name="expiryDate" type="date" />
              {actionError && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{actionError}</p>}
              <div className="flex justify-end gap-2 sm:col-span-2">
                <button type="button" className="button-secondary" onClick={() => setBatchFormOpen(false)}>Cancel</button>
                <button type="submit" className="button-primary" disabled={saving}>{saving ? "Saving…" : "Save batch"}</button>
              </div>
            </form>
          )}
          {actionError && !batchFormOpen && <p role="alert" className="mb-3 text-sm text-red-700">{actionError}</p>}
          {detailsError && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{detailsError}</p>}
          {batchLoading ? <LoadingState rows={3} /> : detailsError ? null : batches.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No batches have been received for this product.</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Batch</th><th>Remaining</th><th>Received</th><th>Expiry</th></tr></thead>
                <tbody>{batches.map((batch) => (
                  <tr key={batch._id}>
                    <td className="font-medium">{batch.batchNumber}</td>
                    <td>{formatQuantity(batch.remainingQuantity)} {selected.baseUnit}</td>
                    <td>{formatDate(batch.receivedDate)}</td>
                    <td>{batch.expiryDate ? formatDate(batch.expiryDate) : <span className="text-slate-400">Not tracked</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button className="button-quiet text-red-700" disabled={saving} onClick={() => void deactivate(selected)}>Deactivate product</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function FormField({ label, name, required, placeholder, type = "text", inputMode, defaultValue }: { label: string; name: string; required?: boolean; placeholder?: string; type?: string; inputMode?: "decimal"; defaultValue?: string }) {
  return <label className="block text-xs font-medium text-slate-700">{label}<input className="field mt-1.5" name={name} type={type} required={required} placeholder={placeholder} inputMode={inputMode} defaultValue={defaultValue} /></label>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div><h2 className="text-lg font-semibold">{title}</h2>{subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}</div>
          <button className="button-quiet" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function Notice({ message, onClose }: { message: string; onClose: () => void }) {
  return <div role="status" className="mb-4 flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><span>{message}</span><button className="button-quiet" aria-label="Dismiss notification" onClick={onClose}><X size={14} /></button></div>;
}