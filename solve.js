// Fast CSV Reader — a faster drop-in for make.fun's csv-reader 1.0.0.
//
// run(input) returns exactly csv-reader 1.0.0's answer {columns, rows, errors}
// for an input {text, header}. Same broken-row policy, same error records,
// same order — only the scanning is faster:
//
//   - a clean physical line (no quote, no CR) is split in one native call;
//   - unquoted fields jump to the next comma or line break with indexOf,
//     and a CR inside the field is found on the slice (a stray CR is
//     dropped, a CRLF ends the field);
//   - quoted fields jump quote to quote with indexOf, slicing segments
//     instead of copying one character at a time;
//   - line breaks inside quotes are counted and CRs normalised with
//     native regexes, only when the segment holds one;
//   - no object is allocated per field: the readers write the field's
//     value, ending and kept-character count into shared slots.
//
// No dependencies, no state kept from one call to the next.

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0; // a U+FEFF at the very start is dropped
  let line = 1; // the line the next character is on

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and the characters kept by the readUnquoted call
  // that read it (for quote_junk). Written by readUnquoted/readQuoted, read by the record loop.
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Sets fValue, fEnded and fAdded (the characters kept in this call).
  function readUnquoted(value) {
    let added = 0;
    while (pos < len) {
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      let end = len;
      let kind = END;
      if (comma !== -1 && (lf === -1 || comma < lf)) {
        end = comma;
        kind = COMMA;
      } else if (lf !== -1) {
        end = lf;
        kind = LINE_BREAK;
      }
      const seg = text.slice(pos, end);
      const cr = seg.indexOf('\r');
      if (cr === -1) {
        if (end > pos) {
          value += seg;
          added += seg.length;
        }
        if (kind === COMMA) pos = end + 1;
        else if (kind === LINE_BREAK) {
          pos = end + 1;
          line += 1;
        } else {
          pos = len;
        }
        fValue = value;
        fEnded = kind;
        fAdded = added;
        return;
      }
      if (kind === LINE_BREAK && cr === seg.length - 1) {
        // The CR is the first half of the CRLF that ends the field.
        if (cr > 0) {
          value += seg.slice(0, cr);
          added += cr;
        }
        pos = pos + cr + 2;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = added;
        return;
      }
      // A stray CR: dropped (stray_cr), the field goes on.
      if (cr > 0) {
        value += seg.slice(0, cr);
        added += cr;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = pos + cr + 1;
    }
    fValue = value;
    fEnded = END;
    fAdded = added;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue, fEnded and fAdded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    while (pos < len) {
      const q = text.indexOf('"', pos);
      if (q === -1) break;
      if (q > pos) {
        let seg = text.slice(pos, q);
        if (seg.indexOf('\r') !== -1 || seg.indexOf('\n') !== -1) {
          // Each CRLF or lone CR inside quotes is one LF, and counts one line.
          const breaks = seg.match(/\r\n|\r|\n/g);
          if (breaks) line += breaks.length;
          if (seg.indexOf('\r') !== -1) seg = seg.replace(/\r\n?/g, '\n');
        }
        value += seg;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote inside the field is one quote.
        value += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1;
      closed = true;
      break;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted('"');
      return;
    }
    if (pos >= len) {
      fValue = value;
      fEnded = END;
      fAdded = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = value;
      fEnded = COMMA;
      fAdded = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = LINE_BREAK;
      fAdded = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = LINE_BREAK;
      fAdded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    let fields = null;
    let lastQuoted = false;

    // Fast path: one physical line with no quote and no CR is one whole
    // record, split in a single native call.
    const lf = text.indexOf('\n', pos);
    const lineEnd = lf === -1 ? len : lf;
    let seg = text.slice(pos, lineEnd);
    if (lf !== -1 && seg.charCodeAt(seg.length - 1) === 13) seg = seg.slice(0, -1); // a CRLF line break
    if (seg.length > 0 && seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      fields = seg.split(',');
      pos = lf === -1 ? len : lf + 1;
      line += 1;
    }

    if (fields === null) {
      fields = [];
      do {
        const quoted = text.charCodeAt(pos) === 34;
        lastQuoted = quoted;
        if (quoted) readQuoted();
        else readUnquoted('');
        fields.push(fValue);
      } while (fEnded === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
