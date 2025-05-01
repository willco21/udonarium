import gspread
from google.oauth2 import service_account
import csv
import os
import json

# Required OAuth scope for Google Sheets API
SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

# Load service account credentials from environment variable
service_account_info = json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_JSON'])
credentials = service_account.Credentials.from_service_account_info(
    service_account_info,
    scopes=SCOPES
)
client = gspread.Client(auth=credentials)

# スプレッドシートを開く
spreadsheet = client.open_by_key(os.environ['SPREADSHEET_KEY'])

# シート一覧を取得
sheets = spreadsheet.worksheets()

# CSV保存用ディレクトリ作成
os.makedirs('card_factory/source_csv', exist_ok=True)

# 各シートをCSVにエクスポート
for sheet in sheets:
    filename = f'card_factory/source_csv/{sheet.title}.csv'
    with open(filename, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerows(sheet.get_all_values())
