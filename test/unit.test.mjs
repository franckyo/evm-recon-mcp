import { test } from "node:test";
import assert from "node:assert/strict";
import { disassemble, hexToBytes } from "../dist/evm/disasm.js";
import { mappingSlot, keccakWords, keccakUtf8, keccakRawHex, pad32, arrayElementSlot } from "../dist/evm/slots.js";
import { selectorOf, decodeCalldata } from "../dist/evm/selectors.js";

test("keccak256 matches the known empty-string vector", () => {
  assert.equal(keccakUtf8(""),
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
});

test("function selectors match well-known values", () => {
  assert.equal(selectorOf("transfer(address,uint256)"), "0xa9059cbb");
  assert.equal(selectorOf("balanceOf(address)"), "0x70a08231");
  assert.equal(selectorOf("totalSupply()"), "0x18160ddd");
});

test("mapping slot matches the Solidity layout formula", () => {
  // keccak256(pad32(key) . pad32(slot))
  assert.equal(mappingSlot("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", 2),
    "0x85efa08969febcb72bd7c79e3795763c6a77762d27bd830f8777227bf55e86a3");
});

test("keccak over concatenated words (hand-written-assembly layout)", () => {
  assert.equal(
    keccakWords(["80002", "0x66de8ffda797e3de9c05e8fc57b3bf0ec28a930d40b0d285d93c06501cf6a090"]),
    "0x9a7c6623207a1c3a727a6bf353300be7fb9bda1c9e094cb9724c54a0fbda1b5e");
});

test("array element slot is keccak(pad32(slot)) + index", () => {
  const a = arrayElementSlot(1, 0), b = arrayElementSlot(1, 1);
  assert.equal(BigInt(b) - BigInt(a), 1n);
});

// --- regression: v0.1.0 returned a confident wrong hash for non-hex input ---
test("non-hex input is rejected instead of silently hashing zeroes", () => {
  assert.throws(() => mappingSlot("0xZZZZ", 2), /Not a hex value/);
  assert.throws(() => pad32("0xnope"), /Not a hex value/);
  assert.throws(() => keccakRawHex("0xabc"), /odd length/);
});

test("a 0x5b byte inside PUSH data is not treated as a JUMPDEST", () => {
  // 0x61 = PUSH2, so the following 5b 5b are immediate data, not jump destinations
  const d = disassemble(hexToBytes("0x615b5b00"));
  assert.deepEqual(d.jumpdests, []);
  assert.equal(d.instructions[0].op, "PUSH2");
  assert.equal(d.instructions[0].push, "0x5b5b");
});

test("valid static jump target is accepted", () => {
  const d = disassemble(hexToBytes("0x60055600005b00")); // PUSH1 05; JUMP -> pc5 JUMPDEST
  assert.equal(d.invalidJumps.length, 0);
  assert.deepEqual(d.jumpdests, [5]);
});

test("invalid static jump target is reported", () => {
  const d = disassemble(hexToBytes("0x60045600005b00")); // PUSH1 04; JUMP -> pc4 STOP
  assert.equal(d.invalidJumps.length, 1);
  assert.equal(d.invalidJumps[0].kind, "JUMP");
  assert.equal(d.invalidJumps[0].target, "0x4");
});

// --- regression: v0.1.0 skipped PUSH0 entirely in static jump analysis ---
test("PUSH0 followed by JUMP is analysed", () => {
  const d = disassemble(hexToBytes("0x5f5600")); // PUSH0; JUMP -> pc0 is PUSH0, not JUMPDEST
  assert.equal(d.invalidJumps.length, 1);
  assert.equal(d.invalidJumps[0].target, "0x0");
});

test("jump target beyond the end of code is reported", () => {
  const d = disassemble(hexToBytes("0x60ff5600"));
  assert.equal(d.invalidJumps.length, 1);
  assert.match(d.invalidJumps[0].reason, /beyond end of code|not JUMPDEST/);
});

test("a maximum-size contract is fully decoded, not truncated", () => {
  const d = disassemble(hexToBytes("0x" + "5b".repeat(24576))); // EVM max contract size
  assert.equal(d.instructions.length, 24576);
  assert.equal(d.truncated, false);
});

test("calldata decodes into selector and words", () => {
  const d = decodeCalldata(
    "0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045" +
    "00000000000000000000000000000000000000000000000000000000000f4240");
  assert.equal(d.selector, "0xa9059cbb");
  assert.equal(d.knownSignature, "transfer(address,uint256)");
  assert.equal(d.wordCount, 2);
  assert.equal(d.words[0].asAddress, "0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
  // a small amount must not be mislabelled as an address
  assert.equal(d.words[1].asAddress, undefined);
  assert.equal(d.words[1].asUint, "1000000");
});

test("malformed hex is rejected by the disassembler", () => {
  assert.throws(() => hexToBytes("0xZZ"), /non-hex/);
  assert.throws(() => hexToBytes("0xabc"), /odd length/);
});
