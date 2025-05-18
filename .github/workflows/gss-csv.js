const { google } = require("googleapis");
const { GoogleAuth } = require("google-auth-library");
const fs = require("fs");

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
async function main(auth) {
  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: authClient });
  try {
    const spreadsheetId = process.env["SPREADSHEET_ID"];
    // スプレッドシートの全シート情報を取得
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetInfos = spreadsheet.data.sheets;
    if (!sheetInfos) throw new Error("No sheets found");
    for (const sheetInfo of sheetInfos) {
      const sheetName = sheetInfo.properties?.title;
      if (!sheetName) continue;
      // シートの全データを取得
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}`,
      });
      const rows = res.data.values || [];
      // CSV変換
      const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
      // ファイル出力
      fs.writeFileSync(`${sheetName}.csv`, csv, "utf8");
      console.log(`シート「${sheetName}」を${sheetName}.csvに出力しました。`);
    }
  } catch (err) {
    console.log("The API returned an error: " + err);
    process.exit(1);
  }
}
const auth = new GoogleAuth({
  scopes: SCOPES,
});
main(auth);
