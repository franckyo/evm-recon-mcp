# evm-recon-mcp v0.1.0 — post-ship code review

Reviewed 2026-09-23, after publication. Every finding below was **reproduced by running the
shipped code**, not inferred by reading it. Commands to reproduce are included.

Verdict: **ship was correct, but v0.1.1 should not wait.** Two findings are the kind that
matter most in a security tool — it returns a confident wrong answer rather than failing loudly.

---

## HIGH — 1. The headline feature has a blind spot: `PUSH0; JUMP` is never checked

`src/evm/disasm.ts`

The README leads with invalid-jump detection. It misses the `PUSH0` case entirely.

`PUSH0` is opcode `0x5f`, outside the `0x60–0x7f` PUSH range, so the decoder never sets
`instr.push`. Pass 2 only inspects instructions where `push !== undefined`, so `PUSH0`
followed by `JUMP`/`JUMPI` — a jump to offset `0x00` — is skipped.

```
$ node -e 'import("./dist/evm/disasm.js").then(m=>{
    const d=m.disassemble(m.hexToBytes("0x5f5600"));   // PUSH0; JUMP; STOP
    console.log(d.invalidJumps.length)})'
0        <-- should be 1; pc 0 is PUSH0, not JUMPDEST
```

Fix: treat `PUSH0` as a push of `0x00` in the static-jump pass.

## HIGH — 2. Non-hex input silently produces a wrong storage slot

`src/evm/slots.ts` — `keccakHex()` / `pad32()`

`pad32` validates length but never validates that the input is hexadecimal. `keccakHex` then
does `parseInt("ZZ", 16)` → `NaN`, and assigning `NaN` into a `Uint8Array` coerces to `0`. The
function returns a real-looking 32-byte hash derived from silently zeroed bytes.

```
$ node -e 'import("./dist/evm/slots.js").then(m=>
    console.log(m.mappingSlot("0xZZZZ", 2)))'
0xac33ff75c19e70fe83507db0d683fd3465c996598dc972688b7ace676c89077b
```

An auditor with a typo in an address gets a plausible slot, reads storage at it, sees zeroes,
and concludes the mapping entry is empty. **Wrong answer delivered confidently** is the worst
failure mode for this class of tool — it's the same shape as the dead-oracle problem.

Fix: validate `/^[0-9a-fA-F]*$/` in `pad32` and `keccakHex`, throw otherwise.

## MEDIUM — 3. `eth_call` reports network failures as "REVERTED"

`src/index.ts`

```ts
} catch (e: any) {
  return text(`REVERTED (or rejected by the node).\n${...}`);
}
```

`rpcCall` throws for *any* failure — every endpoint down, DNS failure, timeout, rate limit —
and all of them are presented as a revert. The README sells this tool for "probing which
calldata and value combinations a contract accepts," so a transient network fault reads as a
definitive negative result about the contract.

Fix: distinguish a node-reported execution revert (JSON-RPC error with revert data) from a
transport failure, and label them differently.

## MEDIUM — 4. Zero tests and no CI in the repository

```
$ git ls-files | grep -iE "test|spec|\.github"
(nothing)
```

The package was genuinely tested before publishing — the full 8-tool suite ran over stdio
against live chains, and against the published artifact — but that harness is in `.gitignore`
and ships nowhere. A technical buyer evaluating this as a work sample checks for tests first,
and finds none. For a security tool that is a credibility problem, independent of correctness.

Fix: commit the stdio test client, add a GitHub Actions workflow running build + tests.

## MEDIUM — 5. Disassembly silently stops at 20,000 instructions

`src/evm/disasm.ts` — `maxInstructions = 20000`

The EVM max contract size is 24,576 bytes, so a large contract exceeds the cap:

```
instructions decoded: 20000 of 24576
truncated flag: true
```

Jump analysis over everything past instruction 20,000 never runs. The only signal is a boolean
`truncated`, and the formatted output mentions it only if `max_lines` was also exceeded. A user
can receive "All statically-resolvable jump targets are valid JUMPDESTs" for a contract that
was only 80% analysed.

Fix: raise the cap above max contract size, and make partial analysis a loud warning attached
to the invalid-jump verdict rather than a separate flag.

## LOW — 6. `main` points at the CLI entry

`package.json` has `"main": "dist/index.js"`, the same file as `bin`. That module executes
`await server.connect(new StdioServerTransport())` at import time — so
`import("evm-recon-mcp")` starts a stdio server and hangs rather than exposing an API.

Fix: drop `main`, or split a library entry from the CLI entry.

## LOW — 7. Missing release hygiene

No `CHANGELOG.md` (though `files` once referenced one), no npm version badge in the README, no
`engines` verification in CI.

---

## What holds up

Recorded because a review that only lists faults is not calibrated:

- **PUSH immediate data is skipped correctly.** A `0x5b` byte inside push data is not counted
  as a `JUMPDEST`. This is the classic naive-disassembler bug and the implementation gets it
  right — verified on the live 42-byte contract.
- **Verified against the published artifact, not the local build.** Registry shasum
  `4ce7cc3e…` matched the local tarball, and the full tool suite was re-run through
  `npx evm-recon-mcp@0.1.0`.
- **Read-only by construction.** No signing path, no key handling, no transaction broadcast.
  `eth_call` is simulation only.
- **Clean package.** 8 files, 11.1 kB, no `node_modules`, no `dist` in git, no stray files.
- **Endpoint failover works** — multiple RPCs per chain, first success wins, errors aggregate.
- **Correct judgment call on disclosure.** The OtterSec challenge contract was deliberately
  excluded from public examples.

## Recommended v0.1.1

1. Findings 1 and 2 — both are small, mechanical fixes with outsized correctness impact
2. Finding 4 — commit tests + CI; it is what converts this from "code" to "work sample"
3. Findings 3 and 5
4. Findings 6 and 7 with the same release

Findings 1, 2, 3 and 5 each deserve a regression test in the committed suite.
