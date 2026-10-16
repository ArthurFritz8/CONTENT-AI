import {test} from "node:test";
import {strictEqual,throws,deepStrictEqual} from "node:assert";
import {defaultStoryPresentation,storyPresentationSchema,presentationNeedsAdapter,supportsPreparedPattern,supportsNativePattern,storyStyleSampleSchema,storySampleSources,storySources} from "./styles.ts";
import {storyRequestSchema} from "./schema.ts";

test("Puter is a selectable native source but requires explicit voice variants",()=>{
 const sample=storyStyleSampleSchema.parse({id:"11111111-2222-4333-8444-555555555555",source:"puter",style_id:"cinematic_3d",title:"Malu — prévia aprovada",model:"Wan 2.7 I2V",sha256:"a".repeat(64),bytes:100,seconds:5,width:720,height:1280,output_fps:30,native_fps:null,has_audio:true,motion:"generated",review_scope:"reviewed_sample",limitations:["Integração de capítulos em preparação."]});
 strictEqual(sample.source,"puter");strictEqual(storySampleSources.puter,"Puter");
 strictEqual(Object.hasOwn(storySources,"puter"),true);
 const p=storyPresentationSchema.parse({...defaultStoryPresentation(),source:"puter",primary_style:"cinematic_3d",allowed_styles:["cinematic_3d"]});
 strictEqual(supportsNativePattern(p,"cinematic_3d"),false);
 strictEqual(supportsNativePattern({...p,voice_policy:"approved_variants"},"cinematic_3d"),true);
 strictEqual(supportsPreparedPattern({...p,voice_policy:"approved_variants"},"cinematic_3d"),false);
});
test("old requests keep their exact shape; style intent never masquerades as legacy illustration",()=>{
  const old={kind:"fruits",genre:"mystery",creation_mode:"automatic",premise:"",chapters:2};
  deepStrictEqual(storyRequestSchema.parse(old),old);
  strictEqual(presentationNeedsAdapter(defaultStoryPresentation()),false);
  for(const primary_style of ["cinematic_3d","cartoon_2d","anime","realistic","motion_comic"] as const)
    strictEqual(presentationNeedsAdapter({...defaultStoryPresentation(),primary_style,allowed_styles:[primary_style]}),true);
  strictEqual(presentationNeedsAdapter({...defaultStoryPresentation(),source:"auray"}),true);
  strictEqual(presentationNeedsAdapter({...defaultStoryPresentation(),voice_policy:"approved_variants"}),true);
});

test("prepared patterns are separate from sources without an audio-conditioned chapter adapter",()=>{
 const p=storyPresentationSchema.parse({...defaultStoryPresentation(),primary_style:"anime",allowed_styles:["anime"]});
 strictEqual(supportsPreparedPattern(p,"anime"),true);
 strictEqual(supportsPreparedPattern({...p,source:"modal"},"anime"),true);
 strictEqual(supportsPreparedPattern({...p,source:"auray"},"anime"),false);
 strictEqual(supportsPreparedPattern({...p,source:"local"},"anime"),false);
 strictEqual(supportsPreparedPattern(p,"realistic"),false);
 strictEqual(supportsNativePattern({...p,source:"auray"},"anime"),false);
 strictEqual(supportsNativePattern({...p,source:"auray",voice_policy:"approved_variants"},"anime"),true);
});
test("fixed styles, permitted chapter variants and voice permissions are independent and explicit",()=>{
  const base=defaultStoryPresentation();
  throws(()=>storyPresentationSchema.parse({...base,allowed_styles:["anime"]}));
  throws(()=>storyPresentationSchema.parse({...base,allowed_styles:["illustrated","anime"]}));
  throws(()=>storyPresentationSchema.parse({...base,allowed_styles:["illustrated","illustrated"]}));
  throws(()=>storyPresentationSchema.parse({...base,cash_allowed:true}));
  const pool=storyPresentationSchema.parse({...base,continuity_mode:"per_chapter",allowed_styles:["illustrated","anime"]});
  strictEqual(presentationNeedsAdapter(pool,"anime"),true);strictEqual(presentationNeedsAdapter(pool,"illustrated"),false);
  throws(()=>presentationNeedsAdapter(pool,"realistic"));strictEqual(pool.voice_policy,"preserve");
});
