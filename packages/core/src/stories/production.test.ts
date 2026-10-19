import { test } from "node:test";
import { strictEqual, deepStrictEqual, throws, notStrictEqual } from "node:assert";
import { productionProfileHash, quoteSeriesProduction,planProductionQueue,type ProductionQueueEntry } from "./production.ts";
import { routeVideoShot, type VideoProvider } from "./video-routing.ts";
import { storyRequestSchema, proposalBibleSchema } from "./schema.ts";
import { biblePrompt } from "./prompts.ts";
import { storyFixture } from "../testing/story-fixture.ts";

const now = 1000000, series = "11111111-1111-4111-8111-111111111111", profile = "a".repeat(64), execution = "b".repeat(64);
const shot = { version: "1.0.0", id: "talk", kind: "dialogue", reference_path: "own.png", reference_sha256: profile,
  prompt: "A personagem pergunta pelo segredo, olhando para o outro personagem.", seconds: 4, seed: 42,
  quality: "approved_master", min_short_edge: 704, min_output_fps: 60, audio_sha256: profile,
  continuity: { series_id: series, profile_sha256: profile } };
const provider = (id: string, group = id): VideoProvider => ({ id, quota_group: group, available: true, adapter_ready: true,
  checked_at: now, cooldown_until: 0, free_remaining: 100, reserved: 0, required: 10, cash_cost: 0,
  free_tier: "recurring", billing: "credits", capabilities: ["dialogue"], quality: ["approved_master"],
  short_edge: 704, output_fps: 60, max_seconds: 5, execution_sha256: execution,
  continuity_approvals: [{ series_id: series, profile_sha256: profile, execution_sha256: execution, capabilities: ["dialogue"] }] });
