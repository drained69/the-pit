import { STORE_ENABLED } from "@/lib/round-store";
import { escrowReady, configuredSolanaCluster } from "@/lib/escrow-server";

const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Shared server-side gate for paid mainnet hosting and market creation. */
export async function mainnetPaidReadinessError(): Promise<string | null> {
  if (process.env.MAINNET_RECOVERY_MODE === "YES") {
    return "New paid activity is paused while mainnet recovery mode is active.";
  }
  const rpc = process.env.SOLANA_RPC_URL ?? "";
  const browserRpc = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "";
  if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "mainnet-beta") {
    return "Mainnet is disabled until the app cluster is set to mainnet-beta.";
  }
  if (!rpc || !/^https:\/\//.test(rpc) || /api\.(mainnet|mainnet-beta)\.solana\.com/i.test(rpc)) {
    return "Mainnet needs a dedicated server-only production Solana RPC.";
  }
  if (!browserRpc || !/^https:\/\//.test(browserRpc)
    || /devnet|testnet/i.test(browserRpc) || /api\.(mainnet|mainnet-beta)\.solana\.com/i.test(browserRpc)) {
    return "The browser wallet RPC must also point to mainnet using a browser-safe endpoint.";
  }
  let network: "mainnet-beta" | "devnet" | "unknown";
  try { network = await configuredSolanaCluster(); }
  catch { return "The configured Solana RPC could not be reached."; }
  if (network !== "mainnet-beta") return "The configured Solana RPC did not identify as Solana mainnet.";
  if (!STORE_ENABLED) return "Mainnet requires persistent database storage.";
  if (!escrowReady()) return "Mainnet escrow is not fully configured.";
  if (process.env.NEXT_PUBLIC_USDC_MINT !== MAINNET_USDC) return "Mainnet requires Circle's Solana USDC mint.";
  if (!/^pk_live_/.test(process.env.PANTA_API_KEY ?? "")) return "Mainnet requires a live Panta API key.";
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) return "Mainnet identity is not fully configured.";
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  if (sessionSecret.length < 32 || sessionSecret === process.env.ESCROW_HOST_SECRET_KEY || sessionSecret === process.env.ROUND_HOST_SECRET) {
    return "Mainnet needs an independent session secret of at least 32 characters.";
  }
  return null;
}
