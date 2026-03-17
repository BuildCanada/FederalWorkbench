import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use separate build directory for tests to allow running alongside dev server
  distDir: process.env.PLAYWRIGHT ? ".next-test" : ".next",
  cacheComponents: true,
  images: {
    remotePatterns: [
      {
        hostname: "avatar.vercel.sh",
      },
      {
        protocol: "https",
        //https://nextjs.org/docs/messages/next-image-unconfigured-host
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
};

export default nextConfig;
