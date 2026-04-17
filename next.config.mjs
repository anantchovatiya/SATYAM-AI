/** @type {import('next').NextConfig} */
const nextConfig = {
  // Baileys + webpack’s RSC bundle often breaks Noise/WebSocket framing; load from node_modules.
  experimental: {
    serverComponentsExternalPackages: ["@whiskeysockets/baileys"],
  },
};

export default nextConfig;
