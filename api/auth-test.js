import { google } from "googleapis";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { docId, signerName, signatureBase64 } = req.body;

    if (!docId || !signerName || !signatureBase64) {
      return res.status(400).json({ error: "Missing required fields" });
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

    /* ------------------ Convert base64 to Buffer ------------------ */
    const base64Data = signatureBase64.replace(/^data:image\/png;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");

    /* ------------------ Upload to Shared Drive Folder ------------------ */
    const fileMetadata = {
      name: `signature-${Date.now()}.png`,
      parents: [process.env.SHARED_DRIVE_FOLDER_ID]
    };

    const media = {
      mimeType: "image/png",
      body: imageBuffer
    };

    const upload = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: "id",
      supportsAllDrives: true
    });

    const fileId = upload.data.id;

    /* ------------------ Make image public ------------------ */
    await drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: {
        role: "reader",
        type: "anyone"
      }
    });

    const imageUrl = `https://drive.google.com/uc?id=${fileId}`;

    /* ------------------ Insert into Google Doc ------------------ */
    const date = new Date().toLocaleDateString();

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: `\n\nSigned by: ${signerName}\nDate: ${date}\n`
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
