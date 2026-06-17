import { Wifi } from "lucide-react";

export function Header() {
  return (
    <header className="flex flex-col items-center text-center pb-6 border-b border-border/60">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
          <img
            src="/logo.png"
            alt="Logo"
            className="h-10 w-10 rounded-md object-contain"
            onError={(e) => {
              // Fallback al ícono si el logo no carga
              (e.currentTarget as HTMLImageElement).style.display = "none";
              const parent = (e.currentTarget as HTMLImageElement).parentElement;
              if (parent && !parent.querySelector(".fallback-icon")) {
                const icon = document.createElement("div");
                icon.className = "fallback-icon";
                icon.innerHTML = "📶";
                icon.style.fontSize = "1.5rem";
                parent.appendChild(icon);
              }
            }}
          />
          <Wifi className="hidden fallback-icon" />
        </div>
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        Administrador de Red de Invitados
      </h1>
      <p className="mt-2 text-sm text-muted-foreground sm:text-base">
        Control y programación de acceso WiFi para clientes.
      </p>
    </header>
  );
}
