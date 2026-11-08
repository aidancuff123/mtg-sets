/** @type {import('next').NextConfig} */
const isStatic = process.env.NEXT_PUBLIC_STATIC === '1';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  // Allow the dev server to be opened from phones on the LAN (Next 15 blocks cross-origin dev assets otherwise)
  allowedDevOrigins: ['*.local', '192.168.*.*', '10.*.*.*', '172.*.*.*'],
  ...(isStatic ? { output: 'export', basePath, trailingSlash: true } : {}),
};
export default nextConfig;
