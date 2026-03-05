const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Supabase config
const supabaseUrl = 'https://cjbagfragoqhkdwylzgz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqYmFnZnJhZ29xaGtkd3lsemd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NzM5MTAsImV4cCI6MjA4ODI0OTkxMH0.t-QLx1i1xDnA60r8TT7GYCOk5hCxJW0y25MdDh3RSkU';
const supabase = createClient(supabaseUrl, supabaseKey);

const dataDir = path.join(__dirname, 'Data');

// Map file name to table name (bạn chỉnh lại nếu cần)
const fileTableMap = {
  'offices_template.csv': 'offices',
  'stock_template.csv': 'stock',
  'transactions_template.csv': 'transactions',
  'warehouses_template.csv': 'warehouses',
  'stores_template.csv': 'stores',
  // Thêm các file csv khác nếu có
};

// Đọc CSV thành array object
function parseCSV(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = (values[i]||'').trim());
    return obj;
  });
}

async function importFile(filePath, table) {
  const filename = path.basename(filePath);
  const csv = fs.readFileSync(filePath, 'utf8');
  const data = parseCSV(csv);
  if (!data.length) {
    console.log(`❌ ${filename}: Không có dữ liệu`);
    return;
  }
  const { error } = await supabase.from(table).insert(data);
  if (error) {
    console.error(`❌ Lỗi import ${filename} vào bảng ${table}:`, error.message);
  } else {
    console.log(`✅ Đã import ${filename} vào bảng ${table} (${data.length} dòng)`);
  }
}

async function main() {
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv'));
  for (const file of files) {
    const table = fileTableMap[file];
    if (!table) {
      console.warn(`⚠️  Không có mapping cho file: ${file}, bỏ qua.`);
      continue;
    }
    await importFile(path.join(dataDir, file), table);
  }
}

main();
