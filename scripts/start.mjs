#!/usr/bin/env node
// Keep devnet starts unchanged. Mainnet app instances must pass the same
// read-only release preflight before accepting traffic.
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta") {
  const preflight = spawnSync(process.execPath, ["scripts/mainnet-preflight.mjs"], { stdio: "inherit", timeout: 60_000 });
  if (preflight.error || preflight.status !== 0) {
    if (process.env.MAINNET_RECOVERY_MODE !== "YES") {
      if (preflight.error) console.error(`Mainnet preflight could not finish: ${preflight.error.message}`);
      process.exit(preflight.status ?? 1);
    }
    console.warn("Mainnet preflight failed; starting in recovery mode. New paid activity is disabled.");
  }
}

const next = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => next.kill(signal));
}
next.on("error", (error) => {
  console.error(`Next.js could not start: ${error.message}`);
  process.exit(1);
});
next.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
