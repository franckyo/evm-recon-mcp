/** Minimal multi-chain JSON-RPC client. No API keys: uses public endpoints. */

export interface ChainDef { name: string; chainId: number; rpc: string[]; explorer?: string; }

export const CHAINS: Record<string, ChainDef> = {
  ethereum:      { name: "Ethereum",          chainId: 1,        rpc: ["https://eth.llamarpc.com", "https://ethereum-rpc.publicnode.com", "https://rpc.ankr.com/eth"], explorer: "https://etherscan.io" },
  sepolia:       { name: "Sepolia",           chainId: 11155111, rpc: ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.sepolia.org"], explorer: "https://sepolia.etherscan.io" },
  holesky:       { name: "Holesky",           chainId: 17000,    rpc: ["https://ethereum-holesky-rpc.publicnode.com"], explorer: "https://holesky.etherscan.io" },
  polygon:       { name: "Polygon",           chainId: 137,      rpc: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.llamarpc.com"], explorer: "https://polygonscan.com" },
  "polygon-amoy":{ name: "Polygon Amoy",      chainId: 80002,    rpc: ["https://polygon-amoy-bor-rpc.publicnode.com", "https://polygon-amoy.drpc.org"], explorer: "https://amoy.polygonscan.com" },
  arbitrum:      { name: "Arbitrum One",      chainId: 42161,    rpc: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"], explorer: "https://arbiscan.io" },
  optimism:      { name: "OP Mainnet",        chainId: 10,       rpc: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"], explorer: "https://optimistic.etherscan.io" },
  base:          { name: "Base",              chainId: 8453,     rpc: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"], explorer: "https://basescan.org" },
  "base-sepolia":{ name: "Base Sepolia",      chainId: 84532,    rpc: ["https://base-sepolia-rpc.publicnode.com"], explorer: "https://sepolia.basescan.org" },
  bsc:           { name: "BNB Smart Chain",   chainId: 56,       rpc: ["https://bsc-rpc.publicnode.com", "https://binance.llamarpc.com"], explorer: "https://bscscan.com" },
  avalanche:     { name: "Avalanche C-Chain", chainId: 43114,    rpc: ["https://avalanche-c-chain-rpc.publicnode.com"], explorer: "https://snowtrace.io" },
  gnosis:        { name: "Gnosis",            chainId: 100,      rpc: ["https://gnosis-rpc.publicnode.com"], explorer: "https://gnosisscan.io" },
  scroll:        { name: "Scroll",            chainId: 534352,   rpc: ["https://scroll-rpc.publicnode.com"], explorer: "https://scrollscan.com" },
  linea:         { name: "Linea",             chainId: 59144,    rpc: ["https://linea-rpc.publicnode.com"], explorer: "https://lineascan.build" },
};

export function chainList(): string { return Object.keys(CHAINS).join(", "); }

export function resolveEndpoints(chain: string, rpcUrl?: string): string[] {
  if (rpcUrl) return [rpcUrl];
  const c = CHAINS[chain.toLowerCase()];
  if (!c) throw new Error(`Unknown chain "${chain}". Known: ${chainList()}. Or pass rpc_url directly.`);
  return c.rpc;
}

/** The node executed the request and rejected it (e.g. an EVM revert). Not a transport problem. */
export class RpcExecutionError extends Error {
  constructor(message: string, readonly code?: number, readonly data?: unknown) {
    super(message); this.name = "RpcExecutionError";
  }
}
/** Every endpoint failed to produce an answer: DNS, timeout, HTTP error, rate limit. */
export class RpcTransportError extends Error {
  constructor(message: string) { super(message); this.name = "RpcTransportError"; }
}

/** True when the node is reporting the outcome of execution rather than an infrastructure fault. */
function isExecutionError(code: unknown, message: string): boolean {
  if (code === 3) return true;                    // standard JSON-RPC "execution reverted"
  // Geth-family nodes report EVM failures as -32000 with a descriptive message, so the
  // message is the only reliable signal. Matching too narrowly turns a real verdict about
  // the contract into a misleading "could not reach the network".
  return /revert|execution|out of gas|gas required|invalid opcode|invalid jump|bad jump|stack (under|over)flow|insufficient funds|max (code|init ?code) size|contract creation code/i
    .test(message);
}

/** Calls each endpoint in turn; returns the first success. Errors aggregate so failures are debuggable. */
export async function rpcCall(endpoints: string[], method: string, params: unknown[], timeoutMs = 20000): Promise<any> {
  const errors: string[] = [];
  for (const url of endpoints) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctrl.signal,
      });
      if (!res.ok) { errors.push(`${url}: HTTP ${res.status}`); continue; }
      const json: any = await res.json();
      if (json.error) {
        const msg = json.error.message ?? JSON.stringify(json.error);
        // An execution verdict is the node's answer, identical on every endpoint, so
        // failing over would only turn a real result into a misleading transport error.
        if (isExecutionError(json.error.code, String(msg))) {
          throw new RpcExecutionError(String(msg), json.error.code, json.error.data);
        }
        errors.push(`${url}: ${msg}`); continue;
      }
      return json.result;
    } catch (e: any) {
      if (e instanceof RpcExecutionError) throw e;
      errors.push(`${url}: ${e?.message ?? String(e)}`);
    } finally { clearTimeout(timer); }
  }
  throw new RpcTransportError(`All RPC endpoints failed for ${method}.\n${errors.join("\n")}`);
}

export function normalizeAddress(addr: string): string {
  const a = addr.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) throw new Error(`Invalid address: ${addr}`);
  return a;
}

export function toHexQuantity(v: string | number | bigint): string {
  if (typeof v === "string" && v.startsWith("0x")) return v;
  return "0x" + BigInt(v).toString(16);
}
