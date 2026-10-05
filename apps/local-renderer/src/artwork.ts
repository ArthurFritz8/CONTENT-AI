import sharp from "sharp";
import { readFile } from "node:fs/promises";

/** Rasterize our bounded SVG illustrations before passing a real PNG to FFmpeg. */
export async function rasterizeArtwork(path: string): Promise<string> {
  if (!path.toLowerCase().endsWith(".svg")) return path;
  const bytes = await readFile(path);
  if (bytes.length > 1_000_000) throw new Error("Ilustração excede limite de tamanho");
  const svg = bytes.toString("utf8");
  if (!svg.trimStart().startsWith("<svg") || /<!DOCTYPE|<!ENTITY|<script|<foreignObject|\bhref\s*=|url\s*\(/i.test(svg))
    throw new Error("Ilustração contém recurso externo ou conteúdo não permitido");
  const png = `${path}.png`;
  await sharp(bytes, { limitInputPixels: 4_000_000 }).png().toFile(png);
  return png;
}
