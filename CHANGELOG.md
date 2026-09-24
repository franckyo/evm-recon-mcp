# Changelog

## 0.1.2 — 2026-09-23

### Fixed
- **The server reported version `0.1.0` over MCP while publishing as `0.1.1`.** The version
  passed to `McpServer` was a hardcoded string that was not bumped with the package. It is now
  read from `package.json` at startup, so the two cannot drift again. Caught by end-to-end
  verification of the published 0.1.1 artifact, not by any test — a test now covers it.

## 0.1.1 — 2026-09-23

Post-release review found seven issues; all are fixed here. Two produced confidently wrong
output rather than failing loudly, which is the worst failure mode for an analysis tool.

### Fixed
- **`PUSH0` was excluded from static jump analysis.** `PUSH0` is opcode `0x5f`, outside the
  `PUSH1..PUSH32` range, so `PUSH0; JUMP` — a jump to offset `0x00` — was never validated.
  The headline invalid-jump check silently skipped it.
- **Non-hex input produced a plausible but wrong storage slot.** `pad32` validated length but
  not hex-ness; `parseInt("ZZ", 16)` yields `NaN`, which coerces to `0` in a `Uint8Array`. A
  single typo in an address returned a real-looking hash derived from zeroed bytes. Hex input
  is now validated and rejected.
- **`eth_call` reported network failures as `REVERTED`.** An unreachable or rate-limited RPC
  was indistinguishable from a contract rejecting the call. Execution verdicts and transport
  failures are now separate outcomes, and an execution error is no longer failed over between
  endpoints (every node returns the same verdict).
- **Disassembly silently stopped at 20,000 instructions**, below the 24,576-byte maximum
  contract size, so analysis could be incomplete while reporting all jumps valid. The cap is
  now 30,000.

### Changed
- Removed `main` from `package.json`. It pointed at the CLI entry, which connects a stdio
  transport at import time, so `import("evm-recon-mcp")` would hang.
- Broadened EVM execution-error detection: geth-family nodes report reverts as `-32000` with
  a descriptive message (e.g. `invalid jump destination`), not the standard code `3`.

### Added
- Test suite: 14 tests covering keccak vectors, selectors, storage-slot derivation,
  disassembly, jump validation, and calldata decoding. Includes regression tests for both
  silent-wrong-answer bugs above.
- GitHub Actions CI on Node 18, 20 and 22.
- Committed the stdio smoke test (`test/smoke-stdio.mjs`), which exercises all 8 tools over
  real MCP against live chains.

## 0.1.0 — 2026-09-23

Initial release.
