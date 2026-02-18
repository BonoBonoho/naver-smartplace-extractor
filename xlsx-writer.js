/**
 * xlsx-writer.js — 외부 라이브러리 없이 다중 시트 xlsx 파일 생성
 * ZIP(STORE) + OOXML 구현
 */
var XlsxWriter = (function () {
  'use strict';

  // ===== CRC-32 테이블 =====
  var crcTable = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    return table;
  })();

  function crc32(buf) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ===== 바이너리 유틸 =====
  function strToU8(str) {
    // TextEncoder 사용 (UTF-8)
    return new TextEncoder().encode(str);
  }

  function u16LE(val) { return [val & 0xFF, (val >> 8) & 0xFF]; }
  function u32LE(val) { return [val & 0xFF, (val >> 8) & 0xFF, (val >> 16) & 0xFF, (val >> 24) & 0xFF]; }

  function concatArrays(arrays) {
    var totalLen = 0;
    arrays.forEach(function (a) { totalLen += a.length; });
    var result = new Uint8Array(totalLen);
    var offset = 0;
    arrays.forEach(function (a) {
      result.set(a, offset);
      offset += a.length;
    });
    return result;
  }

  // ===== ZIP (STORE 방식, 비압축) =====
  function createZip(files) {
    // files: [{name: 'path/file.xml', data: Uint8Array}]
    var localHeaders = [];
    var centralHeaders = [];
    var offset = 0;

    files.forEach(function (file) {
      var nameBytes = strToU8(file.name);
      var data = file.data;
      var crc = crc32(data);
      var size = data.length;

      // DOS 날짜/시간
      var now = new Date();
      var dosTime = ((now.getHours() & 0x1F) << 11) | ((now.getMinutes() & 0x3F) << 5) | ((now.getSeconds() >> 1) & 0x1F);
      var dosDate = (((now.getFullYear() - 1980) & 0x7F) << 9) | (((now.getMonth() + 1) & 0x0F) << 5) | (now.getDate() & 0x1F);

      // Local file header
      var local = new Uint8Array([
        0x50, 0x4B, 0x03, 0x04,   // signature
        0x14, 0x00,                 // version needed (2.0)
        0x00, 0x00,                 // general purpose bit flag
        0x00, 0x00,                 // compression method: STORE
        ...u16LE(dosTime),          // last mod time
        ...u16LE(dosDate),          // last mod date
        ...u32LE(crc),              // crc-32
        ...u32LE(size),             // compressed size
        ...u32LE(size),             // uncompressed size
        ...u16LE(nameBytes.length), // file name length
        0x00, 0x00,                 // extra field length
      ]);

      var localEntry = concatArrays([local, nameBytes, data]);
      localHeaders.push(localEntry);

      // Central directory header
      var central = new Uint8Array([
        0x50, 0x4B, 0x01, 0x02,    // signature
        0x14, 0x00,                  // version made by
        0x14, 0x00,                  // version needed
        0x00, 0x00,                  // flags
        0x00, 0x00,                  // compression: STORE
        ...u16LE(dosTime),
        ...u16LE(dosDate),
        ...u32LE(crc),
        ...u32LE(size),
        ...u32LE(size),
        ...u16LE(nameBytes.length),
        0x00, 0x00,                  // extra field length
        0x00, 0x00,                  // file comment length
        0x00, 0x00,                  // disk number start
        0x00, 0x00,                  // internal file attributes
        0x00, 0x00, 0x00, 0x00,      // external file attributes
        ...u32LE(offset),            // relative offset of local header
      ]);

      centralHeaders.push(concatArrays([central, nameBytes]));
      offset += localEntry.length;
    });

    var centralDirOffset = offset;
    var centralDirSize = 0;
    centralHeaders.forEach(function (h) { centralDirSize += h.length; });

    // End of central directory
    var eocd = new Uint8Array([
      0x50, 0x4B, 0x05, 0x06,       // signature
      0x00, 0x00,                     // disk number
      0x00, 0x00,                     // disk with central dir
      ...u16LE(files.length),         // entries on this disk
      ...u16LE(files.length),         // total entries
      ...u32LE(centralDirSize),       // size of central dir
      ...u32LE(centralDirOffset),     // offset of central dir
      0x00, 0x00,                     // comment length
    ]);

    return concatArrays([].concat(localHeaders, centralHeaders, [eocd]));
  }

  // ===== XML 이스케이프 =====
  function escXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ===== 시트 XML 생성 =====
  function colLetter(index) {
    var s = '';
    var n = index;
    while (n >= 0) {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  }

  function sheetXml(rows, headers) {
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    xml += ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';

    // 열 너비 설정
    xml += '<cols>';
    headers.forEach(function (h, i) {
      var w = Math.max(h.length * 2.5, 12);
      xml += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    });
    xml += '</cols>';

    xml += '<sheetData>';

    // 헤더 행
    xml += '<row r="1">';
    headers.forEach(function (h, ci) {
      var ref = colLetter(ci) + '1';
      xml += '<c r="' + ref + '" t="inlineStr"><is><t>' + escXml(h) + '</t></is></c>';
    });
    xml += '</row>';

    // 데이터 행
    rows.forEach(function (row, ri) {
      var rowNum = ri + 2;
      xml += '<row r="' + rowNum + '">';
      headers.forEach(function (h, ci) {
        var ref = colLetter(ci) + rowNum;
        var val = row[h];
        if (val == null) val = '';
        var strVal = String(val);
        var numVal = parseFloat(strVal.replace(/[,%]/g, ''));
        // 숫자인 경우 숫자로 저장
        if (!isNaN(numVal) && strVal.replace(/[,%\s]/g, '') === String(numVal)) {
          xml += '<c r="' + ref + '"><v>' + numVal + '</v></c>';
        } else {
          xml += '<c r="' + ref + '" t="inlineStr"><is><t>' + escXml(strVal) + '</t></is></c>';
        }
      });
      xml += '</row>';
    });

    xml += '</sheetData></worksheet>';
    return xml;
  }

  // ===== 워크북 생성 =====
  function buildXlsx(sheets) {
    // sheets: [{name: '시트이름', rows: [...], headers: [...]}]
    if (!sheets || sheets.length === 0) return null;

    var files = [];

    // [Content_Types].xml
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    contentTypes += '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';
    contentTypes += '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>';
    contentTypes += '<Default Extension="xml" ContentType="application/xml"/>';
    contentTypes += '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
    sheets.forEach(function (_, i) {
      contentTypes += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    });
    contentTypes += '</Types>';
    files.push({ name: '[Content_Types].xml', data: strToU8(contentTypes) });

    // _rels/.rels
    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    rootRels += '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    rootRels += '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>';
    rootRels += '</Relationships>';
    files.push({ name: '_rels/.rels', data: strToU8(rootRels) });

    // xl/workbook.xml
    var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    workbook += '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    workbook += ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    workbook += '<sheets>';
    sheets.forEach(function (s, i) {
      workbook += '<sheet name="' + escXml(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    });
    workbook += '</sheets></workbook>';
    files.push({ name: 'xl/workbook.xml', data: strToU8(workbook) });

    // xl/_rels/workbook.xml.rels
    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    wbRels += '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    sheets.forEach(function (_, i) {
      wbRels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    });
    wbRels += '</Relationships>';
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: strToU8(wbRels) });

    // xl/worksheets/sheetN.xml
    sheets.forEach(function (s, i) {
      var xml = sheetXml(s.rows, s.headers);
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: strToU8(xml) });
    });

    return createZip(files);
  }

  // ===== 공개 API =====
  function getAllHeaders(rows) {
    var keys = [];
    var seen = {};
    rows.forEach(function (r) {
      Object.keys(r || {}).forEach(function (k) {
        if (!seen[k]) { seen[k] = true; keys.push(k); }
      });
    });
    return keys;
  }

  /**
   * @param {Array} sheets - [{name: '시트명', rows: [{col:val,...},...]}]
   * @param {string} filename - 파일명 (예: '통계.xlsx')
   */
  function saveXlsx(sheets, filename) {
    var validSheets = sheets.filter(function (s) { return s.rows && s.rows.length > 0; });
    if (validSheets.length === 0) {
      alert('내보낼 데이터가 없습니다.');
      return;
    }

    var prepared = validSheets.map(function (s) {
      return {
        name: s.name.substring(0, 31), // 시트명 최대 31자
        rows: s.rows,
        headers: s.headers || getAllHeaders(s.rows),
      };
    });

    var zipData = buildXlsx(prepared);
    if (!zipData) return;

    var blob = new Blob([zipData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'export.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  return { saveXlsx: saveXlsx };
})();
