import {test} from "node:test";
import {strictEqual,rejects} from "node:assert";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import sharp from "sharp";
import {storyFixture} from "../../../packages/core/src/testing/story-fixture.ts";
import {storyArtwork} from "../../../packages/core/src/stories/art.ts";
import {rasterizeArtwork} from "./artwork.ts";
test("real SVG rasterization preserves portrait/landscape and rejects external references",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"content-ai-art-"));
 try {
  const {context,draft}=storyFixture();
  for(const orientation of ["portrait","landscape"] as const){
   const path=join(dir,`${orientation}.svg`);await writeFile(path,storyArtwork(context,draft.scenes[0]!.visual,orientation));
   const png=await rasterizeArtwork(path),meta=await sharp(png).metadata();strictEqual(meta.format,"png");strictEqual(meta.width,orientation==="portrait"?1080:1920);strictEqual(meta.height,orientation==="portrait"?1920:1080);
  }
  const path=join(dir,"unsafe.svg");await writeFile(path,'<svg><image href="https://example.test/secret"/></svg>');await rejects(()=>rasterizeArtwork(path),/não permitido/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
