import { Github } from "lucide-react";

export function Footer() {
  return (
    <footer className="pt-2 text-center">
      <p className="text-[12.5px] text-muted-foreground">
        Hecho por{" "}
        <span className="font-medium text-foreground/90">Axel Mrak</span>
      </p>
      <a
        href="https://github.com/AxelMrak"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Github className="h-3.5 w-3.5" />
        GitHub
      </a>
    </footer>
  );
}
