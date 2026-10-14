import { z } from "zod";

/** Response of `GET /health`: the API is up, and which build is running. */
export const HealthResponse = z.object({
  status: z.literal("ok"),
  version: z.string().min(1),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
