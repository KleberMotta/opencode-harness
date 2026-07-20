import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, cpSync, existsSync } from "fs"
import os from "os"
import path from "path"
import { spawnSync, type SpawnSyncOptions } from "child_process"

export type CommandResult = {
  status: number | null
  stdout: string
  stderr: string
}

export function repoRoot(): string {
  return path.resolve(__dirname, "../../..")
}

export function opencodeRoot(): string {
  return path.join(repoRoot(), ".opencode")
}

export function createTempDir(prefix: string): string {
  // Canonicalize the temp root so on-disk paths the plugins/CLI produce (which they
  // resolve through the real filesystem) compare equal to the ones tests build from
  // this root. Without this, a symlinked tmpdir (macOS default `/var` -> `/private/var`,
  // or a TMPDIR under a symlinked path) makes byte-for-byte path assertions diverge.
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)))
}

export function removeDir(target: string): void {
  rmSync(target, { recursive: true, force: true })
}

export function runCommand(
  command: string,
  args: string[],
  options: SpawnSyncOptions = {}
): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    ...options,
  })

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

export function makeExecutable(filePath: string): void {
  runCommand("chmod", ["+x", filePath])
}

export function writeExecutable(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, "utf-8")
  makeExecutable(filePath)
}

export function createGitRepo(root: string): void {
  runCommand("git", ["init"], { cwd: root })
  runCommand("git", ["config", "user.name", "Harness Eval"], { cwd: root })
  runCommand("git", ["config", "user.email", "harness-eval@example.com"], { cwd: root })
}

export function scaffoldHarnessRepo(root: string): void {
  mkdirSync(path.join(root, ".opencode", "scripts"), { recursive: true })
  mkdirSync(path.join(root, ".opencode", "hooks"), { recursive: true })
  mkdirSync(path.join(root, ".opencode", "templates"), { recursive: true })
  mkdirSync(path.join(root, ".opencode", "state"), { recursive: true })
  mkdirSync(path.join(root, "docs", "specs"), { recursive: true })

  const sourceFiles = [
    ".opencode/scripts/pre-commit.sh",
    ".opencode/scripts/install-git-hooks.sh",
    ".opencode/scripts/lint-structure.sh",
    ".opencode/scripts/build-verify.sh",
    ".opencode/scripts/test-related.sh",
    ".opencode/scripts/run-test-scope.sh",
    ".opencode/scripts/check-all.sh",
    ".opencode/scripts/_resolve-repo.sh",
    ".opencode/scripts/_detect-stack.sh",
    ".opencode/scripts/_read-config.sh",
    ".opencode/scripts/harness-feature-integration.sh",
    ".opencode/scripts/commit-context-canon.sh",
    ".opencode/scripts/scaffold-spec-state.sh",
    ".opencode/hooks/pre-commit",
    ".opencode/templates/spec-state-readme.md",
  ]

  for (const relativePath of sourceFiles) {
    const sourcePath = path.join(repoRoot(), relativePath)
    const targetPath = path.join(root, relativePath)
    mkdirSync(path.dirname(targetPath), { recursive: true })
    cpSync(sourcePath, targetPath)
    if (relativePath.endsWith(".sh")) makeExecutable(targetPath)
  }
}

export function createFakeBuildTools(root: string, options?: { failSpotless?: boolean; failCompile?: boolean; failTest?: boolean }) {
  const mvnw = `#!/bin/sh
set -e
printf '%s\n' "$*" >> "${path.join(root, ".mvnw.log")}"
case "$*" in
  *"spotless:check"*) ${options?.failSpotless ? "echo 'spotless failed' >&2; exit 1" : "exit 0"} ;;
  *"-DskipTests verify"*) ${options?.failCompile ? "echo 'compile failed' >&2; exit 1" : "exit 0"} ;;
  *" test "*|*" test"|"test"|*" verify"*|"verify") ${options?.failTest ? "echo 'test failed' >&2; exit 1" : "exit 0"} ;;
  *) exit 0 ;;
esac
`
  writeExecutable(path.join(root, "mvnw"), mvnw)

  // Minimal pom.xml so _detect-stack.sh helpers see a Maven project with the
  // spotless plugin configured (pom_has_plugin greps the artifactId). No
  // <java.version> tag on purpose — maven_check_java_version must not gate on
  // the eval host's JVM.
  writeFileSync(
    path.join(root, "pom.xml"),
    [
      "<project>",
      "  <build><plugins><plugin>",
      "    <artifactId>spotless-maven-plugin</artifactId>",
      "  </plugin></plugins></build>",
      "</project>",
      "",
    ].join("\n"),
    "utf-8"
  )

  // Makefile without a `dependencies:` target — the docker-compose dependency
  // gate (maven_dependencies_required) must stay inert in the sandbox.
  writeFileSync(
    path.join(root, "Makefile"),
    "lint:\n\t./mvnw spotless:check\n",
    "utf-8"
  )
}

export function readLogLines(filePath: string): string[] {
  if (!existsSync(filePath)) return []
  return readFileSync(filePath, "utf-8").split("\n").filter(Boolean)
}

export function writeExecutionState(root: string, content: string): void {
  const target = path.join(root, ".opencode", "state", "execution-state.md")
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content, "utf-8")
}

export function writeActivePlan(root: string, planPath: string): void {
  const target = path.join(root, ".opencode", "state", "active-plan.json")
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(
    target,
    JSON.stringify(
      {
        slug: "feature-x",
        planPath,
        specPath: "docs/specs/feature-x/spec.md",
        contextPath: "docs/specs/feature-x/CONTEXT.md",
      },
      null,
      2
    ) + "\n",
    "utf-8"
  )
}

export function writePersistentContext(root: string, content: string): void {
  const target = path.join(root, ".opencode", "state", "persistent-context.md")
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content, "utf-8")
}
