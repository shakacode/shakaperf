interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder }: Props) {
  return (
    <label className="search">
      <span className="search__prefix" aria-hidden>
        ▸
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'filter by name, file path, url'}
        spellCheck={false}
      />
    </label>
  );
}
