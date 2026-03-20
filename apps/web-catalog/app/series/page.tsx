const generateRandomSeries = () =>
  Array.from({ length: 12 }, (_, i) => ({
    author: `著者 ${i + 1}`,
    episodeCount: Math.max(i, 20),
    id: i + 1,
    title: `シリーズ ${i + 1}`,
  }));

export default function SeriesPage() {
  const series = generateRandomSeries();

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="mb-2 font-serif text-4xl font-bold">シリーズ一覧</h1>
      <p className="mb-8 text-muted-foreground">
        Publira に登録されているシリーズをご紹介します
      </p>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {series.map((item) => (
          <a
            key={item.id}
            href={`/series/${item.id}`}
            className="group overflow-hidden rounded-lg border border-border/70 bg-card p-6 shadow-sm transition hover:shadow-md"
          >
            <div className="mb-4 flex h-32 items-center justify-center rounded bg-linear-to-br from-primary/20 to-primary/10 text-primary/40">
              <svg
                className="h-12 w-12"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C6.5 6.253 2 10.998 2 17.25c0 5.25 3.07 9.386 7.007 11.466.665.36 1.296.001 1.296-.951v-.853c0-.552-.224-1.052-.63-1.611-.356-.5-.529-1.23-.529-2.051V6.253m0 0C17.5 6.253 22 10.998 22 17.25c0 5.25-3.07 9.386-7.007 11.466-.665.36-1.296.001-1.296-.951v-.853c0-.552.224-1.052.63-1.611.356-.5.529-1.23.529-2.051V6.253"
                />
              </svg>
            </div>
            <h2 className="mb-1 font-serif text-lg font-semibold group-hover:text-primary">
              {item.title}
            </h2>
            <p className="text-sm text-muted-foreground">{item.author}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              全 {item.episodeCount} 話
            </p>
          </a>
        ))}
      </div>
    </main>
  );
}
