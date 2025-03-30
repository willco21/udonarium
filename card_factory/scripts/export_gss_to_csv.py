import gspread
from google.oauth2.service_account import Credentials
import csv
import os
import sys

def export_gss_to_csv(sheet_id):
    # Google API認証設定
    scopes = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ]

    credentials = Credentials.from_service_account_file(
        os.environ['GOOGLE_APPLICATION_CREDENTIALS'],
        scopes=scopes
    )
    gc = gspread.Client(auth=credentials)
    gc.session = credentials.authorize(gspread.httpsession.HTTPSession())

    # スプレッドシートを開く
    try:
        spreadsheet = gc.open_by_key(sheet_id)
    except gspread.SpreadsheetNotFound:
        print(f"Error: Spreadsheet with ID {sheet_id} not found")
        sys.exit(1)

    # 出力ディレクトリの作成
    output_dir = 'source_csv'
    os.makedirs(output_dir, exist_ok=True)

    # 各ワークシートをCSVにエクスポート
    for worksheet in spreadsheet.worksheets():
        # シート名に基づいてファイル名を生成
        filename = f"無限カード生成 - {worksheet.title}.csv"
        filepath = os.path.join(output_dir, filename)

        # データを取得
        data = worksheet.get_all_values()

        # CSVに書き込み
        with open(filepath, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerows(data)

        print(f"Exported {worksheet.title} to {filename}")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python export_gss_to_csv.py <sheet_id>")
        sys.exit(1)

    sheet_id = sys.argv[1]
    export_gss_to_csv(sheet_id)
