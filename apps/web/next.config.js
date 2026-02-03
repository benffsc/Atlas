/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server Actions are enabled by default in Next.js 14+
  // Body size limit for server actions
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
    proxyClientMaxBodySize: 50 * 1024 * 1024, // 50MB for media uploads
  },
};

module.exports = nextConfig;
