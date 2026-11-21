# Tari Milestone Escrow

A small escrow for freelance work on Tari Ootle. A payer locks a budget for two or three milestones; the payee submits each deliverable; and each milestone settles exactly once. The payer can approve or dispute delivered work. A neutral arbiter can release or refund disputed funds, and the payer can reclaim a funded milestone that expires without a submission.

**[Open the walletless demo](https://zq051031.github.io/tari-build-contest-2026/)** · Default judge path. This link becomes available when the repository owner enables GitHub Pages from branch `main`, folder `/docs`. The local demo below has the same features and requires no account, wallet, faucet, network call from the app, or real funds.

## Try the demo

Serve the static files from this repository:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory docs
```

Open [localhost:8000](http://127.0.0.1:8000/) and click **Run step** ten times:

1. Create the sample agreement and fund the exact 600 simulated XTM.
2. Submit Discovery as the payee. Approve it as the payer and see 150 move to the payee.
3. Repeat the release. It is rejected and does not move any funds.
4. Submit Prototype, dispute it, then act as the arbiter and refund its 200 to the payer.
5. Advance the simulated epoch to Handoff's deadline without a delivery, then claim the 250 refund.

The final ledger shows **150 simulated XTM paid, 450 refunded, 0 locked**. For an alternate path, use the workbench instead of the guide: change the draft terms, create an escrow, switch roles, and choose **Resolve: release** on a disputed milestone. The role dropdown and clock are local simulation controls, not wallet authentication or chain time. Reset clears the draft, balances and ledger. Reloading also clears them.

## State and authorization

The Ootle template uses a separate component and vault for each agreement. Terms must have distinct role keys, 2–3 positive milestone amounts that sum exactly to a positive total, and deadlines in the future. The payer authorizes creation; the escrow starts unfunded. Only the payer can fund it, once, with the exact revealed amount before any deadline. No milestone action is allowed before funding.

| Current state | Action | Required role | Result |
| --- | --- | --- | --- |
| Pending | Submit a nonblank work reference (1–240 UTF-8 bytes) before the deadline | Payee | Submitted |
| Submitted | Approve | Payer | Released to payee |
| Submitted | Dispute | Payer | Disputed |
| Disputed | Resolve in favor of the payee or payer | Arbiter | Released to payee or refunded to payer |
| Pending | Claim expiry at or after the deadline | Payer | Refunded to payer |

Deadlines use `Consensus::current_epoch()` in the template; the browser uses a controllable epoch. A submission is never eligible for a timeout refund. Timely submissions and disputes can still be settled after the deadline. Released and refunded are terminal. A milestone is independent of the others.

This MVP tests one job-agreement flow. It does not handle real work uploads, recurring payments, milestone renegotiation, partial releases, confidential escrow deposits, or an inactive payer or arbiter after submission. Work references in the template are public; never put sensitive data in them.

## Architecture and verification

- [`src/escrow.rs`](src/escrow.rs) is the testable Rust transition model. It returns a settlement only when a milestone moves to a terminal state.
- [`src/lib.rs`](src/lib.rs) is the deployable Rust template, built using the official pinned [`tari_template_lib` 0.42.0](https://crates.io/crates/tari_template_lib). Immutable component access rules require the relevant public-key badge; there is no owner override. The template funds a vault and deposits settlements directly to fixed, built-in account components rather than letting the caller take a payout bucket. The payer picks its refund account at creation. The payee picks its own payout account on the first successful delivery and uses it for later deliveries. The arbiter cannot change either account.
- [`docs/`](docs/) is HTML, CSS and ES modules. The JS model mirrors the Rust rules using whole simulated XTM and maintains a visible ledger; it does not call the WASM, use RPC, or hold assets.
- [`tests/`](tests/) covers the Rust model, browser model, and both browser paths. [`tools/template-check/`](tools/template-check/) separately uses the official [`tari_template_test_tooling` 0.55.0](https://crates.io/crates/tari_template_test_tooling) and Ootle engine to compile, validate and load the actual template WASM and check the ABI. This test does not sign or execute transactions.

Local commands and results (Rust 1.99.1, Node 24.22.2, Chrome 156):

| Command | Result |
| --- | --- |
| `cargo build` | Exit 0 |
| `cargo test` | 8 passed, 0 failed |
| `cargo clippy -- -D warnings` | Exit 0 |
| `cargo fmt --all -- --check` | Exit 0 |
| `cargo fmt --manifest-path tools/template-check/Cargo.toml --all -- --check` | Exit 0 |
| `cargo build --release --target wasm32-unknown-unknown` | Exit 0 |
| `cargo test --manifest-path tools/template-check/Cargo.toml` | 1 passed, 0 failed; official engine validated and loaded the WASM |
| `node --test tests/demo.test.mjs` | 5 passed, 0 failed |
| `node tests/browser.mjs` | Guided and custom scenarios passed in headless Chrome |

Install the Wasm target with `rustup target add wasm32-unknown-unknown` before either Wasm check. The browser smoke test requires Node 22+ and Chrome; set `CHROME_BIN` if its executable is not `google-chrome`.

## Optional live Ootle path

The default demo does not connect to Esmeralda, Sapient or any other network. The Rust component was checked offline with the pinned Ootle SDK and engine; it was not published or exercised in a signed transaction. A live operator would need a compatible network release, funded accounts, three signer identities, and testnet fees, all outside the contest demo.

1. Build the artifact with `cargo build --release --target wasm32-unknown-unknown`: `target/wasm32-unknown-unknown/release/tari_milestone_escrow.wasm`. See the official [publishing guide](https://ootle.tari.com/guides/publishing-templates/) for the wallet-side workflow.
2. Create an instance with the three public keys, payer's refund account, exact total, parallel amount and deadline vectors. Amounts are integer microtari; deadlines are absolute consensus epochs; indices are zero-based. The live template holds revealed Ootle `TARI_TOKEN` balance, not L1 XTM or confidential UTXOs. See [Ootle tokenomics](https://ootle.tari.com/concepts/tokenomics/) for the distinction.
3. In the payer's funding transaction, pass the exact revealed native-token bucket to `fund`. Each authorized role can then call its method from the state table. `submit` takes the milestone index, a work reference and the payee's chosen built-in receiving account; `resolve` takes an index and `release_to_payee` boolean. Use built-in accounts that permit escrow deposits. `status`, `reference`, and `locked_balance` are public queries. Review the official [transaction guide](https://ootle.tari.com/guides/transaction-overview/) before attempting a live transaction.

## Contest handoff

- **Project:** Tari Milestone Escrow — an MVP for funding and settling freelance milestone work on Tari Ootle.
- **Public code:** [ZQ051031/tari-build-contest-2026](https://github.com/ZQ051031/tari-build-contest-2026)
- **MVP app:** [GitHub Pages demo](https://zq051031.github.io/tari-build-contest-2026/) (available after enabling Pages on `main` / `docs`).
- **Tari payment address:** **TODO — entrant adds their own Tari payment address.**
- **Public social-media announcement:** **TODO — entrant adds their public announcement link.**
- **Deadline:** December 1, 2026 at 00:00 UTC (December 1, 2026 at 08:00 China Standard Time).
- **Prizes:** 1st: 1,000,000 XTM · 2nd: 500,000 XTM · 3rd: 250,000 XTM.
- [Official contest thread](https://community.tari.com/t/november-build-contest-thread-mvp/520) · [Full rules](https://community.tari.com/t/ootle-launch-date-and-launch-contest-rules/323/1).

This is original contest code released under the [MIT License](LICENSE). The entrant is responsible for the public announcement and forum submission.
