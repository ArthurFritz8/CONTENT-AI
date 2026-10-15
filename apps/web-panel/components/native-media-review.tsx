import {nativeMediaReviewSchema} from "../../../packages/core/src/stories/native-review";
export function NativeMediaReview({report,cast=[]}:{report:unknown;cast?:Array<{id:string;name:string}>}) {
 const parsed=nativeMediaReviewSchema.safeParse(report);
 if(!parsed.success)return <section className="info-note"><p>Este vídeo ainda não tem análise automática de falas e cores. Confira o áudio, o figurino e os movimentos antes de aprovar.</p></section>;
 return <section className="panel native-media-review" aria-label="Conferência do vídeo"><h3>Conferência do vídeo</h3>
  <p className="muted">Os avisos ajudam na revisão. A transcrição pode errar; luz, câmera e pose podem alterar as cores detectadas. Esta análise não comprova identidade, qualidade das mãos ou sincronia da boca.</p>
  {parsed.data.takes.map(t=><article key={t.index} className="review-record">
   <strong>Cena {t.index+1} · {cast.find(c=>c.id===t.speaker)?.name??t.speaker}</strong>
   <p>{t.speech_status==="unavailable"?"Áudio ainda precisa ser conferido: análise indisponível.":t.speech_status==="possible_extra_speech"?"Possíveis palavras extras no áudio. Ouça esta cena.":t.speech_status==="possible_missing_speech"?"A fala reconhecida pode estar diferente do roteiro. Ouça esta cena.":"A transcrição não apontou diferença; confira a fala e a boca ao assistir."}</p>
   <p>{t.appearance_status==="possible_color_shift"?"Possível mudança de cor durante a cena. Confira roupa, estampa e iluminação.":t.appearance_status==="unavailable"?"A aparência ainda precisa ser conferida: análise indisponível.":"A análise de cores não apontou mudança; confira figurino e aparência ao assistir."}</p>
   <details><summary>Comparar falas</summary><p>Roteiro: {t.expected_text}</p><p>Transcrição automática: {t.recognized_text||"Indisponível"}</p></details>
  </article>)}
 </section>;
}
