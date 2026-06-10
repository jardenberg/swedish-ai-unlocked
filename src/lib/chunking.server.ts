// Lightweight recursive markdown chunker. Targets ~800 tokens per chunk
// (~3200 chars) with ~400-char overlap. No tokenizer dependency — we
// approximate tokens as chars/4.

const TARGET_CHARS = 3200;
const OVERLAP_CHARS = 400;
const MIN_CHARS = 200;

export interface Chunk {
  ord: number;
  text: string;
  tokenCount: number;
}

export function chunkMarkdown(md: string): Chunk[] {
  const clean = md.replace(/\r\n/g, "\n").trim();
  if (clean.length === 0) return [];
  if (clean.length <= TARGET_CHARS) {
    return [{ ord: 0, text: clean, tokenCount: Math.ceil(clean.length / 4) }];
  }

  // Split on markdown headings or double newlines first
  const blocks = clean.split(/\n(?=#{1,6}\s)|\n\n+/);
  const chunks: Chunk[] = [];
  let buf = "";

  for (const block of blocks) {
    if ((buf + "\n\n" + block).length > TARGET_CHARS && buf.length >= MIN_CHARS) {
      chunks.push({ ord: chunks.length, text: buf, tokenCount: Math.ceil(buf.length / 4) });
      // overlap tail
      buf = buf.slice(-OVERLAP_CHARS) + "\n\n" + block;
    } else {
      buf = buf ? buf + "\n\n" + block : block;
    }
    // Hard-split a single oversized block
    while (buf.length > TARGET_CHARS * 1.5) {
      const cut = buf.slice(0, TARGET_CHARS);
      chunks.push({ ord: chunks.length, text: cut, tokenCount: Math.ceil(cut.length / 4) });
      buf = buf.slice(TARGET_CHARS - OVERLAP_CHARS);
    }
  }
  if (buf.trim().length >= MIN_CHARS) {
    chunks.push({ ord: chunks.length, text: buf.trim(), tokenCount: Math.ceil(buf.length / 4) });
  }
  return chunks;
}
