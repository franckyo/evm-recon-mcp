# evm-recon-mcp

[![npm](https://img.shields.io/npm/v/evm-recon-mcp)](https://www.npmjs.com/package/evm-recon-mcp)
[![CI](https://github.com/franckyo/evm-recon-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/franckyo/evm-recon-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/evm-recon-mcp)](./LICENSE)

**Give your AI assistant the ability to read deployed smart contracts.**

An [MCP](https://modelcontextprotocol.io) server for EVM contract reconnaissance: fetch bytecode, disassemble it, detect invalid jump targets, read storage slots, derive Solidity storage layouts, and decode calldata — on any EVM chain, **with no API key**.

Built for security researchers, auditors, and CTF players who keep hitting the same wall: the contract is unverified, there's no source, and you need to understand what it actually does.

Read-only by design. No private keys, no signing, no transactions.

---

## Install

```bash
npx evm-recon-mcp
```

**Claude Code:**
```bash
claude mcp add evm-recon -- npx -y evm-recon-mcp
```

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "evm-recon": { "command": "npx", "args": ["-y", "evm-recon-mcp"] }
  }
}
```

Requires Node 18+.

---

## The part you can't get elsewhere: invalid jump detection

Most disassemblers print opcodes. This one also tells you which jumps **cannot land**.

In the EVM, jumping to anything that isn't a `JUMPDEST` is an exceptional halt — the call reverts and consumes all gas. When a `PUSH` is immediately followed by `JUMP`/`JUMPI`, the target is statically known, so it can be checked. Hand-written assembly and puzzle contracts get this wrong constantly, sometimes deliberately.

```
=== 0x60055600005b00
0000: PUSH1 0x05
0002: JUMP
0003: STOP
0004: STOP
0005: JUMPDEST
0006: STOP

All statically-resolvable jump targets are valid JUMPDESTs.
```

Change the push by one byte:

```
=== 0x60045600005b00
0000: PUSH1 0x04
0002: JUMP
...

!! 1 INVALID JUMP TARGET(S) — these revert if taken:
   pc 0x0002 JUMP -> 0x4: target is STOP, not JUMPDEST — taking this jump
   halts exceptionally (reverts, consumes all gas)
```

That single line is often the whole answer to "why does this always revert?"

The decoder also skips `PUSH` immediate data correctly, so a `0x5b` byte sitting inside push data is **not** mistaken for a jump destination — a classic source of wrong disassembly.

---

## Tools

| Tool | What it does |
|---|---|
| `get_bytecode` | Fetch deployed runtime bytecode (`eth_getCode`) |
| `disassemble` | Disassemble an address or raw hex, with PC offsets + invalid-jump analysis |
| `read_storage` | Read a raw storage slot (`eth_getStorageAt`), with uint/address interpretations |
| `compute_storage_slot` | Derive mapping, nested mapping, array, and hand-rolled `keccak(words)` slots |
| `decode_calldata` | Split calldata into selector + 32-byte words, name known selectors |
| `function_selector` | Compute 4-byte selectors from canonical signatures |
| `eth_call` | Simulate a read-only call; reports returned vs reverted |
| `list_chains` | List built-in chains |

### Storage slot derivation

Reading an unverified contract's state means knowing where the state lives:

- `mapping` — `keccak256(pad32(key) . pad32(slot))`
- `nested_mapping` — applied left to right for `mapping(a => mapping(b => c))`
- `array` — `keccak256(pad32(slot)) + index`
- `keccak_words` — `keccak256` over concatenated 32-byte words, which is what hand-written assembly does when it `MSTORE`s values and hashes the region. Compiler-generated layouts don't cover this; hand-rolled ones need it.

---

## Chains

Built in: `ethereum`, `sepolia`, `holesky`, `polygon`, `polygon-amoy`, `arbitrum`, `optimism`, `base`, `base-sepolia`, `bsc`, `avalanche`, `gnosis`, `scroll`, `linea`.

Any other network works by passing `rpc_url` directly. Each chain has multiple public endpoints and fails over automatically, so a single dead RPC doesn't stop you.

---

## Example prompts

> Disassemble `0x…` on Base and tell me whether any jump target is invalid.

> This contract is unverified. Read storage slot 0 and slot 1, and tell me what they probably are.

> What's the storage slot for `balances[0xd8dA…]` if `balances` is at slot 2?

> Decode this calldata and tell me which function it calls.

---

## Safety

Every tool is read-only. The server never signs, never broadcasts, and never asks for a private key. `eth_call` is a simulation — nothing reaches the chain.

Public RPC endpoints see the addresses you query and your IP. For sensitive work, pass your own `rpc_url`.

---

## License

MIT
