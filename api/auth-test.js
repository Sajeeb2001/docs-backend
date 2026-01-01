import { google } from "googleapis";

export default async function handler(req, res) {
  try {
    console.log("RAW BODY:", req.body); // 🔍 DEBUG — KEEP THIS

    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const body = req.body || {};
    const { docId, signerName, signatureBase64 } = body;

    /* 🔒 HARD VALIDATION */
    if (!docId || !signatureBase64 || typeof signatureBase64 !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid fields",
        received: body,
      });
    }

    /* 1️⃣ AUTH (SERVICE ACCOUNT) */
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

    /* 2️⃣ BASE64 → BUFFER (CRITICAL) */
    const cleanedBase64 = signatureBase64.replace(
      /^data:image\/(png|jpeg|jpg);base64,/,
      ""
    );

    const imageBuffer = Buffer.from(cleanedBase64, "base64");

    /* 3️⃣ UPLOAD IMAGE TO SHARED DRIVE */
    const uploadResponse = await drive.files.create({
      requestBody: {
        name: `signature-${Date.now()}.png`,
        mimeType: "image/png",
        parents: [process.env.SHARED_DRIVE_FOLDER_ID], // MUST be Shared Drive
      },
      media: {
        mimeType: "image/png",
        body: imageBuffer, // ✅ BUFFER ONLY
      },
      supportsAllDrives: true,
      fields: "id",
    });

    const fileId = uploadResponse.data.id;

    /* 4️⃣ MAKE IMAGE PUBLIC (DOCS NEEDS THIS) */
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

    return res.status(200).json({
      success: true,
      message: "Signature inserted into document",
      imageUrl,
    });

  } catch (error) {
    console.error("Insert signature error:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/* 🧠 VERCEL BODY PARSER FIX (MANDATORY) */
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb", // base64 images
    },
  },
};
