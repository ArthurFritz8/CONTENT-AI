import {createHash} from "node:crypto";
/** The caller must first authorize this row through a workspace-scoped RPC. */
export async function readVerifiedAurayMedia(row,origin,service,fetcher=fetch) {
  const base=new URL(origin);
  if(base.protocol!=="https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(base.hostname) || base.username || base.password || base.port || base.pathname!=="/" ||
    !/^auray\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}\.mp4$/.test(row.path) ||
    !/^[a-f0-9]{64}$/.test(row.sha256) || !row.path.endsWith(`/${row.sha256}.mp4`) ||
    !Number.isSafeInteger(row.bytes) || row.bytes<1 || row.bytes>50*1024*1024)throw Error("invalid_private_media");
  const response=await fetcher(`${base.origin}/storage/v1/object/studio-private/${row.path}`,{
    headers:{apikey:service,Authorization:`Bearer ${service}`},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(25000),
  });
  if(!response.ok || !response.body)throw Error("private_media_unavailable");
  const reader=response.body.getReader(),chunks=[];let total=0;
  try {while(true){const r=await reader.read();if(r.done)break;total+=r.value.length;if(total>row.bytes)throw Error("private_media_changed");chunks.push(r.value);}}
  catch(e){void reader.cancel().catch(()=>{});throw e;}
  const bytes=Buffer.concat(chunks);
  if(bytes.length!==row.bytes || createHash("sha256").update(bytes).digest("hex")!==row.sha256)throw Error("private_media_changed");
  return bytes;
}
