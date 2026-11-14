import type { CatalogChanged, CategorySlug, Product } from "@luxebaddie/contracts";

/**
 * Where products are kept. Implemented by an adapter (DynamoDB today).
 * Lists come back ordered by category, then by position within the category.
 */
export interface ProductRepository {
  findById(id: string): Promise<Product | null>;
  /** Products shoppers can buy, optionally limited to one category. */
  findForSale(category?: CategorySlug): Promise<Product[]>;
  /** Every product, drafts included. */
  findAll(): Promise<Product[]>;
  save(product: Product): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Announces catalog changes to the rest of the system. */
export interface CatalogEventPublisher {
  publishChanges(changes: CatalogChanged[]): Promise<void>;
}
