import { describe, expect, it } from "vitest";
import { hasRole, homePathFor, isRole, safeRedirectPath, toRole } from "./roles";

describe("roles", () => {
  it("ranks owner above staff above customer", () => {
    expect(hasRole("owner", "staff")).toBe(true);
    expect(hasRole("owner", "owner")).toBe(true);
    expect(hasRole("staff", "staff")).toBe(true);
    expect(hasRole("staff", "owner")).toBe(false);
    expect(hasRole("customer", "staff")).toBe(false);
    expect(hasRole("customer", "customer")).toBe(true);
  });

  it("never upgrades an unknown value", () => {
    expect(isRole("owner")).toBe(true);
    expect(isRole("admin")).toBe(false);
    expect(toRole("admin")).toBe("customer");
    expect(toRole(undefined)).toBe("customer");
    expect(toRole("OWNER")).toBe("customer");
  });

  it("sends staff to the dashboard and customers home", () => {
    expect(homePathFor("owner")).toBe("/admin");
    expect(homePathFor("staff")).toBe("/admin");
    expect(homePathFor("customer")).toBe("/");
  });
});

describe("safeRedirectPath", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirectPath("/admin", "/")).toBe("/admin");
    expect(safeRedirectPath("/booking/GC-7K2F?t=abc", "/")).toBe("/booking/GC-7K2F?t=abc");
  });

  it("refuses anything that could leave the site", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "admin",
      "",
      "/ok\nLocation: https://evil.example",
      null,
      undefined,
      42,
    ]) {
      expect(safeRedirectPath(bad, "/fallback")).toBe("/fallback");
    }
  });
});
