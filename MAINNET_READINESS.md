# The Pit mainnet release review — 11 October 2026

## Current decision: NO GO

Railway production was verified on devnet on 11 October. Its Panta API key is
live and its database and Privy variables are set, but it has no server-side
production Solana RPC and still has the devnet cluster and a non-mainnet USDC
mint. The operator `C4kBbe3c6hMMkr7TSyjK7hKBiL9cd7myErJAmqYwKHc5` has
0 SOL on mainnet, and the intended escrow program
`Ea9pUaAdVwuR71L5xv6SYdryLXeTuMRUtEkMChaBUyUx` is absent there. No
mainnet deployment transaction was submitted. Mainnet rent for 134,333 bytes
of ProgramData is 0.68306188 SOL; deployment also needs a temporary buffer,
the Program account, transaction fees, and headroom. These were read from
mainnet RPC, not estimated from devnet.

An internal review found that settlement could still be closed after the
recovery deadline, defeating a player's recovery right, and the proposed
deployment shared the online operator key with the upgrade authority. Source
changes below close those paths, but the changes have not yet passed a full
devnet deposit → trade → settle → claim/recover test or an external audit.
Do not route real USDC through this build yet.

This is a code review and local test pass, not an independent smart contract
audit or a guarantee that all vulnerabilities have been found. The operator
also chooses each player's settlement entitlement; the program conserves
escrowed funds but does not verify off-chain rankings. A compromised operator
could award the pool unfairly to an account it controls. This trust assumption
must be explicit before real-money use.

## Changes made in this pass

- `CloseSettlement` and `CloseRefund` now require every unique on-chain
  depositor entry to be settled or recovered, checked atomically with the
  on-chain deposit counter. Settlement must allocate every remaining USDC
  base unit. A recovered entry can no longer be settled a second time.
- Ordinary settlement now closes before the recovery deadline. `CloseRefund`
  atomically assigns each depositor exactly their original entry plus vault
  deposit; it cannot redirect value to another player.
- The server supplies all depositor accounts to the close instruction.
- `Deposit` now requires the round operator's signature. The server only
  co-signs an enrolling wallet after its X/profile and balance checks, so
  a direct unauthenticated program call cannot consume capacity.
- Live Panta order, claim, position, market, category, and trade-history errors
  no longer fall back to fabricated data. An unconfirmed order is not shown
  as confirmed, and a Panta order starts only after its pit trade succeeds.
- Paid hosting requires persistent storage; mainnet hosting also requires a
  live Panta key, canonical mainnet USDC mint, escrow, Privy, and session
  secret. Runtime gates compare the RPC genesis to the cluster label and apply
  the same mainnet checks to paid market quotes and builds.
- Mainnet deployment now separates the online operator/payer from the offline
  upgrade authority. Release preflight checks the configured authority and
  frozen bytecode hash/size against the on-chain ProgramData account.
- Mainnet deposits use the shared paid-release gate and require the RPC's
  genesis hash to match the selected cluster. Claim and recovery use only the
  player's signature, so removing the online operator key pauses new deposits
  without hiding existing positions or blocking withdrawals through the app.
- Mainnet Railway starts run the read-only release preflight before Next.js
  accepts traffic. It checks both RPC genesis hashes and the deployed program
  identity, authority, and bytecode; devnet starts are unchanged. During an
  incident, `MAINNET_RECOVERY_MODE=YES` lets the app serve existing claims and
  recoveries when preflight fails, while blocking new paid activity.
- A trade is rejected if its round changes while its price is being fetched.

## Blocking work before a real-funds launch

1. **On-chain admission integration:** the new operator co-signing path has
   compiled but has not been exercised with a Privy wallet. Upgrade the
   devnet program to this exact bytecode, then test a valid co-signed deposit,
   expired transaction retry, and direct unsigned/hostless hostile deposit.
   A server endpoint check alone cannot block direct program calls.
2. **Independent escrow review and tests:** commission an external Solana
   program audit. Add program integration tests covering deposits during
   settlement, deadline recovery, refund close, duplicate entries,
   conservation, host compromise, fee accounts, and timeout recovery. The
   Rust suite contains helper tests only; no program-test suite exists.
3. **Production infrastructure:** provision a dedicated server-only mainnet
   RPC with indexing support for `getProgramAccounts`, a separate
   browser-safe production RPC, durable Postgres with backup and restore
   drill, a production Privy app, and isolated operator/payer and offline
   upgrade keys. Set the canonical mainnet USDC mint, deploy only the
   reviewed escrow program, and run `npm run preflight:mainnet` against the
   production environment.
4. **Realistic canary:** run the exact build through a complete devnet cycle,
   then a limited mainnet canary with capped deposits and monitored operator
   balance, transaction landing, settlement, and user claims. Verify a
   recovery after the deadline in a controlled test. Record signatures.
5. **Legal and operations:** get jurisdiction-specific advice on the paid
   prediction/competition model, access restrictions, KYC/AML obligations,
   disclosures, dispute handling, support, incident response, and fund
   recovery before allowing public real-money play.

## Verification completed locally

- `npm run lint` — passed.
- `npm run build` — passed.
- `cargo test --locked --offline` — passed, four escrow helper regression tests.
- `cargo-build-sbf` — passed with the local Solana v1.54 toolchain; the `.so`
  was generated at `program/target/deploy/oracle_rumble_escrow.so`.
- The 11 October rebuild reproduced SHA-256
  `51f0c776b5861008fc3c8f89503b2568a339c35ed3949035e4b59114d1acfa96`
  (134,288 bytes). The CLI's default rustup invocation failed on this machine;
  the bundled platform toolchain built successfully, and the deployment script
  now retries with it.
- `npm run preflight:mainnet` — failed as expected because independent audit
  approval, production RPCs, persistent database, Privy credentials, separate
  upgrade authority, frozen bytecode identity, and mainnet program ID are not
  configured. Network checks did not run without the server RPC. No key values
  were printed.

## Release order after blockers are resolved

1. Freeze a reviewed Git commit, run the full test suite and SBF build from
   that commit, and preserve the bytecode hash. Keep the devnet and mainnet
   program IDs and keys separate unless reuse is intentional and documented.
2. Deploy the reviewed program from a funded dedicated deployer to the
   intended mainnet RPC. Confirm program ID, executable state, upgrade
   authority, and bytecode/source verification before any app traffic.
3. Configure production variables in an isolated Railway environment. Run
   `npm run preflight:mainnet` **there**, not only on a developer laptop. The
   Railway start command repeats this check before accepting mainnet traffic.
4. Release the matching app commit. Railway currently deploys the `main`
   branch on push, so inspect all existing uncommitted changes before merge.
5. Run a small canary from two fresh wallets. Confirm deposit, trading,
   settlement, each claim, and any refund on Solana and in the database.
6. Expand access gradually with alerting, a pause procedure, and a written
   rollback plan. A web rollback cannot undo an on-chain deployment or
   already accepted deposits; keep recovery and settlement available.

The previous audit's code changes were pushed to GitHub `main`. The local `video/` directory is
excluded from the current branch and remains on the developer machine. The
earlier pushed commit that contained the video files remains in branch history;
the removal commit makes them absent from the current tree. No mainnet
transaction or live Panta order has been performed in this readiness pass.
