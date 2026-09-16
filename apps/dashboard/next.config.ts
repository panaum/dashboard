import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The 3D handset models are read from disk by /api/models/[model]. The file
  // name comes from the registry at run time, so the build's tracer cannot see
  // which files the route needs and would ship none of them.
  outputFileTracingIncludes: {
    "/api/models/[model]": ["./assets/models/*.glb"],
  },
};

export default nextConfig;
