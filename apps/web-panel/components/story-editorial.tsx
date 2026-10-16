"use client";
import Link from "next/link";
import {useRef,useState} from "react";
import type {SeriesBible} from "../../../packages/core/src/stories/schema";
import {emptyStoryMemory,storyEditorialSaveSchema,seasonSchema} from "../../../packages/core/src/stories/editorial";

type Memory=typeof emptyStoryMemory;
type View={revision:number;bible:SeriesBible;pins:string[];memory:Memory;guidance:string;cast_locked:boolean;planned_through:number;
  seasons:Array<{number:number;title:string;starts_at:number;ends_at:number}>;
  history:Array<{revision:number;created_at:string}>;
  storyboards:Array<{chapter:number;episode_id:string;title:string|null;summary:string|null;approved:boolean;
    scenes:Array<{narration_text:string;prompt?:string;visual?:{speaker_id?:string;setting?:string;direction?:{action:string}};story_visual?:{speaker_id?:string}}> | null}>};
const labels={synopsis:"Sinopse e universo",cast:"Personagens e relações",arcs:"Arcos e desfecho"};
const memoryLabels:Record<keyof Memory,string>={relationships:"Relações e alianças",secrets:"Segredos: quem sabe o quê",characters:"Personagens: objetivos, emoções e figurino",setting:"Cenários, tempo e objetos",open_threads:"Ganchos e conflitos ainda abertos"};
const messages:Record<string,string>={revision_changed:"A história mudou em outra aba. Feche e abra o editor para carregar a versão atual.",story_locked:"A história já entrou em produção. Edite apenas os arcos futuros e a memória.",chapter_locked:"Os arcos de capítulos já iniciados ficam preservados.",cast_locked:"O elenco já tem referências ou capítulos. Sua identidade precisa ser preservada.",section_pinned:"Desmarque a seção fixada e salve antes de recriá-la.",busy:"Essa revisão já foi solicitada. Aguarde; o mesmo pedido não usa outra chamada.",daily_limit:"O limite de revisões de texto do dia foi atingido.",review_required:"Conclua e aprove os capítulos desta temporada antes de abrir a próxima.",version_limit:"O limite de versões desta história foi atingido."};
export function StoryEditorial({seriesId,onSaved}:{seriesId:string;onSaved:()=>void}) {
  const [opened,setOpened]=useState(false),[data,setData]=useState<View|null>(null),[draft,setDraft]=useState<View|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [season,setSeason]=useState({title:"Uma nova temporada",ending:"",chapters:[{title:"Um novo começo",arc:""}]}),[seasonOpen,setSeasonOpen]=useState(false);
  const request=useRef<{key:string;id:string}|null>(null);
  function id(payload:unknown){const key=JSON.stringify(payload);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};return request.current.id;}
  async function load(){const r=await fetch(`/api/stories?series=${encodeURIComponent(seriesId)}`),v=await r.json();if(!r.ok)throw Error(v.error||"História indisponível.");setData(v);setDraft(v);}
  async function post(payload:Record<string,unknown>){const r=await fetch("/api/stories",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,seriesId,requestId:id(payload)})}),v=await r.json();if(!r.ok)throw Error(v.error||"Não foi possível salvar.");return v;}
  async function run(fn:()=>Promise<void>){setBusy(true);setError("");setNotice("");try{await fn();}catch(e){setError(e instanceof Error?e.message:"Operação indisponível.");}finally{setBusy(false);}}
  const input=(v:View)=>({revision:v.revision,bible:v.bible,pins:v.pins,memory:v.memory,guidance:v.guidance});
  const dirty=!!data&&!!draft&&JSON.stringify(input(data))!==JSON.stringify(input(draft));
  function bible(patch:Partial<SeriesBible>){setDraft(v=>v?{...v,bible:{...v.bible,...patch}}:v);}
  async function save(){if(!draft)return;const parsed=storyEditorialSaveSchema.safeParse(input(draft));if(!parsed.success)throw Error("Confira os tamanhos dos textos. Sinopse: 30–1.200; arcos e desfecho: 30–700 caracteres. Nenhum campo obrigatório pode ficar vazio.");
    const v=await post({action:"editorial",input:parsed.data});if(v.code!=="saved")throw Error(messages[v.code]||"Não foi possível salvar.");request.current=null;await load();onSaved();setNotice("Versão salva. Os vídeos existentes foram preservados; a próxima preparação usará esta orientação e memória.");}
  return <section className="story-editorial" aria-label="Edição e continuidade">
    <button className="button secondary" aria-expanded={opened} disabled={busy} onClick={()=>{if(opened){setOpened(false);setData(null);setDraft(null);}else{setOpened(true);void run(load);}}}>{opened?"Fechar editor":"Editar história, memória e temporadas"}</button>
    {opened&&<div className="story-editorial-body">
      {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {!draft?<p className="muted">Carregando história…</p>:<>
        <p className="muted">Versão editorial {draft.revision}. {draft.planned_through?`Capítulos 1–${draft.planned_through} já iniciados: elenco, universo e arcos desses capítulos ficam preservados.`:"Edite a proposta antes de iniciar a produção."} Salvar ou recriar texto não gera vídeo.</p>
        <fieldset disabled={busy}><legend>Elementos fixados na criação automática</legend>
          <div className="studio-actions">{Object.entries(labels).map(([key,label])=><label key={key} className="story-pin"><input type="checkbox" checked={draft.pins.includes(key)} onChange={e=>setDraft({...draft,pins:e.target.checked?[...draft.pins,key]:draft.pins.filter(p=>p!==key)})}/>Fixar {label.toLowerCase()}</label>)}</div>
        </fieldset>
        <details open><summary>Sinopse e universo</summary><fieldset disabled={busy||draft.planned_through>0}>
          <label>Título<input maxLength={100} value={draft.bible.title} onChange={e=>bible({title:e.target.value})}/></label>
          <label>Sinopse<textarea rows={3} maxLength={1200} value={draft.bible.premise} onChange={e=>bible({premise:e.target.value})}/></label>
          <label>Universo e cenários<textarea rows={2} maxLength={500} value={draft.bible.world??""} onChange={e=>bible({world:e.target.value})}/></label>
          <label>Conflito central<textarea rows={2} maxLength={700} value={draft.bible.central_conflict??""} onChange={e=>bible({central_conflict:e.target.value})}/></label>
        </fieldset></details>
        <details><summary>Personagens e relações</summary><fieldset disabled={busy||draft.cast_locked}>
          {draft.bible.cast.map((c,i)=><div className="story-editorial-character" key={c.id}>
            <label>Nome<input maxLength={40} value={c.name} onChange={e=>bible({cast:draft.bible.cast.map((v,j)=>j===i?{...v,name:e.target.value}:v)})}/></label>
            {(["personality","goal","appearance_description"] as const).map(field=><label key={field}>{field==="personality"?"Personalidade":field==="goal"?"Objetivo":"Aparência e figurino"}<textarea rows={2} maxLength={field==="appearance_description"?500:300} value={c[field]??""} onChange={e=>bible({cast:draft.bible.cast.map((v,j)=>j===i?{...v,[field]:e.target.value}:v)})}/></label>)}
          </div>)}
          {draft.bible.relationships?.map((r,i)=><label key={`${r.from}:${r.to}`}>{draft.bible.cast.find(c=>c.id===r.from)?.name} e {draft.bible.cast.find(c=>c.id===r.to)?.name}<textarea rows={2} maxLength={300} value={r.description} onChange={e=>bible({relationships:draft.bible.relationships!.map((v,j)=>j===i?{...v,description:e.target.value}:v)})}/></label>)}
        </fieldset>{draft.cast_locked&&<p className="muted">As referências ou capítulos já vinculam este elenco. Sua aparência não será alterada por uma revisão de texto.</p>}</details>
        <details><summary>Arcos dos capítulos e desfecho</summary><fieldset disabled={busy}>
          {draft.bible.chapters.map((c,i)=><div key={i}><label>Capítulo {i+1}: título<input disabled={i<draft.planned_through} maxLength={100} value={c.title} onChange={e=>bible({chapters:draft.bible.chapters.map((v,j)=>j===i?{...v,title:e.target.value}:v)})}/></label><label>Arco do capítulo {i+1}<textarea disabled={i<draft.planned_through} rows={2} maxLength={700} value={c.arc} onChange={e=>bible({chapters:draft.bible.chapters.map((v,j)=>j===i?{...v,arc:e.target.value}:v)})}/></label></div>)}
          <label>Desfecho previsto<textarea rows={2} maxLength={700} value={draft.bible.ending??""} onChange={e=>bible({ending:e.target.value})}/></label>
        </fieldset></details>
        <details open><summary>Memória e orientação da continuação</summary>
          <button className="button small secondary" disabled={busy||dirty||!draft.storyboards.some(s=>s.approved)} onClick={()=>void run(async()=>{const v=await post({action:"editorial_suggest",section:"memory",revision:draft.revision,chapters:1});if(v.code!=="preview")throw Error(messages[v.code]||"Sugestão indisponível.");setDraft({...draft,memory:v.value});request.current=null;setNotice("Memória sugerida a partir dos resumos aprovados. Confira os fatos e salve para usar na continuação.");})}>Sugerir memória dos capítulos aprovados</button>
          <p className="muted">Registre fatos dos capítulos aprovados. Os resumos completos continuam sendo usados. Esta memória e a orientação são copiadas para o próximo capítulo ao iniciar sua preparação; capítulos já iniciados mantêm a versão anterior.</p>
          <fieldset disabled={busy}>{Object.entries(memoryLabels).map(([key,label])=><label key={key}>{label}<textarea rows={2} maxLength={1500} value={draft.memory[key as keyof Memory]} onChange={e=>setDraft({...draft,memory:{...draft.memory,[key]:e.target.value}})}/></label>)}
            <label>O que você quer na continuação? (opcional)<textarea rows={2} maxLength={1000} value={draft.guidance} placeholder="Ex.: revele quem escondeu a passagem, mantendo o segredo da carta." onChange={e=>setDraft({...draft,guidance:e.target.value})}/></label>
          </fieldset>
        </details>
        <div className="studio-actions"><button className="button primary" disabled={busy||!dirty} onClick={()=>void run(save)}>Salvar edição e memória</button>{dirty&&<span className="muted">Há alterações ainda não salvas.</span>}</div>
        {!draft.planned_through&&<div><p className="muted">Recriar uma seção usa a cota de texto e mantém as demais. Salve suas alterações e os elementos fixados primeiro. Confira a prévia e salve para adotá-la.</p><div className="studio-actions">{Object.entries(labels).map(([section,label])=><button className="button small secondary" key={section} disabled={busy||dirty||draft.pins.includes(section)||(section==="cast"&&draft.cast_locked)} onClick={()=>void run(async()=>{const v=await post({action:"revise",section,revision:draft.revision,guidance:draft.guidance});if(v.code!=="preview")throw Error(messages[v.code]||"Revisão indisponível.");setDraft({...draft,bible:v.bible});request.current=null;setNotice("Prévia pronta. Confira a seção alterada e salve para usar esta versão.");})}>Recriar {label.toLowerCase()}</button>)}</div></div>}
        <details><summary>Storyboard e acontecimentos aprovados</summary>
          {!draft.storyboards.length&&<p className="muted">O roteiro com as falas de cada cena aparecerá aqui quando o capítulo for preparado. Os arcos acima são o planejamento da história.</p>}
          {draft.storyboards.map(ch=><article key={ch.episode_id}><h4>Capítulo {ch.chapter} · {ch.title||"Em preparação"}</h4><p>{ch.approved?"Aprovado para continuidade":"Aguardando revisão"}</p>{ch.summary&&<p>{ch.summary}</p>}<ol>{ch.scenes?.map((s,i)=><li key={i}><strong>{draft.bible.cast.find(c=>c.id===(s.story_visual?.speaker_id??s.visual?.speaker_id))?.name||"Narração"}:</strong> {s.narration_text}{s.visual?.direction?.action&&<p className="muted">{s.visual.direction.action}</p>}</li>)}</ol><Link className="button small secondary" href={`/studio/episodes/${ch.episode_id}`}>Abrir capítulo</Link></article>)}
        </details>
        <details><summary>Temporadas e histórico</summary>
          <ul>{draft.seasons.map(s=><li key={s.number}>{s.title} · capítulos {s.starts_at}–{s.ends_at}</li>)}</ul>
          <p className="muted">Até 60 capítulos por novela, com até seis novos arcos por temporada. A próxima temporada exige os capítulos anteriores aprovados e conserva o elenco, as referências e os vídeos.</p>
          <button className="button secondary" disabled={busy||draft.bible.chapters.length>=60} onClick={()=>setSeasonOpen(!seasonOpen)}>{seasonOpen?"Fechar nova temporada":"Planejar próxima temporada"}</button>
          <button className="button secondary" disabled={busy||dirty||draft.bible.chapters.length>57||draft.storyboards.length!==draft.bible.chapters.length||!draft.storyboards.every(s=>s.approved)} onClick={()=>void run(async()=>{const v=await post({action:"editorial_suggest",section:"season",revision:draft.revision,chapters:3});if(v.code!=="preview")throw Error(messages[v.code]||"Sugestão indisponível.");setSeason(v.value);setSeasonOpen(true);request.current=null;setNotice("Prévia de três novos capítulos criada. Confira os arcos e salve a temporada; nenhum vídeo foi gerado.");})}>Criar próxima temporada automaticamente</button>
          {seasonOpen&&<fieldset disabled={busy}><legend>Nova temporada</legend><label>Título<input maxLength={100} value={season.title} onChange={e=>setSeason({...season,title:e.target.value})}/></label>{season.chapters.map((c,i)=><div key={i}><label>Título do capítulo {draft.bible.chapters.length+i+1}<input maxLength={100} value={c.title} onChange={e=>setSeason({...season,chapters:season.chapters.map((v,j)=>j===i?{...v,title:e.target.value}:v)})}/></label><label>Arco<textarea maxLength={700} rows={2} value={c.arc} onChange={e=>setSeason({...season,chapters:season.chapters.map((v,j)=>j===i?{...v,arc:e.target.value}:v)})}/></label></div>)}<label>Desfecho da temporada<textarea rows={2} maxLength={700} value={season.ending} onChange={e=>setSeason({...season,ending:e.target.value})}/></label><div className="studio-actions"><button className="button secondary" disabled={season.chapters.length>=6||draft.bible.chapters.length+season.chapters.length>=60} onClick={()=>setSeason({...season,chapters:[...season.chapters,{title:"Novo capítulo",arc:""}]})}>Adicionar capítulo ao plano</button><button className="button primary" disabled={dirty} onClick={()=>void run(async()=>{const parsed=seasonSchema.safeParse(season);if(!parsed.success)throw Error("Preencha título e arcos. Cada arco e o desfecho precisam de 30–700 caracteres.");const v=await post({action:"season",revision:draft.revision,season:parsed.data});if(v.code!=="saved")throw Error(messages[v.code]||"Temporada indisponível.");request.current=null;setSeasonOpen(false);await load();onSaved();setNotice("Nova temporada planejada. Nenhum vídeo foi gerado.");})}>Salvar temporada</button></div></fieldset>}
          <p className="muted">{draft.history.length?`Revisões salvas: ${draft.history.map(h=>h.revision).join(", ")}. Os capítulos guardam o contexto usado na sua criação.`:"Nenhuma revisão editorial salva ainda."}</p>
        </details>
      </>}
    </div>}
  </section>;
}
