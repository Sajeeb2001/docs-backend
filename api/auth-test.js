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

    /* ===============================
       1️⃣ GOOGLE AUTH (CORRECT)
    =============================== */
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

    /* ===============================
       2️⃣ BASE64 → BUFFER
    =============================== */
    const base64Clean = signatureBase64.replace(
      /^data:image\/png;base64,/,
      ""
    );

    const imageBuffer = Buffer.from(base64Clean, "base64");

    /* ===============================
       3️⃣ BUFFER → STREAM (CRITICAL FIX)
    =============================== */
    const stream = new Readable();
    stream.push(imageBuffer);
    stream.push(null);

    /* ===============================
       4️⃣ UPLOAD TO SHARED DRIVE
    =============================== */
    const upload = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: `signature-${Date.now()}.png`,
        mimeType: "image/png",
        parents: [process.env.SHARED_DRIVE_FOLDER_ID],
      },
      media: {
        mimeType: "image/png",
        body: stream, // ✅ MUST be stream
      },
      fields: "id",
    });

    const fileId = upload.data.id;

    /* ===============================
       5️⃣ MAKE FILE PUBLIC (READ)
    =============================== */
    await drive.permissions.create({
      supportsAllDrives: true,
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    const imageUrl = `https://drive.google.com/uc?id=${fileId}`;

    /* ===============================
       6️⃣ INSERT INTO GOOGLE DOC
    =============================== */
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: `\n\nSigned by: ${
                signerName || "Customer"
              }\nDate: ${new Date().toLocaleDateString()}\n`,
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

    return res.status(200).json({
      success: true,
      message: "Signature inserted successfully",
    });
  } catch (err) {
    console.error("Insert signature error:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}
