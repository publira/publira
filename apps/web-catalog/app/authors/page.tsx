const generateRandomAuthors = () =>
  Array.from({ length: 12 }, (_, i) => ({
    description: "静かに読む、持続可能に出版する",
    id: i + 1,
    name: `著者 ${i + 1}`,
  }));

export default function AuthorsPage() {
  const authors = generateRandomAuthors();

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="mb-2 font-serif text-4xl font-bold">著者一覧</h1>
      <p className="mb-8 text-muted-foreground">
        Publira に登録されている著者をご紹介します
      </p>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {authors.map((author) => (
          <a
            key={author.id}
            href={`/authors/${author.id}`}
            className="group overflow-hidden rounded-lg border border-border/70 bg-card p-6 shadow-sm transition hover:shadow-md"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-primary">
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
            <h2 className="mb-1 font-serif text-lg font-semibold group-hover:text-primary">
              {author.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {author.description}
            </p>
          </a>
        ))}
      </div>
    </main>
  );
}
