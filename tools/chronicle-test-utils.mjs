import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
export async function harness() {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const server = http.createServer((q, r) => {
    r.setHeader("Content-Type", "text/html;charset=utf-8");
    r.end(fs.readFileSync(new URL("../index.html", import.meta.url)));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" }),
    errors = [];
  return {
    errors,
    async setup(seed = null) {
      const c = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await c.addInitScript(() => {
        requestAnimationFrame = () => 0;
        if (sessionStorage.seed) return;
        sessionStorage.seed = "1";
        localStorage.setItem(
          "worldDefense.soldiers.v1",
          JSON.stringify({
            seq: 2,
            squadSeq: 1,
            squads: [{ id: 1, type: "ashigaru", slot: 0 }],
            soldiers: [1, 2].map((id) => ({
              id,
              type: "ashigaru",
              job: "ashigaru",
              jobs: ["ashigaru"],
              squadId: 1,
              level: 100,
              bestLevel: 100,
              name: "兵" + id,
              kills: 1000,
              skills: [],
              learned: [],
            })),
            fallen: [],
          }),
        );
        localStorage.setItem(
          "worldDefense.warlords.v1",
          JSON.stringify({ owned: {}, forge: { scrolls: { revive: 2 } } }),
        );
      });
      if (seed)
        await c.addInitScript((seed) => {
          if (sessionStorage.customSeed) return;
          sessionStorage.customSeed = "1";
          localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(seed));
        }, seed);
      const p = await c.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto("http://127.0.0.1:" + server.address().port + "/?debug");
      return { p, c };
    },
    async close() {
      await browser.close();
      await new Promise((r) => server.close(r));
    },
  };
}
