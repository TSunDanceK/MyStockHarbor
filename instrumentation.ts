// SERVER INSTRUMENTATION: runs once per server instance, before any request.
//
// The Redis request-size guard (#553 COWORK #84): every Upstash REST request is
// measured at the fetch layer -- warned over 2 MB, refused over 9.5 MB at error
// level. See lib/server/redisSizeGuard.ts. Shared file: append-only edits.
export async function register() {
  const { installRedisSizeGuard } = await import("./lib/server/redisSizeGuard");
  installRedisSizeGuard();
}
