import { google } from "googleapis";

export default async function handler(req, res) {
  try {
    const { docId, signerName, signatureBase64 } = req.body;
    if (!docId || !signatureBase64) {
      return res.status(400).json({ error: "Missing data" });
    }

    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/documents"
      ]
    });

    const authClient = await auth.getClient();
    const drive = google.drive({ version: "v3", auth: authClient });
    const docs = google.docs({ version: "v1", auth: authClient });

    // 🔹 Decode base64
    const base64Data = signatureBase64.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");

    // 🔹 Upload to Shared Drive
    const file = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: `signature-${Date.now()}.png`,
        mimeType: "image/png",
        parents: [process.env.GOOGLE_SHARED_DRIVE_ID]
      },
      media: {
        mimeType: "image/png",
        body: imageBuffer
      }
    });

    const fileId = file.data.id;

    // 🔹 Make image public
    await drive.permissions.create({
      supportsAllDrives: true,
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone"
      }
    });

    const imageUrl = `https://drive.google.com/uc?id=${fileId}`;

    // 🔹 Insert into Google Doc
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: `\n\nSigned by: ${signerName}\n`
            }
          },
          {
            insertInlineImage: {
              location: { index: 1 },
              uri: imageUrl,
              objectSize: {
                width: { magnitude: 250, unit: "PT" }
              }
            }
          }
        ]
      }
    });

    res.json({
      success: true,
      imageUrl
    });

  } catch (err) {
    console.error("Insert signature error:", err);
    res.status(500).json({ error: err.message });
  }
}
