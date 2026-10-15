import {animatedFixtureInput} from "./animated-fixture.ts";
import {nativeProfileSchema,NATIVE_AURAY} from "../stories/native-contract.ts";

export function nativeFixtureInput() {
  const a=animatedFixtureInput();
  return {...a,profile:nativeProfileSchema.parse({version:NATIVE_AURAY.version,model:NATIVE_AURAY.model,
    contract_sha256:"d".repeat(64),orientation:"portrait",output_fps:24,width:768,height:1344,style:a.profile.style,
    references:a.profile.references,voice_directions:a.context.bible.cast.map(c=>({character_id:c.id,
      description:`Adult Brazilian ${c.voice} voice, natural and expressive, consistent throughout the scene.`})),
    example:{id:"88888888-8888-4888-8888-888888888888",sha256:"e".repeat(64)},
    voice_policy:"provider_generated_review",native_voice_acknowledged:true}),
    draft:{...a.draft,scenes:a.draft.scenes.slice(0,3)}};
}
