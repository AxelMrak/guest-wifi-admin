import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Save } from "lucide-react";
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
        <CardContent className="py-12 text-center text-[13px] text-muted-foreground">
          Cargando configuración…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>Programación</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Master toggle */}
          <div className="flex items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
            <div className="space-y-0.5">
              <Label
                htmlFor="scheduleEnabled"
                className="text-[15px] font-medium text-foreground"
              >
                Activar programación
              </Label>
              <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                Encendido y apagado automático por horario.
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

          <div
            className={`space-y-5 transition-all duration-300 ${
              scheduleEnabled ? "opacity-100" : "pointer-events-none opacity-40"
            }`}
          >
            {/* Times */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="startTime"
                  className="text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Desde
                </Label>
                <Controller
                  name="startTime"
                  control={control}
                  render={({ field }) => (
                    <Input
                      id="startTime"
                      type="time"
                      {...field}
                      className="h-11 rounded-xl border-white/10 bg-white/[0.03] text-[15px] tabular-nums focus-apple"
                    />
                  )}
                />
                {errors.startTime && (
                  <p className="text-[11.5px] text-destructive">{errors.startTime.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="endTime"
                  className="text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Hasta
                </Label>
                <Controller
                  name="endTime"
                  control={control}
                  render={({ field }) => (
                    <Input
                      id="endTime"
                      type="time"
                      {...field}
                      className="h-11 rounded-xl border-white/10 bg-white/[0.03] text-[15px] tabular-nums focus-apple"
                    />
                  )}
                />
                {errors.endTime && (
                  <p className="text-[11.5px] text-destructive">{errors.endTime.message}</p>
                )}
              </div>
            </div>

            {/* Days */}
            <div className="space-y-2">
              <Label className="text-[12.5px] font-medium uppercase tracking-wider text-muted-foreground">
                Días
              </Label>
              <Controller
                name="days"
                control={control}
                render={({ field }) => (
                  <div className="grid grid-cols-7 gap-1.5">
                    {WEEK_DAYS.map((day) => {
                      const checked = field.value.includes(day.value);
                      return (
                        <label
                          key={day.value}
                          className={`flex flex-col items-center gap-1.5 rounded-xl border py-2.5 cursor-pointer transition-all active:scale-95 ${
                            checked
                              ? "border-primary/60 bg-primary/[0.12] text-foreground"
                              : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:bg-white/[0.05]"
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
                            className="sr-only"
                          />
                          <span className="text-[13px] font-semibold tracking-tight">
                            {day.short}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              />
              {errors.days && (
                <p className="text-[11.5px] text-destructive">{errors.days.message}</p>
              )}
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            disabled={!isDirty || update.isPending}
            className="h-12 w-full rounded-xl bg-primary text-[15px] font-medium text-primary-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.16)_inset,0_8px_24px_-8px_hsl(211,100%,50%)] hover:bg-primary/90 disabled:opacity-40 disabled:shadow-none active:scale-[0.99] transition-all"
          >
            <Save className="h-4 w-4" strokeWidth={2.25} />
            Guardar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
