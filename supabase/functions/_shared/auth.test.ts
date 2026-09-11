import { assertThrows } from "jsr:@std/assert@1";
import { requireServiceRole } from "./auth.ts";

Deno.test("workers rejeitam anon, usuário e ausência de credencial", () => {
  for (const token of ["", "Bearer anon", "Bearer user"]) {
    assertThrows(() => requireServiceRole(new Request("https://example.test", {
      headers: { authorization: token },
    }), "service-test"));
  }
  requireServiceRole(new Request("https://example.test", {
    headers: { authorization: "Bearer service-test" },
  }), "service-test");
});
