/** @type {import('next').NextConfig} */
const nextConfig = {
  // Node-based analysis libraries must not be bundled as browser/edge code.
  serverExternalPackages: ["eslint", "eslint-plugin-react", "eslint-plugin-react-hooks", "@astral-sh/ruff-wasm-nodejs", "web-tree-sitter", "prettier", "prettier-plugin-java", "firebase-admin", "inngest"],
  outputFileTracingIncludes: {
    "/api/inngest": [
      "./node_modules/prettier-plugin-java/dist/tree-sitter-java_orchard.wasm",
      "./node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm",
    ],
    "/api/analyze*": [
      "./node_modules/prettier-plugin-java/dist/tree-sitter-java_orchard.wasm",
      "./node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
