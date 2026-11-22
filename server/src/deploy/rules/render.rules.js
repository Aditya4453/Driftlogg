/**
 * Platform Rules: Render (render.yaml, Web Services, Background Workers)
 */

import { createFinding, createUnifiedDiff } from "../findings.js"

export function checkRenderRules(snapshot) {
  const findings = []

  // Check render.yaml if present
  const renderYamlPath = snapshot.hasFile("render.yaml")
    ? "render.yaml"
    : snapshot.hasFile("render.yml")
      ? "render.yml"
      : null

  if (renderYamlPath) {
    const content = snapshot.getContent(renderYamlPath) || ""
    const pkg = snapshot.getJSON("package.json") || {}

    // 1. healthCheckPath check
    const healthMatch = content.match(/healthCheckPath:\s*([^\s#]+)/)
    if (healthMatch) {
      const healthPath = healthMatch[1].trim()
      if (!healthPath.startsWith("/")) {
        findings.push(
          createFinding({
            ruleId: "RENDER_HEALTH_CHECK_LEADING_SLASH",
            stage: "config",
            severity: "blocker",
            confidence: "confirmed",
            file: renderYamlPath,
            line: 1,
            snippet: `healthCheckPath: ${healthPath}`,
            platform: "render",
            message: `Render healthCheckPath "${healthPath}" must start with a leading slash ("/${healthPath}").`,
            fix: {
              description: `Add leading slash to healthCheckPath: /${healthPath}`,
              patch: createUnifiedDiff({
                file: renderYamlPath,
                originalText: `healthCheckPath: ${healthPath}`,
                newText: `healthCheckPath: /${healthPath}`,
              }),
            },
          }),
        )
      }
    }

    // 2. startCommand sanity
    const startCmdMatch = content.match(/startCommand:\s*([^\r\n#]+)/)
    if (startCmdMatch) {
      const startCmd = startCmdMatch[1].trim()
      if (
        startCmd.includes("npm start") &&
        (!pkg.scripts || !pkg.scripts.start)
      ) {
        findings.push(
          createFinding({
            ruleId: "RENDER_START_COMMAND_MISSING_SCRIPT",
            stage: "config",
            severity: "blocker",
            confidence: "confirmed",
            file: renderYamlPath,
            line: 1,
            snippet: `startCommand: ${startCmd}`,
            platform: "render",
            message: `render.yaml defines startCommand "${startCmd}", but package.json has no "scripts.start".`,
            fix: {
              description:
                'Define "scripts.start" in package.json or adjust startCommand',
              patch: "",
            },
          }),
        )
      }
    }
  }

  // 3. Render 15-minute start timeout check: building during scripts.start
  const rootPkg = snapshot.getJSON("package.json")
  if (rootPkg && rootPkg.scripts && typeof rootPkg.scripts.start === "string") {
    const startScript = rootPkg.scripts.start
    if (
      /(npm run build|pnpm build|yarn build|tsc|vite build)\s*&&/.test(
        startScript,
      )
    ) {
      findings.push(
        createFinding({
          ruleId: "RENDER_START_TIMEOUT_BUILD_IN_START",
          stage: "boot",
          severity: "warning",
          confidence: "likely",
          file: "package.json",
          line: 1,
          snippet: `"start": "${startScript}"`,
          platform: "render",
          message:
            'Start script contains a build step. Render services have a ~15-minute start timeout; move build steps to "buildCommand" instead of "startCommand".',
          fix: {
            description: "Separate build and start scripts in package.json",
            patch: "",
          },
        }),
      )
    }
  }

  return findings
}
