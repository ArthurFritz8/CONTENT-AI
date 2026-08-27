import { z } from "npm:zod@3.23.8";
import { AppError } from "./error-handler.ts";

export const triggerRenderInputSchema = z.object({
  episode_id: z.string().uuid(),
  force: z.boolean().optional().default(false),
});

export type TriggerRenderInput = z.infer<typeof triggerRenderInputSchema>;

/** Valida body JSON contra schema Zod; erros viram AppError 400 (Regra D). */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError("Body JSON inválido", 400, "INVALID_JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      `Input inválido: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      400,
      "VALIDATION_ERROR",
    );
  }
  return parsed.data;
}
