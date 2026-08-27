import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { AppError, isTransientHttpStatus, retryWithBackoff } from "./error-handler.ts";

Deno.test("retryWithBackoff: sucesso após falhas transitórias", async () => {
  let calls = 0;
  const result = await retryWithBackoff(
    () => {
      calls++;
      if (calls < 3) return Promise.reject(new Error("transitório"));
      return Promise.resolve("ok");
    },
    { retries: 3, baseDelayMs: 1, maxDelayMs: 2 },
  );
  assertEquals(result, "ok");
  assertEquals(calls, 3);
});

Deno.test("retryWithBackoff: não repete quando shouldRetry retorna false", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      retryWithBackoff(
        () => {
          calls++;
          return Promise.reject(new AppError("não encontrado", 404, "NOT_FOUND"));
        },
        {
          retries: 3,
          baseDelayMs: 1,
          shouldRetry: (err) => !(err instanceof AppError) || err.status >= 500,
        },
      ),
    AppError,
  );
  assertEquals(calls, 1);
});

Deno.test("retryWithBackoff: esgota tentativas e propaga último erro", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      retryWithBackoff(
        () => {
          calls++;
          return Promise.reject(new Error("sempre falha"));
        },
        { retries: 2, baseDelayMs: 1, maxDelayMs: 2 },
      ),
    Error,
    "sempre falha",
  );
  assertEquals(calls, 3);
});

Deno.test("isTransientHttpStatus: 429/5xx transitórios, 4xx não", () => {
  assertEquals(isTransientHttpStatus(429), true);
  assertEquals(isTransientHttpStatus(500), true);
  assertEquals(isTransientHttpStatus(503), true);
  assertEquals(isTransientHttpStatus(400), false);
  assertEquals(isTransientHttpStatus(404), false);
});
