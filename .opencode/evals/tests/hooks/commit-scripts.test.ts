import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "fs"
import path from "path"
import {
  createFakeBuildTools,
  createGitRepo,
  createTempDir,
  readLogLines,
  removeDir,
  runCommand,
  scaffoldHarnessRepo,
} from "../../lib/test-utils"

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    removeDir(tempDirs.pop()!)
  }
})

function setupRepo(options?: { failSpotless?: boolean; failCompile?: boolean; failTest?: boolean }) {
  const root = createTempDir("juninho-hooks-")
  tempDirs.push(root)
  createGitRepo(root)
  scaffoldHarnessRepo(root)
  createFakeBuildTools(root, options)
  runCommand("sh", [".opencode/scripts/install-git-hooks.sh"], { cwd: root })
  return root
}

function stageFile(root: string, relativePath: string, content: string) {
  const target = path.join(root, relativePath)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content, "utf-8")
  runCommand("git", ["add", relativePath], { cwd: root })
}

describe("commit path scripts", () => {
  test("git commit is blocked by the installed pre-commit hook when lint fails", () => {
    const root = setupRepo({ failSpotless: true })
    stageFile(root, "src/main/kotlin/br/com/olx/trp/financial/Foo.kt", "class Foo\n")

    const result = runCommand("git", ["commit", "-m", "test: bad lint"], {
      cwd: root,
      env: process.env,
    })

    expect(result.status).toBe(1)
    const combinedOutput = result.stdout + result.stderr
    expect(combinedOutput).toContain("[juninho:pre-commit] Running structure lint...")
    expect(combinedOutput).not.toContain("[juninho:pre-commit] Running build verification...")

    const log = readLogLines(path.join(root, ".mvnw.log"))
    expect(log).toEqual(["spotless:check"])
    expect(runCommand("git", ["rev-parse", "HEAD"], { cwd: root }).status).toBe(128)
  })

  test("git commit succeeds only after the installed pre-commit hook passes", () => {
    const root = setupRepo()
    stageFile(root, "src/main/kotlin/br/com/olx/trp/financial/FooService.kt", "class FooService\n")

    const result = runCommand("git", ["commit", "-m", "test: valid commit"], {
      cwd: root,
      env: process.env,
    })

    expect(result.status).toBe(0)
    const combinedOutput = result.stdout + result.stderr
    expect(combinedOutput).toContain("[juninho:pre-commit] Running structure lint...")
    expect(combinedOutput).toContain("[juninho:pre-commit] Running build verification...")
    expect(combinedOutput).toContain("[juninho:pre-commit] Running related tests...")
    expect(combinedOutput).toContain("[juninho:pre-commit] Local checks passed")

    const log = readLogLines(path.join(root, ".mvnw.log"))
    expect(log).toEqual([
      "spotless:check",
      "-q -DskipTests compile test-compile",
      'test -Dsurefire.failIfNoSpecifiedTests=false -Dtest=FooServiceTest',
    ])
    expect(runCommand("git", ["rev-list", "--count", "HEAD"], { cwd: root }).stdout.trim()).toBe("1")
  })

  test("installed pre-commit hook skips related tests when only non-code files are staged", () => {
    const root = setupRepo()
    stageFile(root, "README.md", "docs\n")

    const result = runCommand("git", ["commit", "-m", "docs: update readme"], {
      cwd: root,
      env: process.env,
    })

    expect(result.status).toBe(0)
    const combinedOutput = result.stdout + result.stderr
    expect(combinedOutput).toContain("No Kotlin/Java files staged. Skipping tests.")
    expect(readLogLines(path.join(root, ".mvnw.log"))).toEqual(["spotless:check", "-q -DskipTests compile test-compile"])
  })

  test("check-all runs branch switch attempt, formatting, build, and full tests", () => {
    const root = setupRepo()

    const result = runCommand("sh", [".opencode/scripts/check-all.sh"], {
      cwd: root,
      env: process.env,
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[juninho:check-all] Running formatting checks...")
    expect(result.stdout).toContain("[juninho:check-all] Running build verification...")
    expect(result.stdout).toContain("[juninho:check-all] Running repo-wide tests...")

    const log = readLogLines(path.join(root, ".mvnw.log"))
    expect(log).toEqual([
      "spotless:check",
      "-q -DskipTests compile test-compile",
      "test",
    ])
  })
})
