import { Pause, Play, Power, PowerOff } from "lucide-react";
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Acciones rápidas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Button
            size="lg"
            className="w-full"
            onClick={() => enable.mutate()}
            disabled={enable.isPending || disable.isPending || resume.isPending || routerOffline}
          >
            {enable.isPending ? (
              <Play className="animate-pulse" />
            ) : (
              <Power className="h-4 w-4" />
            )}
            Activar ahora
          </Button>

          <Button
            size="lg"
            variant="destructive"
            className="w-full"
            onClick={() => disable.mutate()}
            disabled={enable.isPending || disable.isPending || resume.isPending || routerOffline}
          >
            {disable.isPending ? (
              <Power className="animate-pulse" />
            ) : (
              <PowerOff className="h-4 w-4" />
            )}
            Desactivar ahora
          </Button>

          <Button
            size="lg"
            variant="outline"
            className="w-full"
            onClick={() => resume.mutate()}
            disabled={
              enable.isPending ||
              disable.isPending ||
              resume.isPending ||
              routerOffline ||
              !isOverride
            }
          >
            {resume.isPending ? (
              <Pause className="animate-pulse" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Reanudar programación
          </Button>
        </div>

        {routerOffline && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Acciones deshabilitadas: el router no responde.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
