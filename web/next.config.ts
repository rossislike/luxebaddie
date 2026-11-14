import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The storefront is a fully static site (plain files, served from a CDN).
  // Everything dynamic - bag, checkout, orders - happens in the browser
  // against the backend API.
  // (Cache Components / partial prerendering need a server, so they stay off.)
  output: "export",
  transpilePackages: ["@luxebaddy/contracts"],
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
