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

  // Unified Data Review Hub redirects
  async redirects() {
    return [
      // Identity review consolidation
      {
        source: '/admin/person-dedup',
        destination: '/admin/reviews/identity',
        permanent: false,
      },
      {
        source: '/admin/merge-review',
        destination: '/admin/reviews/identity?filter=tier4',
        permanent: false,
      },
      {
        source: '/admin/data-engine/review',
        destination: '/admin/reviews/identity?filter=uncertain',
        permanent: false,
      },
      // Other review page moves
      {
        source: '/admin/place-dedup',
        destination: '/admin/reviews/places',
        permanent: false,
      },
      {
        source: '/admin/data-quality/review',
        destination: '/admin/reviews/quality',
        permanent: false,
      },
      {
        source: '/admin/needs-review',
        destination: '/admin/reviews/ai-parsed',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
