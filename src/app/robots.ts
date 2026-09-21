import type { MetadataRoute } from 'next';

// Crawling public branding is allowed. Page-level noindex and authentication
// continue to protect the internal app's search visibility and private data.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/' } };
}
