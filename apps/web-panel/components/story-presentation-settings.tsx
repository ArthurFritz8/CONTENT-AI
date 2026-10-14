"use client";
import {useEffect,useRef,useState} from "react";
import {StoryStyleSelector} from "./story-style-selector";
import {defaultStoryPresentation,storyStyles,storySources,type StoryPresentation} from "../../../packages/core/src/stories/styles";
export type PresentationVersion={revision:number;effective_from:number;preferences:StoryPresentation};
export function StoryPresentationSettings({seriesId,current,history,chapterActive,onSaved}:{seriesId:string;current:PresentationVersion|null;history:PresentationVersion[];chapterActive:boolean;onSaved:()=>void}) {
  const [open,setOpen]=useState(false),[value,setValue]=useState(current?.preferences ?? defaultStoryPresentation()),[confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const request=useRef<{key:string;id:string}|null>(null);
  useEffect(()=>{setValue(current?.preferences ?? defaultStoryPresentation());setConfirmed(false);},[current?.revision,seriesId]);
  async function save() {
    setBusy(true);setError("");setNotice("");
    const key=JSON.stringify([seriesId,current?.revision ?? 0,value]);
    if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
    try {
      const response=await fetch("/api/stories",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"presentation",seriesId,expectedRevision:current?.revision ?? 0,requestId:request.current.id,preferences:value,confirmed})});
      const result=await response.json();if(!response.ok)throw Error(result.error || "Não foi possível salvar o estilo.");
      const messages:Record<string,string>={style_changed:"A escolha foi atualizada em outra aba. Recarregue as preferências antes de salvar.",chapter_active:"Conclua e aprove o capítulo atual antes de mudar o padrão dos próximos.",completed:"A novela já terminou. Crie outra proposta para usar os novos estilos.",version_limit:"O limite de revisões desta novela foi atingido."};
      if(result.code!=="saved")throw Error(messages[result.code] || "A mudança ainda não está disponível.");
      request.current=null;setConfirmed(false);setNotice(`Escolha salva como versão ${result.revision}, a partir do capítulo ${result.effective_from}. Capítulos anteriores preservados; assistir a uma amostra não libera a geração automaticamente.`);onSaved();
    }catch(e){setError(e instanceof Error ? e.message : "Estilo indisponível.");onSaved();}finally{setBusy(false);}
  }
  return <details className="story-presentation-settings" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>Estilo e fontes da novela · {current ? `versão ${current.revision}` : "padrão anterior preservado"}</summary>
    {open && <div>
      <p>A mudança vale para os próximos capítulos. História, acontecimentos e vídeos anteriores permanecem preservados.</p>
      {chapterActive && <p role="status">Conclua e aprove o capítulo atual para salvar outra escolha de estilo ou fonte.</p>}
      <StoryStyleSelector value={value} disabled={busy || chapterActive} onChange={v=>{setValue(v);setConfirmed(false);setNotice("");}}/>
      <label className="studio-check"><input type="checkbox" checked={confirmed} disabled={busy || chapterActive} onChange={e=>setConfirmed(e.target.checked)}/>Conferi os estilos, as fontes e a política de vozes para os próximos capítulos.</label>
      <button type="button" className="button secondary" disabled={busy || chapterActive || !confirmed} onClick={()=>void save()}>{busy ? "Salvando escolha…" : "Salvar escolha para os próximos capítulos"}</button>
      {!!history.length && <details><summary>Histórico de escolhas ({history.length})</summary><ul>{history.map(v=><li key={v.revision}>Versão {v.revision} · a partir do capítulo {v.effective_from} · {storyStyles.find(s=>s.id===v.preferences.primary_style)?.label} · {storySources[v.preferences.source]}</li>)}</ul></details>}
      {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    </div>}
  </details>;
}
