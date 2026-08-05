import { Download } from 'lucide-react';

/** Escapes a value for CSV: wraps in quotes if it contains a comma, quote, or newline. */
function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Downloads `rows` (array of flat objects) as a CSV file. Columns are taken
 * from the keys of the first row, in order.
 * @param {{rows: Array<object>, filename: string, label?: string}} props
 */
export default function ExportButton({ rows, filename, label = 'Export CSV' }) {
  function handleExport() {
    if (!rows || rows.length === 0) return;
    const columns = Object.keys(rows[0]);
    const lines = [
      columns.join(','),
      ...rows.map((row) => columns.map((col) => csvEscape(row[col])).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={!rows || rows.length === 0}
      className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Download className="h-4 w-4" />
      {label}
    </button>
  );
}
