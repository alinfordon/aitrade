/** @type {import('next').NextConfig} */
const nextConfig = {
  // imagine Docker mai mică + deploy pe VPS lângă alte containere (ex. Flowise)
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,
  experimental: {
    serverComponentsExternalPackages: ["ccxt", "mongoose"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "coin-images.coingecko.com", pathname: "/**" },
      { protocol: "https", hostname: "assets.coingecko.com", pathname: "/**" },
      { protocol: "https", hostname: "bin.bnbstatic.com", pathname: "/**" },
    ],
  },
};

export default nextConfig;
