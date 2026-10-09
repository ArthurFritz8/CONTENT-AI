import { assertEquals } from "jsr:@std/assert@1";
import { handleStory } from "../studio-story/handler.ts";

Deno.test("balance refresh dispatches only an authorized wallet and never invokes generation", async () => {
  const values={SUPABASE_URL:"https://audit.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"test-service-key",GITHUB_REPO:"audit/studio",GITHUB_TOKEN:"test-github-key",GITHUB_BRANCH:"main"};
  const old=Object.keys(values).map(k=>Deno.env.get(k)), oldFetch=globalThis.fetch;
  const serviceOverride=Deno.env.get("CONTENT_AI_SERVICE_ROLE_KEY");
  Object.entries(values).forEach(([k,v])=>Deno.env.set(k,v));Deno.env.delete("CONTENT_AI_SERVICE_ROLE_KEY");
  let outcome="dispatch", allowed=true, dispatches=0;
  const wallet="33333333-3333-4333-8333-333333333333";
  globalThis.fetch=(async(input,init)=>{
    const url=new URL(input instanceof Request ? input.url : String(input));
    if(url.pathname.endsWith("/rpc/studio_assert_member"))return Response.json(null);
    if(url.pathname.endsWith("/rpc/studio_modal_balance_request")) {
      assertEquals(JSON.parse(String(init?.body)).p_wallet,wallet);
      return Response.json(allowed ? {code:outcome} : {message:"access denied"},{status:allowed ? 200 : 403});
    }
    if(url.hostname==="api.github.com") {
      assertEquals(url.pathname,"/repos/audit/studio/actions/workflows/story-balance.yml/dispatches");
      assertEquals(JSON.parse(String(init?.body)),{ref:"main",inputs:{wallet_id:wallet}});
      dispatches++;return new Response(null,{status:204});
    }
    if(url.pathname.endsWith("/job_events"))return new Response(null,{status:201});
    throw Error("Unexpected external operation during read-only balance request");
  }) as typeof fetch;
  const request=(token="test-service-key")=>new Request("https://edge.test",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({action:"balance",workspace:"11111111-1111-4111-8111-111111111111",actor:"22222222-2222-4222-8222-222222222222",wallet_id:wallet})});
  try {
    assertEquals((await handleStory(request())).status,200);assertEquals(dispatches,1);
    outcome="waiting";assertEquals((await handleStory(request())).status,200);assertEquals(dispatches,1);
    outcome="entitlement_unverified";assertEquals((await handleStory(request())).status,200);assertEquals(dispatches,1);
    allowed=false;assertEquals((await handleStory(request())).status,403);assertEquals(dispatches,1);
    assertEquals((await handleStory(request("wrong"))).status,401);assertEquals(dispatches,1);
  } finally {
    globalThis.fetch=oldFetch;Object.keys(values).forEach((k,i)=>old[i]===undefined ? Deno.env.delete(k) : Deno.env.set(k,old[i]!));
    if(serviceOverride===undefined)Deno.env.delete("CONTENT_AI_SERVICE_ROLE_KEY");else Deno.env.set("CONTENT_AI_SERVICE_ROLE_KEY",serviceOverride);
  }
});
