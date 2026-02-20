// netlify/functions/ghl-intake.js

export default async (req) => {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Parse body
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "invalid_json_body" }, 400);
    }

    const {
      firstName = "",
      lastName = "",
      email = "",
      phone = "",
      company = "",
      source = "netlify-landing",
      tags = [],
      utm = {}
    } = body;

    if (!email && !phone) {
      return json({ error: "email_or_phone_required" }, 400);
    }

    // Env vars
    const token = process.env.GHL_TOKEN;
    const locationId = process.env.GHL_LOCATION_ID;
    const pipelineId = process.env.GHL_PIPELINE_ID;
    const stageId = process.env.GHL_STAGE_ID;

    const missing = [];
    if (!token) missing.push("GHL_TOKEN");
    if (!locationId) missing.push("GHL_LOCATION_ID");
    if (!pipelineId) missing.push("GHL_PIPELINE_ID");
    if (!stageId) missing.push("GHL_STAGE_ID");

    if (missing.length) {
      return json({ error: "missing_env_vars", required: missing }, 500);
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json"
    };

    const base = "https://services.leadconnectorhq.com";
    const locQ = `locationId=${encodeURIComponent(locationId)}`;

    // ---- 1) UPSERT CONTACT ----
    const upsertUrl = `${base}/contacts/upsert?${locQ}`;

    const upsertPayload = {
      firstName,
      lastName,
      email,
      phone,
      companyName: company,
      source
      // If you later create custom fields in GHL, we can map utm values here.
      // customFields: [{ id: "FIELD_ID", value: utm.utm_source }, ...]
    };

    const upsertRes = await fetch(upsertUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(upsertPayload)
    });

    const upsertText = await upsertRes.text();
    if (!upsertRes.ok) {
      return json(
        {
          step: "contact_upsert_failed",
          status: upsertRes.status,
          details: safeJsonOrText(upsertText)
        },
        400
      );
    }

    const upsertJson = safeParseJson(upsertText);
    const contactId = upsertJson?.contact?.id || upsertJson?.id;

    if (!contactId) {
      return json(
        { step: "contact_id_missing", details: upsertJson || upsertText },
        400
      );
    }

    // ---- 2) ADD TAGS ----
    const defaultTags = (process.env.GHL_DEFAULT_TAGS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const finalTags = [...new Set([...defaultTags, ...(Array.isArray(tags) ? tags : [])])];

    if (finalTags.length) {
      const tagsUrl = `${base}/contacts/${contactId}/tags?${locQ}`;

      const tagRes = await fetch(tagsUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ tags: finalTags })
      });

      const tagText = await tagRes.text();
      if (!tagRes.ok) {
        return json(
          {
            step: "add_tags_failed",
            status: tagRes.status,
            details: safeJsonOrText(tagText)
          },
          400
        );
      }
    }

    // ---- 3) UPSERT OPPORTUNITY ----
    const oppUrl = `${base}/opportunities/upsert?${locQ}`;

    const oppPayload = {
      contactId,
      pipelineId,
      stageId,
      name: company
        ? `${company} - Health Check`
        : `${firstName} ${lastName}`.trim() || "Health Check Lead",
      source,
      status: "open"
      // optional:
      // monetaryValue: 0,
      // assignedTo: "USER_ID",
    };

    const oppRes = await fetch(oppUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(oppPayload)
    });

    const oppText = await oppRes.text();
    if (!oppRes.ok) {
      return json(
        {
          step: "opportunity_upsert_failed",
          status: oppRes.status,
          details: safeJsonOrText(oppText)
        },
        400
      );
    }

    const oppJson = safeParseJson(oppText);

    // Done
    return json(
      {
        ok: true,
        contactId,
        tags: finalTags,
        opportunity: oppJson,
        utmCaptured: utm
      },
      200
    );
  } catch (e) {
    return json({ error: "server_error", details: String(e) }, 500);
  }
};

// ---------- helpers ----------
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeJsonOrText(text) {
  const j = safeParseJson(text);
  return j ?? text;
}