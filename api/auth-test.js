import { google } from "googleapis";
import { Buffer } from "buffer";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { docId, signerName, signatureBase64 } = req.body;

    if (!docId || !signerName || !signatureBase64) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Auth
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: [
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/drive"
      ]
    });

    const drive = google.drive({ version: "v3", auth });
    const docs = google.docs({ version: "v1", auth });

    // Convert base64 → buffer
    const base64Data = signatureBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // 1️⃣ Upload image to Drive
    const file = await drive.files.create({
      requestBody: {
        name: `signature-${Date.now()}.png`,
        mimeType: "image/png"
      },
      media: {
        mimeType: "image/png",
        body: buffer
      }
    });

    const fileId = file.data.id;

    // 2️⃣ Make it public
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone"
      }
    });

    // 3️⃣ Get public URL
    const imageUrl = `https://drive.google.com/uc?id=${fileId}`;

    // 4️⃣ Insert into Google Doc
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: `\n\nSigned by: ${signerName}\nDate: ${new Date().toLocaleDateString()}\n`
            }
          },
          {
            insertInlineImage: {
              location: { index: 2 },
              uri: imageUrl,
              objectSize: {
                height: { magnitude: 80, unit: "PT" },
                width: { magnitude: 250, unit: "PT" }
              }
            }
          }
        ]
      }
    });

    res.status(200).json({
      success: true,
      message: "Signature inserted into document"
    });

  } catch (error) {
    console.error("Insert signature error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
