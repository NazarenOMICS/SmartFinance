const STYLES = {
  Supermercado: "bg-finance-purpleSoft text-finance-purple",
  Transporte: "bg-finance-tealSoft text-finance-teal",
  Suscripciones: "bg-finance-coralSoft text-finance-coral",
  Restaurantes: "bg-finance-blueSoft text-finance-blue",
  Servicios: "bg-finance-amberSoft text-finance-amber",
  Alquiler: "bg-finance-greenSoft text-finance-green",
  Salud: "bg-finance-redSoft text-finance-red",
  Ingreso: "bg-finance-greenSoft text-finance-green",
  Otros: "bg-finance-graySoft text-finance-gray"
};

export default function Badge({ children }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STYLES[children] || STYLES.Otros}`}>
      {children || "Pendiente"}
    </span>
  );
}

