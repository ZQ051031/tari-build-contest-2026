import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const types = new Map([
  ["/", ["index.html", "text/html"]],
  ["/style.css", ["style.css", "text/css"]],
  ["/app.mjs", ["app.mjs", "text/javascript"]],
  ["/escrow.mjs", ["escrow.mjs", "text/javascript"]],
]);
const server = createServer(async (req, res) => {
  const file = types.get(req.url);
  if (!file) return res.writeHead(404).end();
  const [name, type] = file;
  res.writeHead(200, { "Content-Type": type }).end(await readFile(new URL(`../docs/${name}`, import.meta.url)));
});
const profile = await mkdtemp(join(tmpdir(), "escrow-chrome-"));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const browser = spawn(process.env.CHROME_BIN ?? "google-chrome", [
  "--headless=new", "--remote-debugging-port=0", "--no-first-run", "--disable-background-networking",
  "--window-size=1360,1080", `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });
let socket;
let browserError;
browser.on("error", (error) => { browserError = error; });
try {
  let port;
  for (let tries = 0; tries < 100 && !port; tries += 1) {
    if (browserError) throw browserError;
    port = (await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "")).split("\n")[0];
    if (!port) await delay(100);
  }
  assert.ok(port, "Chrome DevTools did not start");
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(({ type }) => type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const pending = new Map();
  const pageErrors = [];
  let requestId = 0;
  socket.addEventListener("message", ({ data }) => {
    const { id, result, error, method, params } = JSON.parse(data);
    if (method === "Runtime.exceptionThrown") pageErrors.push(params.exceptionDetails);
    if (!id) return;
    const resolve = pending.get(id);
    pending.delete(id);
    resolve({ result, error });
  });
  async function cdp(method, params = {}) {
    const id = ++requestId;
    const { result, error } = await new Promise((resolve) => {
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
    assert.equal(error, undefined);
    return result;
  }
  async function run(expression) {
    const { result, exceptionDetails } = await cdp("Runtime.evaluate", { expression, returnByValue: true });
    assert.equal(exceptionDetails, undefined);
    return result.value;
  }
  const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const get = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  async function set(selector, value, event = "change") {
    await run(`{ const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event(${JSON.stringify(event)})); }`);
  }
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  for (let tries = 0; tries < 100; tries += 1) {
    if (await run("document.querySelectorAll('#terms input').length === 6")) break;
    await delay(50);
  }
  assert.equal(await run("document.querySelectorAll('#terms input').length"), 6);
  for (let step = 0; step < 10; step += 1) await click("#guide-next");
  assert.match(await get("#guide-progress"), /COMPLETE/);
  assert.match(await get("#contract-state"), /Settled/);
  assert.deepEqual(await Promise.all(["#locked", "#paid", "#refunded"].map(get)), ["0 XTM", "150 XTM", "450 XTM"]);
  assert.equal(await run("document.querySelectorAll('.rejected').length"), 1);
  assert.match(await get(".rejected"), /Released; expected Submitted/);
  assert.match(await get("#ledger"), /ARBITER.*Prototype → Refunded/s);
  assert.match(await get("#ledger"), /Handoff → Refunded/);
  if (process.env.SCREENSHOT) {
    const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(process.env.SCREENSHOT, Buffer.from(data, "base64"));
  }
  console.log("PASS: all 10 guided steps, rejected double-release, dispute refund, expiry refund, and final balances");

  await click("#reset");
  await set('[name="count"]', "2");
  await click('#create-form button[type="submit"]');
  assert.match(await get(".rejected"), /sum/);
  await set('[name="total"]', "350");
  await click('#create-form button[type="submit"]');
  await click("#fund");
  const first = "#milestones section:first-child ";
  await set(first + "input", "artifact:custom", "input");
  await click(first + '[data-action="submit"]');
  assert.match(await get("#ledger li:first-child"), /Only the payee/);
  await set("#role", "payee");
  await click(first + '[data-action="submit"]');
  assert.match(await get(first + ".reference"), /artifact:custom/);
  await set("#role", "payer");
  await click(first + '[data-action="dispute"]');
  await set("#role", "arbiter");
  await click(first + '[data-action="release"]');
  assert.equal(await get("#paid"), "150 XTM");
  assert.equal(await get("#locked"), "200 XTM");
  assert.deepEqual(pageErrors, []);
  console.log("PASS: custom two-milestone escrow, bad-sum and wrong-role rejections, and arbiter release");
} finally {
  socket?.close();
  if (browser.pid && browser.exitCode === null && browser.signalCode === null) {
    const exited = once(browser, "exit");
    browser.kill();
    await exited;
  }
  server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5 });
}
