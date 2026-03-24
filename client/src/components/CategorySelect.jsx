export default function CategorySelect({ categories, value, onChange }) {
  return (
    <select
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-finance-ink shadow-sm outline-none focus:border-finance-purple"
    >
      <option value="">Asignar categoría</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </select>
  );
}

