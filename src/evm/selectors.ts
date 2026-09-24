/** Function selectors and calldata decoding. */
import sha3 from "js-sha3";
const { keccak_256 } = sha3;

export function selectorOf(signature: string): string {
  const sig = signature.replace(/\s+/g, "");
  return "0x" + keccak_256(new TextEncoder().encode(sig)).slice(0, 8);
}

/** Common selectors, so an unverified contract's dispatcher is readable without a 4byte lookup. */
export const KNOWN: Record<string, string> = {};
for (const sig of [
  "transfer(address,uint256)","transferFrom(address,address,uint256)","approve(address,uint256)",
  "balanceOf(address)","allowance(address,address)","totalSupply()","name()","symbol()","decimals()",
  "owner()","transferOwnership(address)","renounceOwnership()","paused()","pause()","unpause()",
  "mint(address,uint256)","burn(uint256)","withdraw(uint256)","withdraw()","deposit()",
  "safeTransferFrom(address,address,uint256)","ownerOf(uint256)","tokenURI(uint256)","setApprovalForAll(address,bool)",
  "implementation()","upgradeTo(address)","upgradeToAndCall(address,bytes)","admin()",
  "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)","nonces(address)","DOMAIN_SEPARATOR()",
  "initialize()","initialize(address)","multicall(bytes[])","execute(address,uint256,bytes)",
]) KNOWN[selectorOf(sig)] = sig;

export interface DecodedCalldata {
  selector: string;
  knownSignature?: string;
  wordCount: number;
  words: { index: number; hex: string; asUint: string; asAddress?: string }[];
  trailingBytes?: string;
  note?: string;
}

export function decodeCalldata(dataHex: string): DecodedCalldata {
  let h = dataHex.startsWith("0x") || dataHex.startsWith("0X") ? dataHex.slice(2) : dataHex;
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error("calldata contains non-hex characters");
  if (h.length === 0) return { selector: "0x", wordCount: 0, words: [], note: "empty calldata" };

  // Heuristic: a 4-byte selector is only meaningful when the remainder is word-aligned.
  let selector = "0x";
  let body = h;
  if (h.length >= 8 && (h.length - 8) % 64 === 0) { selector = "0x" + h.slice(0, 8); body = h.slice(8); }
  else if (h.length % 64 === 0) { selector = "(none — calldata is word-aligned with no selector)"; }
  else if (h.length >= 8) { selector = "0x" + h.slice(0, 8); body = h.slice(8); }

  const words: DecodedCalldata["words"] = [];
  let i = 0;
  for (; i + 64 <= body.length; i += 64) {
    const w = body.substr(i, 64);
    const asUint = BigInt("0x" + w).toString();
    const entry: DecodedCalldata["words"][number] = { index: words.length, hex: "0x" + w, asUint };
    // Heuristic: 12 zero bytes then a value large enough that it is not plausibly an
    // amount. Token amounts top out far below 2^120, real addresses are ~uniform over 160 bits.
    if (/^0{24}[0-9a-fA-F]{40}$/.test(w) && BigInt("0x" + w) >= (1n << 120n)) entry.asAddress = "0x" + w.slice(24);
    words.push(entry);
  }
  const trailing = body.slice(i);
  const out: DecodedCalldata = { selector, wordCount: words.length, words };
  if (trailing.length) out.trailingBytes = "0x" + trailing;
  const known = KNOWN[selector];
  if (known) out.knownSignature = known;
  return out;
}
