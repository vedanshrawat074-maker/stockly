"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { ApiClientError } from "@/lib/api-client";
import { normalizeCreateStoreInput } from "@/lib/store-form";

export function CreateShopForm({
  onCreated,
  buttonLabel = "Create Shop",
}: {
  onCreated: () => void;
  buttonLabel?: string;
}) {
  const { createStore } = useAuth();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [currency, setCurrency] = useState("INR");
  const [shopType, setShopType] = useState<"grocery" | "clothing">("grocery");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createStore(normalizeCreateStoreInput({
        name,
        address,
        timezone,
        currency,
        shopType,
      }));
      onCreated();
    } catch (createError) {
      setError(
        createError instanceof ApiClientError
          ? createError.message
          : "The backend API could not be reached.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      <label className="block text-sm font-medium text-slate-700">
        Shop name
        <input
          className="field mt-1.5"
          required
          minLength={1}
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Address
        <input
          className="field mt-1.5"
          required
          minLength={1}
          maxLength={500}
          autoComplete="street-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Business type
        <select
          className="field mt-1.5"
          required
          value={shopType}
          onChange={(event) => setShopType(event.target.value === "clothing" ? "clothing" : "grocery")}
        >
          <option value="grocery">Grocery Store</option>
          <option value="clothing">Clothing Store</option>
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Time zone
          <input
            className="field mt-1.5"
            required
            maxLength={100}
            placeholder="Asia/Kolkata"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Currency code
          <input
            className="field mt-1.5 uppercase"
            required
            minLength={3}
            maxLength={3}
            pattern="[A-Za-z]{3}"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </label>
      </div>
      <p className="text-xs leading-5 text-slate-500">
        Enter an IANA timezone such as Asia/Kolkata and a three-letter ISO currency code.
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button className="button-primary w-full justify-center" type="submit" disabled={submitting}>
        {submitting ? "Creating shop…" : buttonLabel}
      </button>
    </form>
  );
}
