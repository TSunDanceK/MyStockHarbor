import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 4000;
const MIN_SUBMIT_SECONDS = 3;

type FeedbackBody = {
  message?: unknown;
  email?: unknown;
  website?: unknown; // honeypot -- should always arrive empty from real users
  startedAt?: unknown;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  let body: FeedbackBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const honeypot = typeof body.website === "string" ? body.website.trim() : "";
  const startedAt = typeof body.startedAt === "number" ? body.startedAt : 0;

  // Two lightweight, no-database spam checks: a honeypot field real users
  // never see or fill, and a minimum elapsed-time check (bots that submit
  // immediately on page load are almost never real people). Both cases
  // return ok:true so bots don't learn their submission was rejected.
  const submittedTooFast =
    startedAt > 0 && Date.now() - startedAt < MIN_SUBMIT_SECONDS * 1000;

  if (honeypot || submittedTooFast) {
    return NextResponse.json({ ok: true });
  }

  if (message.length < MIN_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: "Please add a little more detail before submitting." },
      { status: 400 },
    );
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: "That message is too long — please shorten it." },
      { status: 400 },
    );
  }

  if (email && !isValidEmail(email)) {
    return NextResponse.json(
      { error: "That doesn't look like a valid email address." },
      { status: 400 },
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  // FEEDBACK_FROM_EMAIL should be a verified Resend sending address on the
  // mystockharbor.com domain once domain verification is complete (see
  // claude/feedback-form-setup.md). admin@mystockharbor.com stays untouched
  // as the Zoho-hosted destination inbox -- this route only ever sends TO it.
  const fromAddress =
    process.env.FEEDBACK_FROM_EMAIL ??
    "MyStockHarbor Feedback <feedback@mystockharbor.com>";

  if (!apiKey) {
    console.error(
      "RESEND_API_KEY is not set — feedback form cannot send email yet.",
    );
    return NextResponse.json(
      {
        error:
          "Feedback isn't wired up to email yet — please try again shortly.",
      },
      { status: 503 },
    );
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: ["admin@mystockharbor.com"],
        reply_to: email || undefined,
        subject: "New feedback — MyStockHarbor",
        text: [
          "New feedback submitted via mystockharbor.com/feedback",
          "",
          email ? `From: ${email}` : "From: (no email provided)",
          "",
          message,
        ].join("\n"),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Resend API error:", res.status, detail);
      return NextResponse.json(
        {
          error:
            "Something went wrong sending your feedback. Please try again.",
        },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error("Failed to reach Resend:", err);
    return NextResponse.json(
      { error: "Something went wrong sending your feedback. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
