// next/server for scripts/dashboard-timing.mjs: everything from Next, except
// after(), which runs its callback at once and times it (the deferred work a
// request leaves behind). A callback still running after AFTER_LIMIT_MS is
// reported and abandoned.
export * from "next/server.js";
let n = 0;
export function after(task) {
  const id = ++n;
  const t0 = Date.now();
  const limit = Number(process.env.AFTER_LIMIT_MS || 60000);
  const run = Promise.resolve().then(() => (typeof task === "function" ? task() : task));
  globalThis.__afterTasks = globalThis.__afterTasks ?? [];
  globalThis.__afterTasks.push(
    Promise.race([
      run.then(() => `after#${id}: done ${Date.now() - t0} ms`, (e) => `after#${id}: threw ${Date.now() - t0} ms (${String(e?.message ?? e).slice(0, 60)})`),
      new Promise((r) => setTimeout(() => r(`after#${id}: PENDING after ${limit} ms`), limit).unref?.()),
    ])
  );
}
