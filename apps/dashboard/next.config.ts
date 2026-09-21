import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Next's default is 1 MB, and a pasted full-screen screenshot is 1–4 MB,
      // so every such paste died as a bare "A server error occurred" with the
      // real reason ("Body exceeded 1 MB limit") only in the server log.
      // Screenshots are now re-encoded in the browser before they are sent
      // (see components/boards/image-prep.ts), so this is headroom rather than
      // the thing being relied on; the 4 MB check inside the action still
      // answers with a sentence a person can act on.
      bodySizeLimit: "6mb",
    },
  },
  // The 3D handset models are read from disk by /api/models/[model]. The file
  // name comes from the registry at run time, so the build's tracer cannot see
  // which files the route needs and would ship none of them.
  outputFileTracingIncludes: {
    "/api/models/[model]": ["./assets/models/*.glb"],
  },
};

export default nextConfig;
