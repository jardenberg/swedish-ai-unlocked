import { CompactSign, importJWK, type CryptoKey, type KeyObject } from "jose";
import jcs from "canonicalize";

export const SPEC_NAMESPACE = "org.jardenberg.verifiable-mcp";
export const SPEC_VERSION = "0.2";

/**
 * RFC 8785 (JCS) canonical JSON. Normative canonicalization for all signing and
 * hashing in the trust layer — number serialization and lone-surrogate handling
 * are defined by the RFC, not by us.
 */
export function canonicalJson(value: unknown): string {
  return jcs(value as never) ?? "null";
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

async function signCanonical(value: unknown): Promise<{ jws: string; kid: string } | null> {
  const signer = await getSigner();
  if (!signer) return null;
  try {
    const payload = new TextEncoder().encode(canonicalJson(value));
    const jws = await new CompactSign(payload)
      .setProtectedHeader({ alg: "EdDSA", kid: signer.kid, typ: "JOSE" })
      .sign(signer.key);
    return { jws, kid: signer.kid };
  } catch {
    return null;
  }
}

// ── v0.1 (deprecated, removed in v0.3) ──────────────────────────────────────
export type SignatureBlock = {
  alg: "EdDSA";
  kid: string;
  signed: "structuredContent";
  jws: string;
};

export async function signStructuredContent(
  structuredContent: unknown,
): Promise<SignatureBlock | null> {
  const signed = await signCanonical(structuredContent);
  if (!signed) return null;
  return { alg: "EdDSA", kid: signed.kid, signed: "structuredContent", jws: signed.jws };
}

// ── v0.2 wrapper envelope ───────────────────────────────────────────────────
export type Wrapper = {
  iat: number;
  payload: unknown;
  payload_digest: string;
  content_digest?: string;
  provenance: unknown;
};

/**
 * The _meta envelope carries NO security-bearing values outside the JWS:
 * everything a verifier trusts (iat, digests, provenance, payload) is recovered
 * from the verified wrapper.
 */
export type MetaEnvelope = {
  spec: string;
  alg: "EdDSA";
  kid: string;
  signed: "wrapper";
  jws: string;
};

/**
 * Sign a { iat, payload, payload_digest, content_digest?, provenance } wrapper,
 * RFC 8785 canonicalized. `contentText` is the EXACT text arm bytes as served;
 * its SHA-256 becomes content_digest (content binding by digest).
 */
export async function signWrapper(
  payload: unknown,
  provenance: unknown,
  contentText?: string,
): Promise<{ wrapper: Wrapper; meta: MetaEnvelope } | null> {
  const iat = Math.floor(Date.now() / 1000);
  const payload_digest = "sha256:" + (await sha256Hex(canonicalJson(payload)));
  const wrapper: Wrapper = {
    iat,
    payload,
    payload_digest,
    ...(contentText !== undefined
      ? { content_digest: "sha256:" + (await sha256Hex(contentText)) }
      : {}),
    provenance,
  };
  const signed = await signCanonical(wrapper);
  if (!signed) return null;
  return {
    wrapper,
    meta: {
      spec: SPEC_VERSION,
      alg: "EdDSA",
      kid: signed.kid,
      signed: "wrapper",
      jws: signed.jws,
    },
  };
}

