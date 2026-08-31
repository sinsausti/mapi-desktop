# MAPI

**Mi Administración de Patrimonio e Inversiones**
*Tu mapa financiero familiar.*

[English](README.md) · [Guía de usuario](docs/GUIA_USUARIO.es.md) · [Desarrollo](docs/DEVELOPMENT.md)

MAPI es una aplicación local de finanzas personales para administrar presupuesto,
flujo de caja, inversiones y proyecciones de retiro de un hogar. Nació para reemplazar
una planilla que se había vuelto difícil de mantener, sin entregar el control de los
datos financieros a un servicio externo.

## Por qué existe MAPI

Quería una aplicación de finanzas personales y control de inversiones que pudiera
adaptarse lo máximo posible a las necesidades de mi hogar, sin seguir dependiendo de
una planilla cada vez más compleja. Había comprado una aplicación que se acercaba
bastante a lo que buscaba, pero su registro de inversiones no tenía el nivel de detalle
que necesitaba para administrar mis cuentas y portafolios.

Les escribí a sus desarrolladores y les expliqué qué funciones de inversión consideraba
que complementarían muy bien el producto. Me dijeron que evaluarían la propuesta, pero
después de varios meses no recibí más novedades. En lugar de seguir esperando o
extendiendo la planilla, decidí construir la aplicación que necesitaba. Así surgió MAPI:
un sistema financiero local que reúne presupuesto, flujo de caja, inversiones y
planificación de largo plazo en un mismo lugar.

MAPI fue creada por mi: **Sebastian Insausti**.

## Plataforma

MAPI Desktop funciona actualmente en **Mac con Apple Silicon y macOS 13 o posterior**.
Es una aplicación nativa construida con Tauri. React ofrece la interfaz, FastAPI
funciona como un proceso local y SQLite conserva los datos en Application Support.

La compilación actual no soporta Windows, Linux ni Mac con procesador Intel.

> [!IMPORTANT]
> MAPI está diseñada actualmente para un hogar y un dispositivo. No tiene
> autenticación y no debe exponerse directamente a Internet.

## Funciones principales

- Cuentas CAD, USD y UYU con patrimonio consolidado en CAD.
- Presupuesto mensual y anual con comparación proyectado contra real.
- Ingresos, gastos, transferencias internas y movimientos recurrentes.
- Categorías jerárquicas y reglas deterministas de categorización.
- Importación CSV, OFX y QFX con vista previa y detección de duplicados.
- Cuentas de inversión, efectivo, posiciones, precios y rebalanceo.
- Límites de contribución TFSA, RRSP y RESP.
- Proyección de caja, salud financiera y simulación de escenarios.
- Proyección configurable de retiro con CPP, OAS, pensiones y BPS.
- Respaldos locales automáticos, restauración y exportación JSON.
- Interfaz bilingüe, modo claro y modo oscuro.

La [guía completa](docs/GUIA_USUARIO.es.md) explica cada sección y sus cálculos.

## Privacidad

La base Desktop se almacena en:

```text
~/Library/Application Support/ca.mapi.finance/mapi.sqlite3
```

Los precios y tipos de cambio pueden consultarse en proveedores públicos, pero los
movimientos financieros no se envían deliberadamente a esos proveedores. Consultá
[Privacidad](docs/PRIVACY.md) y [Seguridad](SECURITY.md).

## Descargar la aplicación para macOS

Las versiones preliminares para Apple Silicon se publican en la
[página de Releases](https://github.com/sinsausti/mapi-desktop/releases) cuando existe
un ZIP descargable. Extraé el ZIP y mové `MAPI.app` a la carpeta Aplicaciones.

Las compilaciones preliminares actuales tienen una firma de integridad ad-hoc, pero no
están firmadas con un certificado Apple Developer ni notarizadas. macOS puede bloquear
el primer inicio. Solo si confiás en este repositorio y en el archivo descargado, seguí
las instrucciones de Apple para
[abrir una app de un desarrollador no identificado](https://support.apple.com/es-lamr/guide/mac-help/mh40616/mac).
El archivo `.sha256` junto a cada ZIP permite verificar su integridad.

## Generar la aplicación para macOS

### 1. Instalar los requisitos

- Mac con Apple Silicon y macOS 13 o posterior.
- Xcode Command Line Tools.
- Node.js 20.19 o posterior, o 22.12 o posterior.
- Rust estable.
- Python 3.12 o posterior.

Verificá las herramientas:

```bash
xcodebuild -version
node --version
npm --version
rustc --version
cargo --version
python3 --version
```

Si faltan las herramientas de Xcode:

```bash
xcode-select --install
```

### 2. Clonar e instalar dependencias

```bash
git clone https://github.com/sinsausti/mapi-desktop.git
cd mapi-desktop
cd frontend
npm install
cd ..
```

### 3. Generar el backend local y la aplicación

```bash
./scripts/build-sidecar.sh
cd frontend
npm run desktop:build
```

El resultado principal queda en:

```text
frontend/src-tauri/target/release/bundle/macos/MAPI.app
```

La aplicación no queda firmada ni notarizada por defecto. La firma, notarización y
creación de un DMG son pasos de lanzamiento separados necesarios para distribuir un
instalador público confiable. Más detalles en
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Alcance regional actual

MAPI está optimizada actualmente para un hogar canadiense con vínculos financieros con
Uruguay. Incluye CAD, USD y UYU; cuentas TFSA, FHSA, RRSP y RESP; y retiro con CPP,
OAS, pensiones laborales y BPS. Los montos, límites, edades, tasas y supuestos se pueden
editar, pero estas listas todavía no son configurables desde la interfaz.

## Estado y licencia

MAPI todavía es software pre-1.0. Realizá un respaldo antes de actualizar. Sus
proyecciones son educativas y no constituyen asesoramiento financiero, fiscal ni de
inversión.

El código se publica bajo la [GNU Affero General Public License v3.0](LICENSE). La
atribución se encuentra en el [aviso de copyright](NOTICE).

Copyright © 2026 Sebastian Insausti.
