/** Typed environment with defaults. The server must boot with zero configuration. */
export const env = {
  port: Number(process.env.PORT ?? 2567),
  devTools: process.env.DEV_TOOLS === 'true',
  /** Registers test-only room messages (teleport, setIt). Set ONLY by tools/check/mp-probe.ts. */
  testHooks: process.env.TEST_HOOKS === 'true',
} as const
