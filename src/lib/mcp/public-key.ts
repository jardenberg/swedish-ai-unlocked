// Public half of the MCP response-signing keypair. Safe to commit.
// The private half lives ONLY in the runtime env as MCP_SIGNING_PRIVATE_JWK.
export const MCP_SIGNING_KID = "upCmqalkMBHA7ZBkcCNWakftZgIEKtGVvvvpSQL_2p8";

export const MCP_SIGNING_PUBLIC_JWK = {
  kty: "OKP",
  crv: "Ed25519",
  x: "E-puWZrBTXIA3ca6pSrcFR4PMAVs3ClVMABaSKEp_2I",
  kid: MCP_SIGNING_KID,
  alg: "EdDSA",
  use: "sig",
} as const;

export const MCP_SIGNING_KEY_URL =
  "https://rise-ai-sweden.jardenberg.org/.well-known/rise-ai-sweden-mcp-public-key.json";
