# Guía de usuario de MAPI

Esta guía explica MAPI Desktop desde el punto de vista del usuario. Persona A,
Persona B, Hijo 1 e Hijo 2 son nombres genéricos para los integrantes del hogar.

## 1. Primer inicio

MAPI inicia un motor financiero local y abre el resumen. Una instalación nueva usa
inglés por defecto. El control **EN/ES** cambia el idioma y el botón de sol/luna cambia
el tema. Ambas elecciones quedan guardadas.

Antes de ingresar datos reales:

1. Creá las cuentas del hogar.
2. Creá o adaptá las categorías.
3. Configurá los tipos de cambio.
4. Generá un respaldo manual después de la configuración inicial.

## 2. Resumen

El resumen muestra para el mes seleccionado el patrimonio consolidado en CAD, los
saldos en cada moneda, ingresos, gastos, ahorro, cuentas activas, avance del
presupuesto, actividad reciente y elementos que requieren atención.

USD y UYU solo se convierten cuando existe una tasa. Si falta, MAPI lo informa en vez
de inventar una conversión.

## 3. Cuentas

Hay cuentas corrientes, de ahorro, efectivo, tarjetas e inversiones. Cada cuenta tiene
una moneda y un propietario genérico: Persona A, Persona B, Conjunta u Hogar.

En cuentas comunes:

```text
saldo actual = saldo inicial + movimientos registrados
```

En inversiones:

```text
valor total = efectivo disponible + valor de las posiciones
```

Archivar quita la cuenta de los totales actuales sin perder el historial. Eliminar es
permanente y borra sus registros dependientes.

## 4. Movimientos y transferencias

Los gastos son negativos y los ingresos positivos. Una transferencia interna crea una
salida en la cuenta de origen y una entrada vinculada en la cuenta de destino. Los
pagos de tarjetas deben cargarse como transferencias para no duplicar gastos.

Los filtros permiten buscar por cuenta, tipo, categoría y texto.

## 5. Categorías y reglas

Las categorías de ingreso y gasto están separadas. Una categoría padre con hijos solo
agrupa y no puede seleccionarse. Las reglas pueden buscar por descripción o comercio
con Empieza con, Contiene o Es igual a. También pueden restringirse por monto, moneda,
cuenta y tipo. La prioridad más baja se evalúa primero.

## 6. Importación y revisión inteligente

MAPI admite CSV, OFX y QFX. Revisá siempre la vista previa, la cuenta, la moneda, los
signos y las fechas. La deduplicación considera cuenta, fecha, monto, descripción e
identificador externo cuando existe.

La revisión inteligente agrupa movimientos parecidos para categorizar uno, aplicar a
todo el grupo, crear una regla o eliminar registros. Los PDF no se importan
directamente.

## 7. Programados

Los recurrentes pueden ser semanales, quincenales, mensuales o anuales. Cada aparición
queda pendiente hasta confirmarla u omitirla. Al confirmar se puede vincular un
movimiento ya importado o crear uno nuevo. Los pendientes influyen en las proyecciones
pero no cambian saldos.

## 8. Presupuesto

El presupuesto anual se compone de conceptos mensuales. Los ingresos y gastos deben
tener una categoría asignable y pueden restringirse a una persona o cuenta.

MAPI compara proyectado, máximo opcional y real, mostrando variación y porcentaje. Un
mes puede copiarse a una selección de meses; los meses no seleccionados quedan
intactos.

## 9. Inversiones

El efectivo disponible se mantiene separado de las posiciones:

```text
valor posición = cantidad × precio actual
ganancia no realizada = valor posición − cantidad × costo promedio
total cuenta = efectivo disponible + posiciones
```

Verificá símbolo, mercado, moneda, fecha y fuente del precio. El rebalanceo usa solo
efectivo excedente; no recomienda ventas ni calcula impuestos.

## 10. Límites de contribución

Se pueden registrar TFSA y RRSP por persona y RESP por beneficiario. MAPI muestra
aportes, disponible y porcentaje. Estos valores deben conciliarse con los registros
oficiales.

## 11. Análisis

Incluye proyección de caja, historial patrimonial, disponible para gastar, asignación
de inversiones, rendimiento y simulaciones. Las simulaciones no modifican datos. Las
proyecciones suelen usar la tasa de cambio más reciente; los análisis históricos deben
interpretarse con tasas apropiadas para cada fecha.

## 12. Retiro

Se configuran edades, gasto anual deseado en dólares actuales, aportes, ingresos
pasivos, pensiones, tasa de retiro, retorno real y edad objetivo. El resultado es
educativo: no modela completamente impuestos, orden de retiros, riesgo de secuencia ni
cambios legislativos. Compará CPP y OAS con fuentes oficiales.

## 13. Información

Las fichas guardan notas que no afectan los cálculos. No deben usarse para almacenar
contraseñas ni documentos secretos.

## 14. Respaldos

MAPI crea copias diarias y una copia de seguridad antes de restaurar. También permite
exportar JSON, descargar la base completa, revisar el historial y restaurar un respaldo
compatible. Conservá al menos una copia fuera de la Mac y cifrala si la subís a una
nube.

## 15. Problemas frecuentes

- Si un total no cierra, revisá moneda, tasa, efectivo, posiciones, saldo inicial y
  archivado.
- Si el real del presupuesto es cero, revisá categoría, tipo, moneda, propietario,
  cuenta y fecha.
- Si un programado vence, confirmalo, vinculalo u omitilo.
- Si falta un precio, verificá símbolo, mercado, moneda y red; podés cargarlo manual.

## Aviso

MAPI es una herramienta de registro y proyección educativa. No brinda asesoramiento
financiero, fiscal, contable, legal ni de inversión.
