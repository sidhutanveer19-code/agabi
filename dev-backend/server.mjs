// Agabi DEV backend stub — a local stand-in for the real backend during
// development. It implements the shared API contract (/teach NDJSON stream,
// /workspace, /events, /session). It is NOT part of the frontend bundle and is
// NOT imported by the app — all lesson generation lives here, never in the
// frontend. Run: `node dev-backend/server.mjs`  (or `npm run dev:backend`).
//
// Point the app at it:  NEXT_PUBLIC_API_BASE_URL=http://localhost:8787 npm run dev

import http from "node:http";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const workspaces = new Map(); // in-memory workspace store (dev only)

// ---------- block-data builders (mirror the frontend block schemas) ----------
const doc = (...nodes) => ({ type: "doc", content: nodes });
const para = (t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : undefined });
const heading = (level, t) => ({ type: "heading", attrs: { level }, content: t ? [{ type: "text", text: t }] : undefined });
const textData = (t) => ({ doc: doc(para(t)) });
const headingData = (t) => ({ doc: doc(heading(1, t)) });
const subheadingData = (t) => ({ doc: doc(heading(2, t)) });
const admonitionData = (t) => ({ doc: doc(para(t)) });
const formulaData = (latex) => ({ latex });
const barChartData = (rows) => ({ kind: "bar", series: [{ key: "value", color: "#a78bfa" }], data: rows, xKey: "label" });
const diagramData = (nodes, edges) => ({ nodes, edges });

const b = (type, data, streamText) => ({ type, data, streamText });

function classify(topic) {
  const t = topic.toLowerCase();
  if (/pythag|hypotenuse|right triangle/.test(t)) return "pythagoras";
  if (/quadratic|parabola|roots|x\^?2|discriminant/.test(t)) return "quadratic";
  if (/projectile|gravity|thrown|falling|newton/.test(t)) return "projectile";
  return "generic";
}

function planLesson(topic) {
  const t = (topic || "this idea").trim();
  const kind = classify(t);
  const intro = `Let's build a clear picture of ${t.toLowerCase()}. We'll start from one simple idea and grow it, step by step, until the whole thing makes sense.`;
  const detail = `The trick is to hold onto the core idea and watch how everything else follows from it. Once you can see it, ${t.toLowerCase()} stops being something to memorise and becomes something you understand.`;
  const plan = [
    b("heading", headingData(t)),
    b("paragraph", textData(""), intro),
    b("subheading", subheadingData("The core idea")),
    b("callout", admonitionData(`${t}: the one idea everything is built on.`)),
    b("paragraph", textData(""), detail),
  ];
  if (kind === "pythagoras") {
    plan.push(b("formula", formulaData("a^2 + b^2 = c^2")));
    plan.push(b("basic-diagram", diagramData(
      [{ id: "n1", x: 40, y: 150, label: "a" }, { id: "n2", x: 40, y: 40, label: "c" }, { id: "n3", x: 240, y: 150, label: "b" }],
      [{ id: "e1", from: "n1", to: "n2" }, { id: "e2", from: "n2", to: "n3" }, { id: "e3", from: "n3", to: "n1" }]
    )));
  } else if (kind === "quadratic") {
    plan.push(b("formula", formulaData("x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}")));
    plan.push(b("chart", barChartData([{ label: "-2", value: 4 }, { label: "-1", value: 1 }, { label: "0", value: 0 }, { label: "1", value: 1 }, { label: "2", value: 4 }])));
  } else if (kind === "projectile") {
    plan.push(b("formula", formulaData("y = v_0 t - \\tfrac{1}{2} g t^2")));
  } else {
    plan.push(b("chart", barChartData([{ label: "A", value: 6 }, { label: "B", value: 11 }, { label: "C", value: 5 }, { label: "D", value: 9 }])));
  }
  plan.push(b("summary", admonitionData(`In short: ${t.toLowerCase()} comes down to that one idea — everything else is just seeing it from a new angle.`)));
  return plan;
}

// Stress mode (dev/e2e only): a `stress:N` topic streams N lightweight blocks
// fast, to exercise workspace virtualization + streaming under load.
function planStress(topic) {
  const m = /stress[:\-\s]?(\d+)/i.exec(topic || "");
  const n = Math.max(20, Math.min(m ? Number(m[1]) : 200, 800));
  const plan = [b("heading", headingData(`Stress test — ${n} blocks`))];
  for (let i = 0; i < n; i++) {
    const r = i % 4;
    if (r === 0) plan.push(b("subheading", subheadingData(`Section ${i}`)));
    else if (r === 1) plan.push(b("formula", formulaData(`x_{${i}} = ${i}^2 + 1`)));
    else if (r === 2) plan.push(b("callout", admonitionData(`Note ${i}: idea number ${i}.`)));
    else plan.push(b("paragraph", textData(`Paragraph ${i}: explanation text for block ${i}.`)));
  }
  return plan;
}

