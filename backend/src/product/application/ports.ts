import type { Activity, CatalogChanged, CategorySlug, PhotoContentType, PhotoUpload, Product } from "@luxebaddie/contracts";

/**
 * Where products are kept. Implemented by an adapter (DynamoDB today).
 * Lists come back ordered by category, then by position within the category.
 *
 * Every change takes the activity log entry that describes it, and stores the
 * two together: a change that is not stored leaves no entry.
 */
export interface ProductRepository {
  findById(id: string): Promise<Product | null>;
  /** Products shoppers can buy, optionally limited to one category. */
  findForSale(category?: CategorySlug): Promise<Product[]>;
  /** Every product, drafts included. */
  findAll(): Promise<Product[]>;
  /** Creates the product, or replaces the one with the same id. */
  save(product: Product, activity: Activity): Promise<void>;
  /** Creates the product unless one with the same id exists. Never overwrites. */
  saveNew(product: Product, activity: Activity): Promise<"created" | "already_exists">;
  /** Removes the product if it is there. */
  remove(id: string, activity: Activity): Promise<"removed" | "not_found">;
}

/** Where product photos are kept and served from. Implemented by an adapter (S3 behind the storefront's CDN today). */
export interface PhotoStore {
  /** Makes room for one new photo and returns the permission to upload it. */
  startUpload(contentType: PhotoContentType): Promise<PhotoUpload>;
}

/** Announces catalog changes to the rest of the system. */
export interface CatalogEventPublisher {
  publishChanges(changes: CatalogChanged[]): Promise<void>;
}
