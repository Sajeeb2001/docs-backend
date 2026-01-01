import { google } from "googleapis";
import { Readable } from "stream";

function base64ToStream(base64Data) {
  const clean = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(clean, "base64");
  return Readable.from(buffer);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { docId, signerName, signatureBase64 } = req.body;

    if (!docId || !signerName || !signatureBase64) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 🔐 Auth
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/documents"
      ]
    });

    const drive = google.drive({ version: "v3", auth });
    const docs = google.docs({ version: "v1", auth });

    // 📤 Upload image to Shared Drive
    const imageStream = base64ToStream(signatureBase64);

    const upload = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: `signature-${Date.now()}.png`,
        mimeType: "image/png",
        parents: [process.env.SHARED_DRIVE_FOLDER_ID]
      },
      media: {
        mimeType: "image/png",
        body: imageStream
      }
    });

    const fileId = upload.data.id;

    // 🌍 Make image publicly viewable
    await drive.permissions.create({
      supportsAllDrives: true,
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone"
      }
    });

    const imageUrl = `https://drive.google.com/uc?id=${fileId}`;

    // 📝 Insert text + image into Google Doc
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
              location: { index: 1 },
              uri: imageUrl,
              objectSize: {
                width: { magnitude: 250, unit: "PT" },
                height: { magnitude: 80, unit: "PT" }
              }
            }
          }
        ]
      }
    });

    return res.status(200).json({
      success: true,
      message: "Signature inserted successfully"
    });

  } catch (error) {
    console.error("Insert signature error:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
