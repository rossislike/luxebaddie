"use client";

import { emptyVariant, MAX_OPTIONS, type ProductDraft, type VariantDraft, withOptionAdded, withOptionRemoved, withOptionRenamed } from "./product-draft";

type Change = (change: (draft: ProductDraft) => ProductDraft) => void;

/**
 * What a shopper chooses between, and what each choice costs. A product with
 * no options has a single row; a wig sold in four lengths has an option called
 * Length and four rows.
 */
export function VariantRows({ draft, change }: { draft: ProductDraft; change: Change }) {
  const changeRow = (rowId: string, patch: Partial<VariantDraft>) =>
    change((current) => ({
      ...current,
      variants: current.variants.map((variant) => (variant.rowId === rowId ? { ...variant, ...patch } : variant)),
    }));
  const hasOptions = draft.optionNames.length > 0;

  return (
    <>
      <fieldset>
        <legend className="text-sm">What shoppers choose between</legend>
        <p className="mt-1 text-sm text-cocoa">
          For example Length, Density or Color. Leave this empty for a product that comes one way only.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {draft.optionNames.map((name, index) => (
            <span key={index} className="flex items-center gap-1">
              <input
                aria-label={`Option ${index + 1} name`}
                className="field w-40"
                maxLength={40}
                value={name}
                onChange={(event) => change((current) => withOptionRenamed(current, index, event.target.value))}
              />
              <button
                type="button"
                className="min-h-11 px-2 text-sm text-wine underline underline-offset-4"
                onClick={() => change((current) => withOptionRemoved(current, index))}
              >
                Remove<span className="sr-only"> option {name}</span>
              </button>
            </span>
          ))}
          {draft.optionNames.length < MAX_OPTIONS && (
            <button type="button" className="btn btn-outline" onClick={() => change(withOptionAdded)}>
              Add an option
            </button>
          )}
        </div>
      </fieldset>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm" data-testid="variant-rows">
          <thead className="text-cocoa">
            <tr>
              {draft.optionNames.map((name, index) => (
                <th key={index} scope="col" className="pr-3 pb-2 font-normal">
                  {name || `Option ${index + 1}`}
                </th>
              ))}
              <th scope="col" className="pr-3 pb-2 font-normal">SKU</th>
              <th scope="col" className="pr-3 pb-2 font-normal">Price ($)</th>
              <th scope="col" className="pr-3 pb-2 font-normal">Was ($), optional</th>
              <th scope="col" className="pr-3 pb-2 font-normal">For sale</th>
              <th scope="col" className="pb-2 font-normal">
                <span className="sr-only">Remove row</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.variants.map((variant, index) => {
              const row = `Row ${index + 1}`;
              return (
                <tr key={variant.rowId} className="align-top">
                  {draft.optionNames.map((name, optionIndex) => (
                    <td key={optionIndex} className="pr-3 pb-3">
                      <input
                        aria-label={`${row} ${name}`}
                        className="field"
                        value={variant.options[name] ?? ""}
                        onChange={(event) => changeRow(variant.rowId, { options: { ...variant.options, [name]: event.target.value } })}
                      />
                    </td>
                  ))}
                  <td className="pr-3 pb-3">
                    <input
                      aria-label={`${row} SKU`}
                      className="field uppercase"
                      maxLength={64}
                      value={variant.sku}
                      onChange={(event) => changeRow(variant.rowId, { sku: event.target.value })}
                    />
                  </td>
                  <td className="pr-3 pb-3">
                    <input
                      aria-label={`${row} price in dollars`}
                      className="field w-28"
                      inputMode="decimal"
                      value={variant.price}
                      onChange={(event) => changeRow(variant.rowId, { price: event.target.value })}
                    />
                  </td>
                  <td className="pr-3 pb-3">
                    <input
                      aria-label={`${row} "was" price in dollars`}
                      className="field w-28"
                      inputMode="decimal"
                      value={variant.compareAt}
                      onChange={(event) => changeRow(variant.rowId, { compareAt: event.target.value })}
                    />
                  </td>
                  <td className="pr-3 pb-3">
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-5"
                        checked={variant.active}
                        onChange={(event) => changeRow(variant.rowId, { active: event.target.checked })}
                      />
                      <span className="sr-only">{row} for sale</span>
                    </label>
                  </td>
                  <td className="pb-3">
                    {draft.variants.length > 1 && (
                      <button
                        type="button"
                        className="min-h-11 text-wine underline underline-offset-4"
                        onClick={() => change((current) => ({ ...current, variants: current.variants.filter((other) => other.rowId !== variant.rowId) }))}
                      >
                        Remove<span className="sr-only"> {row}</span>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasOptions && (
        <button
          type="button"
          className="btn btn-outline mt-2"
          onClick={() => change((current) => ({ ...current, variants: [...current.variants, emptyVariant(current.optionNames)] }))}
        >
          Add a row
        </button>
      )}
      <p className="mt-3 text-sm text-cocoa">
        Untick &quot;For sale&quot; to stop selling one choice, for example a length the vendor has run out of, without removing it.
      </p>
    </>
  );
}
