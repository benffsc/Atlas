import { test } from "@playwright/test";

test("map page console errors", async ({ page }) => {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });

  page.on("pageerror", (err) => {
    errors.push(`PAGE_ERROR: ${err.message}\n${err.stack}`);
  });

  await page.goto("/map", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);

  await page.screenshot({ path: "/tmp/map-debug.png", fullPage: false });

  for (const err of errors) {
    console.log(`[ERROR] ${err}`);
  }

  console.log(`\nTotal errors: ${errors.length}`);
  if (errors.length > 0) {
    // Don't fail — just report
    console.log("\n=== FIRST ERROR DETAIL ===");
    console.log(errors[0]);
  }
});
