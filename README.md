# Administrador de Red de Invitados

Aplicación web moderna para administrar la red WiFi de invitados de un router TOTOLINK mediante la API UBUS.

## Stack

- **Runtime**: Bun
- **Backend**: Hono + TypeScript
- **Frontend**: React 19 + TypeScript + Vite
- **Estilos**: TailwindCSS + shadcn/ui
- **Estado servidor**: TanStack Query (React Query)
- **Formularios**: React Hook Form + Zod
- **Iconos**: Lucide React
- **Toasts**: Sonner

## Características

- Ver estado actual de la red de invitados en tiempo real
- Activar / desactivar la red manualmente
- Reanudar la programación automática tras intervención manual
- Configurar horarios y días de operación
- Renovación automática de sesión con el router
- Sincronización inicial al arrancar
- Scheduler automático en el backend (vive independiente de la UI)
- Polling automático cada 30 segundos
- Indicador de estado de conexión con el router

## Requisitos

- [Bun](https://bun.sh/) >= 1.1
- Router TOTOLINK accesible desde la red local

## Instalación

```bash
bun install
cp .env.example .env
# Editar .env con las credenciales reales del router
```

## Uso

### Desarrollo

```bash
bun run dev
```

Inicia backend (`:3001`) y frontend Vite (`:5173`) en paralelo.

### Producción

```bash
bun run build   # compila el frontend
bun run start   # inicia el servidor (permanece activo)
```

El servidor de producción sirve la API y los archivos estáticos compilados en un único puerto (3001 por defecto).

### Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `ROUTER_URL` | URL del endpoint UBUS del router | `http://192.168.0.1/ubus` |
| `ROUTER_USERNAME` | Usuario del router | `useradmin` |
| `ROUTER_PASSWORD` | Contraseña del router | — |
| `SERVER_PORT` | Puerto del servidor backend | `3001` |

## Estructura

```
src/
├── server/                # Backend (Hono + Bun)
│   ├── index.ts           # Bootstrap (scheduler + server)
│   ├── routes/            # Endpoints REST
│   ├── services/          # Lógica de negocio
│   └── types.ts
├── client/                # Frontend (React + Vite)
│   ├── components/        # Componentes UI
│   ├── hooks/             # React Query hooks
│   ├── lib/               # Utilidades + API client
│   ├── pages/             # Páginas
│   └── types/
└── shared/                # Tipos compartidos
data/
└── settings.json          # Persistencia de configuración
public/
└── logo.png               # Logo de la empresa
```

## API

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET`  | `/api/status` | Estado actual de la red + estado del router |
| `GET`  | `/api/settings` | Configuración persistida |
| `PUT`  | `/api/settings` | Actualizar configuración |
| `POST` | `/api/guest/enable` | Activar red manualmente |
| `POST` | `/api/guest/disable` | Desactivar red manualmente |
| `POST` | `/api/guest/resume` | Reanudar la programación automática |

## Scheduler

El scheduler se ejecuta cada minuto en el backend. Evalúa:

1. Si la programación automática está habilitada.
2. Si hoy está dentro de los días configurados.
3. Si la hora actual está dentro del rango configurado.
4. Si hay override manual activo.

Solo envía comandos al router cuando el estado deseado difiere del estado actual, evitando llamadas innecesarias.

Al arrancar, el servidor evalúa el horario inmediatamente y aplica cualquier corrección necesaria antes de iniciar el ciclo periódico.

## Hecho por

Axel Mrak — [GitHub](https://github.com/AxelMrak)
