import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { name: 'MTG Set Overlap', short_name: 'Set Overlap', start_url: '/', display: 'standalone', background_color: '#0f1115', theme_color: '#0f1115' };
}
