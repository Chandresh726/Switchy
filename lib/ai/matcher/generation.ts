import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";

export interface GenerationOptions<T extends z.ZodTypeAny> {
  model: LanguageModel;
  schema: T;
  system: string;
  prompt: string;
  providerOptions?: Record<string, unknown>;
}

export interface GenerationResult<T> {
  data: T;
}

interface ZodArrayDef {
  typeName: "ZodArray";
  type: z.ZodTypeAny;
}

interface ZodDefWithType {
  typeName: string;
  type?: z.ZodTypeAny;
}

function isArraySchema(schema: z.ZodTypeAny): boolean {
  const def = schema._def as unknown as ZodDefWithType;
  return def.typeName === "ZodArray";
}

function getArrayElementSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = schema._def as unknown as ZodArrayDef;
  return def.type;
}

export async function generateStructured<T extends z.ZodTypeAny>(
  options: GenerationOptions<T>
): Promise<GenerationResult<z.infer<T>>> {
  const { model, schema, system, prompt, providerOptions } = options;

  const isArray = isArraySchema(schema);

  const result = await generateText({
    model,
    output: isArray
      ? Output.array({ element: getArrayElementSchema(schema) })
      : Output.object({ schema }),
    system,
    prompt,
    ...providerOptions,
  });

  if (result.output === undefined || result.output === null) {
    throw new Error("Model did not produce structured output");
  }

  return {
    data: result.output as z.infer<T>,
  };
}
