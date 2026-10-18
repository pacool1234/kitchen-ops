import { FIELD_ERROR_CODES, LOCALES } from "@kitchen-ops/shared";
import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import { useT } from "./index";
import { en } from "./messages/en";
import { es, type Messages } from "./messages/es";

const messages = { es, en };

/** Every message as [key, text], keys dotted: ["signIn.title", "Iniciar sesión"]. */
function leaves(tree: object, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([name, value]) =>
    typeof value === "string"
      ? [[`${prefix}${name}`, value] as [string, string]]
      : leaves(value as object, `${prefix}${name}.`),
  );
}

/** The `{name}` placeholders a message uses, sorted. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

describe("the message files (#86)", () => {
  it("every key exists in both languages", () => {
    const keys = (tree: object) =>
      leaves(tree)
        .map(([key]) => key)
        .sort();
    expect(keys(en)).toEqual(keys(es));
  });

  it("every field error code from packages/shared has a message, in both languages (#89)", () => {
    for (const locale of LOCALES) {
      expect(
        Object.keys(messages[locale].errors.fields).sort(),
        locale,
      ).toEqual([...FIELD_ERROR_CODES].sort());
    }
  });

  it("no message is empty", () => {
    for (const locale of LOCALES) {
      for (const [key, text] of leaves(messages[locale])) {
        expect(text.trim(), `${locale} ${key}`).not.toBe("");
      }
    }
  });

  it("each message has the same placeholders in both languages", () => {
    const english = new Map(leaves(en));
    for (const [key, text] of leaves(es)) {
      expect(placeholders(english.get(key)!), key).toEqual(placeholders(text));
    }
  });

  it("every message compiles and renders in both languages, its placeholders filled in", () => {
    const errors: string[] = [];
    for (const locale of LOCALES) {
      const i18n = createI18n({
        legacy: false,
        locale,
        messages,
        missing: (_, key) => {
          errors.push(`${locale} ${key}: missing`);
          return key;
        },
      });
      for (const [key, text] of leaves(messages[locale])) {
        const values = Object.fromEntries(
          placeholders(text).map((name) => [name, `<${name}>`]),
        );
        // A stray `@` or `{` throws; a stray `|` quietly shows only the text before it.
        try {
          const rendered = i18n.global.t(key, values);
          const expected = text.replace(/\{(\w+)\}/g, "<$1>");
          if (rendered !== expected) {
            errors.push(`${locale} ${key}: ${JSON.stringify(rendered)}`);
          }
        } catch (error) {
          errors.push(`${locale} ${key}: ${(error as Error).message}`);
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it("is typed by the Spanish file: English can't miss a key or add one", () => {
    // Never called: checked by the typechecker (`pnpm typecheck`), which fails if an
    // expected error below stops being one.
    const typeChecks = () => {
      const missing: Messages = {
        ...en,
        // @ts-expect-error: products.loading and others are missing.
        products: { title: "Products" },
      };
      const extra: Messages = {
        ...en,
        app: {
          name: "kitchen-ops",
          // @ts-expect-error: a key the Spanish file doesn't have.
          notInSpanish: "Extra",
        },
      };
      return [missing, extra];
    };
    expect(typeChecks).toBeTypeOf("function");
  });

  it("is typed for the app: t() refuses a key that doesn't exist", () => {
    const typeChecks = () => {
      const t = useT();
      // @ts-expect-error: no such key.
      t("signIn.noSuchKey");
      // A real one is fine, and so is one built from a type with only real keys.
      t("signIn.title");
      t(`roles.${"office" as "counter" | "office" | "owner"}`);
    };
    expect(typeChecks).toBeTypeOf("function");
  });
});
