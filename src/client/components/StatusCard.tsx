import { Activity, AlertTriangle, CheckCircle2, Power, RefreshCw, Wifi } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStatus } from "@/hooks/useStatus";
import { formatDateTime } from "@/lib/utils";

export function StatusCard() {
  const { data, isLoading, isFetching, refetch, isError, error } = useStatus();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center gap-3 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <div>
              <p className="font-medium">No se pudo obtener el estado</p>
              <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { active, routerConnected, routerError, lastSyncAt, settings } = data!;
  const showOffline = !routerConnected;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Activity className="h-5 w-5 text-primary" />
          Estado actual
        </CardTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Actualizar estado"
          className="h-8 w-8"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Estado de la red */}
        <div className="flex flex-col items-center justify-center rounded-lg border bg-muted/30 p-6 text-center">
          {active ? (
            <>
              <div className="relative mb-3">
                <div className="absolute inset-0 animate-pulse-slow rounded-full bg-success/20" />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success">
                  <Wifi className="h-8 w-8" />
                </div>
              </div>
              <Badge variant="success" className="mb-2 px-3 py-1 text-sm">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                Activa
              </Badge>
              <p className="text-sm text-muted-foreground">
                Los invitados pueden conectarse a la red WiFi.
              </p>
            </>
          ) : (
            <>
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <Power className="h-8 w-8" />
              </div>
              <Badge variant="destructive" className="mb-2 px-3 py-1 text-sm">
                <Power className="mr-1 h-3.5 w-3.5" />
                Desactivada
              </Badge>
              <p className="text-sm text-muted-foreground">
                La red WiFi de invitados no está disponible.
              </p>
            </>
          )}
        </div>

        {/* Estado del router + sync */}
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {showOffline ? (
              <Badge variant="destructive" className="gap-1.5">
                <span className="h-2 w-2 rounded-full bg-white" />
                Router desconectado
              </Badge>
            ) : (
              <Badge variant="success" className="gap-1.5">
                <span className="h-2 w-2 rounded-full bg-white" />
                Router conectado
              </Badge>
            )}
            {settings.manualOverride && (
              <Badge variant="warning">Override manual activo</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Última sincronización: <span className="font-medium text-foreground">{formatDateTime(lastSyncAt)}</span>
          </p>
        </div>

        {showOffline && routerError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <p className="font-medium">No se pudo contactar al router</p>
            <p className="text-xs opacity-80">{routerError}</p>
            <p className="mt-1 text-xs opacity-80">
              La aplicación reintentará automáticamente.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
