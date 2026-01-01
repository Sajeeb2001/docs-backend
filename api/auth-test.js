import { google } from "googleapis";
import { Readable } from "stream";

/**
 * Convert base64 image → Readable stream
 */
function base64ToStream(base64Data) {
  const buffer = Buffer.from(
    base64Data.replace(/^data:image\/png;base64,/, ""),
    "base64"
  );

  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
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

    // 🔐 Google Auth (Service Account)
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: [
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/drive"
      ]
    });

    const authClient = await auth.getClient();

    const drive = google.drive({ version: "v3", auth: authClient });
    const docs = google.docs({ version: "v1", auth: authClient });

    // 🖼️ Upload signature image to Drive
    const imageStream = base64ToStream(signatureBase64);

    const uploadRes = await drive.files.create({
      requestBody: {
        name: `signature-${Date.now()}.png`,
        mimeType: "image/png"
      },
      media: {
        mimeType: "image/png",
        body: imageStream
      }
    });

    const imageFileId = uploadRes.data.id;

    // 🔓 Make image readable by Docs (internal only)
    await drive.permissions.create({
      fileId: imageFileId,
      requestBody: {
        role: "reader",
        type: "anyone"
      }
    });

    const imageUrl = `https://drive.google.com/uc?id=${imageFileId}`;

    // ✍️ Insert text + image into Google Doc
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: `\n\nSigned by: ${signerName}\nDate: ${new Date().toLocaleDateString()}\n\n`
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
      message: "Signature inserted into Google Doc",
      imageFileId
    });

  } catch (error) {
    console.error("Insert signature error:", error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
