export function Ribbon() {
  const path =
    'M-160 235 C95 255 190 -40 410 55 S745 225 891 156 S1110 -16 1360 55 S1550 164 1650 105';
  return (
    <svg className="ribbon" viewBox="0 0 1440 290" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="silk">
          <stop stopColor="#b9d7df" />
          <stop offset=".29" stopColor="#9bbcd7" />
          <stop offset=".56" stopColor="#5f93b7" />
          <stop offset=".76" stopColor="#82b5c9" />
          <stop offset="1" stopColor="#ced6ec" />
        </linearGradient>
      </defs>
      {Array.from({ length: 80 }, (_, i) => (
        <path
          key={i}
          d={path}
          transform={`translate(${i * 0.72} ${i * 0.72 - 23})`}
          fill="none"
          stroke="url(#silk)"
          strokeWidth={2}
          opacity={0.08 + 0.53 * Math.sin((i / 80) * Math.PI) ** 1.5}
        />
      ))}
      {[7, 17, 35, 62, 77].map((i) => (
        <path
          key={i}
          d={path}
          transform={`translate(${i * 0.72} ${i * 0.72 - 23})`}
          fill="none"
          stroke="white"
          strokeWidth=".9"
          opacity=".65"
        />
      ))}
    </svg>
  );
}
