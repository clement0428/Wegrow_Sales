/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const baseURL = process.env.BASE_URL || "http://localhost:3216";
const qaDir = path.join(__dirname, "..", "qa");
fs.mkdirSync(qaDir, { recursive: true });

function check(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mobile.goto(baseURL, { waitUntil: "networkidle" });
  check(await mobile.getByRole("heading", { name: /來麻豆/ }).isVisible(), "mobile hero missing");
  check((await mobile.getByText("管理後台").count()) === 0, "customer page must not expose admin navigation");
  check(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "mobile horizontal overflow");
  check(await mobile.getByText("核准前預覽").isVisible(), "preview boundary missing");
  check(await mobile.getByText("農場門票與導覽").isVisible(), "ticket pricing missing");
  await mobile.getByRole("button", { name: "盆栽手作增加" }).click();
  await mobile.getByRole("button", { name: "現場餐飲增加" }).click();
  check(await mobile.locator(".pricing-total").getByText("NT$ 600", { exact: true }).isVisible(), "ticket credit total is incorrect");
  await mobile.getByRole("button", { name: /我的預約/ }).click();
  check(await mobile.getByRole("heading", { name: "我的預約" }).isVisible(), "my bookings view missing");
  await mobile.getByRole("button", { name: /交通須知/ }).click();
  check(await mobile.getByRole("heading", { name: "交通與注意事項" }).isVisible(), "visit information view missing");
  await mobile.getByRole("button", { name: /聯絡農場/ }).click();
  check(await mobile.getByRole("heading", { name: "聯繫農場" }).isVisible(), "farm contact view missing");
  await mobile.getByRole("button", { name: /預約參訪/ }).click();
  await mobile.screenshot({ path: path.join(qaDir, "farm-mobile-home.png"), fullPage: true });
  await mobile.getByRole("button", { name: /查看農場開放日期/ }).click();
  check(await mobile.getByText(/只顯示農場已建立/).isVisible(), "farm-owned date explanation missing");
  check(await mobile.getByText("可新增 1 團，這團最多 50 人").first().isVisible(), "capacity message missing");
  await mobile.locator(".slot").first().click();
  await mobile.getByRole("button", { name: /填寫聯絡資料/ }).click();
  await mobile.getByLabel("聯絡人姓名").fill("E2E 測試");
  await mobile.getByLabel("手機號碼").fill("0912345678");
  await mobile.getByRole("button", { name: /信用卡/ }).click();
  await mobile.getByRole("checkbox").check();
  await mobile.getByRole("button", { name: /檢查預約內容/ }).click();
  await mobile.getByRole("button", { name: /前往付款/ }).click();
  check(await mobile.getByText("尚未啟用正式收款").isVisible(), "unconfigured payment boundary missing");
  await mobile.screenshot({ path: path.join(qaDir, "farm-mobile-payment-blocked.png"), fullPage: true });
  results.push("mobile booking flow PASS");

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await desktop.goto(baseURL, { waitUntil: "networkidle" });
  check(await desktop.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "desktop horizontal overflow");
  await desktop.screenshot({ path: path.join(qaDir, "farm-desktop-home.png"), fullPage: true });
  await desktop.goto(`${baseURL}/admin`, { waitUntil: "networkidle" });
  if (await desktop.getByRole("heading", { name: "接待行事曆" }).isVisible().catch(() => false)) {
    check(await desktop.getByText("1 團／20 人").isVisible(), "admin group count missing");
    await desktop.screenshot({ path: path.join(qaDir, "farm-desktop-admin.png"), fullPage: true });
    results.push("desktop and admin layout PASS");
  } else {
    check(desktop.url().includes("/login"), "protected admin must show the calendar or redirect to login");
    results.push("desktop layout and production admin access boundary PASS");
  }

  for (const width of [360, 430, 650, 768, 1024]) {
    const responsive = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    await responsive.goto(baseURL, { waitUntil: "networkidle" });
    check(await responsive.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px horizontal overflow`);
    check(await responsive.getByRole("button", { name: /查看農場開放日期/ }).isVisible(), `${width}px primary action missing`);
    await responsive.screenshot({ path: path.join(qaDir, `farm-${width}px-home.png`), fullPage: true });
    await responsive.close();
  }
  results.push("360px through 1024px responsive layout PASS");

  for (const route of ["/booking", "/my-bookings", "/visit-info", "/contact"]) {
    const routeResponse = await desktop.request.get(`${baseURL}${route}`);
    check(routeResponse.ok(), `${route} route failed`);
  }
  results.push("stable LINE entry routes PASS");

  const availability = await desktop.request.get(`${baseURL}/api/farm/availability?people=11`);
  check(availability.ok(), "availability API failed");
  const availabilityJson = await availability.json();
  check(availabilityJson.slots[0].available === true, "empty slot should accept 11");
  check(availabilityJson.slots[1].available === false, "20-person group slot should reject 11 as second group");
  check(availabilityJson.slots[2].available === false, "two-group slot should reject 11 as third group");
  results.push("availability API PASS");

  const checkout = await desktop.request.post(`${baseURL}/api/farm/checkout`, { data: { bookingId: "B-1", attemptId: "A-1", amount: 1000, method: "line_pay", contact: { contactName: "E2E", phone: "0912345678", groupName: "", note: "" } } });
  check(checkout.status() === 503, "unconfigured payment must be blocked");
  const checkoutJson = await checkout.json();
  check(checkoutJson.charged === false, "blocked checkout must say charged=false");
  results.push("payment safety boundary PASS");

  const ics = await desktop.request.get(`${baseURL}/api/bookings/WG-DEMO/calendar.ics`);
  check(ics.ok(), "ICS endpoint failed");
  const icsText = await ics.text();
  check(icsText.includes("TZID=Asia/Taipei") && icsText.includes("UID:WG-DEMO@wegrow-farm"), "ICS timezone or UID missing");
  results.push("ICS PASS");

  await browser.close();
  fs.writeFileSync(path.join(qaDir, "e2e-result.json"), JSON.stringify({ baseURL, results, completedAt: new Date().toISOString() }, null, 2));
  process.stdout.write(results.join("\n"));
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
