import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sweet/rule-core ships TypeScript source (main -> src/index.ts); Next must
  // transpile it like first-party code rather than treat it as a built dep.
  transpilePackages: ["@sweet/rule-core"],
};

export default nextConfig;
