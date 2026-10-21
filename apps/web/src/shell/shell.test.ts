import { ROLES, type Role } from "@kitchen-ops/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { breadcrumbTrail, initials } from "./layout";
import { NAV, visibleNav, type NavItem } from "./nav";

describe("visibleNav: the navigation shows only what the user's role can do (spec section 6)", () => {
  it("today, every role sees Inicio, the documents (#106: everyone receives deliveries), the stock (#150: everyone counts it) and the catalogue (#89)", () => {
    for (const role of ROLES) {
      expect(visibleNav(NAV, role).map((item) => item.name)).toEqual([
        "home",
        "documents",
        "stock",
        "catalogue",
      ]);
    }
  });

  it("an item for office and owner only, like the reports to come, is hidden from a counter", () => {
    const items = [
      ...NAV,
      { ...NAV[1]!, name: "reports", roles: ["office", "owner"] },
    ] satisfies NavItem[];
    expect(visibleNav(items, "counter").map((i) => i.name)).not.toContain(
      "reports",
    );
    expect(visibleNav(items, "office").map((i) => i.name)).toContain("reports");
  });

  it("any items and role: an item is shown exactly when its roles include the user's, in order", () => {
    const role = fc.constantFrom<Role>(...ROLES);
    const item = fc.record({
      name: fc.string(),
      roles: fc.subarray([...ROLES]),
    });
    fc.assert(
      fc.property(fc.array(item), role, (items, user) => {
        const navItems = items.map((i) => ({ ...NAV[0]!, ...i }));
        expect(visibleNav(navItems, user)).toEqual(
          navItems.filter((i) => i.roles.includes(user)),
        );
      }),
    );
  });
});

describe("breadcrumbTrail: where a page sits, from the top", () => {
  const pages: Record<string, { title: string; parent?: string }> = {
    home: { title: "home.title" },
    catalogue: { title: "catalogue.title", parent: "home" },
    product: { title: "product.title", parent: "catalogue" },
  };
  const lookup = (name: string) => pages[name];

  it("follows each page's parent up to the top, then lists them top first", () => {
    expect(breadcrumbTrail("product", lookup)).toEqual([
      { name: "home", title: "home.title" },
      { name: "catalogue", title: "catalogue.title" },
      { name: "product", title: "product.title" },
    ]);
  });

  it("a page without a parent is a trail of one", () => {
    expect(breadcrumbTrail("home", lookup)).toEqual([
      { name: "home", title: "home.title" },
    ]);
  });

  it("refuses a parent that doesn't exist, or a loop, instead of hanging", () => {
    expect(() =>
      breadcrumbTrail("x", (n) =>
        n === "x" ? { title: "x", parent: "missing" } : undefined,
      ),
    ).toThrow(/missing/);
    expect(() =>
      breadcrumbTrail("a", (n) => ({
        title: n,
        parent: n === "a" ? "b" : "a",
      })),
    ).toThrow(/loop/);
  });
});

describe("initials: what the user menu's round avatar shows", () => {
  it("the first letters of the first and last names", () => {
    expect(initials("Local counter")).toBe("LC");
    expect(initials("María José García")).toBe("MG");
    expect(initials("  ana  ")).toBe("A");
  });

  it("keeps accents and letters outside ASCII whole", () => {
    expect(initials("Íñigo Ñúñez")).toBe("ÍÑ");
  });

  it("an empty name still shows something", () => {
    expect(initials("")).toBe("?");
  });
});
