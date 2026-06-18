import { Play, Power, PowerOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useEnableGuest,
  useDisableGuest,
  useResumeGuest,
} from "@/hooks/useGuestActions";
import { useStatus } from "@/hooks/useStatus";

export function QuickActions() {
  const { data } = useStatus();
  const enable = useEnableGuest();
  const disable = useDisableGuest();
  const resume = useResumeGuest();

  const routerOffline = data ? !data.routerConnected : false;
  const isOverride = data?.settings.manualOverride ?? false;
  const busy = enable.isPending || disable.isPending || resume.isPending;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>Acciones rápidas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Button
            size="lg"
            onClick={() => enable.mutate()}
            disabled={busy || routerOffline}
            className="h-12 rounded-xl bg-primary text-[15px] font-medium text-primary-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.16)_inset,0_8px_24px_-8px_hsl(211,100%,50%)] hover:bg-primary/90 active:scale-[0.98] transition-all"
          >
            <Power className="h-4 w-4" strokeWidth={2.25} />
            Activar
          </Button>

          <Button
            size="lg"
            variant="destructive"
            onClick={() => disable.mutate()}
            disabled={busy || routerOffline}
            className="h-12 rounded-xl bg-destructive/90 text-[15px] font-medium shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset,0_8px_24px_-8px_hsl(0,72%,51%)] hover:bg-destructive active:scale-[0.98] transition-all"
          >
            <PowerOff className="h-4 w-4" strokeWidth={2.25} />
            Desactivar
          </Button>

          <Button
            size="lg"
            variant="outline"
            onClick={() => resume.mutate()}
            disabled={busy || routerOffline || !isOverride}
            className="h-12 rounded-xl border-white/10 bg-white/[0.04] text-[15px] font-medium text-foreground hover:bg-white/[0.08] active:scale-[0.98] transition-all"
          >
            <Play className="h-4 w-4" strokeWidth={2.25} />
            Reanudar
          </Button>
        </div>

        {routerOffline && (
          <p className="mt-3.5 text-center text-[12px] text-muted-foreground">
            Acciones deshabilitadas — el router no responde.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
