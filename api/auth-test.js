import { google } from "googleapis";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { docId, signerName, signatureBase64 } = req.body;

    if (!docId || !signerName || !signatureBase64) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // ---- Google Auth ----
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ["https://www.googleapis.com/auth/documents"]
    });

    const docs = google.docs({
      version: "v1",
      auth: await auth.getClient()
    });

    // ---- Convert base64 to inline image URL ----
    // Google Docs REQUIRES a URL, but it only needs it temporarily.
    const cleanBase64 = signatureBase64.replace(
      /^data:image\/png;base64,/,
      ""
    );

    const imageUrl =
      "data:image/png;base64," + cleanBase64;

    // ---- Insert text + image ----
    const requests = [
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
    ];

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests }
    });

    res.status(200).json({
      success: true,
      message: "Signature successfully added to Google Doc"
    });

  } catch (error) {
    console.error("Insert signature error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
