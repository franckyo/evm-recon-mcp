/** EVM disassembler with static jump-target validation. */

const OPS: Record<number, string> = {
  0x00:"STOP",0x01:"ADD",0x02:"MUL",0x03:"SUB",0x04:"DIV",0x05:"SDIV",0x06:"MOD",0x07:"SMOD",
  0x08:"ADDMOD",0x09:"MULMOD",0x0a:"EXP",0x0b:"SIGNEXTEND",
  0x10:"LT",0x11:"GT",0x12:"SLT",0x13:"SGT",0x14:"EQ",0x15:"ISZERO",0x16:"AND",0x17:"OR",
  0x18:"XOR",0x19:"NOT",0x1a:"BYTE",0x1b:"SHL",0x1c:"SHR",0x1d:"SAR",
  0x20:"KECCAK256",
  0x30:"ADDRESS",0x31:"BALANCE",0x32:"ORIGIN",0x33:"CALLER",0x34:"CALLVALUE",0x35:"CALLDATALOAD",
  0x36:"CALLDATASIZE",0x37:"CALLDATACOPY",0x38:"CODESIZE",0x39:"CODECOPY",0x3a:"GASPRICE",
  0x3b:"EXTCODESIZE",0x3c:"EXTCODECOPY",0x3d:"RETURNDATASIZE",0x3e:"RETURNDATACOPY",0x3f:"EXTCODEHASH",
  0x40:"BLOCKHASH",0x41:"COINBASE",0x42:"TIMESTAMP",0x43:"NUMBER",0x44:"PREVRANDAO",0x45:"GASLIMIT",
  0x46:"CHAINID",0x47:"SELFBALANCE",0x48:"BASEFEE",0x49:"BLOBHASH",0x4a:"BLOBBASEFEE",
  0x50:"POP",0x51:"MLOAD",0x52:"MSTORE",0x53:"MSTORE8",0x54:"SLOAD",0x55:"SSTORE",
  0x56:"JUMP",0x57:"JUMPI",0x58:"PC",0x59:"MSIZE",0x5a:"GAS",0x5b:"JUMPDEST",
  0x5c:"TLOAD",0x5d:"TSTORE",0x5e:"MCOPY",0x5f:"PUSH0",
  0xa0:"LOG0",0xa1:"LOG1",0xa2:"LOG2",0xa3:"LOG3",0xa4:"LOG4",
  0xf0:"CREATE",0xf1:"CALL",0xf2:"CALLCODE",0xf3:"RETURN",0xf4:"DELEGATECALL",0xf5:"CREATE2",
  0xfa:"STATICCALL",0xfd:"REVERT",0xfe:"INVALID",0xff:"SELFDESTRUCT",
};
function opName(b: number): string {
  if (OPS[b]) return OPS[b];
  if (b >= 0x60 && b <= 0x7f) return `PUSH${b - 0x5f}`;
  if (b >= 0x80 && b <= 0x8f) return `DUP${b - 0x7f}`;
  if (b >= 0x90 && b <= 0x9f) return `SWAP${b - 0x8f}`;
  return `UNKNOWN_0x${b.toString(16).padStart(2, "0")}`;
}

export interface Instr { pc: number; op: string; opcode: number; push?: string; note?: string; }
export interface Disassembly {
  size: number;
  instructions: Instr[];
  jumpdests: number[];
  /** PUSHn immediately followed by JUMP/JUMPI whose target is NOT a JUMPDEST. */
  invalidJumps: { pc: number; kind: string; target: string; reason: string }[];
  truncated: boolean;
}

export function hexToBytes(hex: string): Uint8Array {
  let h = hex.trim();
  if (h.startsWith("0x") || h.startsWith("0X")) h = h.slice(2);
  if (h.length % 2) throw new Error("Hex string has odd length");
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error("Hex string contains non-hex characters");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

export function disassemble(code: Uint8Array, maxInstructions = 20000): Disassembly {
  const instructions: Instr[] = [];
  const jumpdests: number[] = [];
  // Pass 1: decode. PUSH immediates are skipped, so a 0x5b inside push data is
  // correctly NOT treated as a jump destination.
  let pc = 0, truncated = false;
  while (pc < code.length) {
    if (instructions.length >= maxInstructions) { truncated = true; break; }
    const b = code[pc];
    const op = opName(b);
    const instr: Instr = { pc, op, opcode: b };
    if (b === 0x5b) jumpdests.push(pc);
    if (b >= 0x60 && b <= 0x7f) {
      const n = b - 0x5f;
      const data = code.slice(pc + 1, pc + 1 + n);
      if (data.length < n) { instr.note = "truncated push data (end of code)"; truncated = true; }
      instr.push = "0x" + Array.from(data).map(x => x.toString(16).padStart(2, "0")).join("");
      instructions.push(instr);
      pc += 1 + n;
      continue;
    }
    instructions.push(instr);
    pc += 1;
  }

  // Pass 2: statically resolvable jumps are PUSHn immediately followed by JUMP/JUMPI.
  const dests = new Set(jumpdests);
  const invalidJumps: Disassembly["invalidJumps"] = [];
  for (let i = 0; i < instructions.length - 1; i++) {
    const a = instructions[i], b2 = instructions[i + 1];
    if (a.push === undefined) continue;
    if (b2.op !== "JUMP" && b2.op !== "JUMPI") continue;
    const target = BigInt(a.push === "0x" ? "0x0" : a.push);
    if (target > BigInt(code.length)) {
      invalidJumps.push({ pc: b2.pc, kind: b2.op, target: "0x" + target.toString(16),
        reason: `target beyond end of code (code size ${code.length})` });
      continue;
    }
    const t = Number(target);
    if (!dests.has(t)) {
      const actual = t < code.length ? opName(code[t]) : "out of range";
      invalidJumps.push({ pc: b2.pc, kind: b2.op, target: "0x" + t.toString(16),
        reason: `target is ${actual}, not JUMPDEST — taking this jump halts exceptionally (reverts, consumes all gas)` });
    }
  }
  return { size: code.length, instructions, jumpdests, invalidJumps, truncated };
}

export function formatDisassembly(d: Disassembly, limit = 600): string {
  const lines = d.instructions.slice(0, limit).map(i => {
    const pc = i.pc.toString(16).padStart(4, "0");
    const body = i.push !== undefined ? `${i.op} ${i.push}` : i.op;
    return `${pc}: ${body}${i.note ? "   ; " + i.note : ""}`;
  });
  if (d.instructions.length > limit) lines.push(`... ${d.instructions.length - limit} more instructions`);
  return lines.join("\n");
}
