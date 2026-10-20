import {test} from "node:test";
import {strictEqual,ok,throws} from "node:assert";
import {comicPanelArtwork,storyArtwork} from "./art.ts";
import {buildStoryScript} from "./script.ts";
import {storyContextSchema} from "./schema.ts";
const context=storyContextSchema.parse({series_id:"11111111-1111-4111-8111-111111111111",chapter_number:1,previous_summaries:[],bible:{kind:"fruits",genre:"mystery",title:"A chave da feira",premise:"Duas frutas encontram uma chave misteriosa na feira.",cast:[
 {id:"lia",name:"Lia",appearance:"apple",color:"#ef1234",personality:"Curiosa e amiga de todos.",voice:"female"},{id:"rui",name:"Rui",appearance:"orange",color:"#fab123",personality:"Impulsivo e muito curioso.",voice:"male"}],chapters:[{title:"A chave",arc:"Os amigos encontram uma chave e procuram juntos quem perdeu aquele objeto na feira."}]}});
test("comic panels retain artwork and escape speech instead of injecting markup",()=>{
 const visual={speaker_id:"lia",on_stage:["lia"],setting:"garden",mood:"happy",prop:"key"} as const;
 const source=storyArtwork(context,{...visual,on_stage:[...visual.on_stage]},"portrait");
 const panel=comicPanelArtwork(source,"<script>unsafe & speech</script>",1,"portrait");
 ok(panel.includes("QUADRO 1"));ok(panel.includes("&lt;script&gt;unsafe &amp; speech&lt;/script&gt;"));ok(!panel.includes("<script>"));
 ok(panel.includes("FICÇÃO ORIGINAL"));ok(panel.endsWith("</svg>"));
});
test("comic script is separately labelled and preserves narration while choosing camera motion",()=>{
 const raw={title:"A chave da feira",summary:"Lia encontra a chave e Rui decide investigar com a amiga o mistério da feira.",scenes:Array.from({length:5},(_,index)=>({narration_text:"Uma chave misteriosa muda a rotina dos amigos na feira.",visual:{speaker_id:index%2?"rui":"lia",on_stage:[index%2?"rui":"lia"],setting:"garden",mood:"surprised",prop:"key"}}))};
 const script=buildStoryScript(raw,{...context,local_comic:true},"22222222-2222-4222-8222-222222222222",false,"motion_comic");
 strictEqual(script.fiction?.local_comic?.source,"local");strictEqual(script.fiction?.local_comic?.body_animation,false);
 strictEqual(script.scenes[0]?.ken_burns,"pan_left");strictEqual(script.scenes[0]?.narration_text,raw.scenes[0]!.narration_text);
 strictEqual(buildStoryScript(raw,context,script.episode_id).fiction?.local_comic,undefined);
 throws(()=>buildStoryScript(raw,context,script.episode_id,false,"motion_comic"));
});