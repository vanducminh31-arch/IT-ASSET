const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const dataDir = path.join(__dirname, 'Data');
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.xlsx'));

for (const file of files) {
  const filePath = path.join(dataDir, file);
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const csv = xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName]);
  const outName = file.replace(/\.xlsx$/i, '.csv');
  const outPath = path.join(dataDir, outName);
  fs.writeFileSync(outPath, csv, 'utf8');
  console.log(`Đã chuyển ${file} → ${outName}`);
}
