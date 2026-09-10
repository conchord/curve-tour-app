import { describe, expect, it } from "vitest";
import { Role, TOUR_ADMIN_ROLE_IDS, canAdminTour } from "./auth.shared";

describe("Tour Hub admin roles", () => {
  it("allows the configured CFP roles", () => {
    expect(TOUR_ADMIN_ROLE_IDS).toEqual([
      Role.ADMIN,
      Role.MOD,
      Role.LEAD_MOD,
      Role.DEVELOPER,
      Role.TOUR_HOST,
      Role.LEAD_TOUR_HOST,
    ]);
    for (const role of TOUR_ADMIN_ROLE_IDS) expect(canAdminTour([role])).toBe(true);
  });

  it("rejects CFP roles outside the admin allowlist", () => {
    expect(canAdminTour([Role.TRANSLATOR])).toBe(false);
    expect(canAdminTour([Role.ARTIST, Role.CONTENT_CREATOR])).toBe(false);
    expect(canAdminTour([])).toBe(false);
  });
});
