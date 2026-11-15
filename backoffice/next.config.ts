import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Like the storefront, the back office is a fully static site (plain files,
  // served from a CDN). It holds no data of its own: every screen is filled in
  // the browser from the backend API, with the signed-in owner's token.
  output: "export",
  transpilePackages: ["@luxebaddie/api-client", "@luxebaddie/contracts"],
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
