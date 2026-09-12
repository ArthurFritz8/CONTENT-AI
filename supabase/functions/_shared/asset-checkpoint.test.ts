import { assertEquals } from "jsr:@std/assert@1";
import { handleAssets } from "../generate-assets/handler.ts";

Deno.test("assets retoma áudio salvo por cena e não promove antes de todas as legendas", async () => {
  const savedFetch = globalThis.fetch;
  const vars = { SUPABASE_URL: "https://audit.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-service-key", GEMINI_API_KEY: "test-api-key" };
  const old = Object.fromEntries(Object.keys(vars).map(key=>[key,Deno.env.get(key)]));
  for (const [key,value] of Object.entries(vars)) Deno.env.set(key,value);
  const id = "11111111-1111-4111-8111-111111111111";
  const ref = { url: "https://images.pexels.com/image.jpg", license: "pexels", source: "pexels" };
  const scenes = ["hook","content","cta"].map((role,order)=>({ id: `s${order}`, order, role, duration_seconds: 20,
    narration_text: "Texto de teste", transition: "cut", ken_burns: "static", visual: {description:"Teste",search_query:"test"},
    highlight_words: [], asset_landscape: ref, asset_portrait: ref, subtitle_position: "bottom_center" }));
  const script = { episode_id:id,prompt_version:"1.0.0",gap_seconds:0.5,music:null,scenes,
    narration:{full_text:"Texto de teste Texto de teste Texto de teste",language:"pt-BR",estimated_duration_seconds:60},
    sources:[{claim:"Teste",source_url:"https://example.com/source"}],
    disclosures:{contains_synthetic_media:true,commercial_content:false,commercial_disclosure_text:null},
    metadata:{youtube:{title:"Teste",description:"Teste",category:"Education",tags:["teste"]},tiktok:{title:"Teste",description:"Teste",hashtags:["#teste"]}} };
  const episode: Record<string, unknown> = {id,status:"script",script_json:script,product_image_url:null,tts_engine:"gemini",
    research_data:[{claim:"Teste",source_url:"https://example.com/source",confidence:0.9,query_used:"teste"}]};
  const assets: Record<string, unknown>[] = scenes.flatMap(scene=>["landscape","portrait"].map(orientation=>({
    type:"image",...ref,metadata:{scene_order:scene.order,orientation},author:"Test" })));
  let ttsCalls=0;
  let reservations=0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const json = (value: unknown) => new Response(JSON.stringify(value), {headers:{"Content-Type":"application/json"}});
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (url.hostname === "generativelanguage.googleapis.com") {
      ttsCalls++;
      return json({candidates:[{content:{parts:[{inlineData:{data:"AAAA",mimeType:"audio/L16;rate=24000"}}]}}]});
    }
    if (url.pathname.endsWith('/rpc/claim_episode')) return json(true);
    if (url.pathname.endsWith('/rpc/reserve_gemini_call')) { reservations++; return json(true); }
    if (url.pathname.endsWith('/episodes')) {
      if (method === "PATCH") { Object.assign(episode,body); return new Response(null,{status:204}); }
      return json(episode);
    }
    if (url.pathname.endsWith('/system_config')) return json({value:url.searchParams.get("key") === "eq.fact_check"
      ? {blocked_patterns:{medical:["\\mcura\\M"]},require_source_per_claim:true} : {}});
    if (url.pathname.endsWith('/assets')) {
      if (method === "POST") { assets.push(...(Array.isArray(body)?body:[body])); return new Response(null,{status:201}); }
      return json(assets);
    }
    if (url.pathname.startsWith('/storage/')) return json({Key:"test"});
    return new Response(null,{status:204});
  }) as typeof fetch;
  try {
    for (let i=0;i<3;i++) {
      const res=await handleAssets(new Request("https://audit.test",{method:"POST",headers:{Authorization:`Bearer ${vars.SUPABASE_SERVICE_ROLE_KEY}`},body:JSON.stringify({episode_id:id})}));
      assertEquals(res.status,202);
      assertEquals(assets.filter(a=>a.type==='audio').length,i+1);
      assertEquals(episode.status,'script');
      assertEquals(ttsCalls,i+1);
    }
    const final=await handleAssets(new Request("https://audit.test",{method:"POST",headers:{Authorization:`Bearer ${vars.SUPABASE_SERVICE_ROLE_KEY}`},body:JSON.stringify({episode_id:id})}));
    assertEquals(final.status,200);
    assertEquals(episode.status,'assets');
    assertEquals(ttsCalls,3);
    assertEquals(reservations,3);
    assertEquals(assets.filter(a=>a.type==='subtitle').length,6);
  } finally {
    globalThis.fetch=savedFetch;
    for (const [key,value] of Object.entries(old)) { if (value===undefined) Deno.env.delete(key); else Deno.env.set(key,value); }
  }
});
