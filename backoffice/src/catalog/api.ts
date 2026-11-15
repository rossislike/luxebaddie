import type { PhotoContentType, PhotoUpload, Product } from "@luxebaddie/contracts";
import { backOfficeFetch } from "@/lib/api";

const productPath = (id: string) => `/product/${encodeURIComponent(id)}`;

/** Every product, drafts included, in the shop's display order. */
export const listProducts = async () => (await backOfficeFetch<{ products: Product[] }>("/product")).products;

/** One product, draft or for sale. */
export const getProduct = async (id: string) => (await backOfficeFetch<{ product: Product }>(productPath(id))).product;

/** Adds a product. Refused if another product already has its address. */
export const addProduct = (product: Product) => backOfficeFetch<{ product: Product }>("/product", { method: "POST", json: product });

/** Replaces a product with what is on the form. */
export const saveProduct = (product: Product) => backOfficeFetch<{ product: Product }>(productPath(product.id), { method: "PUT", json: product });

export const removeProduct = (id: string) => backOfficeFetch<null>(productPath(id), { method: "DELETE" });

export const productPage = (id: string) => `/product?id=${encodeURIComponent(id)}`;

/** Permission to upload one photo of the given kind straight to storage. */
export const startPhotoUpload = async (contentType: PhotoContentType) =>
  (await backOfficeFetch<{ upload: PhotoUpload }>("/product-photo", { method: "POST", json: { contentType } })).upload;
