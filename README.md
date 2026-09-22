# Punto Sandwich — sitio de pedidos + panel interno (Cloudflare Pages)

Este es el sitio de pedidos de Punto Sandwich con número de pedido correlativo real
y un panel interno (`/admin`) para que el local vea los pedidos entrando y les
cambie el estado. El retiro en el local y el delivery tienen procesos distintos:

- **Retiro en el local:** Preparando → Listo para retiro → Entregado
- **Delivery:** Preparando → Listo → Llevando el pedido → Entregado

En los dos casos el pedido tiene que pasar por cada paso en orden — el panel
solo deja avanzar al siguiente estado, nunca saltear uno ni volver para atrás
(esto se controla tanto en la pantalla como en el servidor, así que no hay
forma de forzarlo).

Antes de mandar el pedido, el cliente tiene que cargar su nombre y teléfono
(es obligatorio) — así el local lo puede ubicar igual si el mensaje de
WhatsApp por algún motivo no llega. Esos datos quedan guardados en el pedido
y se muestran arriba de todo en el panel, con el teléfono como link para
llamar directo desde el celular.

Para delivery, el cliente sigue marcando el punto en el mapa como antes (así
el sistema calcula la distancia y el costo de envío solo), pero el mensaje de
WhatsApp y el panel ya no muestran las coordenadas ni un link a Google Maps —
en cambio se le pide al cliente la dirección exacta (calle, altura, depto,
etc.), que ahora es obligatoria para delivery, y es lo que se manda junto con
el barrio, los km aproximados y el costo de envío.

Corre sobre **Cloudflare Pages**, que a diferencia de Vercel tiene un plan
gratuito que sí permite uso comercial (para un negocio real), sin límite de
tiempo y sin tarjeta.

## Qué hay en esta carpeta

- `public/index.html` — la página de pedidos que ven los clientes (menú,
  carrito, cálculo de envío, botón de WhatsApp). Al tocar "Pedir por
  WhatsApp" primero guarda el pedido (así consigue el número) y después abre
  WhatsApp con el mensaje.
- `public/admin.html` — el panel interno del local, protegido con clave.
- `functions/api/orders.js` y `functions/api/orders/[id].js` — el backend:
  reciben los pedidos nuevos y los cambios de estado, y hablan con la base de
  datos (Cloudflare D1, incluida gratis).

## Cómo publicarlo (una sola vez)

Todo con clicks, sin usar la terminal.

### 1. Crear la cuenta de Cloudflare

Andá a [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) y
creá una cuenta gratis con tu email. No pide tarjeta.

### 2. Crear la base de datos (D1)

1. En el panel de Cloudflare, andá a **Workers & Pages** → pestaña **D1 SQL
   Database** (o buscá "D1" en el buscador del panel).
2. Hacé clic en **Create Database**, ponele de nombre `punto-sandwich-db` y
   creala. No hace falta cargar ninguna tabla a mano — el sitio la crea sola
   la primera vez que se usa.

### 3. Subir el código a GitHub

1. Andá a [github.com](https://github.com) y creá una cuenta gratis si no
   tenés.
2. Hacé clic en **"New repository"**, ponele de nombre `punto-sandwich-web`
   y crealo (privado está bien).
3. En la página del repositorio vacío, usá el link **"uploading an existing
   file"** y arrastrá TODO el contenido de esta carpeta (`functions`,
   `public`, este `README.md`).
4. Confirmá el commit ("Commit changes").

### 4. Conectar el repositorio a Cloudflare Pages

1. En el panel de Cloudflare, andá a **Workers & Pages** → **Create** →
   pestaña **Pages** → **Connect to Git**.
2. Elegí el repositorio `punto-sandwich-web` y confirmá.
3. En la configuración de build: **Framework preset** = "None", **Build
   command** = (dejalo vacío), **Build output directory** = `public`.
4. Hacé clic en **Save and Deploy**. En un minuto vas a tener una URL como
   `punto-sandwich-web.pages.dev` — todavía no anda del todo porque falta
   conectar la base de datos y la clave del panel (siguientes pasos).

### 5. Conectar la base de datos al sitio

1. Dentro del proyecto ya creado en Pages, andá a **Settings** →
   **Bindings** (o **Functions** → **D1 database bindings**, según la
   versión del panel).
2. Agregá un binding: **Variable name** = `DB` (tiene que ser exactamente
   así, en mayúsculas), **D1 database** = `punto-sandwich-db` (la que
   creaste en el paso 2).
3. Guardá.

### 6. Poner la clave del panel interno

1. En el mismo proyecto, andá a **Settings** → **Environment variables**
   (o **Variables and Secrets**).
2. Agregá una variable `ADMIN_KEY` con la clave que quieras usar para
   entrar a `/admin` (algo que solo conozca el local).
3. Guardá.

### 7. Volver a desplegar

1. Andá a la pestaña **Deployments**, abrí el último despliegue y hacé clic
   en **Retry deployment** (para que tome la base de datos y la clave
   nuevas). Esperá a que el estado quede en verde.

Listo — el sitio ya está funcionando:

- **Pedidos (clientes):** `https://tu-proyecto.pages.dev/`
- **Panel interno (local):** `https://tu-proyecto.pages.dev/admin` — pide
  la clave que pusiste en `ADMIN_KEY`.

### Opcional: dominio propio

Si más adelante querés un dominio propio (por ejemplo
`pedidos.puntosandwich.com`), se agrega desde la pestaña **Custom domains**
del proyecto — avisame cuando llegues a ese punto.

## Cómo se actualiza más adelante

Cuando quiera pedirme un cambio, edito estos mismos archivos y te doy la
versión nueva para subir a GitHub (reemplazando los archivos que
cambiaron) — Cloudflare vuelve a desplegar solo en cuanto detecta el
cambio en el repositorio.

## Notas sobre la clave del panel

`ADMIN_KEY` es una protección simple para que un desconocido no entre a
`/admin` — no es un sistema de usuarios por persona. Para un local chico
alcanza, pero no la compartas públicamente. Si sospechás que se filtró,
cambiala en "Environment variables" y volvé a desplegar.
