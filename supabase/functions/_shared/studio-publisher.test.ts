import { assertEquals } from "jsr:@std/assert@1";
import { dispatchStudioPost } from "./studio-publisher.ts";
import { makeReviewSnapshot } from "../../../packages/core/src/testing/review-fixture.ts";
import { growthFixture } from "../../../packages/core/src/testing/growth-fixture.ts";
import { applyGrowthStrategy,growthStrategySchema } from "../../../packages/core/src/publish/growth-strategy.ts";
import { scriptJsonSchema } from "../../../packages/core/src/schemas/script-json.ts";
function fixture(){const s=makeReviewSnapshot();s.episode.script_json=scriptJsonSchema.parse(applyGrowthStrategy(s.episode.script_json,growthStrategySchema.parse(growthFixture),undefined,s.episode.id));Object.assign(s.episode.metadata.render_outputs,{platforms:{tiktok:{portrait:`https://project.supabase.co/storage/v1/object/public/assets/episodes/${s.episode.id}/render/final/${"a".repeat(64)}/episode_portrait.mp4`,commercial:false,quality:{version:"1.0.0",decode_verified:true,duration_seconds:75,size_bytes:1000,width:1080,height:1920,warnings:[]}}}});return s;}
Deno.test("tenant publisher uses only its claimed channel/token and never repeats an ambiguous post",async()=>{
 const prev=globalThis.fetch,old=Deno.env.get("SUPABASE_URL");Deno.env.set("SUPABASE_URL","https://project.supabase.co");
 const writes:Record<string,unknown>[]=[],calls:string[]=[];let claimed=false;
 const db={rpc(name:string,args?:Record<string,unknown>){
  if(name==="studio_claim_post"){if(claimed)return Promise.resolve({data:null,error:null});claimed=true;return Promise.resolve({data:{outbox:{id:"outbox",workspace_id:"workspace-own",episode_id:fixture().episode.id},channel:{external_id:"channel-own",platform:"tiktok",id:"channel-row"},snapshot:fixture()},error:null});}
  if(name==="studio_read_secret"){assertEquals(args?.p_workspace,"workspace-own");return Promise.resolve({data:{access_token:"own-token",expires_at:Date.now()+3600000},error:null});}
  throw Error(name);
 },from(table:string){const query:any={update(value:Record<string,unknown>){writes.push(value);return query;},select(){return query;},eq(){return query;},lt(){return query;},order(){return query;},limit(){return query;},insert(){return query;},maybeSingle(){return Promise.resolve({data:table==="system_config"?{value:{}}:null,error:null});},then(resolve:(v:unknown)=>unknown){return Promise.resolve({data:[],error:null}).then(resolve)}};return query;}};
 globalThis.fetch=(async(_url,init)=>{assertEquals(new Headers(init?.headers).get("Authorization"),"Bearer own-token");const body=JSON.parse(String(init?.body));calls.push(body.query);if(body.query.startsWith("query Channel"))return Response.json({data:{channel:{id:"channel-own",service:"tiktok"}}});assertEquals(body.variables.input.channelId,"channel-own");throw new TypeError("network lost after send");}) as typeof fetch;
 try{const result=await dispatchStudioPost(db as any);assertEquals(result?.studio_post_scheduled,false);assertEquals(writes.some(v=>v.status==="uncertain"&&v.error_code==="BUFFER_UNCERTAIN"),true);await dispatchStudioPost(db as any);assertEquals(calls.length,2);}finally{globalThis.fetch=prev;if(old)Deno.env.set("SUPABASE_URL",old);else Deno.env.delete("SUPABASE_URL");}
});
