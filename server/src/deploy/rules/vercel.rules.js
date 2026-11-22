/**
 * Platform Rules: Vercel (vercel.json, Frontend SPA, Serverless Functions)
 */

import { createFinding, createUnifiedDiff } from "../findings.js"

export function checkVercelRules(snapshot) {
  const findings = []

  // 1. SPA rewrite rule for client-side routing
  if (snapshot.appShape === "frontend-spa" || snapshot.target === "vercel") {
    const hasVercelJson = snapshot.hasFile("vercel.json")
    let hasSpaRewrite = false

    if (hasVercelJson) {
      const vercelJson = snapshot.getJSON("vercel.json")
      if (vercelJson) {
        if (Array.isArray(vercelJson.rewrites)) {
          hasSpaRewrite = vercelJson.rewrites.some(
            (r) =>
              (r.source === "/(.*)" || r.source === "/:path*") &&
              (r.destination === "/index.html" || r.destination === "/"),
          )
        } else if (Array.isArray(vercelJson.routes)) {
          hasSpaRewrite = vercelJson.routes.some(
            (r) =>
              (r.src === "/(.*)" || r.src === "/.*") &&
              r.dest === "/index.html",
          )
        }
      }
    }

    if (snapshot.appShape === "frontend-spa" && !hasSpaRewrite) {
      const isBlocker = snapshot.target === "vercel"
      findings.push(
        createFinding({
          ruleId: "VERCEL_SPA_REWRITE_MISSING",
          stage: "config",
          severity: isBlocker ? "blocker" : "warning",
          confidence: "confirmed",
          file: hasVercelJson ? "vercel.json" : "repo",
          line: 1,
          snippet: hasVercelJson
            ? "vercel.json"
            : "No vercel.json SPA rewrites defined",
          platform: "vercel",
          message:
            "Single Page App on Vercel is missing a rewrite rule for deep routes (e.g. /dashboard -> /index.html). Reloading deep links will produce 404 errors.",
          fix: {
            description: "Add a rewrite fallback to /index.html in vercel.json",
            patch: createUnifiedDiff({
              file: "vercel.json",
              originalText: hasVercelJson
                ? snapshot.getContent("vercel.json") || "{}"
                : "",
              newText: JSON.stringify(
                {
                  rewrites: [{ source: "/(.*)", destination: "/index.html" }],
                },
                null,
                2,
              ),
            }),
          },
        }),
      )
    }
  }

  // 2. Serverless app.listen detection
  const serverlessFiles = snapshot.findFiles(
    (e) =>
      e.path.startsWith("api/") ||
      e.path.startsWith("pages/api/") ||
      e.path.startsWith("app/api/"),
  )

  for (const entry of serverlessFiles) {
    const content = snapshot.getContent(entry.path) || ""
    if (/\.listen\s*\(/.test(content)) {
      findings.push(
        createFinding({
          ruleId: "VERCEL_SERVERLESS_LISTEN",
          stage: "code",
          severity: "blocker",
          confidence: "confirmed",
          file: entry.path,
          line: 1,
          snippet: ".listen(...) call inside serverless function",
          platform: "vercel",
          message: `Serverless function "${entry.path}" calls .listen(). Vercel serverless functions must export request handlers instead of binding ports.`,
          fix: {
            description:
              "Export default handler (e.g. export default function handler(req, res))",
            patch: "",
          },
        }),
      )
    }
  }

  return findings
}
