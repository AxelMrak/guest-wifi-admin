import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Calendar, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { WEEK_DAYS, type UpdateSettingsPayload } from "@shared/types";

const FormSchema = z
  .object({
    scheduleEnabled: z.boolean(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida"),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida"),
    days: z.array(z.number()).min(1, "Seleccioná al menos un día"),
  })
  .refine((data) => data.startTime !== data.endTime, {
    message: "La hora de inicio y fin no pueden ser iguales",
    path: ["endTime"],
  });

type FormValues = z.infer<typeof FormSchema>;

export function ScheduleCard() {
  const { data: settings, isLoading } = useSettings();
  const update = useUpdateSettings();

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      scheduleEnabled: false,
      startTime: "08:00",
      endTime: "22:00",
      days: [1, 2, 3, 4, 5, 6, 0],
    },
  });

  // Sincronizar form con settings cuando llegan del backend.
  useEffect(() => {
    if (settings) {
      reset({
        scheduleEnabled: settings.scheduleEnabled,
        startTime: settings.startTime,
        endTime: settings.endTime,
        days: settings.days,
      });
    }
  }, [settings, reset]);

  const scheduleEnabled = watch("scheduleEnabled");

  const onSubmit = (values: FormValues) => {
    const payload: UpdateSettingsPayload = values;
    update.mutate(payload, {
      onSuccess: () => {
        toast.success("Configuración guardada", {
          description: values.scheduleEnabled
            ? "La programación automática está activa."
            : "La programación automática está desactivada.",
        });
        reset(values, { keepValues: true });
      },
      onError: (err: Error) => {
        toast.error("No se pudo guardar", { description: err.message });
      },
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Cargando configuración...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Calendar className="h-5 w-5 text-primary" />
          Programación automática
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Switch principal */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
            <div className="space-y-0.5">
              <Label htmlFor="scheduleEnabled" className="text-base">
                Habilitar programación
              </Label>
              <p className="text-sm text-muted-foreground">
                Activa y desactiva la red automáticamente según el horario.
              </p>
            </div>
            <Controller
              name="scheduleEnabled"
              control={control}
              render={({ field }) => (
                <Switch
                  id="scheduleEnabled"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>

          {/* Horario + días */}
          <div
            className={`space-y-5 transition-opacity ${
              scheduleEnabled ? "opacity-100" : "pointer-events-none opacity-50"
            }`}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startTime">Hora de inicio</Label>
                <Controller
                  name="startTime"
                  control={control}
                  render={({ field }) => (
                    <Input id="startTime" type="time" {...field} />
                  )}
                />
                {errors.startTime && (
                  <p className="text-xs text-destructive">{errors.startTime.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">Hora de finalización</Label>
                <Controller
                  name="endTime"
                  control={control}
                  render={({ field }) => (
                    <Input id="endTime" type="time" {...field} />
                  )}
                />
                {errors.endTime && (
                  <p className="text-xs text-destructive">{errors.endTime.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Días de la semana</Label>
              <Controller
                name="days"
                control={control}
                render={({ field }) => (
                  <div className="grid grid-cols-7 gap-2">
                    {WEEK_DAYS.map((day) => {
                      const checked = field.value.includes(day.value);
                      return (
                        <label
                          key={day.value}
                          className={`flex flex-col items-center gap-1.5 rounded-md border p-2 cursor-pointer transition-colors hover:bg-accent/10 ${
                            checked
                              ? "border-primary bg-primary/5"
                              : "border-border bg-background"
                          }`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => {
                              if (c) {
                                field.onChange([...field.value, day.value]);
                              } else {
                                field.onChange(field.value.filter((d) => d !== day.value));
                              }
                            }}
                            aria-label={day.label}
                          />
                          <span className="text-xs font-medium">{day.short}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              />
              {errors.days && (
                <p className="text-xs text-destructive">{errors.days.message}</p>
              )}
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!isDirty || update.isPending}
          >
            {update.isPending ? (
              <Save className="animate-pulse" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Guardar configuración
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
