/**
 * Header — Apple 2026
 * Logo: sin fondo, sin wrapper con background. Solo el <img> flotando.
 * Tipografía: SF Display tracking apretado, jerarquía clara.
 */

export function Header() {
  return (
    <header className="flex flex-col items-center text-center pb-7">
      <img
        src="/logo.webp"
        alt="Vertiente"
        width={88}
        height={88}
        className="h-20 w-20 object-contain select-none"
        draggable={false}
      />
      <h1 className="mt-5 text-[1.75rem] font-semibold tracking-[-0.025em] text-foreground leading-tight">
        Red de Invitados
      </h1>
      <p className="mt-1.5 text-[0.95rem] text-muted-foreground max-w-md">
        Activá, desactivá y programá el WiFi para tus clientes.
      </p>
    </header>
  );
}
