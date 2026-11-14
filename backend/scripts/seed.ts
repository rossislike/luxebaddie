/**
 * Loads the catalog in scripts/seed-data.ts into a stage through the admin API.
 * Safe to re-run: products are created or replaced by id.
 *
 *   pnpm seed:dev
 */
import { productSchema } from "@luxebaddie/contracts";
import { createAdminFetch, getStackOutputs, stageFromArgs } from "./lib/aws";
import { seedProducts } from "./seed-data";

const stage = stageFromArgs();
const { ApiUrl } = await getStackOutputs(stage);
const adminFetch = await createAdminFetch();

for (const raw of seedProducts) {
  const product = productSchema.parse(raw);
  const response = await adminFetch(`${ApiUrl}/admin/product/${product.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(product),
  });
  if (!response.ok) {
    throw new Error(`Failed to seed ${product.id}: ${response.status} ${await response.text()}`);
  }
  console.log(`seeded ${product.id}`);
}
console.log(`Seeded ${seedProducts.length} products into ${stage}.`);
