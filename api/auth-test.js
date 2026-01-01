import { google } from "googleapis";

export default async function handler(req, res) {
  try {
    console.log("RAW BODY:", req.body);

    const { docId, signatureBase64 } = req.body;

    if (!docId || !signatureBase64) {
      return res.status(400).json({
        success: false,
        error: "docId and signatureBase64 are required",
      });
    }

    /* ===============================
       1️⃣ AUTH
    ================================ */
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/documents",
      ],
    });

    const drive = google.drive({ version: "v3", auth });
    const docs = google.docs({ version: "v1", auth });

    /* ===============================
       2️⃣ BASE64 → BUFFER
    ================================ */
    const base64Data = signatureBase64.replace(
      /^data:image\/\w+;base64,/,
      ""
    );

    const imageBuffer = Buffer.from(base64Data, "base64");

    /* ===============================
       3️⃣ UPLOAD IMAGE TO SHARED DRIVE
    ================================ */
    const upload = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: `signature-${Date.now()}.png`,
        parents: [process.env.SHARED_DRIVE_FOLDER_ID],
        mimeType: "image/png",
      },
      media: {
        mimeType: "image/png",
        body: imageBuffer,
      },
      fields: "id",
    });

    const fileId = upload.data.id;

    /* ===============================
       4️⃣ MAKE IMAGE PUBLIC (DOCS NEEDS THIS)
    ================================ */
    await drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    const imageUrl = `https://drive.google.com/uc?id=${fileId}`;

    /* ===============================
       5️⃣ INSERT IMAGE ONLY (SAFE MODE)
    ================================ */
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertInlineImage: {
              uri: imageUrl,
              location: {
                endOfSegmentLocation: {},
              },
              objectSize: {
                width: { magnitude: 250, unit: "PT" },
                height: { magnitude: 80, unit: "PT" },
              },
            },
          },
        ],
      },
    });

    return res.json({
      success: true,
      fileId,
    });
  } catch (err) {
    console.error("Insert signature error:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}
