/**
 * Safe shell execution helpers.
 *
 * All external commands are run via execFile with an explicit argument array
 * (never a shell string) to avoid shell-injection and quoting bugs. Every call
 * is bounded by a timeout so a hung simulator/device can never wedge the server.
 */

import { execFile } from "node:child_process";
import { DEFAULT_COMMAND_TIMEOUT_MS } from "../constants.js";
import type { CommandResult } from "../types.js";

/** Error thrown when a required external binary is not installed / not on PATH. */
export class MissingBinaryError extends Error {
  constructor(
    public readonly binary: string,
    public readonly installHint: string,
  ) {
    super(`Required tool '${binary}' was not found on PATH. ${installHint}`);
    this.name = "MissingBinaryError";
  }
}

/** Error thrown when a command runs but exits non-zero. Carries stderr for context. */
export class CommandFailedError extends Error {
  constructor(
    public readonly command: string,
    public readonly code: number | null,
    public readonly stderr: string,
    public readonly stdout: string,
  ) {
    super(
      `Command '${command}' failed with exit code ${code}. ` +
        `${stderr.trim() || stdout.trim() || "(no output)"}`,
    );
    this.name = "CommandFailedError";
  }
}

interface RunOptions {
  /** Milliseconds before the process is killed. Defaults to DEFAULT_COMMAND_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Maximum bytes captured from stdout/stderr. Defaults to 16 MB (screenshots). */
  maxBuffer?: number;
}

/**
 * Run a binary with arguments. Resolves with stdout/stderr/code on success.
 * Throws MissingBinaryError if the binary is absent, CommandFailedError on
 * non-zero exit, and a generic Error on timeout.
 */
export function runCommand(
  binary: string,
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  const { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, maxBuffer = 16 * 1024 * 1024 } =
    options;

  return new Promise<CommandResult>((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout: timeoutMs, maxBuffer, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          const err = error as NodeJS.ErrnoException & { killed?: boolean };
          if (err.code === "ENOENT") {
            reject(
              new MissingBinaryError(
                binary,
                `Install it and ensure it is on your PATH.`,
              ),
            );
            return;
          }
          if (err.killed) {
            reject(
              new Error(
                `Command '${binary} ${args.join(" ")}' timed out after ${timeoutMs}ms.`,
              ),
            );
            return;
          }
          reject(
            new CommandFailedError(
              `${binary} ${args.join(" ")}`,
              typeof err.code === "number" ? err.code : null,
              stderr,
              stdout,
            ),
          );
          return;
        }
        resolve({ stdout, stderr, code: 0 });
      },
    );
  });
}

/** Return true if a binary is resolvable on PATH, false otherwise. */
export async function binaryExists(binary: string): Promise<boolean> {
  try {
    // `command -v` is POSIX and cheap; run through /bin/sh explicitly.
    await runCommand("/bin/sh", ["-c", `command -v ${binary}`], {
      timeoutMs: 5000,
    });
    return true;
  } catch {
    return false;
  }
}
