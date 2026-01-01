import { google } from "googleapis";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { docId, signatureBase64, signerName } = req.body;

    if (!docId || !signatureBase64) {
      return res.status(400).json({
        error: "Missing docId or signatureBase64"
      });
    }

    // 🔐 Auth
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: [
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/drive"
      ]
    });

    const authClient = await auth.getClient();

    const docs = google.docs({ version: "v1", auth: authClient });
    const drive = google.drive({ version: "v3", auth: authClient });

    // 📄 Get document to find end index
    const doc = await docs.documents.get({ documentId: docId });
    const body = doc.data.body.content;
    const endIndex = body[body.length - 1].endIndex - 1;

    // 🖼 Convert Base64 → raw bytes
    const imageBase64 = signatureBase64.replace(/^data:image\/png;base64,/, "");
    const imageBytes = Buffer.from(imageBase64, "base64");

    // 🧾 Insert signature + optional text
    const requests = [
      {
        insertText: {
          location: { index: endIndex },
          text: `\n\nSigned by: ${signerName || "Client"}\nDate: ${new Date().toLocaleDateString()}\n`
        }
      },
      {
        insertInlineImage: {
          location: { index: endIndex + 1 },
          uri: `data:image/png;base64,${imageBase64}`,
          objectSize: {
            height: { magnitude: 80, unit: "PT" },
            width: { magnitude: 250, unit: "PT" }
          }
        }
      }
    ];

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests }
    });

    // 📤 Export PDF
    const pdfResponse = await drive.files.export(
      { fileId: docId, mimeType: "application/pdf" },
      { responseType: "arraybuffer" }
    );

    const pdfBuffer = Buffer.from(pdfResponse.data);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="signed-document.pdf"`
    );

    return res.status(200).send(pdfBuffer);

  } catch (error) {
    console.error("Insert signature error:", error);
    return res.status(500).json({
      error: "Failed to insert signature",
      details: error.message
    });
  }
}
