export interface LineChartPoint {
  label: string;
  a: number;
  b: number;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function shortDate(label: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (!match) return label;
  const month = MONTHS[Number(match[2]) - 1] ?? match[2];
  return `${month} ${Number(match[3])}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export default function LineChart({
  points,
  labels,
  className,
  compact = false,
}: {
  points: LineChartPoint[];
  labels: [string, string];
  className?: string;
  compact?: boolean;
}) {
  if (points.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded border border-border bg-surface text-sm text-ink-muted ${
          compact ? "h-12" : "h-56"
        }`}
      >
        No data in this range.
      </div>
    );
  }

  const width = 720;
  const height = 200;
  const padTop = 10;
  const padBottom = 12;

  const maxA = Math.max(...points.map((point) => point.a), 1);
  const maxB = Math.max(...points.map((point) => point.b), 1);

  const xAt = (index: number) =>
    points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
  const yAt = (value: number, max: number) =>
    padTop + (1 - value / max) * (height - padTop - padBottom);

  const path = (pick: (point: LineChartPoint) => number, max: number) =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${xAt(index).toFixed(1)},${yAt(
            pick(point),
            max,
          ).toFixed(1)}`,
      )
      .join(" ");

  const pathA = path((point) => point.a, maxA);
  const pathB = path((point) => point.b, maxB);

  const gridLevels = [0, 0.25, 0.5, 0.75, 1];
  const [firstLabel, lastLabel] = [
    points[0]?.label ?? "",
    points[points.length - 1]?.label ?? "",
  ];
  const middleLabel =
    points.length > 7 ? points[Math.floor(points.length / 2)]?.label : null;

  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${labels[0]} and ${labels[1]} from ${shortDate(
          firstLabel,
        )} to ${shortDate(lastLabel)}. Each series is scaled to its own maximum.`}
        className={compact ? "h-12 w-full" : "h-56 w-full"}
      >
        <title>
          {`${labels[0]} and ${labels[1]} from ${shortDate(
            firstLabel,
          )} to ${shortDate(lastLabel)}`}
        </title>

        {gridLevels.map((level) => (
          <line
            key={level}
            x1={0}
            x2={width}
            y1={padTop + level * (height - padTop - padBottom)}
            y2={padTop + level * (height - padTop - padBottom)}
            stroke="var(--border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path
          d={pathB}
          fill="none"
          stroke="var(--ink-faint)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={pathA}
          fill="none"
          stroke="var(--clay)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="mt-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
        <span>{shortDate(firstLabel)}</span>
        {middleLabel ? (
          <span aria-hidden="true">{shortDate(middleLabel)}</span>
        ) : null}
        <span>{shortDate(lastLabel)}</span>
      </div>

      {compact ? null : (
        <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-muted">
          <span className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-0.5 w-4 rounded bg-[var(--clay)]"
              />
              {labels[0]}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-0.5 w-4 rounded bg-[var(--ink-faint)]"
              />
              {labels[1]}
            </span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
            each series scaled to its own max
          </span>
        </figcaption>
      )}

      {compact ? null : (
        <table className="sr-only">
          <caption>
            {`${labels[0]} and ${labels[1]} by date`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">{labels[0]}</th>
              <th scope="col">{labels[1]}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.label}>
                <th scope="row">{point.label}</th>
                <td>{formatNumber(point.a)}</td>
                <td>{formatNumber(point.b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
