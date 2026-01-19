/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server Actions config (stable in Next.js 14+)
  serverActions: {
    bodySizeLimit: '50mb',
  },
};

module.exports = nextConfig;
