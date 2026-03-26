const STYLES = {
  Supermercado:  "bg-finance-purpleSoft text-finance-purple dark:bg-purple-900/40 dark:text-purple-300",
  Transporte:    "bg-finance-tealSoft text-finance-teal dark:bg-teal-900/40 dark:text-teal-300",
  Suscripciones: "bg-finance-coralSoft text-finance-coral dark:bg-orange-900/40 dark:text-orange-300",
  Restaurantes:  "bg-finance-blueSoft text-finance-blue dark:bg-blue-900/40 dark:text-blue-300",
  Servicios:     "bg-finance-amberSoft text-finance-amber dark:bg-amber-900/40 dark:text-amber-300",
  Alquiler:      "bg-finance-greenSoft text-finance-green dark:bg-green-900/40 dark:text-green-300",
  Salud:         "bg-finance-redSoft text-finance-red dark:bg-red-900/40 dark:text-red-300",
  Ingreso:       "bg-finance-greenSoft text-finance-green dark:bg-green-900/40 dark:text-green-300",
  Otros:         "bg-finance-graySoft text-finance-gray dark:bg-neutral-800 dark:text-neutral-400",
};

export default function Badge({ children }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STYLES[children] || STYLES.Otros}`}>
      {children || "Pendiente"}
    </span>
  );
}
