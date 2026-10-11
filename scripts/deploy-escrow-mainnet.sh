#!/usr/bin/env bash
# Initial mainnet deployment only. The operator/payer and upgrade authority
# must be separate: the operator key is loaded by the online web server.
# The program-ID keypair is separate because Solana needs one to create the
# program address; it does not need to hold SOL.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RPC="${SOLANA_MAINNET_RPC:-}"
ADMIN_KEYPAIR="${MAINNET_ADMIN_KEYPAIR:-.keys/mainnet-admin.json}"
UPGRADE_KEYPAIR="${MAINNET_UPGRADE_AUTHORITY_KEYPAIR:-}"
PROGRAM_KEYPAIR="${MAINNET_PROGRAM_KEYPAIR:-.keys/escrow-program-keypair.json}"
SO="program/target/deploy/oracle_rumble_escrow.so"
MAINNET_GENESIS="5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
EXPECTED_HASH="${MAINNET_PROGRAM_SHA256:-}"
EXPECTED_BYTES="${MAINNET_PROGRAM_BYTES:-}"

if [[ -z "$RPC" ]]; then
  echo "Set SOLANA_MAINNET_RPC to a dedicated production mainnet RPC." >&2
  exit 1
fi
if [[ "$RPC" != https://* || "$RPC" =~ (devnet|testnet|api\.mainnet\.solana\.com|api\.mainnet-beta\.solana\.com) ]]; then
  echo "Use a dedicated HTTPS mainnet RPC; public Solana endpoints are not accepted for deployment." >&2
  exit 1
fi
if [[ "${MAINNET_AUDIT_APPROVED:-}" != "YES" ]]; then
  echo "An independent security review must be complete before deployment. Set MAINNET_AUDIT_APPROVED=YES only after it is complete." >&2
  exit 1
fi
if [[ ! "$EXPECTED_HASH" =~ ^[a-f0-9]{64}$ || ! "$EXPECTED_BYTES" =~ ^[1-9][0-9]*$ ]]; then
  echo "Set MAINNET_PROGRAM_SHA256 and MAINNET_PROGRAM_BYTES to the independently reviewed artifact identity." >&2
  exit 1
fi
if [[ ! -f "$ADMIN_KEYPAIR" || ! -f "$UPGRADE_KEYPAIR" || ! -f "$PROGRAM_KEYPAIR" ]]; then
  echo "Missing payer, separate upgrade-authority, or program-ID keypair. Keep signer files private and gitignored." >&2
  exit 1
fi

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

GENESIS="$(solana genesis-hash --url "$RPC")"
if [[ "$GENESIS" != "$MAINNET_GENESIS" ]]; then
  echo "RPC genesis hash is not Solana mainnet; refusing deployment." >&2
  exit 1
fi

ADMIN="$(solana address --keypair "$ADMIN_KEYPAIR")"
UPGRADE="$(solana address --keypair "$UPGRADE_KEYPAIR")"
PROGRAM_ID="$(solana address --keypair "$PROGRAM_KEYPAIR")"
if [[ "$ADMIN" == "$UPGRADE" || "$ADMIN" == "$PROGRAM_ID" || "$UPGRADE" == "$PROGRAM_ID" ]]; then
  echo "Payer, upgrade authority, and program-ID key must be distinct." >&2
  exit 1
fi
if [[ -n "${MAINNET_UPGRADE_AUTHORITY:-}" && "$UPGRADE" != "$MAINNET_UPGRADE_AUTHORITY" ]]; then
  echo "Upgrade signer does not match MAINNET_UPGRADE_AUTHORITY." >&2
  exit 1
fi
if solana program show --url "$RPC" "$PROGRAM_ID" >/dev/null 2>&1; then
  echo "Program ID already exists on mainnet. Refusing initial deploy; use a reviewed upgrade procedure." >&2
  exit 1
fi

echo "Building escrow program from the current source..."
if ! (cd program && cargo-build-sbf); then
  # Some Solana CLI installations bundle Cargo but do not register the bundled
  # toolchain with rustup. Build with that exact platform toolchain instead.
  SBF_VERSION="$(cargo-build-sbf --version | awk '/^platform-tools / {print $2}')"
  SBF_TOOLS="$HOME/.cache/solana/$SBF_VERSION/platform-tools/rust/bin"
  if [[ -z "$SBF_VERSION" || ! -x "$SBF_TOOLS/cargo" || ! -x "$SBF_TOOLS/rustc" ]]; then
    echo "SBF build failed and the bundled platform toolchain is unavailable." >&2
    exit 1
  fi
  echo "Retrying SBF build with bundled platform tools $SBF_VERSION..."
  (cd program && CARGO="$SBF_TOOLS/cargo" RUSTC="$SBF_TOOLS/rustc" \
    cargo-build-sbf --no-rustup-override --offline)
fi

ACTUAL_HASH="$(shasum -a 256 "$SO" | awk '{print $1}')"
ACTUAL_BYTES="$(wc -c < "$SO" | tr -d ' ')"
if [[ "$ACTUAL_HASH" != "$EXPECTED_HASH" || "$ACTUAL_BYTES" != "$EXPECTED_BYTES" ]]; then
  echo "Built artifact does not match the independently reviewed SHA-256 and byte size; refusing deployment." >&2
  echo "Actual SHA-256: $ACTUAL_HASH" >&2
  echo "Actual bytes: $ACTUAL_BYTES" >&2
  exit 1
fi

echo "Mainnet payer/operator: $ADMIN"
echo "Mainnet offline upgrade authority: $UPGRADE"
echo "New program ID: $PROGRAM_ID"
echo "Payer balance: $(solana balance --url "$RPC" --keypair "$ADMIN_KEYPAIR")"
echo "Program bytecode SHA-256: $ACTUAL_HASH"
echo "Program bytecode bytes: $ACTUAL_BYTES"
echo "Deploying reviewed bytecode..."
solana program deploy "$SO" \
  --url "$RPC" \
  --keypair "$ADMIN_KEYPAIR" \
  --program-id "$PROGRAM_KEYPAIR" \
  --upgrade-authority "$UPGRADE_KEYPAIR" \
  --use-rpc

echo "Verify executable program and record this program ID: $PROGRAM_ID"
