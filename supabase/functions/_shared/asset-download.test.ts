import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { validateAssetHost } from "./asset-download.ts";
Deno.test("downloads rejeitam hosts privados, protocolos e credenciais", () => {
  const allowed = ["images.pexels.com"];
  for (const url of ["http://images.pexels.com/a", "https://127.0.0.1/a", "https://localhost/a",
    "https://images.pexels.com.evil.test/a", "https://user:pass@images.pexels.com/a", "https://images.pexels.com:123/a"]) {
    assertThrows(() => validateAssetHost(url, allowed));
  }
  assertEquals(validateAssetHost("https://images.pexels.com/a", allowed).hostname, allowed[0]);
});
