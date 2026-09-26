/**
 * Runs once when the Next.js server starts (not during `next build`): validate the environment
 * so a misconfigured container exits immediately with the missing variable names.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { exitOnInvalidEnv } = await import("@kb/shared/env");
  const { webEnv } = await import("./lib/env");
  try {
    webEnv();
  } catch (error) {
    exitOnInvalidEnv(error);
  }
}
