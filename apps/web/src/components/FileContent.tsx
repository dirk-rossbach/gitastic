const MAX_RENDERED_LINES = 4000;

export function FileContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const shown = lines.slice(0, MAX_RENDERED_LINES);
  const clipped = lines.length > shown.length;
  return (
    <div className="min-w-max py-2 font-mono text-xs leading-5">
      {shown.map((line, index) => (
        <div key={index} className="flex hover:bg-raised/40">
          <span className="w-14 shrink-0 select-none border-r border-edge/60 px-2 text-right text-faint">
            {index + 1}
          </span>
          <span className="whitespace-pre px-3 text-ink">{line || ' '}</span>
        </div>
      ))}
      {clipped ? (
        <p className="px-3 py-2 text-faint">
          Showing the first {MAX_RENDERED_LINES.toLocaleString()} of {lines.length.toLocaleString()}{' '}
          lines.
        </p>
      ) : null}
    </div>
  );
}