function planCommand(req) {
  const topic = (req.topic || "this idea").trim();
  const cmd = req.command || "";
  const q = (req.text || "").trim();
  if (req.kind === "question" && q) {
    return [
      b("heading", headingData(q)),
      b("paragraph", textData(""), `Good question. Here's how ${q.toLowerCase().replace(/\?+$/, "")} connects back to ${topic.toLowerCase()} — and why it matters.`),
      b("summary", admonitionData("The short answer, kept simple so it sticks.")),
    ];
  }
  switch (cmd) {
    case "simpler":
      return [b("heading", headingData("In simpler terms")), b("paragraph", textData(""), `Forget the details for a moment. At its heart, ${topic.toLowerCase()} is just this one plain idea, said in everyday words.`), b("tip", admonitionData("If you remember only one sentence, remember this one."))];
    case "harder":
      return [b("heading", headingData("Going deeper")), b("paragraph", textData(""), "Now that the idea is solid, let's push on it and see where the edges are."), b("formula", formulaData("f(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}")), b("summary", admonitionData("The deeper view — same idea, sharper tools."))];
    case "example":
      return [b("heading", headingData("Another example")), b("paragraph", textData(""), "Here's the same idea in a different situation, so you can see it isn't a one-off."), b("chart", barChartData([{ label: "1", value: 3 }, { label: "2", value: 7 }, { label: "3", value: 12 }, { label: "4", value: 8 }]))];
    case "visual":
      return [b("heading", headingData("Seen visually")), b("basic-diagram", diagramData([{ id: "a", x: 30, y: 60, label: "Idea" }, { id: "b", x: 220, y: 60, label: "Result" }, { id: "c", x: 130, y: 170, label: "Why" }], [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "a", to: "c" }])), b("caption", textData("The idea, drawn out."))];
    case "again":
      return [b("heading", headingData("Another way to see it")), b("paragraph", textData(""), "Same idea, a fresh angle. Sometimes it clicks the second time, told differently."), b("callout", admonitionData(`${topic}: reframed.`))];
    case "continue":
      return [b("subheading", subheadingData("Continuing…")), b("paragraph", textData(""), "Picking up right where we left off, the next piece follows naturally."), b("summary", admonitionData("One more step forward."))];
    default: {
      const label = cmd === "why" ? "Why it works" : cmd === "how" ? "How it works" : cmd === "whatif" ? "What if we change it?" : "More on this";
      return [b("heading", headingData(label)), b("paragraph", textData(""), `${label} — traced back to the core idea of ${topic.toLowerCase()}.`), b("summary", admonitionData("The gist, in one line."))];
    }
  }
}

function titleFor(req) {
  if (req.kind === "lesson") return (req.topic || "Lesson").trim();
  if (req.kind === "question" && req.text) return req.text.trim();
  const map = { simpler: "Simpler", harder: "Deeper", example: "Another example", visual: "Visual", again: "Another way", continue: "Continued", why: "Why", how: "How", whatif: "What if" };
  return map[req.command || ""] || "Explanation";
}

const VISUAL = new Set(["chart", "basic-diagram", "flow", "mermaid", "threed", "molecule", "map", "graph"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- HTTP ----------
function cors(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-csrf-token");
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // POST /__reset  (dev/e2e only) — clear the in-memory workspace store so each
  // test starts from an empty backend (no stale "default" workspace).
  if (req.method === "POST" && path === "/__reset") {
    workspaces.clear();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  // GET /session
  if (req.method === "GET" && path === "/api/session") {
    res.setHeader("Set-Cookie", "csrf=dev; Path=/; SameSite=Lax");
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ student: { id: "dev", name: "Student" }, preferences: {} }));
  }

  // POST /events
  if (req.method === "POST" && path === "/api/events") {
    const body = await readBody(req);
    console.log(`[events] +${(body.events || []).length}`, (body.events || []).map((e) => e.type).join(", "));
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  // GET/PUT /workspace/:id
  if (path.startsWith("/api/workspace/")) {
    const id = decodeURIComponent(path.slice("/api/workspace/".length));
    if (req.method === "GET") {
      const state = workspaces.get(id);
      if (!state) { res.writeHead(404); return res.end(JSON.stringify({ code: "not_found", message: "no workspace", recoverable: true })); }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(state));
    }
    if (req.method === "PUT") {
      const body = await readBody(req);
      workspaces.set(id, { doc: body.doc, camera: body.camera });
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }
  }

  // POST /teach  → NDJSON stream
  if (req.method === "POST" && path === "/api/teach") {
    const body = await readBody(req);
    const request = body.request || { kind: "lesson", topic: "this idea" };
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
    const send = (ev) => res.write(JSON.stringify(ev) + "\n");
    let cancelled = false;
    req.on("close", () => { cancelled = true; });

    send({ t: "status", status: "thinking" });
    await sleep(420);
    if (cancelled) return res.end();
    const isStress = request.kind === "lesson" && /stress/i.test(request.topic || "");
    const gap = isStress ? 3 : 300;
    const plan = request.kind === "lesson" ? (isStress ? planStress(request.topic) : planLesson(request.topic)) : planCommand(request);
    send({ t: "status", status: "planning" });
    await sleep(320);
    if (cancelled) return res.end();
    send({ t: "region", title: titleFor(request) });
    send({ t: "status", status: "generating" });

    let index = 0;
    for (const block of plan) {
      if (cancelled) return res.end();
      if (VISUAL.has(block.type)) send({ t: "status", status: "visualizing" });
      if (block.streamText) {
        send({ t: "block", block: { type: block.type, data: textData("") } });
        const words = block.streamText.split(" ");
        let acc = "";
        for (const w of words) {
          if (cancelled) return res.end();
          acc += (acc ? " " : "") + w;
          await sleep(38);
          send({ t: "patch", index, data: textData(acc) });
        }
      } else {
        send({ t: "block", block: { type: block.type, data: block.data } });
        await sleep(gap);
      }
      index += 1;
    }
    send({ t: "status", status: "finished" });
    send({ t: "done" });
    return res.end();
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ code: "not_found", message: "unknown route", recoverable: false }));
});

server.listen(PORT, () => console.log(`Agabi dev-backend stub on http://localhost:${PORT}`));
