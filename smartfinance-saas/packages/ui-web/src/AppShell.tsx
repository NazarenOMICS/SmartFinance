import type { ReactNode } from "react";

type StatusCard = {
  label: string;
  value: string;
  hint?: string;
};

export function AppShell(props: {
  title: string;
  subtitle: string;
  cards: StatusCard[];
  children?: ReactNode;
}) {
  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">SmartFinance SaaS Foundation</p>
        <h1>{props.title}</h1>
        <p className="subtitle">{props.subtitle}</p>
      </header>

      <section className="card-grid">
        {props.cards.map((card) => (
          <article key={card.label} className="status-card">
            <p className="status-label">{card.label}</p>
            <h2>{card.value}</h2>
            {card.hint ? <p className="status-hint">{card.hint}</p> : null}
          </article>
        ))}
      </section>

      <section className="content-panel">{props.children}</section>
    </div>
  );
}
