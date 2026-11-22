/**
 * Platform Rules Index
 */

export * from "./render.rules.js"
export * from "./vercel.rules.js"
export * from "./docker.rules.js"

import { checkRenderRules } from "./render.rules.js"
import { checkVercelRules } from "./vercel.rules.js"
import { checkDockerRules } from "./docker.rules.js"

export function runPlatformRules(snapshot) {
  const findings = []

  // Always run relevant platform rules based on target and app shape
  if (
    snapshot.target === "render" ||
    snapshot.appShape === "backend-api" ||
    snapshot.hasFile("render.yaml")
  ) {
    findings.push(...checkRenderRules(snapshot))
  }

  if (
    snapshot.target === "vercel" ||
    snapshot.appShape === "frontend-spa" ||
    snapshot.hasFile("vercel.json")
  ) {
    findings.push(...checkVercelRules(snapshot))
  }

  if (
    snapshot.target === "docker" ||
    snapshot.appShape === "containerized" ||
    snapshot.hasFile("Dockerfile")
  ) {
    findings.push(...checkDockerRules(snapshot))
  }

  return findings
}
