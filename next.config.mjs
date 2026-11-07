/** @type {import('next').NextConfig} */
const nextConfig = {
  // The landing page is static HTML in public/index.html; the console lives at /app.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/index.html" }] };
  },
};
export default nextConfig;
