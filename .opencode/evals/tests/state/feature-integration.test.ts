import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import {
  createGitRepo,
  createTempDir,
  removeDir,
  runCommand,
  scaffoldHarnessRepo,
} from "../../lib/test-utils"

const tempDirs: string[] = []

const harnessEnv = { ...process.env, ALLOW_WORKSPACE_GIT: "1" }

afterEach(() => {
  while (tempDirs.length > 0) {
    removeDir(tempDirs.pop()!)
  }
})

function setupRepo() {
  const root = createTempDir("juninho-state-")
  tempDirs.push(root)
  createGitRepo(root)
  scaffoldHarnessRepo(root)
  mkdirSync(path.join(root, "docs", "specs", "sample-feature"), { recursive: true })
  writeFileSync(path.join(root, "README.md"), "seed\n", "utf-8")
  runCommand("git", ["add", "."], { cwd: root })
  runCommand("git", ["commit", "-m", "seed"], { cwd: root })
  return root
}

describe("feature integration script", () => {
  test("ensure creates feature branch and integration manifest", () => {
    const root = setupRepo()

    const result = runCommand("sh", [".opencode/scripts/harness-feature-integration.sh", "ensure", "sample-feature"], {
      cwd: root,
      env: harnessEnv,
    })

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe("feature/sample-feature")

    const manifestPath = path.join(root, "docs", "specs", "sample-feature", "state", "integration-state.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      featureSlug: string
      featureBranch: string
      tasks: Record<string, unknown>
    }

    expect(manifest.featureSlug).toBe("sample-feature")
    expect(manifest.featureBranch).toBe("feature/sample-feature")
    expect(manifest.tasks).toEqual({})
  })

  test("record-task and integrate-task persist validated commit metadata", () => {
    const root = setupRepo()
    runCommand("sh", [".opencode/scripts/harness-feature-integration.sh", "ensure", "sample-feature"], { cwd: root, env: harnessEnv })
    runCommand("sh", [".opencode/scripts/harness-feature-integration.sh", "switch", "sample-feature"], { cwd: root, env: harnessEnv })

    writeFileSync(path.join(root, "feature.txt"), "hello\n", "utf-8")
    runCommand("git", ["add", "feature.txt"], { cwd: root })
    runCommand("git", ["commit", "-m", "feat: add feature file"], { cwd: root })
    const commitSha = runCommand("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim()

    const record = runCommand(
      "sh",
      [
        ".opencode/scripts/harness-feature-integration.sh",
        "record-task",
        "sample-feature",
        "1",
        commitSha,
        "1",
        "Create feature file",
      ],
      { cwd: root, env: harnessEnv }
    )

    expect(record.status).toBe(0)
    expect(record.stdout.trim()).toBe(commitSha)

    const integrate = runCommand(
      "sh",
      [".opencode/scripts/harness-feature-integration.sh", "integrate-task", "sample-feature", "1"],
      { cwd: root, env: harnessEnv }
    )

    expect(integrate.status).toBe(0)
    const manifestPath = path.join(root, "docs", "specs", "sample-feature", "state", "integration-state.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      tasks: Record<string, { validatedCommit: string; integration: { status: string; method: string; integratedCommit: string } }>
    }

    expect(manifest.tasks["1"].validatedCommit).toBe(commitSha)
    expect(manifest.tasks["1"].integration.status).toBe("direct")
    expect(manifest.tasks["1"].integration.method).toBe("direct-commit")
    expect(manifest.tasks["1"].integration.integratedCommit).toBe(commitSha)
  })

  test("context canon commit requires a clean baseline and stages only the target context", () => {
    const root = setupRepo()
    const contextsRoot = path.join(root, "contexts")
    const contextRoot = path.join(contextsRoot, "team", ".context")
    mkdirSync(contextRoot, { recursive: true })
    writeFileSync(path.join(contextRoot, "AGENTS.md"), "# Context\n", "utf-8")
    writeFileSync(path.join(contextsRoot, "unrelated.txt"), "clean\n", "utf-8")
    createGitRepo(contextsRoot)
    runCommand("git", ["add", "."], { cwd: contextsRoot })
    runCommand("git", ["commit", "-m", "seed context"], { cwd: contextsRoot })
    const baselinePath = path.join(root, "baseline.json")
    writeFileSync(
      baselinePath,
      JSON.stringify({
        schemaVersion: 1,
        contextRoot,
        gitRoot: contextsRoot,
        head: runCommand("git", ["rev-parse", "HEAD"], { cwd: contextsRoot }).stdout.trim(),
        status: "",
      }, null, 2) + "\n",
      "utf-8"
    )
    writeFileSync(path.join(contextRoot, "AGENTS.md"), "# Context\nEvidence-based rule.\n", "utf-8")

    const result = runCommand(
      "sh",
      [
        ".opencode/scripts/commit-context-canon.sh",
        contextRoot,
        "docs(context): add evidence rule",
        "--baseline",
        baselinePath,
      ],
      { cwd: root, env: harnessEnv }
    )
    expect(result.status).toBe(0)
    expect(runCommand("git", ["status", "--short"], { cwd: contextsRoot }).stdout).toBe("")
  })

  test("context canon commit refuses pre-existing or out-of-target dirty changes", () => {
    const root = setupRepo()
    const contextsRoot = path.join(root, "contexts")
    const contextRoot = path.join(contextsRoot, "team", ".context")
    mkdirSync(contextRoot, { recursive: true })
    writeFileSync(path.join(contextRoot, "AGENTS.md"), "# Context\n", "utf-8")
    writeFileSync(path.join(contextsRoot, "unrelated.txt"), "clean\n", "utf-8")
    createGitRepo(contextsRoot)
    runCommand("git", ["add", "."], { cwd: contextsRoot })
    runCommand("git", ["commit", "-m", "seed context"], { cwd: contextsRoot })
    const baselinePath = path.join(root, "baseline.json")
    writeFileSync(
      baselinePath,
      JSON.stringify({
        schemaVersion: 1,
        contextRoot,
        gitRoot: contextsRoot,
        head: runCommand("git", ["rev-parse", "HEAD"], { cwd: contextsRoot }).stdout.trim(),
        status: "",
      }, null, 2) + "\n",
      "utf-8"
    )
    writeFileSync(path.join(contextRoot, "AGENTS.md"), "# Context\nNew rule.\n", "utf-8")
    writeFileSync(path.join(contextsRoot, "unrelated.txt"), "dirty outside target\n", "utf-8")

    const result = runCommand(
      "sh",
      [
        ".opencode/scripts/commit-context-canon.sh",
        contextRoot,
        "docs(context): unsafe bundle",
        "--baseline",
        baselinePath,
      ],
      { cwd: root, env: harnessEnv }
    )
    expect(result.status).not.toBe(0)
    expect(runCommand("git", ["log", "--oneline", "-1"], { cwd: contextsRoot }).stdout).toContain("seed context")
  })
})
