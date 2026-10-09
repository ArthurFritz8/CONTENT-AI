import sharp from "sharp";
import { createHash } from "node:crypto";
import { PanelError } from "./security.mjs";
export const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
export async function normalizeProductionImage(bytes: Buffer) {
  const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  const webp = bytes.toString("ascii",0,4)==="RIFF" && bytes.toString("ascii",8,12)==="WEBP";
  if (!bytes.length || bytes.length>MAX_REFERENCE_BYTES || !(png || jpg || webp))
    throw new PanelError("Envie uma imagem PNG, JPEG ou WebP de até 12 MB.",400);
  try {
    const image=sharp(bytes,{limitInputPixels:16_000_000,failOn:"warning"});
    const meta=await image.metadata();
    if ((meta.pages ?? 1)!==1) throw Error("animated");
    const result=await image.autoOrient().flatten({background:"#ffffff"}).png().toBuffer({resolveWithObject:true});
    const {width,height}=result.info;
    if (width<480 || height<=width || height>4096 || width>4096 || result.data.length>MAX_REFERENCE_BYTES) throw Error("dimensions");
    return {bytes:result.data,sha256:createHash("sha256").update(result.data).digest("hex"),metadata:{mime:"image/png",width,height}};
  } catch { throw new PanelError("Use uma imagem vertical, com pelo menos 480 pixels de largura e até 4.096 pixels por lado. Não use imagens animadas.",400); }
}
export async function boundedReferenceBody(request:Request) {
  if (!request.headers.get("content-type")?.startsWith("application/octet-stream")) throw new PanelError("Envie o arquivo da imagem.",415);
  if (Number(request.headers.get("content-length") || 0)>MAX_REFERENCE_BYTES) throw new PanelError("Imagem maior que 12 MB.",413);
  const reader=request.body?.getReader();if(!reader)throw new PanelError("Imagem ausente.");
  const parts:Uint8Array[]=[];let size=0;
  while(true) { const {value,done}=await reader.read();if(done)break;size+=value.length;
    if(size>MAX_REFERENCE_BYTES){await reader.cancel();throw new PanelError("Imagem maior que 12 MB.",413);}parts.push(value); }
  return Buffer.concat(parts);
}
