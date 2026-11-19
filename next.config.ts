import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Card renderers read fonts from public/fonts with readFile, which the
  // bundler can't see: ship them with every function that may draw a card
  // (the writer's endpoints, the sender, the issue pages and images).
  // src/app/font-tracing.test.ts checks the traces after a build.
  outputFileTracingIncludes: {
    "/api/news/**": ["./public/fonts/**"],
    "/api/cron/news-send": ["./public/fonts/**"],
    "/newsletter/**": ["./public/fonts/**"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    return [
      // Issues moved to /newsletter before issue 1; a 308 keeps old links.
      {
        source: "/news/issues/:path*",
        destination: "/newsletter/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // Origin only, never the path: family invite codes live in
          // /join/<code> addresses and must not ride along with any request
          // (analytics, map tiles, links out).
          { key: "Referrer-Policy", value: "strict-origin" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(), microphone=(), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
  },
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
