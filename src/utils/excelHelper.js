// ============================================================
// Excel Helper — SheetJS(xlsx) 기반 내보내기 / 가져오기
// ============================================================
const XLSX = require('xlsx');

/**
 * rows (객체 배열) → Excel Buffer
 * @param {Array<{key, label}>} columns  — 순서대로 출력할 컬럼 정의
 * @param {Array<Object>}        rows     — 데이터 행
 * @param {string}               sheetName
 */
function toExcelBuffer(columns, rows, sheetName = 'Sheet1') {
  // 헤더 행 + 데이터 행
  const header = columns.map(c => c.label);
  const data = rows.map(row =>
    columns.map(c => {
      const v = row[c.key];
      return v === null || v === undefined ? '' : v;
    })
  );

  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);

  // 컬럼 너비 자동 조정 (최대 50자)
  ws['!cols'] = columns.map((c, ci) => {
    const maxLen = Math.max(c.label.length, ...data.map(r => String(r[ci] ?? '').length));
    return { wch: Math.min(maxLen + 2, 50) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Excel Buffer → 객체 배열 (헤더 행이 첫 번째 행)
 */
function fromExcelBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

/**
 * res 에 Excel 파일 응답 전송
 */
function sendExcel(res, buffer, filename) {
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}.xlsx`
  );
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}

module.exports = { toExcelBuffer, fromExcelBuffer, sendExcel };
