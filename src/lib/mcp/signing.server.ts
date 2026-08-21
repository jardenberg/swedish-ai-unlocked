import { CompactSign, importJWK, type CryptoKey, type KeyObject } from "jose";

// ── Canonical JSON: lexicographically sorted object keys, no insignificant
// whitespace, UTF-8. Arrays keep their order. This is the exact convention the
// signature and content_hash are computed over.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortValue(src[k]);
    return out;
  }
  return value;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type Signer = { key: CryptoKey | KeyObject | Uint8Array; kid: string } | null;
let signerPromise: Promise<Signer> | null = null;

async function getSigner(): Promise<Signer> {
  if (!signerPromise) {
    signerPromise = (async () => {
      const raw = process.env["MCP_SIGNING_PRIVATE_JWK"];
      if (!raw) return null;
      try {
        const jwk = JSON.parse(raw) as Record<string, unknown>;
        const key = await importJWK(jwk, "EdDSA");
        const kid = typeof jwk.kid === "string" ? jwk.kid : "";
        return { key, kid };
      } catch {
        return null;
      }
    })();
  }
  return signerPromise;
}

export type SignatureBlock = {
  alg: "EdDSA";
  kid: string;
  signed: "structuredContent";
  jws: string;
};

/**
 * Sign the canonicalized structuredContent as a compact EdDSA JWS.
 * Returns null when no signing key is configured (graceful degradation).
 */
export async function signStructuredContent(
  structuredContent: unknown,
): Promise<SignatureBlock | null> {
  const signer = await getSigner();
  if (!signer) return null;
  try {
    const payload = new TextEncoder().encode(canonicalJson(structuredContent));
    const jws = await new CompactSign(payload)
      .setProtectedHeader({ alg: "EdDSA", kid: signer.kid, typ: "JOSE" })
      .sign(signer.key);
    return { alg: "EdDSA", kid: signer.kid, signed: "structuredContent", jws };
  } catch {
    return null;
  }
}
