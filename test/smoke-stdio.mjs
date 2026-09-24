import { spawn } from "node:child_process";
const p = spawn("node", ["dist/index.js"], { stdio: ["pipe","pipe","pipe"] });
let buf = ""; const pending = new Map();
p.stdout.on("data", d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    try { const m = JSON.parse(line); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {}
  }
});
p.stderr.on("data", d => process.stderr.write("[server] " + d));
let id = 0;
const send = (method, params) => new Promise(res => { const myId = ++id; pending.set(myId, res);
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n"); });
const notify = (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

const init = await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
console.log("INIT:", init.result?.serverInfo?.name, init.result?.serverInfo?.version);
notify("notifications/initialized");
const tools = await send("tools/list", {});
console.log("TOOLS:", tools.result.tools.map(t => t.name).join(", "));

const AMOY = { chain: "polygon-amoy" };
const ADDR = "0xa60Fa8391625163b1760f89DAc94bac2C448f897";
const V = "0x66de8ffda797e3de9c05e8fc57b3bf0ec28a930d40b0d285d93c06501cf6a090";

async function call(name, args) {
  const r = await send("tools/call", { name, arguments: args });
  if (r.error) return `RPC ERROR: ${JSON.stringify(r.error)}`;
  return r.result.content.map(c => c.text).join("\n");
}
console.log("\n===== TEST 1: disassemble (expect invalid jump to 0x21) =====");
console.log(await call("disassemble", { address: ADDR, ...AMOY }));
console.log("\n===== TEST 2: keccak_words(chainid=80002, V) =====");
console.log(await call("compute_storage_slot", { kind: "keccak_words", words: ["80002", V] }));
console.log("\n===== TEST 3: read_storage slot 0x13 =====");
console.log(await call("read_storage", { address: ADDR, slot: "0x13", ...AMOY }));
console.log("\n===== TEST 4: function_selector =====");
console.log(await call("function_selector", { signatures: ["transfer(address,uint256)", "balanceOf(address)"] }));
console.log("\n===== TEST 5: decode_calldata =====");
console.log(await call("decode_calldata", { data: "0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000000000000000f4240" }));
console.log("\n===== TEST 6: error path (EOA) =====");
console.log(await call("get_bytecode", { address: "0x0000000000000000000000000000000000000001", chain: "ethereum" }));
p.kill();
