export interface DriverOnlyKAST {
  protocol: 'kast/1';
  kind: 'driver-only';
  '@driver': {
    '@abi': number;
    '@requires': Record<string, string>;
    '@capabilities': string[];
    '@phase_hooks': Record<string, string>;
    '@provider': string;
    '@resources': string[];
    '@hash': string;
    '@signature?: string;
  };
  '@admission': {
    allowed_glyphs: string[];
    allowed_opcodes: string[];
    allowed_folds: string[];
    max_nodes: number;
    max_edges: number;
    resource_limits: Record<string, number>;
  };
  source_id: string;
  timestamp: string;
}
export function canonicalJson(obj: any): string;
export function toDriverOnly(
  appKast: any,
  opts?: {
    provider?: string;
    resourceLimits?: Record<string, number>;
    allowedGlyphs?: string[];
    allowedOpcodes?: string[];
    allowedFolds?: string[];
    sign?: (payload: string) => string;
  }
): DriverOnlyKAST;
export function verifyDriverOnly(
  driverKast: DriverOnlyKAST,
  runtimeCaps: {
    abi: number;
    capabilities: string[];
    maxNodes?: number;
    maxMemory?: number;
    providerWhitelist?: string[];
  }
): { admitted: boolean; reason?: string };

export class DriverRegistry {
  constructor(entries?: Record<string, any>);
  register(provider: string, entry: any): DriverRegistry;
  lookup(provider: string): any;
  runtimeCapabilities(maxNodes?: number, maxMemory?: number): any;
  verify(driverKast: DriverOnlyKAST): { admitted: boolean; reason?: string };
}
export function generateProviderKeypair(): { publicKey: string; privateKey: string };
export function signDriver(driverKast: DriverOnlyKAST, privateKeyPem: string): DriverOnlyKAST;
export function auditEntry(driverKast: DriverOnlyKAST, result: { admitted: boolean; reason?: string }, meta?: Record<string, any>): any;
