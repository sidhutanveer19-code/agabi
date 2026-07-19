import { NextResponse } from "next/server";
import { lessonBriefSchema } from "@/lib/compose/brief";

/**
 * Optional AI lesson generation. Active only when ANTHROPIC_API_KEY is present.
 * Returns a validated LessonBrief; the client lays it out. Any failure responds
 * non-2xx so the client falls back to the generic composer (never blank).
 */
export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "ai-unavailable" }, { status: 501 });
  }

  let topic = "";
  try {
    topic = ((await req.json())?.topic ?? "").toString().slice(0, 200);
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  if (!topic.trim()) {
    return NextResponse.json({ error: "no-topic" }, { status: 400 });
  }

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const system =
      "You are Agabi, a tutor. Given a topic, output ONLY a JSON object (no prose) " +
      "with these exact fields: title (<=80), subject (<=40), subtitle (<=120), " +
      "keyIdea (<=120, no trailing period), points (array of exactly 2 short strings <=40 each), " +
      "note1 (array of exactly 2 short strings <=40), note2 (array of exactly 2 short strings <=40), " +
      "definitionLabel (<=30), definitionBody (<=120). Keep language clear and student-friendly.";
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: `Topic: ${topic}` }],
    });
    const text = msg.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return NextResponse.json({ error: "no-json" }, { status: 502 });
    }
    const json = JSON.parse(text.slice(start, end + 1));
    const parsed = lessonBriefSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid-brief" }, { status: 502 });
    }
    return NextResponse.json({ brief: parsed.data });
  } catch {
    return NextResponse.json({ error: "ai-error" }, { status: 502 });
  }
}
