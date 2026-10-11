#!/usr/bin/env node
// Read-only release check. Run in the exact environment that will host paid pits.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import nextEnv from "@next/env";
import pg from "pg";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

nextEnv.loadEnvConfig(process.cwd());

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const failures = [];

function check(name, ok, detail = "") {
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
  if (!ok) failures.push(name);
}

const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
const rpc = process.env.SOLANA_RPC_URL ?? "";
const browserRpc = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "";
const mint = process.env.NEXT_PUBLIC_USDC_MINT ?? "";
const program = process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? "";
check("cluster", cluster === "mainnet-beta");
check("independent security review approved", process.env.MAINNET_AUDIT_APPROVED === "YES");
const httpsRpc = /^https:\/\//.test(rpc) && !/devnet|testnet/i.test(rpc);
const productionRpc = httpsRpc && !/api\.(mainnet|mainnet-beta)\.solana\.com/i.test(rpc);
check("private production RPC", productionRpc);
const browserSafeRpc = /^https:\/\//.test(browserRpc) && !/devnet|testnet/i.test(browserRpc)
  && !/api\.(mainnet|mainnet-beta)\.solana\.com/i.test(browserRpc);
check("browser-safe production RPC", browserSafeRpc);
check("Circle mainnet USDC", mint === MAINNET_USDC);
check("persistent database", !!process.env.DATABASE_URL);
if (process.env.DATABASE_URL) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await db.query("SELECT 1");
    check("database reachable", true);
  } catch {
    check("database reachable", false);
  } finally {
    await db.end().catch(() => {});
  }
}
check("live Panta key", /^pk_live_/.test(process.env.PANTA_API_KEY ?? ""));
check("Privy app ID and server secret", !!process.env.NEXT_PUBLIC_PRIVY_APP_ID && !!process.env.PRIVY_APP_SECRET);
const sessionSecret = process.env.SESSION_SECRET ?? "";
check("independent session secret", sessionSecret.length >= 32
  && sessionSecret !== process.env.ESCROW_HOST_SECRET_KEY
  && sessionSecret !== process.env.ROUND_HOST_SECRET);
let operator = null;
try { operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.ESCROW_HOST_SECRET_KEY ?? ""))); }
catch { /* no secret material is printed */ }
check("escrow operator key", !!operator);
let upgradeAuthority = null;
try { upgradeAuthority = new PublicKey(process.env.MAINNET_UPGRADE_AUTHORITY ?? ""); } catch { /* public key not configured */ }
check("separate offline upgrade authority", !!upgradeAuthority && !!operator
  && !upgradeAuthority.equals(operator.publicKey));
const expectedProgramHash = process.env.MAINNET_PROGRAM_SHA256 ?? "";
const expectedProgramBytes = Number(process.env.MAINNET_PROGRAM_BYTES ?? "0");
let localProgram = null;
try { localProgram = await readFile("program/target/deploy/oracle_rumble_escrow.so"); } catch { /* deploy target may not contain the SBF artifact */ }
const localProgramHash = localProgram ? createHash("sha256").update(localProgram).digest("hex") : "";
check("frozen reviewed bytecode identity", /^[a-f0-9]{64}$/.test(expectedProgramHash)
  && Number.isSafeInteger(expectedProgramBytes) && expectedProgramBytes > 0
  && (!localProgram || (localProgramHash === expectedProgramHash && localProgram.length === expectedProgramBytes)));
let programKey = null;
try { programKey = new PublicKey(program); } catch { /* invalid public key */ }
check("escrow program ID", !!programKey);

// A public RPC is insufficient for production, but still useful for finding
// missing mainnet accounts during staging. Do not skip those checks merely
// because the endpoint is public.
if (cluster === "mainnet-beta" && httpsRpc) {
  try {
    const conn = new Connection(rpc, "confirmed");
    const genesis = await conn.getGenesisHash();
    check("RPC genesis", genesis === MAINNET_GENESIS);
    if (browserSafeRpc) {
      const browserGenesis = await new Connection(browserRpc, "confirmed").getGenesisHash();
      check("browser RPC genesis", browserGenesis === MAINNET_GENESIS);
    }
    if (mint === MAINNET_USDC) {
      const account = await conn.getAccountInfo(new PublicKey(mint), "confirmed");
      check("USDC mint account", !!account && account.owner.toBase58() === TOKEN_PROGRAM
        && account.data.length >= 82 && account.data[44] === 6 && account.data[45] === 1);
    }
    if (programKey) {
      const account = await conn.getAccountInfo(programKey, "confirmed");
      const executable = !!account?.executable && account.owner.equals(UPGRADEABLE_LOADER)
        && account.data.length >= 36 && account.data.readUInt32LE(0) === 2;
      check("escrow program executable", executable);
      if (executable && account) {
        const programDataAddress = new PublicKey(account.data.subarray(4, 36));
        const programData = await conn.getAccountInfo(programDataAddress, "confirmed");
        const data = programData?.data;
        const isProgramData = !!programData && programData.owner.equals(UPGRADEABLE_LOADER)
          && !!data && data.length >= 45 && data.readUInt32LE(0) === 3;
        const actualAuthority = isProgramData && data[12] === 1
          ? new PublicKey(data.subarray(13, 45))
          : null;
        check("on-chain upgrade authority", isProgramData && !!upgradeAuthority
          && !!actualAuthority && actualAuthority.equals(upgradeAuthority));
        if (isProgramData && data && expectedProgramBytes > 0 && expectedProgramBytes <= data.length - 45) {
          const deployedBytes = data.subarray(45, 45 + expectedProgramBytes);
          const trailing = data.subarray(45 + expectedProgramBytes);
          const deployedHash = createHash("sha256").update(deployedBytes).digest("hex");
          check("deployed bytecode matches frozen artifact", deployedHash === expectedProgramHash
            && trailing.every((byte) => byte === 0));
        } else {
          check("deployed bytecode matches frozen artifact", false);
        }
      } else {
        check("on-chain upgrade authority", false);
        check("deployed bytecode matches frozen artifact", false);
      }
    }
    if (operator) {
      const balance = await conn.getBalance(operator.publicKey, "confirmed");
      check("operator funded", balance > 0);
    }
  } catch (err) {
    check("RPC access", false, err instanceof Error ? err.message : "unavailable");
  }
}

process.stdout.write(`\n${failures.length ? `${failures.length} release check(s) failed` : "Configuration checks passed"}.\n`);
process.exitCode = failures.length ? 1 : 0;
