# TRAMA. — Blindaje del admin · Guía de despliegue

Objetivo: sacar la `service_role` key (y la contraseña) del navegador, sin
romper el panel ni el resto del sitio. Seguí el orden EXACTO. Cada paso deja
el sitio funcionando; nunca quedás sin acceso en el medio.

---

## Archivos de este entregable

| Archivo | Dónde va | Qué hace |
|---|---|---|
| `admin.html` | reemplaza tu `admin.html` actual | Panel sin ninguna key adentro. Llama a `/api/admin`. |
| `admin-api.js` | subir como `api/admin.js` | Backend: valida la contraseña y opera con service_role del lado servidor. |
| `blindaje_creators_rls.sql` | correr en Supabase SQL Editor | Cierra la escritura anónima sobre `creators`. |

---

## PASO 0 — Env vars en Vercel (antes de subir nada)

En Vercel → tu proyecto → Settings → Environment Variables, asegurate de tener:

| Variable | Valor |
|---|---|
| `ADMIN_PASS` | una contraseña nueva, larga y difícil (NO "trama2025"). Ej: 24+ caracteres al azar. |
| `SUPABASE_URL` | `https://mcpmabvxmdepastmpzbi.supabase.co` |
| `SUPABASE_SERVICE_KEY` | la service_role key |
| `SITE_URL` | `https://tramapunto-web.vercel.app` (o tu dominio final) |

> **Sobre la service_role key:** en este mismo momento, en Supabase →
> Settings → API, tenés la opción de **regenerarla (Roll)**. Como la key vieja
> estuvo dentro de un archivo HTML público, lo correcto es rolearla y pegar la
> NUEVA acá. Si rolean, acordate de actualizar también la env var
> `SUPABASE_SERVICE_KEY` que ya usa `mp-webhook.js` — es la misma variable, así
> que con cambiarla una vez alcanza para los dos. La decisión es tuya; el
> archivo funciona con cualquiera de las dos, pero solo la rotación cierra
> de verdad la exposición.

Guardá y hacé un redeploy para que las env vars queden activas.

---

## PASO 1 — Subir el backend (todavía no rompe nada)

Subí `api/admin.js` a tu repo (carpeta `/api`). Deployá.

En este punto conviven los dos mundos: el `admin.html` viejo (con la key)
sigue funcionando, y el backend nuevo ya está disponible. Nada se rompió.

Probá que el backend responde: no hace falta nada especial, el siguiente paso
lo prueba de punta a punta.

---

## PASO 2 — Reemplazar el admin.html

Reemplazá tu `admin.html` por el de este entregable. Deployá.

Entrá al panel:
- Debería pedirte SOLO contraseña (ya no usuario).
- Poné la `ADMIN_PASS` que definiste en el Paso 0.
- Si entrás y ves la lista de creators → **el circuito nuevo funciona.**
- Probá aprobar/rechazar un creator de prueba y ver que llega el email.

Si algo falla acá, tenés el panel viejo en el historial de deploys de Vercel
para volver atrás en un click. Pero no debería fallar.

---

## PASO 3 — Cerrar la puerta vieja (RLS)

Recién cuando el panel nuevo funcione, corré `blindaje_creators_rls.sql` en
el SQL Editor de Supabase.

**Antes de correr la Sección 1**, ejecutá esto y guardá el resultado:

```sql
select policyname, cmd, roles from pg_policies where tablename = 'creators';
```

Eso te lista las policies actuales. Si ves alguna de UPDATE o DELETE abierta a
`anon` o `public`, esas son las que hay que borrar (descomentá los `drop
policy` de la Sección 1 y ajustá los nombres a los reales).

**Corré Secciones 1 y 2** (cierran el agujero crítico). La **Sección 3** (vista
pública sin contactos) es opcional ahora: si la corrés, después hay que
cambiar `index.html` para leer de `creators_publicos` en vez de `creators`.
Si no querés tocar el front hoy, dejá la Sección 3 comentada.

---

## PASO 4 — Verificación final

- [ ] Abrí `admin.html`, F12 → Sources → buscá "eyJ". **No debe aparecer
      ninguna key.** (Ya viene limpio, es para tu tranquilidad.)
- [ ] El panel pide contraseña y entra con la nueva `ADMIN_PASS`.
- [ ] Aprobar/rechazar funciona y manda email.
- [ ] La bolsa pública (`index.html`) sigue mostrando creators.
- [ ] El pago con MercadoPago sigue registrando conexiones (probá un pago test
      o revisá que `mp-webhook.js` tenga la env var correcta si roleaste).

---

## Qué NO cambió (y está bien así)

- `crear-preferencia.js`, `mp-webhook.js`, `email-api.js`: ya usaban env vars
  del servidor. No exponen nada. Solo verificá, si rolean la key, que
  `SUPABASE_SERVICE_KEY` esté actualizada (los afecta a todos por igual).
- `registro.html`, `perfil.html`, `pago-*.html`: usan la **anon key**, que es
  pública por diseño y no es un problema. No hay que tocarlas por seguridad.

---

## Pendiente anotado (no urgente)

Para subir un escalón más de seguridad en el futuro: mover el login del admin
a Supabase Auth con un claim de rol 'admin' y validar el JWT en `api/admin.js`,
en lugar de una contraseña compartida. Suficiente lo actual para el equipo
chico; lo dejamos para más adelante.
