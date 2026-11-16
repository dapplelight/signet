### signet-ui, signet-db, signet-server: data editing

- signet-ui `./domain/csv-import`: `CsvImport`, a CSV import flow (file or paste, RFC 4180 parsing with quotes, escaped quotes, CRLF and BOM, column mapping with auto-match, zod validation per row, errors per cell, import of the valid rows, server errors per row from the import report). Exports `parseCsv`, `toCsv`, `autoMatch` and `validateRows`.
- signet-ui `./components/data-grid`: `DataGrid`, an editable grid on react-table and the Table parts: text, number, select, date and checkbox cells, keyboard navigation with one tab stop, range copy and paste as TSV, row selection, sort and resize, optimistic saves with an error per cell, virtualised rows. Also in the barrel.
- signet-ui `./components/rich-text-editor`: `RichTextEditor`, a contenteditable editor with no editor library (bold, italic, code, links, headings, lists, @mentions stored as signet-db mention tokens), whose value is allowlisted markdown; `RichTextContent` and `richTextToHtml` render it safely. Also in the barrel.
- signet-db `./import`: `bulkInsert(ops, table, rows, { key })`, chunked and idempotent bulk insert through a scope, with a per-row error report.
- signet-server `./http/sanitize`: `sanitizeMarkdown` and `isSafeLinkTarget`, a server-side sanitiser for stored rich text (raw HTML escaped, unsafe link targets removed).
- signet-mcp: an `add-data-editing` recipe.
