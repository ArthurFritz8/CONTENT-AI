import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizeProductionImage,boundedReferenceBody } from "../lib/production-image.ts";
test("private reference normalization preserves resolution and removes metadata",async()=>{
  const original=await sharp({create:{width:704,height:1280,channels:4,background:{r:128,g:50,b:10,alpha:1}}}).png().withMetadata().toBuffer();
  const result=await normalizeProductionImage(original),meta=await sharp(result.bytes).metadata();
  assert.deepEqual(result.metadata,{mime:"image/png",width:704,height:1280});assert.equal(result.sha256.length,64);assert.equal(meta.exif,undefined);
});
test("EXIF orientation is applied without cropping or upscaling",async()=>{
  const original=await sharp({create:{width:1280,height:704,channels:3,background:"#ffaa44"}}).jpeg().withMetadata({orientation:6}).toBuffer();
  const result=await normalizeProductionImage(original);assert.equal(result.metadata.width,704);assert.equal(result.metadata.height,1280);
});
test("reference rejects vector payloads, oversized, small and landscape images",async()=>{
  await assert.rejects(()=>normalizeProductionImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')));
  await assert.rejects(()=>normalizeProductionImage(Buffer.alloc(12*1024*1024+1)));
  for(const [width,height] of [[320,640],[640,480],[640,640],[500,4100]]) {
    const bytes=await sharp({create:{width,height,channels:3,background:"#ffaa44"}}).png().toBuffer();await assert.rejects(()=>normalizeProductionImage(bytes));
  }
});
test("stream bound works when Content-Length is absent or false",async()=>{
  const request=new Request("http://panel.test",{method:"POST",headers:{"Content-Type":"application/octet-stream","Content-Length":"1"},body:Buffer.alloc(12*1024*1024+1)});
  await assert.rejects(()=>boundedReferenceBody(request),e=>e.status===413);
});
