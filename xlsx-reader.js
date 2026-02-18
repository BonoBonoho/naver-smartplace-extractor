/**
 * xlsx-reader.js — 외부 라이브러리 없이 xlsx/csv 파일 읽기
 * ZIP(DEFLATE) 파싱 + OOXML 추출 + CSV 파싱
 */
var XlsxReader = (function () {
  'use strict';

  // ===== ZIP 파싱 =====
  function parseZipEntries(buffer) {
    var view = new DataView(buffer);

    // End of Central Directory 찾기 (뒤에서부터 검색)
    var eocdOffset = -1;
    for (var i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65536); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) throw new Error('ZIP 파일이 아닙니다');

    var cdOffset = view.getUint32(eocdOffset + 16, true);
    var cdCount = view.getUint16(eocdOffset + 10, true);

    // Central Directory 파싱
    var entries = [];
    var offset = cdOffset;

    for (var e = 0; e < cdCount; e++) {
      if (offset + 46 > buffer.byteLength) break;
      if (view.getUint32(offset, true) !== 0x02014b50) break;

      var compressionMethod = view.getUint16(offset + 10, true);
      var compressedSize = view.getUint32(offset + 20, true);
      var fileNameLength = view.getUint16(offset + 28, true);
      var extraLength = view.getUint16(offset + 30, true);
      var commentLength = view.getUint16(offset + 32, true);
      var localHeaderOffset = view.getUint32(offset + 42, true);

      var fileName = new TextDecoder().decode(new Uint8Array(buffer, offset + 46, fileNameLength));

      // Local header에서 실제 데이터 위치 계산
      var localFnLen = view.getUint16(localHeaderOffset + 26, true);
      var localExLen = view.getUint16(localHeaderOffset + 28, true);
      var dataOffset = localHeaderOffset + 30 + localFnLen + localExLen;

      entries.push({
        name: fileName,
        compression: compressionMethod,
        compressedData: new Uint8Array(buffer.slice(dataOffset, dataOffset + compressedSize)),
        data: null,
      });

      offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return entries;
  }

  // DEFLATE 해제 (브라우저 DecompressionStream 사용)
  async function inflate(data) {
    try {
      var ds = new DecompressionStream('deflate-raw');
      var writer = ds.writable.getWriter();
      var reader = ds.readable.getReader();
      writer.write(data);
      writer.close();

      var chunks = [];
      while (true) {
        var result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
      }

      var total = 0;
      chunks.forEach(function (c) { total += c.length; });
      var out = new Uint8Array(total);
      var off = 0;
      chunks.forEach(function (c) { out.set(c, off); off += c.length; });
      return out;
    } catch (e) {
      console.warn('Inflate failed:', e);
      return data; // 실패 시 원본 반환
    }
  }

  // 모든 ZIP 엔트리 압축 해제
  async function decompressEntries(entries) {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry.compression === 0) {
        entry.data = entry.compressedData; // STORE
      } else if (entry.compression === 8) {
        entry.data = await inflate(entry.compressedData); // DEFLATE
      } else {
        entry.data = entry.compressedData; // 기타
      }
    }
    return entries;
  }

  function findEntry(entries, name) {
    return entries.find(function (e) { return e.name === name; });
  }

  function entryText(entry) {
    if (!entry || !entry.data) return '';
    return new TextDecoder().decode(entry.data);
  }

  // ===== XML 파싱 =====
  function parseXml(xmlString) {
    return new DOMParser().parseFromString(xmlString, 'application/xml');
  }

  // Shared Strings 파싱
  function parseSharedStrings(entries) {
    var entry = findEntry(entries, 'xl/sharedStrings.xml');
    if (!entry) return [];
    var doc = parseXml(entryText(entry));
    var strings = [];
    var siNodes = doc.getElementsByTagName('si');
    for (var i = 0; i < siNodes.length; i++) {
      var tNodes = siNodes[i].getElementsByTagName('t');
      var text = '';
      for (var j = 0; j < tNodes.length; j++) {
        text += tNodes[j].textContent || '';
      }
      strings.push(text);
    }
    return strings;
  }

  // 셀 참조 → 열 인덱스 (A=0, B=1, ..., AA=26, ...)
  function colIndex(ref) {
    var col = ref.replace(/\d+/g, '');
    var idx = 0;
    for (var i = 0; i < col.length; i++) {
      idx = idx * 26 + (col.charCodeAt(i) - 64);
    }
    return idx - 1;
  }

  // 워크시트 파싱 → [{header: value, ...}, ...]
  function parseSheet(xmlText, sharedStrings) {
    var doc = parseXml(xmlText);
    var rowNodes = doc.getElementsByTagName('row');
    if (rowNodes.length === 0) return [];

    // 모든 행의 셀 데이터 수집
    var rawRows = [];
    var maxCol = 0;

    for (var ri = 0; ri < rowNodes.length; ri++) {
      var cells = rowNodes[ri].getElementsByTagName('c');
      var rowData = {};
      for (var ci = 0; ci < cells.length; ci++) {
        var cell = cells[ci];
        var ref = cell.getAttribute('r') || '';
        var type = cell.getAttribute('t') || '';
        var vNode = cell.getElementsByTagName('v')[0];
        var isNode = cell.getElementsByTagName('is')[0];
        var value = '';

        if (isNode) {
          // 인라인 문자열
          var tNodes = isNode.getElementsByTagName('t');
          for (var ti = 0; ti < tNodes.length; ti++) value += tNodes[ti].textContent || '';
        } else if (vNode) {
          value = vNode.textContent || '';
          if (type === 's' && sharedStrings[parseInt(value)] !== undefined) {
            value = sharedStrings[parseInt(value)];
          }
        }

        var cIdx = colIndex(ref);
        if (cIdx > maxCol) maxCol = cIdx;
        rowData[cIdx] = value;
      }
      rawRows.push(rowData);
    }

    if (rawRows.length < 1) return [];

    // 첫 행을 헤더로 사용
    var headerRow = rawRows[0];
    var headers = [];
    for (var h = 0; h <= maxCol; h++) {
      headers[h] = String(headerRow[h] || 'Column' + (h + 1)).trim();
    }

    // 데이터 행
    var dataRows = [];
    for (var di = 1; di < rawRows.length; di++) {
      var obj = {};
      var hasValue = false;
      for (var col = 0; col <= maxCol; col++) {
        var val = rawRows[di][col];
        if (val !== undefined && val !== '') {
          obj[headers[col]] = val;
          hasValue = true;
        } else {
          obj[headers[col]] = '';
        }
      }
      if (hasValue) dataRows.push(obj);
    }

    return dataRows;
  }

  // 시트 이름 목록
  function getSheetNames(entries) {
    var wbEntry = findEntry(entries, 'xl/workbook.xml');
    if (!wbEntry) return ['Sheet1'];
    var doc = parseXml(entryText(wbEntry));
    var sheets = doc.getElementsByTagName('sheet');
    var names = [];
    for (var i = 0; i < sheets.length; i++) {
      names.push(sheets[i].getAttribute('name') || 'Sheet' + (i + 1));
    }
    return names;
  }

  // ===== CSV 파싱 =====
  function parseCsvLine(line) {
    var result = [];
    var current = '';
    var inQuote = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"'; i++;
        } else if (ch === '"') {
          inQuote = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === ',') { result.push(current.trim()); current = ''; }
        else { current += ch; }
      }
    }
    result.push(current.trim());
    return result;
  }

  function parseCsv(text) {
    var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];
    var headers = parseCsvLine(lines[0]);
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var values = parseCsvLine(lines[i]);
      var obj = {};
      var hasValue = false;
      headers.forEach(function (h, idx) {
        var v = values[idx] || '';
        obj[h] = v;
        if (v) hasValue = true;
      });
      if (hasValue) rows.push(obj);
    }
    return rows;
  }

  // ===== 공개 API =====

  /**
   * xlsx 파일 읽기
   * @param {ArrayBuffer} buffer - 파일 내용
   * @returns {Promise<{sheets: [{name, rows}]}>}
   */
  async function readXlsx(buffer) {
    var entries = parseZipEntries(buffer);
    await decompressEntries(entries);
    var sharedStrings = parseSharedStrings(entries);
    var sheetNames = getSheetNames(entries);

    var sheets = [];
    for (var i = 0; i < sheetNames.length; i++) {
      var sheetPath = 'xl/worksheets/sheet' + (i + 1) + '.xml';
      var sheetEntry = findEntry(entries, sheetPath);
      if (sheetEntry && sheetEntry.data) {
        var rows = parseSheet(entryText(sheetEntry), sharedStrings);
        if (rows.length > 0) {
          sheets.push({ name: sheetNames[i], rows: rows });
        }
      }
    }
    return { sheets: sheets };
  }

  /**
   * csv 파일 읽기
   * @param {string} text - 파일 내용
   * @param {string} fileName - 파일명
   * @returns {{sheets: [{name, rows}]}}
   */
  function readCsv(text, fileName) {
    var name = (fileName || 'data').replace(/\.[^.]+$/, '');
    var rows = parseCsv(text);
    return { sheets: [{ name: name, rows: rows }] };
  }

  /**
   * 파일 읽기 (xlsx 또는 csv 자동 판별)
   * @param {File} file
   * @returns {Promise<{sheets: [{name, rows}]}>}
   */
  async function readFile(file) {
    var ext = (file.name || '').split('.').pop().toLowerCase();
    if (ext === 'csv') {
      var text = await file.text();
      return readCsv(text, file.name);
    } else {
      var buffer = await file.arrayBuffer();
      return readXlsx(buffer);
    }
  }

  /**
   * 여러 파일 읽고 병합
   * @param {FileList|File[]} files
   * @returns {Promise<{allSheets: [{name, rows, fileName}]}>}
   */
  async function readFiles(files) {
    var allSheets = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var ext = (file.name || '').split('.').pop().toLowerCase();
      if (!['xlsx', 'xls', 'csv'].includes(ext)) continue;
      try {
        var result = await readFile(file);
        result.sheets.forEach(function (sheet) {
          allSheets.push({
            name: sheet.name,
            rows: sheet.rows,
            fileName: file.name,
          });
        });
      } catch (e) {
        console.warn('파일 읽기 실패:', file.name, e);
      }
    }
    return { allSheets: allSheets };
  }

  return {
    readXlsx: readXlsx,
    readCsv: readCsv,
    readFile: readFile,
    readFiles: readFiles,
  };
})();
