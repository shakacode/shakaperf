import type { ReactNode } from 'react';

interface Props {
  title: string;
  count: number;
  children: ReactNode;
}

export function Section({ title, count, children }: Props) {
  return (
    <section className="section">
      <div className="section__head">
        <h2>{title}</h2>
        <span className="section__rule" aria-hidden />
        <span className="section__count">
          {count} {count === 1 ? 'test' : 'tests'}
        </span>
      </div>
      {children}
    </section>
  );
}
