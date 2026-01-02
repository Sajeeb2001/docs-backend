import { google } from "googleapis";
import { Readable } from "stream";

export default async function handler(req, res) {
  /* ========= CORS ========= */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  /* ======================== */

  try {
    console.log("RAW BODY:", req.body);

    const { docId, signatureBase64, jobUUID } = req.body;
    if (!docId || !signatureBase64 || !jobUUID) {
      return res
        .status(400)
        .json({ success: false, error: "Missing fields" });
    }

    /* ========= AUTH ========= */
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/documents",
      ]
    );

    const drive = google.drive({ version: "v3", auth });
    const docs = google.docs({ version: "v1", auth });

    /* ========= BASE64 → STREAM ========= */
    const base64 = signatureBase64.replace(
      /^data:image\/\w+;base64,/,
      ""
    );
    const buffer = Buffer.from(base64, "base64");
    const stream = Readable.from(buffer);

    /* ========= UPLOAD IMAGE ========= */
    const upload = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: `signature-${Date.now()}.png`,
        parents: [process.env.SHARED_DRIVE_FOLDER_ID],
        mimeType: "image/png",
      },
      media: {
        mimeType: "image/png",
        body: stream,
      },
      fields: "id",
    });

    const fileId = upload.data.id;

    /* ========= MAKE PUBLIC ========= */
    await drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    const imageUrl = `https://drive.google.com/uc?id=${fileId}`;

    /* ========= FIND PLACEHOLDER ========= */
    const PLACEHOLDER = "{{SIGNATURE}}";

    const document = await docs.documents.get({ documentId: docId });
    const content = document.data.body.content;

    let insertIndex = null;
    let deleteRange = null;

    for (const block of content) {
      if (!block.paragraph) continue;

      for (const el of block.paragraph.elements || []) {
        const text = el.textRun?.content;
        if (!text) continue;

        const pos = text.indexOf(PLACEHOLDER);
        if (pos !== -1) {
          insertIndex = el.startIndex + pos;
          deleteRange = {
            startIndex: insertIndex,
            endIndex: insertIndex + PLACEHOLDER.length,
          };
          break;
        }
      }
      if (insertIndex !== null) break;
    }

    /* ========= INSERT IMAGE ========= */
    const requests = [];

    if (deleteRange) {
      requests.push({
        deleteContentRange: { range: deleteRange },
      });
    }

    requests.push({
      insertInlineImage: {
        uri: imageUrl,
        location: {
          index:
            insertIndex ??
            document.data.body.content.at(-1).endIndex - 1,
        },
        objectSize: {
          width: { magnitude: 250, unit: "PT" },
          height: { magnitude: 80, unit: "PT" },
        },
      },
    });

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests },
    });

    /* ========= EXPORT DOC → PDF ========= */
    const pdfExport = await drive.files.export(
      {
        fileId: docId,
        mimeType: "application/pdf",
      },
      { responseType: "arraybuffer" }
    );

    const pdfBuffer = Buffer.from(pdfExport.data);

    /* ========= UPLOAD PDF TO SERVICEM8 ========= */
    const formData = new FormData();

    formData.append(
      "file",
      new Blob([pdfBuffer], { type: "application/pdf" }),
      `signed-${jobUUID}.pdf`
    );

    formData.append("notes", "Signed document");

    const basicAuth = Buffer.from(
      `${process.env.SERVICEM8_API_KEY}:`
    ).toString("base64");

    const serviceM8Response = await fetch(
      `https://api.servicem8.com/api_1.0/Job/${jobUUID}/Attachment.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
        },
        body: formData,
      }
    );

    if (!serviceM8Response.ok) {
      const errorText = await serviceM8Response.text();
      throw new Error(
        `ServiceM8 upload failed (${serviceM8Response.status}): ${errorText}`
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Insert signature error:", err);
    res
      .status(500)
      .json({ success: false, error: err.message });
  }
}
