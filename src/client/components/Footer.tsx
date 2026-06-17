import { Github } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border/60 pt-6 text-center">
      <p className="text-sm font-medium text-foreground">Hecho por Axel Mrak</p>
      <a
        href="https://github.com/AxelMrak"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <Github className="h-4 w-4" />
        GitHub
      </a>
    </footer>
  );
}
