import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Supplier } from "@/lib/types";

export interface SupplierFormValues {
  tradingName: string;
  contactEmail: string;
  instrument: string[];
  bio: string;
  vatRegistered: boolean;
  vatRateBps: number;
}

export function supplierToFormValues(s: Supplier): SupplierFormValues {
  return {
    tradingName: s.tradingName,
    contactEmail: s.contactEmail ?? "",
    instrument: s.instrument ?? [],
    bio: s.bio ?? "",
    vatRegistered: s.vatRegistered,
    vatRateBps: s.vatRateBps,
  };
}

export const emptySupplierFormValues: SupplierFormValues = {
  tradingName: "",
  contactEmail: "",
  instrument: [],
  bio: "",
  vatRegistered: false,
  vatRateBps: 0,
};

export function SupplierForm({
  initial,
  submitLabel,
  onSubmit,
  submitting,
  errorMessage,
}: {
  initial: SupplierFormValues;
  submitLabel: string;
  onSubmit: (values: SupplierFormValues) => void | Promise<void>;
  submitting: boolean;
  errorMessage: string | null;
}) {
  const [values, setValues] = useState(initial);
  const [instrumentInput, setInstrumentInput] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  function addInstrument() {
    const v = instrumentInput.trim();
    if (!v) return;
    if (!values.instrument.includes(v)) {
      setValues({ ...values, instrument: [...values.instrument, v] });
    }
    setInstrumentInput("");
  }

  function removeInstrument(i: string) {
    setValues({
      ...values,
      instrument: values.instrument.filter((x) => x !== i),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="tradingName">Trading name</Label>
        <Input
          id="tradingName"
          required
          value={values.tradingName}
          onChange={(e) =>
            setValues({ ...values, tradingName: e.target.value })
          }
          placeholder="e.g. DJ Alex Smith"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="contactEmail">Contact email</Label>
        <Input
          id="contactEmail"
          type="email"
          required
          value={values.contactEmail}
          onChange={(e) =>
            setValues({ ...values, contactEmail: e.target.value })
          }
          placeholder="alex@example.com"
        />
        <p className="text-xs text-gray-500">
          The supplier's onboarding email lands here. Also used as the email
          address on their auto-created user record.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="instrument">Instruments / specialties</Label>
        <div className="flex gap-2">
          <Input
            id="instrument"
            value={instrumentInput}
            onChange={(e) => setInstrumentInput(e.target.value)}
            placeholder="e.g. decks, sax, equipment"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addInstrument();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addInstrument}>
            Add
          </Button>
        </div>
        {values.instrument.length > 0 ? (
          <div className="flex flex-wrap gap-2 mt-2">
            {values.instrument.map((i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded"
              >
                {i}
                <button
                  type="button"
                  className="text-gray-500 hover:text-gray-900"
                  onClick={() => removeInstrument(i)}
                  aria-label={`Remove ${i}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="bio">Bio</Label>
        <textarea
          id="bio"
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={values.bio}
          onChange={(e) => setValues({ ...values, bio: e.target.value })}
          placeholder="Short description shown internally."
          maxLength={2000}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="vatRegistered">VAT registered</Label>
            <Switch
              id="vatRegistered"
              checked={values.vatRegistered}
              onCheckedChange={(v) =>
                // When toggling VAT registration ON, default to the standard
                // UK rate (20%) so the user doesn't have to clear "0" first.
                // When toggling OFF, force the rate back to 0 so a stale
                // value can't sneak through on submit.
                setValues({
                  ...values,
                  vatRegistered: v,
                  vatRateBps: v ? values.vatRateBps || 2000 : 0,
                })
              }
            />
          </div>
          <p className="text-xs text-gray-500">
            Most sole-trader DJs aren't. Equipment hire entities sometimes are.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="vatRatePct">VAT rate (%)</Label>
          <Input
            id="vatRatePct"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.01}
            // Display as percent: stored basis points / 100. 2000 → 20.
            value={values.vatRegistered ? values.vatRateBps / 100 : ""}
            onChange={(e) => {
              const pct = Number.parseFloat(e.target.value);
              setValues({
                ...values,
                vatRateBps: Number.isFinite(pct)
                  ? Math.round(pct * 100)
                  : 0,
              });
            }}
            onFocus={(e) => e.target.select()}
            disabled={!values.vatRegistered}
            placeholder={values.vatRegistered ? "20" : "—"}
          />
          <p className="text-xs text-gray-500">
            Stored against each line at creation, so later rate changes don't
            retroactively rewrite invoiced lines.
          </p>
        </div>
      </div>

      {errorMessage ? (
        <p className="text-sm text-red-600">{errorMessage}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
