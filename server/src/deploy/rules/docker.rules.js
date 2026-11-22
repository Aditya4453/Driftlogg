/**
 * Platform Rules: Docker (Dockerfile, .dockerignore, EXPOSE, Container Signals)
 */

import { createFinding, createUnifiedDiff } from "../findings.js"

export function checkDockerRules(snapshot) {
  const findings = []
  const isContainerTarget =
    snapshot.target === "docker" || snapshot.appShape === "containerized"
  const hasDockerfile =
    snapshot.hasFile("Dockerfile") || snapshot.hasFile("dockerfile")

  if (isContainerTarget && !hasDockerfile) {
    findings.push(
      createFinding({
        ruleId: "DOCKERFILE_MISSING",
        stage: "config",
        severity: "blocker",
        confidence: "confirmed",
        file: "Dockerfile",
        line: 1,
        snippet: "Missing Dockerfile",
        platform: "docker",
        message: "Containerized application target requires a root Dockerfile.",
        fix: {
          description: "Add a Dockerfile to the repository root",
          patch: "",
        },
      }),
    )
    return findings
  }

  if (hasDockerfile) {
    const dockerfilePath = snapshot.hasFile("Dockerfile")
      ? "Dockerfile"
      : "dockerfile"
    const dockerfileContent = snapshot.getContent(dockerfilePath) || ""

    // 1. EXPOSE check
    if (!/^\s*EXPOSE\s+\d+/m.test(dockerfileContent)) {
      findings.push(
        createFinding({
          ruleId: "DOCKER_EXPOSE_MISSING",
          stage: "config",
          severity: "warning",
          confidence: "likely",
          file: dockerfilePath,
          line: 1,
          snippet: "No EXPOSE instruction found",
          platform: "docker",
          message:
            "Dockerfile does not specify an EXPOSE instruction. Cloud orchestrators may fail to detect the application port.",
          fix: {
            description:
              'Add "EXPOSE 3000" (or matching application port) to Dockerfile',
            patch: createUnifiedDiff({
              file: dockerfilePath,
              originalText: dockerfileContent,
              newText: `${dockerfileContent.trim()}\nEXPOSE 3000\n`,
            }),
          },
        }),
      )
    }

    // 2. .dockerignore check
    const hasDockerignore = snapshot.hasFile(".dockerignore")
    if (!hasDockerignore) {
      findings.push(
        createFinding({
          ruleId: "DOCKERIGNORE_MISSING",
          stage: "config",
          severity: "warning",
          confidence: "confirmed",
          file: ".dockerignore",
          line: 1,
          snippet: "Missing .dockerignore",
          platform: "docker",
          message:
            "Repository is missing a .dockerignore file. Local node_modules, secrets, and build caches will be copied into Docker images.",
          fix: {
            description:
              "Create a .dockerignore ignoring node_modules, .git, and .env files",
            patch: createUnifiedDiff({
              file: ".dockerignore",
              originalText: "",
              newText: "node_modules\n.git\n.env\n.env.*\ndist\nbuild\n",
            }),
          },
        }),
      )
    } else {
      const dockerignoreContent = snapshot.getContent(".dockerignore") || ""
      const missingIgnores = []
      if (!/node_modules/m.test(dockerignoreContent))
        missingIgnores.push("node_modules")
      if (!/\.git/m.test(dockerignoreContent)) missingIgnores.push(".git")
      if (!/\.env/m.test(dockerignoreContent)) missingIgnores.push(".env")

      if (missingIgnores.length > 0) {
        findings.push(
          createFinding({
            ruleId: "DOCKERIGNORE_INCOMPLETE",
            stage: "config",
            severity: "warning",
            confidence: "confirmed",
            file: ".dockerignore",
            line: 1,
            snippet: `.dockerignore does not exclude: ${missingIgnores.join(", ")}`,
            platform: "docker",
            message: `.dockerignore is missing entries for: ${missingIgnores.join(", ")}.`,
            fix: {
              description: `Append ${missingIgnores.join(", ")} to .dockerignore`,
              patch: createUnifiedDiff({
                file: ".dockerignore",
                originalText: dockerignoreContent,
                newText: `${dockerignoreContent.trim()}\n${missingIgnores.join("\n")}\n`,
              }),
            },
          }),
        )
      }
    }
  }

  return findings
}
