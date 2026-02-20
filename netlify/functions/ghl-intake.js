export default async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await req.json();

    const {
      firstName,
      lastName,
      email,
      phone,
      company,
      source = "netlify-landing",
      tags = [],
      utm = {}
    } = body;

    if (!email && !phone) {
      return new Response(JSON.stringify({ error: "email or phone required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const token = process.env.GHL_TOKEN;
    const pipelineId = process.env.GHL_PIPELINE_ID;
    const stageId = process.env.GHL_STAGE_ID;

    if (!token || !pipelineId || !stageId) {
      return new Response(JSON.stringify({
        error: "missing_env_vars",
        required: ["GHL_TOKEN","GHL_PIPELINE_ID","GHL_STAGE_ID"]
      }), { status: 500, headers: { "Content-Type": "application/json" }});
    }

   const headers = {
  Authorization: `Bearer ${token}`,
  Version: "2021-07-28",
  "Location-Id": process.env.uhwOMWuFodfwHvR7KXoa,
  "Content-Type": "application/json"
};

    // 1) Upsert contact
    const upsertPayload = {
      firstName,
      lastName,
      email,
      phone,
      companyName: company,
      source,
      // Sometimes tags here work, sometimes not—so we also call add-tags explicitly.
      tags
      // If you later create custom fields in GHL, we can map utm values here.
    };

    const upsertRes = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
      method: "POST",
      headers,
      body: JSON.stringify(upsertPayload)
    });

    const upsertText = await upsertRes.text();
    if (!upsertRes.ok) {
      return new Response(JSON.stringify({
        step: "contact_upsert_failed",
        status: upsertRes.status,
        details: upsertText
      }), { status: 400, headers: { "Content-Type": "application/json" }});
    }

    const upsertJson = JSON.parse(upsertText);
    const contactId = upsertJson?.contact?.id || upsertJson?.id;

    if (!contactId) {
      return new Response(JSON.stringify({
        step: "contact_id_missing",
        details: upsertJson
      }), { status: 400, headers: { "Content-Type": "application/json" }});
    }

    // 2) Add tags (reliable)
    const defaultTags = (process.env.GHL_DEFAULT_TAGS || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    const finalTags = [...new Set([...defaultTags, ...tags])];

    if (finalTags.length) {
      const tagRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
        method: "POST",
        headers,
        body: JSON.stringify({ tags: finalTags })
      });

      const tagText = await tagRes.text();
      if (!tagRes.ok) {
        return new Response(JSON.stringify({
          step: "add_tags_failed",
          status: tagRes.status,
          details: tagText
        }), { status: 400, headers: { "Content-Type": "application/json" }});
      }
    }

    // 3) Upsert opportunity
    const oppPayload = {
      contactId,
      pipelineId,
      stageId,
      name: company ? `${company} - Health Check` : `${firstName || ""} ${lastName || ""}`.trim() || "Health Check Lead",
      source,
      status: "open"
    };

    const oppRes = await fetch("https://services.leadconnectorhq.com/opportunities/upsert", {
      method: "POST",
      headers,
      body: JSON.stringify(oppPayload)
    });

    const oppText = await oppRes.text();
    if (!oppRes.ok) {
      return new Response(JSON.stringify({
        step: "opportunity_upsert_failed",
        status: oppRes.status,
        details: oppText
      }), { status: 400, headers: { "Content-Type": "application/json" }});
    }

    const oppJson = JSON.parse(oppText);

    return new Response(JSON.stringify({
      ok: true,
      contactId,
      tags: finalTags,
      opportunity: oppJson,
      utmCaptured: utm
    }), { status: 200, headers: { "Content-Type": "application/json" }});

  } catch (e) {
    return new Response(JSON.stringify({
      error: "server_error",
      details: String(e)
    }), { status: 500, headers: { "Content-Type": "application/json" }});
  }
};
