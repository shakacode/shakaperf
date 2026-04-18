interface Props {
  errors: string[];
}

export function ErrorBanner({ errors }: Props) {
  if (errors.length === 0) return null;
  return (
    <div className="error-banner" role="alert">
      <div className="error-banner__title">
        {errors.length === 1 ? 'engine error' : `${errors.length} engine errors`}
      </div>
      <ul className="error-banner__list">
        {errors.map((message, idx) => (
          <li key={idx}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
