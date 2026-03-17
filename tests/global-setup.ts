import { execSync } from "node:child_process";

const TEST_PORT = 3100;

/**
 * Global setup that runs before all tests.
 * Cleans up any stale processes on the test port from previous interrupted runs.
 */
function globalSetup() {
  try {
    // Kill any process using the test port (macOS/Linux)
    execSync(`lsof -ti:${TEST_PORT} | xargs kill -9 2>/dev/null || true`, {
      stdio: "ignore",
    });
  } catch {
    // Ignore errors - no process to kill
  }

  // Clean up stale Next.js lock file for test build directory
  try {
    execSync("rm -f .next-test/dev/lock", { stdio: "ignore" });
  } catch {
    // Ignore errors
  }
}

export default globalSetup;
