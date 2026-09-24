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
      if (json.error) { errors.push(`${url}: ${json.error.message ?? JSON.stringify(json.error)}`); continue; }
      return json.result;
    } catch (e: any) {
      errors.push(`${url}: ${e?.message ?? String(e)}`);
    } finally { clearTimeout(timer); }
  }
  throw new Error(`All RPC endpoints failed for ${method}.\n${errors.join("\n")}`);
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