const wallet = (group: string, amount = 20) => ({ quota_group: group, unit: "credits", remaining_units: amount, held_units: 0, checked_at: now, valid_until: now + 5000 });
const chapter = (id: string, units = 10) => ({ id, shots: [{ shot, quotes: ["a", "b"].map(provider_id => ({ provider_id, execution_sha256: execution, units, cash_cost: 0 })) }] });
function queued(id:string,seriesId=series):ProductionQueueEntry {
  return {...chapter(id),series_id:seriesId,chapter_number:1,priority:100,created_at:now-100,previous_approved:true,
    shots:chapter(id).shots.map(item=>({...item,shot:{...shot,continuity:{...shot.continuity,series_id:seriesId}}}))};
}
function compatible(id:string,seriesIds:string[],group=id):VideoProvider {
  return {...provider(id,group),continuity_approvals:seriesIds.map(series_id=>({series_id,profile_sha256:profile,execution_sha256:execution,capabilities:["dialogue"]}))};
}
const anotherSeries="22222222-2222-4222-8222-222222222222",thirdSeries="33333333-3333-4333-8333-333333333333";
test("queue rotates independent approved wallets and reserves every shot of a chapter on one source",()=>{
  const sources=[compatible("a",[series,anotherSeries,thirdSeries]),compatible("b",[series,anotherSeries,thirdSeries])];
  const entries=[queued("1"),queued("2",anotherSeries),queued("3",thirdSeries)];
  entries[0]!.shots.push({...entries[0]!.shots[0]!,shot:{...shot,id:"second"}});
  const result=planProductionQueue(entries,sources,[wallet("a",40),wallet("b",40)],now);
  deepStrictEqual(result.decisions.map(row=>row.provider_id),["a","b","a"]);
  deepStrictEqual(result.allocations.slice(0,2).map(row=>row.provider_id),["a","a"]);
  deepStrictEqual(result.remaining_by_wallet,{a:10,b:30});strictEqual(result.dispatch_enabled,false);
});
test("unaffordable chapters hold no simulated balance and do not block unrelated series",()=>{
  const large=queued("1"),small=queued("2",anotherSeries);large.shots.push({...large.shots[0]!,shot:{...shot,id:"second"}});
  const result=planProductionQueue([large,small],[compatible("a",[series,anotherSeries])],[wallet("a",15)],now);
  deepStrictEqual(result.decisions.map(row=>row.status),["waiting_capacity","planned"]);
  deepStrictEqual(result.remaining_by_wallet,{a:5});strictEqual(result.estimated_complete_chapters,1);
});
test("shared wallet aliases cannot create extra budget or extra places in the rotation",()=>{
  const result=planProductionQueue([queued("1"),queued("2",anotherSeries)],
    [compatible("a",[series,anotherSeries],"shared"),compatible("b",[series,anotherSeries],"shared")],[wallet("shared",10)],now);
  deepStrictEqual(result.decisions.map(row=>row.status),["planned","waiting_capacity"]);
  deepStrictEqual(result.remaining_by_wallet,{shared:0});strictEqual(result.proposed_after_quota_group,"shared");
});
test("accepted, uncertain and completed attempts never return to generation or another provider",()=>{
  for(const outcome of ["accepted","unknown","completed"] as const) {
    const entry={...queued("1"),attempt:{provider_id:"a",outcome}};
    const result=planProductionQueue([entry],[provider("a"),provider("b")],[wallet("a"),wallet("b")],now,"b");
    strictEqual(result.decisions[0]!.status,outcome==="completed"?"waiting_review":"reconciliation_required");
    strictEqual(result.decisions[0]!.provider_id,"a");strictEqual(result.allocations.length,0);
    strictEqual(result.proposed_after_quota_group,"b");deepStrictEqual(result.remaining_by_wallet,{a:20,b:20});
  }
});
test("an accepted or unknown attempt pauses its physical wallet including aliases, not unrelated accounts",()=>{
  const existing={...queued("1"),attempt:{provider_id:"a",outcome:"unknown" as const}},next=queued("2",anotherSeries);
  const sources=[compatible("a",[series,anotherSeries],"shared"),compatible("alias",[series,anotherSeries],"shared"),compatible("b",[series,anotherSeries])];
  const result=planProductionQueue([existing,next],sources,[wallet("shared",100),wallet("b",20)],now);
  deepStrictEqual(result.decisions.map(row=>row.status),["reconciliation_required","planned"]);
  strictEqual(result.decisions[1]!.provider_id,"b");
  deepStrictEqual(result.decisions[1]!.reasons.filter(row=>row.reason==="wallet_reconciliation_required").map(row=>row.provider),["a","alias"]);
  deepStrictEqual(result.remaining_by_wallet,{shared:100,b:10});
});
test("queue rotation retains an exhausted wallet position rather than restarting at the first offer",()=>{
  const entry=queued("1");entry.shots[0]!.quotes.push({provider_id:"c",execution_sha256:execution,units:10,cash_cost:0});
  const result=planProductionQueue([entry],[provider("a"),provider("b"),provider("c")],[wallet("a"),wallet("b",0),wallet("c")],now,"b");
  strictEqual(result.decisions[0]!.provider_id,"c");strictEqual(result.proposed_after_quota_group,"c");
});
test("confirmed refusal can consider another approved source but never overrides a pinned source",()=>{
  const entry={...queued("1"),attempt:{provider_id:"a",outcome:"rejected_before_acceptance" as const}};
  strictEqual(planProductionQueue([entry],[provider("a"),provider("b")],[wallet("a"),wallet("b")],now).decisions[0]!.provider_id,"b");
  strictEqual(planProductionQueue([{...entry,pinned_provider_id:"a"}],[provider("a"),provider("b")],[wallet("a"),wallet("b")],now).decisions[0]!.status,"waiting_capacity");
  const aliases=planProductionQueue([entry],[provider("a","shared"),provider("b","shared")],[wallet("shared",100)],now);
  strictEqual(aliases.decisions[0]!.status,"waiting_capacity");
  deepStrictEqual(aliases.remaining_by_wallet,{shared:100});
});
test("queue preserves FIFO priority and held credits without converting wallet currencies",()=>{
  const later={...queued("later"),priority:200,created_at:now-10};
  const earlier={...queued("earlier",anotherSeries),priority:10,created_at:now-100};
  const result=planProductionQueue([later,earlier],[compatible("a",[series,anotherSeries]),compatible("b",[series,anotherSeries])],
    [{...wallet("a",20),held_units:10,unit:"usd_micro"},{...wallet("b",20),unit:"credits"}],now);
  deepStrictEqual(result.decisions.map(row=>[row.chapter_id,row.provider_id]),[["earlier","a"],["later","b"]]);
  deepStrictEqual(result.remaining_by_wallet,{a:0,b:10});
});
test("priority and creation order cannot skip earlier chapters or the human review gate",()=>{
  const first={...queued("1"),priority:500},next={...queued("2"),chapter_number:2,priority:0};
  const result=planProductionQueue([first,next],[provider("a")],[wallet("a",100)],now);
  deepStrictEqual(result.decisions.map(row=>[row.chapter_id,row.status]),[["2","waiting_previous_chapter"],["1","planned"]]);
  strictEqual(planProductionQueue([{...next,previous_approved:false}],[provider("a")],[wallet("a",100)],now).decisions[0]!.status,"waiting_review");
});
test("unapproved sources, unknown or stale wallets and paid quotes remain outside the queue plan",()=>{
  for(const source of [{...provider("a"),continuity_approvals:[]},{...provider("a"),free_tier:"unknown" as const}])
    strictEqual(planProductionQueue([queued("1")],[source],[wallet("a")],now).estimated_complete_chapters,0);
  for(const wallets of [[],[{...wallet("a"),checked_at:now-300001}]])
    strictEqual(planProductionQueue([queued("1")],[provider("a")],wallets,now).estimated_complete_chapters,0);
  const paid=queued("1");paid.shots[0]!.quotes=paid.shots[0]!.quotes.map(quote=>({...quote,cash_cost:0.01}));
  strictEqual(planProductionQueue([paid],[provider("a")],[wallet("a")],now).estimated_complete_chapters,0);
});
test("queue rejects duplicated identities, foreign profiles and mutates no input",()=>{
  const entry=queued("1"),sources=[provider("a")],wallets=[wallet("a")];const before=JSON.stringify({entry,sources,wallets});
  planProductionQueue([entry],sources,wallets,now);strictEqual(JSON.stringify({entry,sources,wallets}),before);
  throws(()=>planProductionQueue([entry,entry],sources,wallets,now));
  throws(()=>planProductionQueue([{...entry,created_at:now+1}],sources,wallets,now));
  throws(()=>planProductionQueue([{...entry,series_id:anotherSeries}],sources,wallets,now));
  throws(()=>planProductionQueue([{...entry,shots:[entry.shots[0]!,{...entry.shots[0]!,shot:{...shot,id:"another",continuity:{...shot.continuity,profile_sha256:"c".repeat(64)}}}]}],sources,wallets,now));
});

