/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Server-only secrets are never exposed to the client. Do not add secret keys
  // to `env` here or prefix them with NEXT_PUBLIC_.
  experimental: {
    // Allow server actions / route handlers to use the Node runtime for the
    // Shopify Admin client and (later) Inngest jobs.
  },
};

export default nextConfig;
