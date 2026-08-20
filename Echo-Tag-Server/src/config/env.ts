/** Typed environment with defaults. The server must boot with zero configuration. */
export const env = {
  port: Number(process.env.PORT ?? 2567),
  devTools: process.env.DEV_TOOLS === 'true',
} as const
