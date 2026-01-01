import { google } from "googleapis";

export default async function handler(req, res) {
  try {
    const { docId, signerName, signatureBase64 } = req.body;

    if (!docId || !signatureBase64) {
      return res.status(400).json({ success: false, error: "Missing fields" });
    }

    /* 1️⃣ AUTH */
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

    /* 2️⃣ BASE64 → BUFFER (CRITICAL FIX) */
    const base64Data = signatureBase64.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");

    /* 3️⃣ UPLOAD IMAGE TO SHARED DRIVE FOLDER */
    const upload = await drive.files.create({
      requestBody: {
        name: `signature-${Date.now()}.png`,
        parents: [process.env.SHARED_DRIVE_FOLDER_ID],
        mimeType: "image/png",
      },
      media: {
        mimeType: "image/png",
        body: imageBuffer, // ✅ MUST be Buffer
      },
      supportsAllDrives: true,
      fields: "id",
    });

    const fileId = upload.data.id;

    /* 4️⃣ MAKE FILE READABLE BY DOCS */
    await drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    const imageUrl = `https://drive.google.com/uc?id=${fileId}`;

    /* 5️⃣ INSERT INTO GOOGLE DOC */
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

    res.json({ success: true });
  } catch (err) {
    console.error("Insert signature error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}
