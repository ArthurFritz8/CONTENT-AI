import {PanelError} from "./security.mjs";
import {storyStyleIds,type StoryStyleId} from "../../../packages/core/src/stories/styles";
export function patternIdentity(revision:unknown,style:unknown):{revision:number;style:StoryStyleId}|null {
  if(revision===undefined && style===undefined)return null;
  if(!Number.isSafeInteger(revision) || Number(revision)<1 || Number(revision)>100 || !storyStyleIds.includes(style as StoryStyleId))throw new PanelError("Escolha uma versão e um estilo válidos.",400);
  return {revision:Number(revision),style:style as StoryStyleId};
}
export function patternQuery(url:URL) {
  const revision=url.searchParams.get("revision"),style=url.searchParams.get("style");
  return patternIdentity(revision===null?undefined:Number(revision),style===null?undefined:style);
}
