# ADR-004: On-Chain Governance for Protocol Parameter Updates

**Status:** Accepted  
**Date:** 2026-06-17  
**Authors:** JamesVictor-O

## Context

Protocol parameters (`fee_bps`, `treasury`, `tip_cooldown_window`) are currently controlled by a single admin key. This creates a centralisation risk: if the admin key is compromised, an attacker can set `fee_bps = 10000` (100 % fee, draining all tips to treasury), change the treasury to their own address, or disable tip cooldowns to enable spam.

A production SocialFi protocol needs an on-chain governance system where parameter changes require a quorum of stakeholders to approve, with a time-lock before execution.

## Decision

We implement a gas-metered, Turing-incomplete on-chain governance module directly inside the Linkora contract. The design is address-weighted (one address = one vote) with quorum decay, an adaptive time-lock, and a veto mechanism.

## Design

### 1. Token-Weighted vs Address-Weighted Voting

| Criterion | Token-weighted | Address-weighted |
|---|---|---|
| Plutocracy resistance | Low — whales dominate | Higher — each address gets one vote |
| Sybil resistance | Naturally Sybil-resistant (tokens are scarce) | Weaker against Sybil, but in a social context profiles are identity-linked |
| Fairness in SocialFi | Poor — social influence ≠ token holdings | Better — aligns with "one person, one voice" ethos |

**Choice: Address-weighted.** In a social protocol, governance should reflect community participation, not capital. Since Linkora profiles are identity-linked (unique usernames, social graphs), Sybil attacks require creating plausible social identities, which is costly.

### 2. Quorum Decay

If quorum is never reached, proposals would be stuck forever. We use a decay function:

```
effective_quorum(proposal) = max(
    quorum_floor,
    base_quorum - (elapsed_ledgers * quorum_decay_rate_bps / 10_000)
)
```

Where:
- `base_quorum`: initial required quorum (e.g., 60%)
- `quorum_decay_rate_bps`: basis points of quorum decayed per ledger (e.g., 10 bps = 0.1% per ledger)
- `quorum_floor`: hard minimum quorum that decay cannot breach (e.g., 30%)
- `elapsed_ledgers`: `current_ledger - proposal.created_ledger`

This ensures low-interest proposals can still pass with reduced participation, while the floor prevents trivially passing proposals.

### 3. Time-Lock Duration

Trade-offs:
- **Too short** (< 100 ledgers / ~8 min): community has no time to react to malicious proposals
- **Too long** (> 100,000 ledgers / ~6 days): protocol cannot respond to emergencies

**Design:** A configurable `time_lock_ledgers` stored in `GovConfig`. The admin retains emergency bypass capability (direct `set_fee` / `set_treasury`) for genuine emergencies, emitting `EmergencyBypassEvent` for transparency.

Default: `time_lock_ledgers = 17_280` (~1 day at 5 s/ledger).

### 4. Veto Mechanism

Any pool's threshold signers can veto a passed proposal during the time-lock window. This provides a safety net against governance attacks where an adversary acquires enough votes to pass a harmful proposal.

Veto requires providing a `pool_id` and a set of signers that meet the pool's M-of-N threshold. The implementation validates each signer against the pool's admin list and requires `pool.threshold` valid signatures, matching the same authorization pattern used for pool withdrawals. No standalone admin auth is required — the pool threshold signers are sufficient on their own.

### 5. Comparison with Existing Governance Systems

#### OpenZeppelin Governor (Solidity)
- Uses token-weighted voting via ERC20Votes — we use address-weighted instead
- Has a fixed quorum — we add quorum decay
- Time-lock via TimelockController — similar concept, we store `time_lock_ledgers` in config
- No built-in veto — we add admin veto during time-lock

#### Cosmos SDK Governance
- Deposit phase to filter spam — not needed here (proposer must have auth)
- Validator-weighted voting — not applicable to Soroban
- Governance parameters stored in module params — we use `GovConfig` in persistent storage
- Burn deposit on failed proposals — not applicable (no deposit mechanism)

#### Soroban-Specific Constraints
- No re-entrancy risk (Soroban is single-threaded per invocation)
- Ledger sequence is the only reliable time source (no block.timestamp equivalent for governance windows)
- All storage must be explicitly typed and TTL-managed — all governance keys use `Persistent` with TTL bump
- No built-in mapping iteration — we use explicit proposal IDs with a counter

### 6. Storage Layout

All governance storage uses `Persistent` storage with TTL bump:

1. `StorageKey::GovProposal(u64)` — stores `GovProposal { id, proposer, parameter, new_value, new_address, votes_for, votes_against, created_ledger, status }`
2. `StorageKey::GovVote(u64, Address)` — prevents double-voting (stores `true`)
3. `StorageKey::GovConfig` — stores `GovConfig { quorum, time_lock_ledgers, vote_window_ledgers, quorum_decay_rate_bps, quorum_floor }`
4. `StorageKey::GovProposalCount` — auto-incrementing counter for the next proposal ID
5. `GovParameter` enum: `FeeBps`, `Treasury`, `TipCooldownWindow`, `GovQuorum`, `GovTimeLock`, `GovVoteWindow`

### 7. Functions

1. `gov_init_config` — Initialize governance configuration (admin-only)
2. `gov_propose` — Create a new governance proposal
3. `gov_vote` — Vote on a proposal (one vote per address)
4. `gov_execute` — Execute a passed proposal after time-lock
5. `gov_veto` — Admin pool veto during time-lock window
6. `gov_get_proposal` — Read a proposal
7. `gov_get_config` — Read governance config
8. `effective_quorum` — Calculate current effective quorum with decay
9. `set_fee` (emergency bypass) — Existing admin function, now emits `EmergencyBypassEvent`
10. `set_treasury` (emergency bypass) — Existing admin function, now emits `EmergencyBypassEvent`

## Consequences

### Positive
- Decentralises parameter control, reducing single-point-of-failure risk
- Quorum decay prevents perpetually stuck proposals
- Veto mechanism provides safety net against governance attacks
- Emergency bypass preserves ability to respond to critical issues

### Negative
- Increased contract complexity and storage usage
- Address-weighted voting has weaker Sybil resistance than token-weighted
- Governance participation may be low initially, relying on quorum decay

### Neutral
- Admin retains emergency powers, which is a pragmatic trade-off for a protocol that is not yet fully decentralised
