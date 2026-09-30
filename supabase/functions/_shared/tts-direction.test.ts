import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { geminiSpeechPrompt, voiceDirectionForStyle } from "./tts.ts";

Deno.test("direção da voz é estável por estilo e mantém a narração literal", () => {
  const calm = voiceDirectionForStyle("explicativo_pausado");
  assertEquals(calm.edgeRate, "-4%");
  const quick = voiceDirectionForStyle("hook_choque_ritmo_rapido");
  assertEquals(quick.edgeRate, "+3%");
  const text = "O produto tem uma limitação importante.";
  const prompt = geminiSpeechPrompt(text, calm.delivery);
  assertStringIncludes(prompt, "português brasileiro");
  assertEquals(prompt.endsWith(text), true);
});
