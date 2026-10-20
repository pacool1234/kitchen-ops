import { z } from "zod";

// What a model answers when asked which of our products each line is (#117, decision 0036).
// The products and lines are numbered in the request, and the model answers numbers. The
// descriptions end up in the JSON Schema given to models, so they are instructions too.

export const ProductSuggestions = z.object({
  suggestions: z
    .array(
      z.object({
        line: z.number().int().describe("The line's number, as given."),
        product: z
          .number()
          .int()
          .nullable()
          .describe(
            "The number of our product the line is, from the list given. null if none of them clearly is.",
          ),
      }),
    )
    .describe("One for each line given, in order."),
});
export type ProductSuggestions = z.infer<typeof ProductSuggestions>;

/** The JSON Schema for `ProductSuggestions`, for models that support structured output. */
export function productSuggestionsJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ProductSuggestions);
}
