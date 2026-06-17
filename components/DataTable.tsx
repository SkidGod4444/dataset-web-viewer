"use client";

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

export function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
}) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-muted text-left">
            <th className="sticky left-0 z-20 border-b bg-muted px-3 py-2 text-right font-mono text-xs font-normal text-muted-foreground">
              #
            </th>
            {columns.map((col) => (
              <th
                key={col}
                className="border-b border-l px-3 py-2 font-medium whitespace-nowrap text-foreground"
                title={col}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="group hover:bg-muted/50">
              <td className="sticky left-0 z-10 border-b bg-background px-3 py-1.5 text-right font-mono text-xs text-muted-foreground group-hover:bg-muted">
                {i + 1}
              </td>
              {columns.map((col) => {
                const value = row[col];
                return (
                  <td
                    key={col}
                    className="max-w-[28rem] truncate border-b border-l px-3 py-1.5 align-top"
                    title={renderCell(value)}
                  >
                    {isEmpty(value) ? (
                      <span className="text-muted-foreground/50 italic">null</span>
                    ) : (
                      <span className="font-mono text-[13px] text-foreground">
                        {renderCell(value)}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
