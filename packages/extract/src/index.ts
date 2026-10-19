// What the API uses of extraction. More of it is exported as the API needs it (#103).

/** A file's kind, from its first bytes (spec section 5, stage 2): uploads are checked with it. */
export { detectFormat, type InputFormat } from "./route/detect";
