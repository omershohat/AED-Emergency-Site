/** @type {import('next').NextConfig} */
const nextConfig = {
  // reactStrictMode double-invokes effects in development on purpose, to expose
  // effects that are not cleaned up properly. Our Leaflet map and WebSocket both
  // have real cleanup functions, so we leave it on rather than hide the problem.
  reactStrictMode: true,
};

export default nextConfig;
