import type { CategorySlug } from "@luxebaddy/contracts";

export type Category = {
  slug: CategorySlug;
  name: string;
  /** One line under the category title. */
  blurb: string;
};

export const categories: Category[] = [
  { slug: "wigs", name: "Wigs", blurb: "Lace fronts, glueless units and bobs. Out of the box, onto your head, out the door." },
  { slug: "weaves", name: "Weaves", blurb: "Bundles, closures and frontals for a sew-in that looks like it grew there." },
  { slug: "lashes", name: "Lashes", blurb: "From barely-there to full drama. The finishing touch." },
];

export const categoryBySlug = (slug: string) => categories.find((c) => c.slug === slug);