test("automatic conception accepts no idea and manual conception still requires one", () => {
  const input = storyRequestSchema.parse({ kind: "fruits", genre: "mystery", chapters: 3, creation_mode: "automatic" });
  strictEqual(input.premise, ""); strictEqual(biblePrompt(input).includes("CRIAÇÃO AUTOMÁTICA"), true);
  throws(() => storyRequestSchema.parse({ kind: "fruits", genre: "mystery", chapters: 3 }));
  strictEqual(storyRequestSchema.parse({ kind: "fruits", genre: "mystery", chapters: 3, premise: "Duas frutas encontram uma carta misteriosa na feira." }).creation_mode, "manual");
  throws(() => storyRequestSchema.parse({ ...input, premise: "x".repeat(1001) }));
});
test("new proposals require the whole narrative; old saved bibles remain readable", () => {
  const bible = storyFixture().context.bible;
  throws(() => proposalBibleSchema.parse(bible));
  const complete = { ...bible, world: "Uma pequena feira brasileira cheia de segredos.",
    central_conflict: "Uma carta perdida ameaça a amizade das duas frutas da feira.", ending: "As duas frutas revelam o segredo e recuperam sua amizade.",
    cast: bible.cast.map(c => ({ ...c, role: "protagonist", goal: "Descobrir o segredo da carta.", appearance_description: "Fruta adulta com vestido ou camisa, rosto expressivo e cores estáveis." })),
    relationships: [{ from: bible.cast[0]!.id, to: bible.cast[1]!.id, description: "Amigos que discordam sobre a carta." }] };
  strictEqual(proposalBibleSchema.parse(complete).cast.length, bible.cast.length);
  throws(() => proposalBibleSchema.parse({ ...complete, relationships: [{ ...complete.relationships[0], to: "unknown" }] }));
});
test("provider changes require series, identity, execution and task compatibility", () => {
  strictEqual(routeVideoShot(shot, [provider("a")], now).selected, "a");
  for (const p of [{ ...provider("a"), continuity_approvals: [] }, { ...provider("a"), execution_sha256: "c".repeat(64) },
    { ...provider("a"), continuity_approvals: [{ ...provider("a").continuity_approvals![0]!, series_id: "22222222-2222-4222-8222-222222222222" }] },
    { ...provider("a"), continuity_approvals: [{ ...provider("a").continuity_approvals![0]!, capabilities: ["reaction"] as ["reaction"] }] }]) {
    deepStrictEqual(routeVideoShot(shot, [p], now).reasons, [{ provider: "a", reason: "series_incompatible" }]);
  }
  strictEqual(routeVideoShot({ ...shot, continuity: undefined }, [provider("a")], now).selected, null);
});
test("capacity adds independent compatible wallets and counts a shared wallet once", () => {
  const plan = [chapter("1"), chapter("2"), chapter("3")];
  strictEqual(quoteSeriesProduction(plan, [provider("a"), provider("b")], [wallet("a"), wallet("b")], now).estimated_complete_chapters, 3);
  strictEqual(quoteSeriesProduction(plan, [provider("a", "shared"), provider("b", "shared")], [wallet("shared")], now).estimated_complete_chapters, 2);
  throws(() => quoteSeriesProduction(plan, [provider("a")], [wallet("a"), wallet("a")], now));
});
test("incompatible and stale credit cannot inflate continuation capacity", () => {
  const plan = [chapter("1"), chapter("2")];
  strictEqual(quoteSeriesProduction(plan, [provider("a"), { ...provider("b"), continuity_approvals: [] }], [wallet("a", 10), wallet("b", 100)], now).estimated_complete_chapters, 1);
  for (const change of [{ checked_at: now - 300001 }, { valid_until: now }, { held_units: 20 }, { remaining_units: NaN }, { checked_at: now + 1 }])
    strictEqual(quoteSeriesProduction(plan, [provider("a")], [{ ...wallet("a"), ...change }], now).estimated_complete_chapters, 0);
});
test("partial chapters do not consume estimate balance; revisions and paid quotes fail closed", () => {
  const twoShots = { id: "1", shots: [...chapter("1").shots, { ...chapter("1").shots[0]!, shot: { ...shot, id: "second" } }] };
  const result = quoteSeriesProduction([twoShots], [provider("a")], [wallet("a", 15)], now);
  strictEqual(result.estimated_complete_chapters, 0); deepStrictEqual(result.remaining_by_wallet, { a: 15 });
  for (const change of [{ execution_sha256: "c".repeat(64) }, { units: 0 }, { units: 1.5 }, { cash_cost: 0.01 }]) {
    const c = chapter("1"); c.shots[0]!.quotes = [{ ...c.shots[0]!.quotes[0]!, ...change }];
    strictEqual(quoteSeriesProduction([c], [provider("a")], [wallet("a")], now).estimated_complete_chapters, 0);
  }
});
test("canonical profile hashes bind references and voices without depending on a GPU host", async () => {
  const p = { version: "1.0.0", orientation: "portrait", short_edge: 704, output_fps: 60,
    style: "Animação 3D estilizada com materiais detalhados e personagens adultos.",
    references: ["a", "b"].map(character_id => ({ character_id, path: `${character_id}.png`, sha256: profile })),
    voices: ["a", "b"].map(character_id => ({ character_id, engine: "tts", voice_id: character_id, version: "1", sample_sha256: profile })) };
  strictEqual(await productionProfileHash(p), await productionProfileHash({ ...p, style: p.style }));
  notStrictEqual(await productionProfileHash(p), await productionProfileHash({ ...p, voices: p.voices.map(v => ({ ...v, version: "2" })) }));
});
