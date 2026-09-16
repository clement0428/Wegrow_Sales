/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");
const path = require("path");

const baseURL = process.env.QA_URL || "http://localhost:3220/outputs/line-farm-booking-qa/";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  if (!await page.getByRole("heading", { name: "來麻豆，走進科技農場" }).isVisible()) throw new Error("hero missing");
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error("horizontal overflow");
  await page.getByRole("button", { name: "＋" }).first().click();
  await page.getByRole("button", { name: "10/10（六）" }).click();
  await page.getByRole("button", { name: /14:00/ }).click();
  await page.getByPlaceholder("聯絡姓名").fill("HTTPS 驗收");
  await page.getByPlaceholder("手機 0912345678").fill("0912345678");
  await page.getByRole("button", { name: "信用卡" }).click();
  await page.getByRole("button", { name: "檢查並前往付款" }).click();
  if (!await page.getByText("信用卡 尚未啟用正式收款").isVisible()) throw new Error("payment boundary missing");
  await page.screenshot({ path: path.join(__dirname, "..", "qa", "https-review-mobile.png"), fullPage: true });
  await browser.close();
  console.log("HTTPS review station mobile flow PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
