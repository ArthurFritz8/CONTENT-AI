import { test, expect } from "@playwright/test";
test("new Studio endpoints deny anonymous and cross-origin writes", async ({
  request,
}) => {
  for (const path of [
    "/api/review?episode=12345678-1234-4234-9234-123456789abc",
    "/api/connections",
    "/api/stories",
    "/api/stories/production",
    "/api/stories/production/media",
  ]) {
    const r = await request.get(path);
    expect(r.status()).toBe(401);
  }
  for (const path of [
    "/api/review",
    "/api/discovery",
    "/api/stories",
    "/api/stories/production",
    "/api/stories/production/media",
    "/api/help",
    "/api/connections",
    "/api/buffer/connect",
  ]) {
    const cross = await request.post(path, {
      headers: { Origin: "https://attacker.invalid" },
      data: {},
    });
    expect(cross.status()).toBe(403);
    const anon = await request.post(path, {
      headers: { Origin: "http://localhost:3100" },
      data: {},
    });
    expect(anon.status()).toBe(401);
  }
});
test("signup stays closed until the administrator enables it", async ({
  page,
}) => {
  await page.route("**/api/signup", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.goto("/join");
  await expect(
    page.getByRole("heading", { name: "Crie seu Studio" }),
  ).toBeVisible();
  await expect(
    page.getByText("Estamos preparando a abertura", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Criar conta", exact: true }),
  ).toHaveCount(0);
});
