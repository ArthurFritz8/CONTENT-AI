import { createHash } from "node:crypto";
import { config } from "./server";
import { PanelError } from "./security.mjs";
function target(path:string,workspace:string) {
  if(!path.startsWith(`${workspace}/story-profile/`) || /\.\.|\\|[?#]/.test(path)) throw new PanelError("Arquivo indisponível.",403);
  return `${config().url}/storage/v1/object/studio-private/${path.split("/").map(encodeURIComponent).join("/")}`;
}
function headers(){const c=config();return {apikey:c.service,Authorization:`Bearer ${c.service}`};}
export async function downloadProductionMedia(row:{path:string;bytes:number;sha256:string},workspace:string) {
  const res=await fetch(target(row.path,workspace),{headers:headers(),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!res.ok || row.bytes>12*1024*1024 || row.bytes<44) throw new PanelError("Arquivo indisponível. Tente novamente.",502);
  const reader=res.body?.getReader();if(!reader)throw new PanelError("Arquivo indisponível.",502);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>row.bytes){await reader.cancel();throw new PanelError("Arquivo inválido.",502);}chunks.push(value);}
  const bytes=Buffer.concat(chunks);
  if(bytes.length!==row.bytes || createHash("sha256").update(bytes).digest("hex")!==row.sha256)throw new PanelError("Arquivo diferente do cadastrado.",502);
  return bytes;
}
export async function uploadProductionMedia(row:{path:string;bytes:number;sha256:string},workspace:string,bytes:Buffer,mime:string) {
  try {
    const res=await fetch(target(row.path,workspace),{method:"POST",headers:{...headers(),"Content-Type":mime,"x-upsert":"false"},body:new Uint8Array(bytes),redirect:"error",signal:AbortSignal.timeout(20000)});
    if(res.ok)return;
  } catch { /* An ambiguous upload may already be stored. Check the identical immutable object. */ }
  await downloadProductionMedia(row,workspace);
}
