import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // In static export, dynamic routes need generateStaticParams
  // We'll handle deck editing client-side with API calls
};

export default nextConfig;
