/**
 * Looks at real data through the repositories, one access pattern at a time,
 * so you never need to hand-build keys in the DynamoDB console.
 *
 *   pnpm db dev catalog wigs
 *   pnpm db dev customer bea@example.com
 *
 * Run without a pattern to list them. See DATA-MODEL.md for the model.
 */
import { categorySlugSchema, fulfillmentStatusSchema } from "@luxebaddy/contracts";
import { dynamoDbBasketRepository } from "../src/basket/adapters/dynamodb-basket-repository";
import { dynamoDbOrderRepository } from "../src/ordering/adapters/dynamodb-order-repository";
import { dynamoDbProductRepository } from "../src/product/adapters/dynamodb-product-repository";
import { createDocumentClient } from "../src/shared/adapters/aws-clients";
import { getStackOutputs, stageFromArgs } from "./lib/aws";

const FIRST_PAGE = { limit: 25 };

const stage = stageFromArgs();
const [pattern, argument] = process.argv.slice(3);

const { TableName } = await getStackOutputs(stage);
const ddb = createDocumentClient();
const products = dynamoDbProductRepository(ddb, TableName);
const baskets = dynamoDbBasketRepository(ddb, TableName);
const orders = dynamoDbOrderRepository(ddb, TableName);

const required = (what: string): string => {
  if (!argument) throw new Error(`This pattern needs ${what}.`);
  return argument;
};

const patterns: Record<string, { describe: string; run: () => Promise<unknown> }> = {
  product: { describe: "<id>          one product", run: () => products.findById(required("a product id")) },
  catalog: {
    describe: "[category]    products for sale, in display order",
    run: () => products.findForSale(argument ? categorySlugSchema.parse(argument) : undefined),
  },
  "all-products": { describe: "              every product, drafts included", run: () => products.findAll() },
  basket: { describe: "<basketId>    a basket's lines", run: () => baskets.findItems(required("a basket id")) },
  order: { describe: "<orderId>     one order", run: () => orders.findById(required("an order number")) },
  queue: {
    describe: "[status]      fulfillment queue, oldest first (default unfulfilled)",
    run: () => orders.findByFulfillmentStatus(fulfillmentStatusSchema.parse(argument ?? "unfulfilled"), FIRST_PAGE),
  },
  customer: {
    describe: "<email>       a customer's orders, newest first",
    run: () => orders.findByCustomerEmail(required("an email"), FIRST_PAGE),
  },
};

const chosen = pattern ? patterns[pattern] : undefined;
if (!chosen) {
  console.log("Access patterns:");
  for (const [name, { describe }] of Object.entries(patterns)) console.log(`  ${name.padEnd(13)} ${describe}`);
  process.exit(pattern ? 1 : 0);
}
console.log(JSON.stringify(await chosen.run(), null, 2));
