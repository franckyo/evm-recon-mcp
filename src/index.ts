#!/usr/bin/env node
/**
 * evm-recon-mcp — EVM contract reconnaissance over MCP.
 * Read-only. No private keys, no signing, no transactions.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CHAINS, chainList, resolveEndpoints, rpcCall, normalizeAddress, toHexQuantity } from "./evm/rpc.js";
import { hexToBytes, disassemble, formatDisassembly } from "./evm/disasm.js";
import { mappingSlot, nestedMappingSlot, arrayElementSlot, keccakWords, keccakUtf8, keccakRawHex } from "./evm/slots.js";
import { decodeCalldata, selectorOf } from "./evm/selectors.js";

const server = new McpServer({ name: "evm-recon-mcp", version: "0.1.0" });
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (e: unknown) => ({ content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true });

const chainArg = z.string().default("ethereum").describe(`Chain name. One of: ${chainList()}`);
const rpcArg = z.string().optional().describe("Custom JSON-RPC URL. Overrides `chain`; use for private or unlisted networks.");

server.registerTool("list_chains", {
  title: "List supported chains",
  description: "List built-in EVM chains with their chain IDs and explorers. Any other network works by passing rpc_url.",
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => text(
  Object.entries(CHAINS).map(([k, c]) => `${k.padEnd(14)} chainId=${String(c.chainId).padEnd(9)} ${c.explorer ?? ""}`).join("\n")
));

server.registerTool("get_bytecode", {
  title: "Fetch deployed bytecode",
  description: "Fetch a contract's deployed runtime bytecode via eth_getCode. Returns size and hex. Empty result means the address is an EOA or has no code.",
  inputSchema: { address: z.string().describe("Contract address (0x...)"), chain: chainArg, rpc_url: rpcArg,
                 block: z.string().optional().describe("Block tag or number. Default 'latest'.") },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ address, chain, rpc_url, block }) => {
  try {
    const eps = resolveEndpoints(chain, rpc_url);
    const code = await rpcCall(eps, "eth_getCode", [normalizeAddress(address), block ?? "latest"]);
    const bytes = code && code !== "0x" ? (code.length - 2) / 2 : 0;
    if (!bytes) return text(`No code at ${address} on ${chain}. This is an EOA, a self-destructed contract, or not yet deployed.`);
    return text(`Contract: ${address}\nChain:    ${chain}\nSize:     ${bytes} bytes\n\n${code}`);
  } catch (e) { return fail(e); }
});

server.registerTool("disassemble", {
  title: "Disassemble EVM bytecode",
  description:
    "Disassemble bytecode into opcodes with program counters. Supply either an on-chain address or a raw hex string. " +
    "Crucially, this also validates statically-resolvable jump targets: a PUSH followed immediately by JUMP/JUMPI whose " +
    "target is not a JUMPDEST will halt exceptionally at runtime (revert, all gas consumed). Those are reported separately " +
    "as `invalidJumps` — a common intentional trap in CTF and puzzle contracts, and a real bug in hand-written assembly.",
  inputSchema: {
    address: z.string().optional().describe("Contract address to fetch and disassemble."),
    bytecode: z.string().optional().describe("Raw bytecode hex, as an alternative to address."),
    chain: chainArg, rpc_url: rpcArg,
    max_lines: z.number().int().positive().max(5000).default(400).describe("Max instructions to print."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ address, bytecode, chain, rpc_url, max_lines }) => {
  try {
    let hex = bytecode;
    if (!hex) {
      if (!address) throw new Error("Provide either `address` or `bytecode`.");
      const eps = resolveEndpoints(chain, rpc_url);
      hex = await rpcCall(eps, "eth_getCode", [normalizeAddress(address), "latest"]);
      if (!hex || hex === "0x") throw new Error(`No code at ${address} on ${chain}.`);
    }
    const d = disassemble(hexToBytes(hex!));
    const parts = [
      `Size: ${d.size} bytes | ${d.instructions.length} instructions | ${d.jumpdests.length} JUMPDESTs`,
      "",
      formatDisassembly(d, max_lines),
    ];
    if (d.invalidJumps.length) {
      parts.push("", `!! ${d.invalidJumps.length} INVALID JUMP TARGET(S) — these revert if taken:`);
      for (const j of d.invalidJumps)
        parts.push(`   pc 0x${j.pc.toString(16).padStart(4, "0")} ${j.kind} -> ${j.target}: ${j.reason}`);
    } else {
      parts.push("", "All statically-resolvable jump targets are valid JUMPDESTs.");
    }
    if (d.truncated) parts.push("", "(output truncated)");
    return text(parts.join("\n"));
  } catch (e) { return fail(e); }
});

server.registerTool("read_storage", {
  title: "Read a contract storage slot",
  description: "Read a raw storage slot via eth_getStorageAt. Returns the 32-byte word plus uint and address interpretations.",
  inputSchema: { address: z.string(), slot: z.string().describe("Slot as hex (0x...) or decimal."), chain: chainArg, rpc_url: rpcArg,
                 block: z.string().optional() },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ address, slot, chain, rpc_url, block }) => {
  try {
    const eps = resolveEndpoints(chain, rpc_url);
    const v = await rpcCall(eps, "eth_getStorageAt", [normalizeAddress(address), toHexQuantity(slot), block ?? "latest"]);
    const n = BigInt(v);
    const w = v.slice(2);
    const asAddr = /^0{24}[0-9a-f]{40}$/.test(w) && n >= (1n << 120n) ? `\npossible address: 0x${w.slice(24)}` : "";
    return text(`slot ${slot} of ${address} (${chain})\nraw:  ${v}\nuint: ${n.toString()}${asAddr}`);
  } catch (e) { return fail(e); }
});

server.registerTool("compute_storage_slot", {
  title: "Derive a Solidity storage slot",
  description:
    "Derive storage slots. kind=mapping: keccak256(pad32(key).pad32(slot)). kind=nested_mapping: applied left to right. " +
    "kind=array: keccak256(pad32(slot))+index. kind=keccak_words: keccak256 over concatenated 32-byte words, which is what " +
    "hand-written assembly does when it MSTOREs values and hashes the region. kind=keccak_utf8 / keccak_hex: plain hashing.",
  inputSchema: {
    kind: z.enum(["mapping", "nested_mapping", "array", "keccak_words", "keccak_utf8", "keccak_hex"]),
    slot: z.string().optional().describe("Base slot, for mapping/nested_mapping/array."),
    key: z.string().optional().describe("Key, for kind=mapping."),
    keys: z.array(z.string()).optional().describe("Keys outermost-first, for kind=nested_mapping."),
    index: z.string().optional().describe("Element index, for kind=array."),
    words: z.array(z.string()).optional().describe("Values to pad to 32 bytes and hash, for kind=keccak_words."),
    input: z.string().optional().describe("String for keccak_utf8, or hex for keccak_hex."),
  },
  annotations: { readOnlyHint: true },
}, async (a) => {
  try {
    switch (a.kind) {
      case "mapping":
        if (a.key === undefined || a.slot === undefined) throw new Error("mapping needs `key` and `slot`.");
        return text(`slot = keccak256(pad32(key) . pad32(slot))\n${mappingSlot(a.key, a.slot)}`);
      case "nested_mapping":
        if (!a.keys?.length || a.slot === undefined) throw new Error("nested_mapping needs `keys` and `slot`.");
        return text(nestedMappingSlot(a.keys, a.slot));
      case "array":
        if (a.slot === undefined || a.index === undefined) throw new Error("array needs `slot` and `index`.");
        return text(`slot = keccak256(pad32(slot)) + index\n${arrayElementSlot(a.slot, a.index)}`);
      case "keccak_words":
        if (!a.words?.length) throw new Error("keccak_words needs `words`.");
        return text(`keccak256(${a.words.length} x 32-byte words)\n${keccakWords(a.words)}`);
      case "keccak_utf8":
        if (a.input === undefined) throw new Error("keccak_utf8 needs `input`.");
        return text(keccakUtf8(a.input));
      case "keccak_hex":
        if (a.input === undefined) throw new Error("keccak_hex needs `input`.");
        return text(keccakRawHex(a.input));
    }
  } catch (e) { return fail(e); }
});

server.registerTool("decode_calldata", {
  title: "Decode raw calldata",
  description: "Split calldata into a 4-byte selector and 32-byte words, flag word values that look like addresses, and name the function when the selector is a well-known one.",
  inputSchema: { data: z.string().describe("Calldata hex.") },
  annotations: { readOnlyHint: true },
}, async ({ data }) => {
  try {
    const d = decodeCalldata(data);
    const lines = [`selector: ${d.selector}${d.knownSignature ? `  (${d.knownSignature})` : ""}`, `words:    ${d.wordCount}`];
    for (const w of d.words) lines.push(`  [${w.index}] ${w.hex}\n        uint=${w.asUint}${w.asAddress ? `  possible address=${w.asAddress}` : ""}`);
    if (d.trailingBytes) lines.push(`trailing (not word-aligned): ${d.trailingBytes}`);
    if (d.note) lines.push(d.note);
    return text(lines.join("\n"));
  } catch (e) { return fail(e); }
});

server.registerTool("function_selector", {
  title: "Compute function selectors",
  description: "Compute 4-byte selectors from canonical signatures, e.g. transfer(address,uint256).",
  inputSchema: { signatures: z.array(z.string()).min(1).describe("Canonical signatures, no argument names or spaces.") },
  annotations: { readOnlyHint: true },
}, async ({ signatures }) => {
  try { return text(signatures.map(s => `${selectorOf(s)}  ${s}`).join("\n")); } catch (e) { return fail(e); }
});

server.registerTool("eth_call", {
  title: "Simulate a read-only call",
  description:
    "Simulate a call with eth_call and report whether it returned or reverted. Nothing is broadcast and no key is used. " +
    "Useful for probing which calldata and value combinations a contract accepts.",
  inputSchema: {
    to: z.string(), data: z.string().default("0x").describe("Calldata hex."),
    value: z.string().optional().describe("Wei, as hex or decimal."),
    from: z.string().optional(), chain: chainArg, rpc_url: rpcArg, block: z.string().optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ to, data, value, from, chain, rpc_url, block }) => {
  try {
    const eps = resolveEndpoints(chain, rpc_url);
    const tx: Record<string, string> = { to: normalizeAddress(to), data: data || "0x" };
    if (value !== undefined) tx.value = toHexQuantity(value);
    if (from) tx.from = normalizeAddress(from);
    try {
      const r = await rpcCall(eps, "eth_call", [tx, block ?? "latest"]);
      return text(`SUCCESS — call did not revert.\nreturn data: ${r === "0x" ? "0x (empty)" : r}`);
    } catch (e: any) {
      return text(`REVERTED (or rejected by the node).\n${e?.message ?? String(e)}`);
    }
  } catch (e) { return fail(e); }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("evm-recon-mcp running on stdio");
