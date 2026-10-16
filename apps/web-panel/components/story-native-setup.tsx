"use client";
import {useEffect,useRef,useState} from "react";
import {storyStyles,type StoryStyleId} from "../../../packages/core/src/stories/styles";
import {GenerateCharacterReference} from "./story-reference-source";
type Ref={id:string;character_id:string;kind:string;sha256:string};
type Profile={style:string;references:Array<{character_id:string;sha256:string}>;voice_directions:Array<{character_id:string;description:string}>;example:{id:string}};
type View={bible:{cast:Array<{id:string;name:string;voice:string}>};media:Ref[];can_configure:boolean;profile:Profile|null;native_examples:Array<{id:string;title:string;limitations:string[]}>};
export function StoryNativeSetup({seriesId,revision,styleId,onSaved}:{seriesId:string;revision:number;styleId:StoryStyleId;onSaved:()=>void}) {
  const [open,setOpen]=useState(false),[view,setView]=useState<View|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const [style,setStyle]=useState(`${storyStyles.find(s=>s.id===styleId)?.label}. Preserve as referências, roupas, proporções e olhos nítidos, com interpretação expressiva, gestos naturais e movimento de boca visível.`);
  const [selected,setSelected]=useState<Record<string,string>>({}),[directions,setDirections]=useState<Record<string,string>>({}),[example,setExample]=useState(""),[listened,setListened]=useState(false),[accepted,setAccepted]=useState(false);
  const uploads=useRef<Record<string,{file:File;id:string}>>({}),query=`series=${seriesId}&revision=${revision}&style=${styleId}`,base="/api/stories/production";
  async function load(signal?:AbortSignal) {
    const r=await fetch(`${base}?${query}`,{signal}),data=await r.json();if(!r.ok)throw Error(data.error||"Não foi possível abrir o padrão.");
    if(signal?.aborted)return;setView(data);
    if(data.profile){setStyle(data.profile.style);setExample(data.profile.example.id);}else setExample(old=>old||data.native_examples?.[0]?.id||"");
  }
  useEffect(()=>{if(!open)return;const c=new AbortController();void load(c.signal).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[open,seriesId,revision,styleId]);
  function ref(id:string){const refs=view?.media.filter(r=>r.kind==="reference"&&r.character_id===id)||[];return view?.profile?refs.find(r=>r.sha256===view.profile!.references.find(v=>v.character_id===id)?.sha256):refs.find(r=>r.id===selected[id])||refs.at(-1);}
  function voice(id:string,gender:string){return view?.profile?.voice_directions.find(v=>v.character_id===id)?.description||directions[id]||`Voz adulta ${gender==="female"?"feminina":"masculina"} em português brasileiro, clara e natural, com emoção contida e interpretação consistente.`;}
  async function upload(id:string,file:File) {
    setBusy(true);setError("");setAccepted(false);
    if(uploads.current[id]?.file!==file)uploads.current[id]={file,id:crypto.randomUUID()};
    try{const r=await fetch(`${base}/media?${query}&character=${id}&request=${uploads.current[id].id}`,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:file});const d=await r.json();if(!r.ok)throw Error(d.error);setSelected(v=>({...v,[id]:d.id}));delete uploads.current[id];await load();}
    catch(e){setError(e instanceof Error?e.message:"Falha no envio.");}finally{setBusy(false);}
  }
  const ready=!!view&&view.bible.cast.every(c=>!!ref(c.id))&&!!example;
  return <details className="story-production-setup" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>Configurar Auray · {storyStyles.find(s=>s.id===styleId)?.label} · versão {revision}</summary>
    {open&&<div><p>Capítulos de aproximadamente 15 segundos, com três tomadas e áudio nativo. Reserva de 15 créditos gratuitos por capítulo. Salvar este padrão não gera vídeo.</p>
      {!view&&!error&&<p role="status">Consultando configuração…</p>}
      {view&&<>
        {view.profile&&<p role="status"><strong>Padrão Auray salvo.</strong> A história e as referências permanecem vinculadas ao capítulo; as vozes são geradas pelo motor e podem variar.</p>}
        {!view.native_examples.length&&<p role="status">Ainda não há exemplo revisado da Auray neste estilo. Escolha um estilo com exemplo disponível antes de gerar.</p>}
        {!!view.native_examples.length&&<><label>Exemplo de referência<select value={example} disabled={busy||!view.can_configure} onChange={e=>{setExample(e.target.value);setListened(false);setAccepted(false);}}>{view.native_examples.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
          <video key={example} controls playsInline preload="none" width={240} aria-label="Exemplo Auray com vozes nativas" src={`/api/stories/styles/media?id=${example}`}/>
          <ul>{view.native_examples.find(s=>s.id===example)?.limitations.map((text,i)=><li key={i}>{text.includes("integração de capítulos")?"A aprovação desta amostra não aprova capítulos novos. Revise cada resultado antes de continuar a história.":text}</li>)}</ul>
        </>}
        <h4>Imagens e direção das vozes</h4><p className="muted">Use imagens verticais, com rosto, roupa e mãos visíveis. PNG, JPEG ou WebP de até 12 MB e pelo menos 480 pixels de largura. A direção vocal orienta a atuação; não fixa nem clona uma voz.</p>
        <div className="story-profile-cast">{view.bible.cast.map(c=><section key={c.id}><h5>{c.name}</h5>
          {view.can_configure&&<GenerateCharacterReference seriesId={seriesId} revision={revision} styleId={styleId} characterId={c.id} onReady={()=>void load()}/>}
          {view.can_configure&&<label>Imagem de {c.name}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const f=e.currentTarget.files?.[0];if(f)void upload(c.id,f);}}/></label>}
          {ref(c.id)&&<img src={`${base}/media?id=${ref(c.id)!.id}`} width={176} height={300} alt={`Referência Auray de ${c.name}`}/>}
          {view.can_configure&&view.media.filter(m=>m.kind==="reference"&&m.character_id===c.id).length>1&&<label>Referência de {c.name}<select value={ref(c.id)?.id} onChange={e=>{setSelected(v=>({...v,[c.id]:e.target.value}));setAccepted(false);}}>{view.media.filter(m=>m.kind==="reference"&&m.character_id===c.id).map((m,i)=><option key={m.id} value={m.id}>Imagem {i+1}</option>)}</select></label>}
          <label>Direção vocal de {c.name}<textarea rows={3} minLength={20} maxLength={240} disabled={busy||!view.can_configure} value={voice(c.id,c.voice)} onChange={e=>{setDirections(v=>({...v,[c.id]:e.target.value}));setAccepted(false);}}/></label>
        </section>)}</div>
        <label>Estilo Auray<textarea rows={3} minLength={30} maxLength={700} value={style} disabled={busy||!view.can_configure} onChange={e=>{setStyle(e.target.value);setAccepted(false);}}/></label>
        {view.can_configure&&<>
          <label className="studio-check"><input type="checkbox" checked={listened} disabled={busy||!example} onChange={e=>setListened(e.target.checked)}/>Assisti ao exemplo e ouvi o áudio. Entendo que ele demonstra uma amostra, sem garantir o mesmo resultado em todas as cenas.</label>
          <label className="studio-check"><input type="checkbox" checked={accepted} disabled={busy||!ready||!listened} onChange={e=>setAccepted(e.target.checked)}/>Aceito vozes geradas pela Auray, que podem variar entre tomadas e capítulos. Vou revisar falas, sincronia e aparência antes de continuar a história.</label>
          <button className="button primary" disabled={busy||!ready||!listened||!accepted||style.trim().length<30} onClick={async()=>{
            setBusy(true);setError("");setNotice("");
            try{const r=await fetch(base,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"native_finalize",seriesId,presentationRevision:revision,styleId,style,exampleId:example,confirmed:listened,nativeVoices:accepted,selection:view.bible.cast.map(c=>({character_id:c.id,reference_id:ref(c.id)!.id,voice_description:voice(c.id,c.voice)}))})});const d=await r.json();if(!r.ok||d.code!=="saved")throw Error(d.error||"As preferências mudaram ou há um capítulo em andamento. Atualize antes de salvar.");await load();setNotice("Padrão salvo. Use Gerar capítulo para começar; o saldo será conferido antes de qualquer tomada.");onSaved();}
            catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar.");}finally{setBusy(false);}
          }}>Salvar padrão Auray</button>
        </>}
        {!view.can_configure&&!view.profile&&<p>Conclua e aprove o capítulo atual ou ajuste a política para permitir versões de voz antes de configurar a Auray.</p>}
      </>}{error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    </div>}
  </details>;
}
