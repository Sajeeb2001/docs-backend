import { google } from "googleapis";
import { Readable } from "stream";

export default async function handler(req, res) {
  try {
    console.log("RAW BODY:", req.body);

    const { docId, signerName, signatureBase64 } = req.body;

    if (!docId || !signatureBase64) {
      return res.status(400).json({
        success: false,
        error: "Missing docId or signatureBase64",
      });
    }

    /* 1️⃣ AUTH (SERVICE ACCOUNT) */
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY, // 🔴 PASTE KEY AS ONE LINE (NO REPLACE)
      [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/documents",
      ]
    );

    const drive = google.drive({ version: "v3", auth });
    const docs = google.docs({ version: "v1", auth });

    /* 2️⃣ BASE64 → BUFFER */
    const base64Data = signatureBase64.split(",")[1];
    const imageBuffer = Buffer.from(base64Data, "base64");

    /* 3️⃣ BUFFER → STREAM (CRITICAL FIX) */
    const imageStream = Readable.from(imageBuffer);

    /* 4️⃣ UPLOAD TO SHARED DRIVE */
    const upload = await drive.files.create({
      requestBody: {
        name: `signature-${Date.now()}.png`,
        parents: [process.env.SHARED_DRIVE_FOLDER_ID],
        mimeType: "image/png",
      },
      media: {
        mimeType: "image/png",
        body: imageStream, // ✅ MUST BE STREAM
      },
      supportsAllDrives: true,
      fields: "id",
    });

    const fileId = upload.data.id;

    /* 5️⃣ MAKE IMAGE PUBLIC (FOR DOCS ACCESS) */
    await drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    const imageUrl = `https://drive.google.com/uc?id=${fileId}`;

    /* 6️⃣ INSERT INTO GOOGLE DOC */
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: `\n\nSigned by: ${signerName || "Customer"}\nDate: ${new Date().toLocaleDateString()}\n`,
            },
          },
          {
            insertInlineImage: {
              location: { index: 1 },
              uri: imageUrl,
              objectSize: {
                width: { magnitude: 250, unit: "PT" },
                height: { magnitude: 80, unit: "PT" },
              },
            },
          },
        ],
      },
    });

    return res.json({ success: true });

  } catch (err) {
    console.error("Insert signature error:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}
