/** Solidity storage-slot derivation. */
import sha3 from "js-sha3";
const { keccak_256 } = sha3;

const HEX = /^[0-9a-fA-F]*$/;

export function pad32(v: string | number | bigint): string {
  let hex: string;
  if (typeof v === "string" && (v.startsWith("0x") || v.startsWith("0X"))) {
    hex = v.slice(2);
    // Without this check, parseInt() below yields NaN, NaN coerces to 0 inside a
    // Uint8Array, and the caller receives a confident but completely wrong slot.
    if (!HEX.test(hex)) throw new Error(`Not a hex value: ${v}`);
  } else {
    try { hex = BigInt(v).toString(16); }
    catch { throw new Error(`Not a valid number or hex value: ${String(v)}`); }
  }
  if (hex.length > 64) throw new Error(`Value does not fit in 32 bytes: 0x${hex}`);
  return hex.padStart(64, "0");
}

export function keccakHex(hexNo0x: string): string {
  if (!HEX.test(hexNo0x)) throw new Error(`Not a hex string: ${hexNo0x}`);
  if (hexNo0x.length % 2) throw new Error("Hex string has odd length");
  const bytes = new Uint8Array(hexNo0x.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hexNo0x.substr(i * 2, 2), 16);
  return "0x" + keccak_256(bytes);
}

/** mapping(K => V) at `slot`: keccak256(pad32(key) . pad32(slot)) */
export function mappingSlot(key: string | number | bigint, slot: string | number | bigint): string {
  return keccakHex(pad32(key) + pad32(slot));
}

/** Nested mapping: apply mappingSlot left to right. */
export function nestedMappingSlot(keys: (string | number | bigint)[], slot: string | number | bigint): string {
  let cur = typeof slot === "string" ? slot : BigInt(slot).toString();
  let out = "";
  for (const k of keys) { out = mappingSlot(k, cur); cur = out; }
  if (!out) throw new Error("Provide at least one key");
  return out;
}

/** Dynamic array at `slot`: element i lives at keccak256(pad32(slot)) + i */
export function arrayElementSlot(slot: string | number | bigint, index: string | number | bigint): string {
  const base = BigInt(keccakHex(pad32(slot)));
  return "0x" + (base + BigInt(index)).toString(16).padStart(64, "0");
}

/**
 * keccak256 over a sequence of 32-byte words, which is what hand-written
 * assembly does when it MSTOREs values then hashes the region.
 * e.g. slot = keccak256(chainid . callvalue)
 */
export function keccakWords(words: (string | number | bigint)[]): string {
  return keccakHex(words.map(pad32).join(""));
}

export function keccakUtf8(s: string): string {
  return "0x" + keccak_256(new TextEncoder().encode(s));
}

export function keccakRawHex(hex: string): string {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  return keccakHex(h);
}
