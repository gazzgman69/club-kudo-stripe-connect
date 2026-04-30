import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Client } from "@/lib/types";

export interface ClientFormValues {
  fullName: string;
  email: string;
  phone: string;
  addressLines: string[];
  postcode: string;
  notes: string;
}

export const emptyClientFormValues: ClientFormValues = {
  fullName: "",
  email: "",
  phone: "",
  addressLines: [],
  postcode: "",
  notes: "",
};

export function clientToFormValues(c: Client): ClientFormValues {
  return {
    fullName: c.fullName,
    email: c.email,
    phone: c.phone ?? "",
    addressLines: c.addressLines ?? [],
    postcode: c.postcode ?? "",
    notes: c.notes ?? "",
  };
}

export function ClientForm({
  initial,
  submitLabel,
  onSubmit,
  submitting,
  errorMessage,
}: {
  initial: ClientFormValues;
  submitLabel: string;
  onSubmit: (values: ClientFormValues) => void;
  submitting: boolean;
  errorMessage: string | null;
}) {
  const [values, setValues] = useState(initial);
  const [addressInput, setAddressInput] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  function addAddressLine() {
    const v = addressInput.trim();
    if (!v) return;
    setValues({ ...values, addressLines: [...values.addressLines, v] });
    setAddressInput("");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          required
          value={values.fullName}
          onChange={(e) => setValues({ ...values, fullName: e.target.value })}
          placeholder="e.g. Rebecca & Mike Thompson"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
            placeholder="couple@example.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            value={values.phone}
            onChange={(e) => setValues({ ...values, phone: e.target.value })}
            placeholder="07…"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Address lines</Label>
        <div className="flex gap-2">
          <Input
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="Add a line, then click Add"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addAddressLine();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addAddressLine}>
            Add
          </Button>
        </div>
        {values.addressLines.length > 0 ? (
          <ul className="text-sm text-gray-700 space-y-1 mt-2">
            {values.addressLines.map((line, idx) => (
              <li key={idx} className="flex justify-between">
                <span>{line}</span>
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-700"
                  onClick={() =>
                    setValues({
                      ...values,
                      addressLines: values.addressLines.filter(
                        (_, i) => i !== idx,
                      ),
                    })
                  }
                  aria-label={`Remove address line ${idx + 1}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="postcode">Postcode</Label>
        <Input
          id="postcode"
          value={values.postcode}
          onChange={(e) => setValues({ ...values, postcode: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <textarea
          id="notes"
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={values.notes}
          onChange={(e) => setValues({ ...values, notes: e.target.value })}
          maxLength={2000}
          placeholder="Internal notes about this client."
        />
      </div>

      {errorMessage ? (
        <p className="text-sm text-red-600">{errorMessage}</p>
      ) : null}

      <div className="flex items-center justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
