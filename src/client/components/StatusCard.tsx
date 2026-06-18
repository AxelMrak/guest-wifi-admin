import { AlertTriangle, Power, RefreshCw, Wifi } from "lucide-react";
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
        <CardContent className="flex items-center justify-center py-16">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-start gap-3 text-destructive">
            <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">No se pudo obtener el estado</p>
              <p className="text-sm text-muted-foreground mt-0.5">{(error as Error).message}</p>
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
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle>Estado</CardTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Actualizar estado"
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Hero: gran indicador de estado */}
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-8 text-center">
          {active ? (
            <>
              <div className="relative mx-auto mb-4 h-20 w-20">
                <div
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle, hsla(142,71%,45%,0.35) 0%, hsla(142,71%,45%,0) 65%)",
                    animation: "pulse-slow 3.5s ease-in-out infinite",
                  }}
                />
                <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-success/15 text-success">
                  <Wifi className="h-9 w-9" strokeWidth={1.75} />
                </div>
              </div>
              <div className="text-[22px] font-semibold tracking-[-0.022em] text-foreground">
                Red activa
              </div>
              <p className="mt-1 text-[13.5px] text-muted-foreground max-w-xs mx-auto leading-relaxed">
                Los clientes pueden conectarse a la red de invitados.
              </p>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Power className="h-9 w-9" strokeWidth={1.75} />
              </div>
              <div className="text-[22px] font-semibold tracking-[-0.022em] text-foreground">
                Red desactivada
              </div>
              <p className="mt-1 text-[13.5px] text-muted-foreground max-w-xs mx-auto leading-relaxed">
                La red WiFi de invitados no está disponible.
              </p>
            </>
          )}
        </div>

        {/* Router status + sync */}
        <div className="flex flex-col gap-2 text-[13px] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Badge
              variant={showOffline ? "destructive" : "success"}
              className="gap-1.5 font-medium"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {showOffline ? "Router desconectado" : "Router conectado"}
            </Badge>
            {settings.manualOverride && (
              <Badge variant="warning" className="font-medium">
                Override manual
              </Badge>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground">
            Sincronizado{" "}
            <span className="text-foreground/80 font-medium">{formatDateTime(lastSyncAt)}</span>
          </p>
        </div>

        {showOffline && routerError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/[0.06] p-3.5 text-[13px] text-destructive">
            <p className="font-medium">No se pudo contactar al router</p>
            <p className="mt-0.5 text-[12px] opacity-80 leading-relaxed">{routerError}</p>
            <p className="mt-1 text-[12px] opacity-80">
              La aplicación reintentará automáticamente.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
