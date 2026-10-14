import {test} from "node:test";
import {strictEqual,rejects} from "node:assert";
import {createHash,randomUUID} from "node:crypto";
import {readVerifiedAurayMedia} from "../lib/verified-private-media.mjs";
const bytes=Buffer.from("private test video bytes"),sha=createHash("sha256").update(bytes).digest("hex");
const row={path:`auray/${randomUUID()}/${randomUUID()}/${sha}.mp4`,bytes:bytes.length,sha256:sha};
test("private video retrieval uses only authorized storage path and verifies complete immutable bytes",async()=>{
  const result=await readVerifiedAurayMedia(row,"https://audit.supabase.co","dummy",async(url,init)=>{
    strictEqual(url,`https://audit.supabase.co/storage/v1/object/studio-private/${row.path}`);strictEqual(init.redirect,"error");strictEqual(init.cache,"no-store");
    strictEqual(init.headers.Authorization,"Bearer dummy");return new Response(bytes);
  });strictEqual(result.toString(),bytes.toString());
});
test("unsafe paths, mismatched hashes, truncated and oversized streams are refused",async()=>{
  for(const path of ["https://evil.test/video.mp4",row.path+"?secret=1",row.path.replace("auray/","auray/../"),row.path.replace(sha,"0".repeat(64))]) {
    await rejects(readVerifiedAurayMedia({...row,path},"https://audit.supabase.co","dummy",async()=>{throw Error("must not fetch");}),/invalid_private_media/);
  }
  for(const body of [bytes.subarray(1),Buffer.concat([bytes,bytes]),Buffer.alloc(bytes.length)])await rejects(readVerifiedAurayMedia(row,"https://audit.supabase.co","dummy",async()=>new Response(body)),/private_media_changed/);
});
