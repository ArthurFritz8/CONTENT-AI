import { test } from "node:test";
import { strictEqual, throws, ok } from "node:assert";
import { storyFixture } from "../testing/story-fixture.ts";
import { buildStoryScript } from "./script.ts";
import { computeScriptHash } from "../validators/hash-utils.ts";
import type { StoryDirection } from "./direction.ts";

function directed() {
  const { draft, context } = storyFixture();
  draft.scenes.forEach((s, i) => {
    s.visual.direction = { framing: (["wide", "medium", "close", "medium", "close"] as const)[i]!,
      action: `A personagem dá o passo ${i + 1} em direção à porta.`, start_pose: "Ao lado da janela com os braços abaixados",
      end_pose: "Perto da porta com o corpo virado para a amiga", emotion_change: "Curiosidade dá lugar à surpresa",
      listener_id: "rui", listener_reaction: "Rui recua e olha para a chave",
      continuity: "Mesma roupa, luz pela esquerda, chave na mão direita" } satisfies StoryDirection;
  });
  return { draft, context };
}
const id = "11111111-1111-4111-8111-111111111111";
test("old stories remain readable; new generation requires actionable direction", () => {
  const { draft, context } = storyFixture();
  ok(buildStoryScript(draft, context, id));
  throws(() => buildStoryScript(draft, context, id, true), /direção/);
  const next = directed();
  strictEqual(buildStoryScript(next.draft, next.context, id, true).prompt_version, "1.1.0");
});
test("rejects listener not present, static poses and direct speech hidden by object", () => {
  for (const patch of [{ listener_id: "foreign" }, { end_pose: "Ao lado da janela com os braços abaixados" }, { framing: "detail" as const }]) {
    const { draft, context } = directed(); draft.scenes[0]!.visual.speaker_id = "lia";
    Object.assign(draft.scenes[0]!.visual.direction!, patch);
    throws(() => buildStoryScript(draft, context, id, true));
  }
});
test("rejects repeated framing and direction changes invalidate editorial approval hash", async () => {
  const { draft, context } = directed(); const script = buildStoryScript(draft, context, id, true);
  const before = await computeScriptHash(script);
  script.scenes[0]!.story_visual!.direction!.action = "A personagem fecha a janela e esconde a chave.";
  ok(before !== await computeScriptHash(script));
  draft.scenes.forEach(s => { s.visual.direction!.framing = "close"; });
  throws(() => buildStoryScript(draft, context, id, true), /enquadramentos/);
});
