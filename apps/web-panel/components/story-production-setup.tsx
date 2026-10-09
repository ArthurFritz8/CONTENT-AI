"use client";
import { useEffect,useRef,useState } from "react";
type Media={id:string;character_id:string;kind:"reference"|"voice_sample";sha256?:string;metadata:{voice_id?:string;width?:number;height?:number}};
type View={media:Media[];can_configure:boolean;voice_enabled:boolean;voice_state:string;voice_retry_allowed?:boolean;voice_attempts?:number;profile:{style:string;references?:Array<{character_id:string;sha256:string}>;voices?:Array<{character_id:string;sample_sha256:string}>}|null;bible:{cast:Array<{id:string;name:string;voice:string}>}};
const defaultStyle="Animação 3D cinematográfica com personagens expressivos, olhos nítidos, iluminação natural e expressões legíveis. Preserve a aparência, as roupas e as proporções das imagens aprovadas em todas as cenas.";
export function StoryProductionSetup({seriesId,onSaved}:{seriesId:string;onSaved:()=>void}) {
  const [open,setOpen]=useState(false),[view,setView]=useState<View|null>(null),[style,setStyle]=useState(defaultStyle);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false);
  const [selected,setSelected]=useState<Record<string,string>>({});
  const uploads=useRef<Record<string,{file:File;id:string}>>({});
  const base="/api/stories/production";
  async function load(signal?:AbortSignal) {
    const response=await fetch(`${base}?series=${seriesId}`,{signal}),data=await response.json();
    if(!response.ok)throw Error(data.error || "Não foi possível consultar o padrão.");
    if(!signal?.aborted){setView(data);if(data.profile)setStyle(data.profile.style);}
  }
  useEffect(()=>{if(!open)return;const controller=new AbortController();void load(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[open,seriesId]);
  useEffect(()=>{if(!open || !["queued","working","failed"].includes(view?.voice_state || ""))return;const controller=new AbortController();const timer=setInterval(()=>void load(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message);}),8000);return()=>{clearInterval(timer);controller.abort();};},[open,seriesId,view?.voice_state]);
  useEffect(()=>{if(open && view?.voice_state==="ready" && !view.profile)setNotice("As prévias estão prontas. Ouça as vozes de cada personagem antes de fixar o padrão.");},[open,view?.voice_state]);
  async function post(payload:unknown){const response=await fetch(base,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw Error(result.error || "Configuração indisponível.");return result;}
  function choice(character:string,kind:Media["kind"]) {
    const options=view?.media.filter(m=>m.character_id===character && m.kind===kind) ?? [];
    if(view?.profile) {
      const hash=kind==="reference" ? view.profile.references?.find(r=>r.character_id===character)?.sha256 : view.profile.voices?.find(v=>v.character_id===character)?.sample_sha256;
      return options.find(m=>m.sha256===hash && hash);
    }
    return options.find(m=>m.id===selected[`${character}:${kind}`]) || options.at(-1);
  }
  async function upload(character:string,file:File) {
    setBusy(true);setError("");setNotice("");setConfirmed(false);
    if(uploads.current[character]?.file!==file)uploads.current[character]={file,id:crypto.randomUUID()};
    try {
      const response=await fetch(`${base}/media?series=${seriesId}&character=${encodeURIComponent(character)}&request=${uploads.current[character].id}`,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:file});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      setSelected(v=>({...v,[`${character}:reference`]:result.id}));delete uploads.current[character];await load();setNotice("Imagem cadastrada. Confira a prévia abaixo.");
    }catch(e){setError(e instanceof Error?e.message:"Falha ao enviar a imagem.");}
    finally{setBusy(false);}
  }
  const ready=!!view && view.bible.cast.every(c=>choice(c.id,"reference") && choice(c.id,"voice_sample"));
  return <details className="story-production-setup" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>Configurar imagens e vozes da novela</summary>
    {open && <div>
      <p>Configure antes do primeiro capítulo. As imagens ficam privadas. Fixar o padrão não gera vídeo nem libera uma fonte automaticamente.</p>
      {!view && !error && <p role="status">Consultando configuração…</p>}
      {view && <>
        {view.profile && <p role="status"><strong>Padrão fixado.</strong> O elenco será preservado nos próximos capítulos. Cada fonte precisa ser validada com esse padrão antes de animar.</p>}
        {!view.can_configure && !view.profile && <p>Esta novela já começou no formato ilustrado. Crie outra proposta para configurar um padrão animado.</p>}
        <h4>1. Confira a imagem de cada personagem</h4>
        <p className="muted">Use imagens verticais PNG, JPEG ou WebP, de até 12 MB, com pelo menos 480 pixels de largura. Uma imagem por personagem, mostrando rosto, roupa e mãos com clareza. O envio preserva a resolução e não tenta recuperar detalhes ausentes.</p>
        <div className="story-profile-cast">{view.bible.cast.map(c=>{
          const ref=choice(c.id,"reference"),voice=choice(c.id,"voice_sample"),refs=view.media.filter(m=>m.character_id===c.id && m.kind==="reference");
          return <section key={c.id}><h5>{c.name}</h5>
            {view.can_configure && <label>Imagem de {c.name}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const file=e.currentTarget.files?.[0];if(file)void upload(c.id,file);}}/></label>}
            {ref ? <img src={`${base}/media?id=${ref.id}`} alt={`Referência cadastrada de ${c.name}`} width={176} height={300}/> : <p className="muted">{view.profile?"Referência já fixada; a prévia deste cadastro não está disponível.":"Imagem ainda não cadastrada."}</p>}
            {refs.length>1 && view.can_configure && <label>Imagem que será usada<select value={ref?.id} onChange={e=>{setSelected(v=>({...v,[`${c.id}:reference`]:e.target.value}));setConfirmed(false);}}>{refs.map((r,i)=><option key={r.id} value={r.id}>Referência {i+1} · {r.metadata.width} × {r.metadata.height}</option>)}</select></label>}
            {voice ? <><p>{c.voice==="female"?"Voz feminina · Francisca":"Voz masculina · Antonio"}</p><audio controls preload="none" src={`${base}/media?id=${voice.id}`} aria-label={`Ouvir voz de ${c.name}`}/></> : <p className="muted">Prévia de voz ainda não preparada.</p>}
          </section>;
        })}</div>
        <h4>2. Ouça as vozes</h4>
        <p className="muted">A versão inicial usa uma voz feminina e uma masculina em português. Personagens com o mesmo tipo compartilham a voz. Não há clonagem de voz.</p>
        {view.can_configure && <button className="button secondary" disabled={busy || !view.voice_enabled || (view.voice_attempts ?? 0)>=3 || (view.voice_state!=="ready" && view.voice_retry_allowed===false)} onClick={async()=>{
          setBusy(true);setError("");setNotice("");setConfirmed(false);
          try{const result=await post({action:"voices",seriesId});const messages:Record<string,string>={dispatch:"Preparando vozes. As prévias aparecerão aqui automaticamente.",waiting:"Prévia em andamento. Aguarde antes de tentar novamente.",ready:"As vozes estão prontas para ouvir.",setup_required:"O administrador precisa ativar a prévia de voz.",retry_exhausted:"As tentativas automáticas terminaram. O administrador precisa verificar a conexão.",locked:"A novela já começou ou o padrão já está fixado."};setNotice(messages[result.code] || "Confira a configuração.");await load();}
          catch(e){setError(e instanceof Error?e.message:"Falha ao preparar vozes.");}finally{setBusy(false);}
        }}>{["queued","working"].includes(view.voice_state) && !view.voice_retry_allowed?"Preparando vozes…":["failed","queued","working"].includes(view.voice_state)?"Tentar preparar vozes novamente":"Preparar prévias de voz"}</button>}
        {view.can_configure && (view.voice_attempts ?? 0)>=3 && view.voice_state!=="ready" && <p role="status">As três tentativas terminaram. O administrador precisa verificar a integração; as amostras já prontas foram preservadas.</p>}
        {view.can_configure && !view.voice_enabled && <p className="muted">Prévia de voz aguardando ativação da integração. Nenhum crédito de vídeo será usado nesta etapa.</p>}
        <h4>3. Fixe o padrão para todos os capítulos</h4>
        <label>Estilo da novela<textarea rows={3} minLength={30} maxLength={3000} value={style} disabled={busy || !view.can_configure} onChange={e=>{setStyle(e.target.value);setConfirmed(false);}}/></label>
        {view.can_configure && <><label className="studio-check"><input type="checkbox" checked={confirmed} disabled={!ready || busy} onChange={e=>setConfirmed(e.target.checked)}/>Conferi as imagens e ouvi as vozes. Quero manter esse padrão nesta novela.</label>
          <button className="button primary" disabled={busy || !ready || !confirmed || style.trim().length<30} onClick={async()=>{
            setBusy(true);setError("");setNotice("");
            try{await post({action:"finalize",seriesId,style,confirmed,selection:view.bible.cast.map(c=>({character_id:c.id,reference_id:choice(c.id,"reference")!.id,voice_id:choice(c.id,"voice_sample")!.id}))});await load();setNotice("Padrão salvo. A geração animada depende de fonte validada e orçamento para o capítulo completo.");onSaved();}
            catch(e){setError(e instanceof Error?e.message:"Não foi possível fixar o padrão.");}finally{setBusy(false);}
          }}>Fixar padrão da novela</button>
          <p className="muted">Depois de fixado, esse padrão não pode ser trocado nesta novela. Uma aparência ou voz diferente exige outra proposta.</p></>}
      </>}
      {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    </div>}
  </details>;
}
