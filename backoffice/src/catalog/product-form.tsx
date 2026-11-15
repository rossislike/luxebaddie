"use client";

import { CATEGORY_SLUGS, type CategorySlug, type Product } from "@luxebaddie/contracts";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { messageOf } from "@/lib/api";
import { Photos } from "./photos";
import { addressFrom, type ProductDraft, productOf } from "./product-draft";
import { VariantRows } from "./variant-rows";

const CATEGORY_NAMES: Record<CategorySlug, string> = { wigs: "Wigs", weaves: "Weaves", lashes: "Lashes" };

/**
 * The form a product is added and edited with. It checks what was typed
 * against the same product rules the API enforces, and says what is wrong in
 * plain words before anything is sent.
 */
export function ProductForm({
  initial,
  isNew,
  saveLabel,
  onSave,
  children,
}: {
  initial: ProductDraft;
  /** A new product's shop address can still be chosen. An existing product keeps its address for good. */
  isNew: boolean;
  saveLabel: string;
  /** Stores the product. A rejection is shown to the owner in the API's own words. */
  onSave: (product: Product) => Promise<void>;
  /** Shown beside the save button, e.g. the button that removes the product. */
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState(initial);
  // Until the owner types an address of their own, it follows the name.
  const [addressTyped, setAddressTyped] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function change(update: (current: ProductDraft) => ProductDraft) {
    setDraft(update);
    setSaved(false);
  }
  const set = <K extends keyof ProductDraft>(field: K, value: ProductDraft[K]) => change((current) => ({ ...current, [field]: value }));

  function changeName(name: string) {
    change((current) => ({ ...current, name, ...(isNew && !addressTyped && { id: addressFrom(name) }) }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = productOf(draft);
    setProblems(checked.problems);
    if (!checked.product) return;

    setSaving(true);
    try {
      await onSave(checked.product);
      setSaved(true);
    } catch (failure) {
      setProblems([messageOf(failure)]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Section title="The product">
        <Field label="Name">
          {(id) => <input id={id} className="field" maxLength={120} value={draft.name} onChange={(event) => changeName(event.target.value)} />}
        </Field>
        <Field
          label="Address in the shop"
          hint={isNew ? "The end of the product page's web address. It cannot be changed later." : "Fixed once a product has been added, so links to it keep working."}
        >
          {(id) => (
            <input
              id={id}
              className="field disabled:bg-sand"
              maxLength={80}
              disabled={!isNew}
              value={draft.id}
              onChange={(event) => {
                setAddressTyped(true);
                set("id", event.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <select id={id} className="field" value={draft.category} onChange={(event) => set("category", event.target.value as CategorySlug)}>
              {CATEGORY_SLUGS.map((slug) => (
                <option key={slug} value={slug}>
                  {CATEGORY_NAMES[slug]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Tagline" hint="One line under the name.">
          {(id) => <input id={id} className="field" maxLength={200} value={draft.tagline} onChange={(event) => set("tagline", event.target.value)} />}
        </Field>
        <Field label="Description">
          {(id) => (
            <textarea id={id} className="field" rows={5} maxLength={4000} value={draft.description} onChange={(event) => set("description", event.target.value)} />
          )}
        </Field>
        <Field label="Highlights" hint="Short selling points, one per line. Up to 12.">
          {(id) => <textarea id={id} className="field" rows={4} value={draft.highlights} onChange={(event) => set("highlights", event.target.value)} />}
        </Field>
      </Section>

      <Section title="Photos">
        <Photos images={draft.images} onChange={(images) => set("images", images)} />
      </Section>

      <Section title="Options and prices">
        <VariantRows draft={draft} change={change} />
      </Section>

      <Section title="In the shop">
        <fieldset>
          <legend className="text-sm">Who can see it</legend>
          <div className="mt-2 space-y-1">
            <Choice name="status" checked={draft.status === "draft"} onChoose={() => set("status", "draft")}>
              Draft <span className="text-cocoa">- only you see it, here</span>
            </Choice>
            <Choice name="status" checked={draft.status === "active"} onChoose={() => set("status", "active")}>
              For sale <span className="text-cocoa">- on the shop for everyone</span>
            </Choice>
          </div>
        </fieldset>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" className="size-5" checked={draft.featured} onChange={(event) => set("featured", event.target.checked)} />
          Feature it on the home page
        </label>
        <Field label="Position" hint="Where it comes in its category. Lower numbers come first; leave gaps (10, 20, 30) so products can be moved between others later.">
          {(id) => <input id={id} className="field w-32" inputMode="numeric" value={draft.position} onChange={(event) => set("position", event.target.value)} />}
        </Field>
      </Section>

      {problems.length > 0 && (
        <div role="alert" className="border border-wine/30 bg-blush/50 px-4 py-3 text-sm text-wine" data-testid="form-problems">
          <p className="font-medium">This product cannot be saved yet:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving..." : saveLabel}
        </button>
        {children}
        <p role="status" className="text-sm text-leaf">
          {saved && (draft.status === "active" ? "Saved. The shop shows the change in a few minutes." : "Saved as a draft. It is not on the shop.")}
        </p>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel p-6">
      <h2 className="font-display text-2xl">{title}</h2>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="max-w-2xl">
      <label htmlFor={id} className="block text-sm">
        {label}
      </label>
      {hint && <p className="text-sm text-cocoa">{hint}</p>}
      <div className="mt-1">{children(id)}</div>
    </div>
  );
}

function Choice({ name, checked, onChoose, children }: { name: string; checked: boolean; onChoose: () => void; children: ReactNode }) {
  return (
    <label className="flex min-h-11 items-center gap-3">
      <input type="radio" className="size-5" name={name} checked={checked} onChange={onChoose} />
      <span>{children}</span>
    </label>
  );
}
