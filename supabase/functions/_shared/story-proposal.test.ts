import { assertEquals } from "jsr:@std/assert@1";
import { handleStory } from "../studio-story/handler.ts";
import { storyFixture } from "../../../packages/core/src/testing/story-fixture.ts";

async function environment(run: () => Promise<void>) {
  const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "CONTENT_AI_SERVICE_ROLE_KEY"];
  const previous = keys.map(k=>Deno.env.get(k)), fetch = globalThis.fetch;
  Deno.env.set(keys[0],"https://story.supabase.co"); Deno.env.set(keys[1],"test-service-key"); Deno.env.set(keys[2],"test-gemini-key");
  Deno.env.delete(keys[3]); Deno.env.delete(keys[4]);
  try { await run(); } finally { globalThis.fetch=fetch; keys.forEach((k,i)=>previous[i]===undefined ? Deno.env.delete(k) : Deno.env.set(k,previous[i]!)); }
}
const json = (v: unknown) => new Response(JSON.stringify(v),{headers:{"Content-Type":"application/json"}});
const proposal = {action:"propose",workspace:"11111111-1111-4111-8111-111111111111",actor:"22222222-2222-4222-8222-222222222222",
  request_id:"33333333-3333-4333-8333-333333333333",input:{kind:"fruits",genre:"mystery",chapters:2,creation_mode:"automatic"}};
const request = (input: unknown = proposal) => new Request("https://worker.test",{method:"POST",headers:{Authorization:"Bearer test-service-key"},body:JSON.stringify(input)});

Deno.test("automatic proposal with no idea persists complete concept once and never generates assets",async()=>await environment(async()=>{
  const bible = storyFixture().context.bible;
  const complete = {...bible,genre:"mystery",world:"Uma pequena feira brasileira cheia de segredos.",
    central_conflict:"Uma carta perdida ameaça a amizade das duas frutas da feira.",ending:"As duas frutas revelam o segredo e recuperam sua amizade.",
    cast:bible.cast.map(c=>({...c,role:"protagonist",goal:"Descobrir o segredo da carta.",appearance_description:"Fruta adulta com rosto expressivo, roupas e materiais detalhados."})),
    relationships:[{from:bible.cast[0].id,to:bible.cast[1].id,description:"Amigos que discordam sobre a carta."}]};
  let calls=0,saves=0; const sid="44444444-4444-4444-8444-444444444444";
  globalThis.fetch=(async(input,init)=>{
    const u=new URL(input instanceof Request ? input.url : String(input)), body=init?.body ? JSON.parse(String(init.body)) : null;
    if(u.pathname.endsWith("/rpc/studio_assert_member")) return json(null);
    if(u.pathname.endsWith("/rpc/studio_story_claim")) { assertEquals(body.p_input.premise,""); return json(saves ? {code:"saved",series_id:sid} : {code:"claimed"}); }
    if(u.pathname.endsWith("/rpc/studio_story_save")) { saves++; assertEquals(body.p_bible.ending,complete.ending); return json(sid); }
    if(u.pathname.endsWith("/system_config")) return json({value:{}});
    if(u.pathname.endsWith("/rpc/reserve_gemini_call")) return json(true);
    if(u.hostname==="generativelanguage.googleapis.com") { calls++; return json({candidates:[{content:{parts:[{text:JSON.stringify(complete)}]}}]}); }
    if(u.pathname.endsWith("/job_events")) return new Response(null,{status:201});
    throw Error(`Unexpected generation request ${u.pathname}`);
  }) as typeof fetch;
  assertEquals((await handleStory(request())).status,200);
  assertEquals((await handleStory(request())).status,200);
  assertEquals(calls,1); assertEquals(saves,1);
  assertEquals((await handleStory(request({...proposal,input:{...proposal.input,creation_mode:"manual"}}))).status,400);
  assertEquals(calls,1);
}));
Deno.test("incomplete automated concept cannot be saved or repaired indefinitely",async()=>await environment(async()=>{
  let calls=0,saves=0;
  globalThis.fetch=(async(input)=>{
    const u=new URL(input instanceof Request ? input.url : String(input));
    if(u.pathname.endsWith("/rpc/studio_assert_member")) return json(null);
    if(u.pathname.endsWith("/rpc/studio_story_claim")) return json({code:"claimed"});
    if(u.pathname.endsWith("/rpc/studio_story_save")) { saves++; return json("unexpected"); }
    if(u.pathname.endsWith("/system_config")) return json({value:{}});
    if(u.pathname.endsWith("/rpc/reserve_gemini_call")) return json(true);
    if(u.hostname==="generativelanguage.googleapis.com") { calls++; return json({candidates:[{content:{parts:[{text:JSON.stringify(storyFixture().context.bible)}]}}]}); }
    if(u.pathname.endsWith("/job_events")) return new Response(null,{status:201});
    throw Error(`Unexpected request ${u.pathname}`);
  }) as typeof fetch;
  assertEquals((await handleStory(request())).status,422); assertEquals(calls,2); assertEquals(saves,0);
}));
