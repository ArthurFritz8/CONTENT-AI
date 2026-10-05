import { test } from "node:test";
import { ok, strictEqual, throws } from "node:assert";
import { storyFixture } from "../testing/story-fixture.ts";
import { buildStoryScript, fictionPlanMatches } from "./script.ts";
import { storyContextSchema, storyVoice } from "./schema.ts";
import { storyArtwork } from "./art.ts";
import { makeReviewSnapshot } from "../testing/review-fixture.ts";
import { buildReviewPacket } from "../review/review-packet.ts";
import { scriptJsonSchema } from "../schemas/script-json.ts";
import { createScriptQualityChecker } from "../validators/script-quality.ts";
import { computeScriptHash } from "../validators/hash-utils.ts";
const episodeId="11111111-1111-4111-8111-111111111111";
const quality={blocked_patterns:{medical:["\\mcura\\M"]},require_source_per_claim:true};
test("fiction is organic, meets duration contract and preserves character voices across chapters",()=>{
  const {context,draft}=storyFixture(), script=buildStoryScript(draft,context,episodeId);
  strictEqual(script.disclosures.commercial_content,false);strictEqual(script.sources.length,0);
  ok(script.scenes.reduce((s,v)=>s+v.duration_seconds,0)>=60);
  strictEqual(createScriptQualityChecker(quality)(script,[],false).passed,true);
  strictEqual(storyVoice(context,"lia"),"pt-BR-FranciscaNeural");strictEqual(storyVoice(context,"rui"),"pt-BR-AntonioNeural");
  const next=storyContextSchema.parse({...context,chapter_number:2,previous_summaries:[draft.summary]});
  strictEqual(storyVoice(next,"lia"),storyVoice(context,"lia"));
  throws(()=>storyContextSchema.parse({...context,chapter_number:2}));
});
test("speaker must exist and be present; fruit novela cannot silently become humans",()=>{
  const {context,draft}=storyFixture();draft.scenes[0]!.visual.speaker_id="foreign";
  throws(()=>buildStoryScript(draft,context,episodeId));
  draft.scenes[0]!.visual.speaker_id="lia";draft.scenes[0]!.visual.on_stage=["rui"];
  throws(()=>buildStoryScript(draft,context,episodeId));
  const wrong=structuredClone(context);wrong.bible.cast[0]!.appearance="human";
  throws(()=>storyContextSchema.parse(wrong));
});
test("factual evidence still required and changed fiction context invalidates review",async()=>{
  const {context,draft}=storyFixture(), base=makeReviewSnapshot(), script=buildStoryScript(draft,context,base.episode.id);
  for(const scene of script.scenes){scene.asset_landscape={url:"https://example.test/own.png",license:"own",source:"system"};scene.asset_portrait=scene.asset_landscape;}
  const q={version:"1.0.0",decode_verified:true,duration_seconds:80,size_bytes:100000,width:1080,height:1920,warnings:[]};
  const snapshot={...base,episode:{...base.episode,script_json:script,research_data:[],briefing:{story_context:context},research_evidence:{type:"fiction_plan",context},
    metadata:{render_outputs:{...base.episode.metadata.render_outputs,platforms:{tiktok:{portrait:base.episode.render_url,commercial:false,quality:q}}}}},fact_check:quality};
  const packet=buildReviewPacket(snapshot,"33333333-3333-4333-8333-333333333333");ok(packet.document.includes(draft.summary));ok(packet.caption.includes("Ficção original"));
  const hash=await computeScriptHash(script);script.fiction!.summary+=" Um detalhe diferente.";ok(await computeScriptHash(script)!==hash);
  const editedHash=await computeScriptHash(script);script.fiction!.context.series_id="66666666-6666-4666-8666-666666666666";strictEqual(await computeScriptHash(script),editedHash);
  const evidence={type:"fiction_plan",context:structuredClone(context)};
  context.bible.cast[0]!.color="#abcdef";strictEqual(fictionPlanMatches(context,evidence),false);throws(()=>buildReviewPacket(snapshot,"33333333-3333-4333-8333-333333333333"));
  const factual=makeReviewSnapshot().episode.script_json;factual.sources=[];throws(()=>scriptJsonSchema.parse(factual));
});
test("artwork is original, deterministic, supports both formats and escapes user text",()=>{
  const {context,draft}=storyFixture();context.bible.title='<script>alert("x")</script>';
  const visual=draft.scenes[0]!.visual;
  const svg=storyArtwork(context,visual,"portrait");ok(!svg.includes("<script>"));ok(svg.includes("&lt;script&gt;"));ok(svg.includes('height="1920"'));
  strictEqual(svg,storyArtwork(context,visual,"portrait"));ok(storyArtwork(context,visual,"landscape").includes('width="1920"'));
});
