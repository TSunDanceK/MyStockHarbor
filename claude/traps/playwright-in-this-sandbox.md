# Playwright in this sandbox — two things that cost an hour

Both are environment facts, not bugs, and neither is guessable.

**`networkidle` never fires on `/dashboard`.** The client polls continuously,
so the network is never idle and `page.goto(..., { waitUntil: "networkidle" })`
times out at whatever limit it is given. Use `domcontentloaded` plus an
explicit `waitForTimeout` settle instead. Anything that mounts `DashboardClient`
has this property.

**The preinstalled Chromium is build 1194; a fresh `npm i playwright` expects
1234.** It fails with "Executable doesn't exist … chromium_headless_shell-1234"
and helpfully suggests `npx playwright install`, which the environment notes
say not to run. Pass the existing binary instead:

```js
chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
```

Install `playwright` into a scratch directory rather than the repo, so
`package.json` and the lockfile stay untouched.
