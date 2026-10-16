import {test} from "node:test";
import assert from "node:assert/strict";
import {mergeStorySection,storyEditorialSaveSchema,emptyStoryMemory,seasonSchema} from "./editorial.ts";
import {seriesBibleSchema,storyContextSchema} from "./schema.ts";
const bible=seriesBibleSchema.parse({title:"A carta escondida",kind:"fruits",genre:"mystery",premise:"Duas frutas procuram uma carta que revela o segredo da feira.",
 cast:[{id:"lia",name:"Lia",appearance:"apple",color:"#ff0000",personality:"Curiosa e muito cuidadosa.",voice:"female"},{id:"rui",name:"Rui",appearance:"orange",color:"#ff9900",personality:"Impulsivo e sempre leal.",voice:"male"}],
 chapters:[{title:"A carta perdida",arc:"Lia encontra uma pista concreta sobre a carta que desapareceu da feira."}]});
test("regeneration cannot alter pinned sections through a model response",()=>{
 const response={...bible,title:"Título que não foi pedido",cast:bible.cast.map(c=>({...c,name:"Trocado"})),chapters:[{title:"Uma nova pista",arc:"Rui revela que guardou a carta para proteger a amiga de um grande engano."}]};
 const merged=mergeStorySection(bible,response,"arcs");assert.equal(merged.title,bible.title);assert.deepEqual(merged.cast,bible.cast);assert.equal(merged.chapters[0]!.title,"Uma nova pista");
 assert.throws(()=>mergeStorySection(bible,{...response,chapters:[...response.chapters,...response.chapters]},"arcs"));
});
test("continuation supports later seasons and validates snapshot length",()=>{
 const chapters=Array.from({length:7},()=>bible.chapters[0]!);const input={series_id:"00000000-0000-4000-8000-000000000001",bible:{...bible,chapters},chapter_number:7,
 previous_summaries:Array.from({length:6},()=>"Lia encontrou uma pista e Rui confessou que guardara a carta."),editorial:{revision:2,memory:{...emptyStoryMemory,secrets:"Só Rui sabe onde está a carta."},guidance:"Revele a carta sem trocar o figurino."}};
 assert.equal(storyContextSchema.parse(input).editorial!.memory.secrets,input.editorial.memory.secrets);
 assert.equal(storyContextSchema.safeParse({...input,previous_summaries:[]}).success,false);
 assert.equal(storyContextSchema.safeParse({...input,chapter_number:61}).success,false);
});
test("editorial contract bounds memory and rejects duplicate pins",()=>{
 const base={revision:0,bible,pins:["cast"],memory:emptyStoryMemory,guidance:""};assert.equal(storyEditorialSaveSchema.safeParse(base).success,true);
 assert.equal(storyEditorialSaveSchema.safeParse({...base,pins:["cast","cast"]}).success,false);
 assert.equal(storyEditorialSaveSchema.safeParse({...base,memory:{...emptyStoryMemory,secrets:"x".repeat(1501)}}).success,false);
 assert.equal(seasonSchema.safeParse({title:"Segunda temporada",chapters:bible.chapters,ending:"Os dois decidem finalmente revelar a carta para todos na feira."}).success,true);
});
