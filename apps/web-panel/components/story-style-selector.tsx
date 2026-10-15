"use client";
import {useEffect,useState} from "react";
import {storyStyles,storySources,presentationNeedsAdapter,supportsNativePattern,type StoryPresentation,type StoryStyleId,type StoryStyleSample} from "../../../packages/core/src/stories/styles";
type Sample=Omit<StoryStyleSample,"sha256"|"bytes"> & {created_at:string};
export function StoryStyleSelector({value,onChange,disabled=false}:{value:StoryPresentation;onChange:(value:StoryPresentation)=>void;disabled?:boolean}) {
  const [samples,setSamples]=useState<Sample[]>([]),[status,setStatus]=useState("loading"),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const c=new AbortController();setStatus("loading");
    void fetch("/api/stories/styles",{signal:c.signal}).then(async r=>{if(!r.ok)throw Error();return r.json();})
      .then(data=>{if(!c.signal.aborted){setSamples(data.samples);setStatus("ready");}}).catch(()=>{if(!c.signal.aborted)setStatus("error");});
    return()=>c.abort();
  },[retry]);
  function primary(id:StoryStyleId) {
    onChange({...value,primary_style:id,allowed_styles:value.continuity_mode==="fixed" ? [id] : [...new Set([...value.allowed_styles,id])]});
  }
  return <fieldset className="story-styles" disabled={disabled}>
    <legend>Escolha como sua novela vai parecer</legend>
    <p>Assistir aos exemplos salvos não usa créditos de geração. Escolher um estilo planeja a novela; não ativa uma fonte nem gera uma prévia nova.</p>
    <div className="story-style-grid">{storyStyles.map(style=>{
      const examples=samples.filter(s=>s.style_id===style.id);
      return <article key={style.id} className={`story-style-card ${value.primary_style===style.id ? "selected" : ""}`}>
        <h4>{style.label}</h4><p>{style.description}</p>
        <small>{style.id==="illustrated" ? "Formato ilustrado existente" : examples.length ? "Exemplo disponível · confira a fonte" : "Em preparação · sem amostra validada"}</small>
        <button type="button" className="button secondary" aria-pressed={value.primary_style===style.id} onClick={()=>primary(style.id)}>{value.primary_style===style.id ? "Estilo principal escolhido" : "Planejar neste estilo"}</button>
        {examples.map(s=><details key={s.id}><summary>Assistir · {storySources[s.source]} · {s.seconds.toLocaleString("pt-BR",{maximumFractionDigits:1})}s</summary>
          <video controls playsInline preload="none" width={240} aria-label={s.title} src={`/api/stories/styles/media?id=${s.id}`}/>
          <p><strong>{s.title}</strong></p><p className="muted">{s.model} · {s.width} × {s.height} · entrega {s.output_fps} FPS{s.native_fps ? ` · animação nativa ${s.native_fps} FPS` : " · fluidez nativa não aferida"}.</p>
          <p className="muted">{s.motion==="interpolated" ? "Há interpolação de quadros na entrega." : s.motion==="mixed" ? "Combina animação com planos sobre imagens; FPS de entrega não mede atuação." : s.motion==="illustrated" ? "Imagens com montagem e câmera digital." : "Vídeo gerado, sem interpolação nesta amostra."} {s.review_scope==="reviewed_sample" ? "Aprovação limitada a esta amostra." : "Verificação técnica; revisão artística pendente."}</p>
          <ul>{s.limitations.map((text,i)=><li key={i}>{text}</li>)}</ul>
          <button type="button" className="button secondary" onClick={()=>onChange({...value,primary_style:s.style_id,allowed_styles:value.continuity_mode==="fixed" ? [s.style_id] : [...new Set([...value.allowed_styles,s.style_id])],source:s.source,...(s.source==="auray"?{voice_policy:"approved_variants" as const}:{})})}>{s.source==="auray"?"Planejar com este exemplo e vozes nativas":"Planejar com este estilo e fonte"}</button>
        </details>)}
      </article>;
    })}</div>
    {status==="loading" && <p role="status">Consultando exemplos privados…</p>}
    {status==="error" && <p role="status">Não foi possível consultar a galeria. As preferências continuam disponíveis. <button type="button" className="button" onClick={()=>setRetry(v=>v+1)}>Consultar exemplos novamente</button></p>}
    <div className="studio-form-grid">
      <label>Continuidade visual<select value={value.continuity_mode} onChange={e=>onChange({...value,continuity_mode:e.target.value as StoryPresentation["continuity_mode"],allowed_styles:[value.primary_style]})}>
        <option value="fixed">Manter o mesmo estilo</option><option value="per_chapter">Permitir estilos diferentes entre capítulos</option>
      </select></label>
      <label>Fonte de geração<select value={value.source} onChange={e=>onChange({...value,source:e.target.value as StoryPresentation["source"]})}>
        {Object.entries(storySources).map(([id,label])=><option key={id} value={id}>{label}</option>)}
      </select></label>
    </div>
    {value.continuity_mode==="per_chapter" && <div><p>Estilos que você aceita nos próximos capítulos:</p>{storyStyles.map(style=><label className="studio-check" key={style.id}><input type="checkbox" checked={value.allowed_styles.includes(style.id)} disabled={disabled || style.id===value.primary_style} onChange={e=>onChange({...value,allowed_styles:e.target.checked ? [...value.allowed_styles,style.id] : value.allowed_styles.filter(id=>id!==style.id)})}/>{style.label}{style.id===value.primary_style ? " (principal)" : ""}</label>)}</div>}
    <label>Vozes<select value={value.voice_policy} onChange={e=>onChange({...value,voice_policy:e.target.value as StoryPresentation["voice_policy"]})}>
      <option value="preserve">Preservar as vozes aprovadas</option><option value="approved_variants">Permitir versões de voz após ouvir e aprovar</option>
    </select></label>
    <p className="muted">No automático, a fonte só pode mudar se for compatível com a novela. Uma fonte fixada aguarda saldo e integração; não é substituída escondida. Permitir versões de voz não aprova automaticamente uma voz nova.</p>
    {supportsNativePattern(value,value.primary_style) ? <p role="status">Depois de criar a proposta, confira as imagens e o exemplo de voz na configuração Auray. Cada capítulo de cerca de 15 segundos exige 15 créditos gratuitos e revisão. Nenhuma geração começa ao escolher este estilo.</p> : presentationNeedsAdapter(value) && <p role="status">Você pode criar a proposta neste estilo. A geração de capítulos ainda depende de integração e validação deste padrão; o sistema não substituirá sua escolha pelo ilustrado clássico.</p>}
  </fieldset>;
}
