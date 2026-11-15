import { expect, test } from "@playwright/test";

/** Milestone 8: the scheduled tick is reachable only with its secret. */

test("the cron tick needs its secret and reports what it did", async ({ request }) => {
  expect((await request.get("/api/cron/tick")).status()).toBe(401);
  expect((await request.get("/api/cron/tick", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);

  const res = await request.get("/api/cron/tick", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ expired: 0, errors: [] });
});
