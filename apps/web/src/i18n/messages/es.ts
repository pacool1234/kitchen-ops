// Every string the interface shows, in Spanish (es-ES), the default language (#86). This file is
// the source: en.ts must have exactly the same keys, and the typechecker refuses it otherwise.
// vue-i18n syntax: `{name}` is a placeholder; `@`, `|`, `{` and `}` are special, so a literal one
// must be written `{'@'}`.

export const es = {
  app: {
    name: "kitchen-ops",
  },
  language: {
    label: "Idioma",
    current: "Idioma: {language}",
    saveFailed: "No se ha podido guardar el idioma. Inténtalo de nuevo.",
  },
  roles: {
    counter: "Personal",
    office: "Oficina",
    owner: "Dirección",
  },
  units: {
    g: "gramos",
    ml: "mililitros",
    unit: "unidades",
  },
  signIn: {
    title: "Iniciar sesión",
    email: "Correo electrónico",
    password: "Contraseña",
    submit: "Entrar",
    codePrompt: "Introduce el código de 6 dígitos de tu app de autenticación.",
    code: "Código",
    verify: "Verificar",
    wrongPassword: "El correo o la contraseña no son correctos.",
    tooManyAttempts:
      "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
    invalidCode:
      "El código no es válido. Introduce el que muestra ahora tu app.",
  },
  twoFactor: {
    title: "Activar la verificación en dos pasos",
    intro:
      "Las cuentas de dirección entran con la contraseña y un código de una app de autenticación, como Google Authenticator, Microsoft Authenticator o 1Password.",
    stepPassword: "Confirma tu contraseña",
    password: "Contraseña",
    continue: "Continuar",
    wrongPassword: "La contraseña no es correcta.",
    unexpectedAnswer:
      "El servidor ha respondido algo inesperado. Inténtalo de nuevo.",
    stepScan: "Escanea el código con la app",
    qrAlt: "Código QR para tu app de autenticación",
    manualKey: "¿No puedes escanearlo? Escribe esta clave en la app:",
    copyKey: "Copiar la clave",
    keyCopied: "Clave copiada",
    stepBackup: "Guarda los códigos de respaldo",
    backupText:
      "Cada uno sirve una vez si pierdes el móvil. Guárdalos ahora en un lugar seguro: no se vuelven a mostrar.",
    copyCodes: "Copiar los códigos",
    codesCopied: "Códigos copiados",
    copyFailed: "No se ha podido copiar. Selecciónalo y cópialo a mano.",
    stepConfirm: "Escribe el código que muestra la app",
    code: "Código de la app",
    submit: "Activar la verificación",
  },
  home: {
    title: "Inicio",
    greeting: "Hola, {name}",
    intro: "¿Qué quieres hacer?",
  },
  products: {
    title: "Productos",
    caption: "Productos activos",
    name: "Nombre",
    baseUnit: "Unidad base",
    description:
      "Consulta los productos activos y la unidad en que se cuentan.",
    loadFailed:
      "No se han podido cargar los productos. Comprueba la conexión y vuelve a intentarlo.",
    empty: "Todavía no hay productos",
    emptyDescription: "Los productos aparecen aquí al darlos de alta.",
  },
  // The catalogue (#89): its sections, and what every list and form in it shares.
  catalogue: {
    title: "Catálogo",
    description: "Productos, proveedores y almacenes.",
    sections: "Secciones del catálogo",
    search: "Buscar",
    status: "Estado",
    statuses: {
      active: "Activos",
      inactive: "Inactivos",
      all: "Todos",
    },
    allTypes: "Todos",
    active: "Activo",
    inactive: "Inactivo",
    noMatches: "Nada coincide con la búsqueda",
    noMatchesDescription: "Prueba con otras palabras o cambia los filtros.",
    saveChanges: "Guardar cambios",
    saved: "Cambios guardados",
    saveFailed: "No se ha podido guardar. Revisa los campos marcados.",
    deactivate: "Desactivar",
    reactivate: "Reactivar",
    deactivateTitle: "¿Desactivar {name}?",
    deactivateText:
      "Deja de aparecer en las listas, pero su historial se conserva. Puedes reactivarlo cuando quieras.",
    cancel: "Cancelar",
    notFound: "No existe, o ya no está disponible.",
    loadFailed:
      "No se ha podido cargar. Comprueba la conexión y vuelve a intentarlo.",
    unsaved: {
      title: "¿Salir sin guardar?",
      text: "Los cambios que has hecho en este formulario se perderán.",
      stay: "Seguir editando",
      leave: "Salir sin guardar",
    },
  },
  storerooms: {
    title: "Almacenes",
    item: "Almacén",
    caption: "Almacenes",
    new: "Nuevo almacén",
    create: "Crear almacén",
    created: "Almacén creado",
    deactivated: "Almacén desactivado",
    reactivated: "Almacén reactivado",
    name: "Nombre",
    type: "Tipo",
    types: {
      cold_room: "Cámara frigorífica",
      dry_store: "Almacén seco",
      bar: "Barra",
    },
    nameTaken: "Ya hay un almacén con este nombre.",
    empty: "Todavía no hay almacenes",
    emptyDescription: "Da de alta los lugares donde guardas el género.",
  },
  suppliers: {
    title: "Proveedores",
    item: "Proveedor",
    caption: "Proveedores",
    new: "Nuevo proveedor",
    create: "Crear proveedor",
    created: "Proveedor creado",
    deactivated: "Proveedor desactivado",
    reactivated: "Proveedor reactivado",
    name: "Nombre",
    taxId: "NIF/CIF",
    taxIdHint: "Con o sin guiones y puntos: se guarda sin ellos.",
    taxIdValid: "{kind} válido",
    taxIdTaken: "Ya hay un proveedor con este NIF/CIF.",
    contact: "Contacto",
    contactName: "Persona de contacto",
    email: "Correo electrónico",
    phone: "Teléfono",
    empty: "Todavía no hay proveedores",
    emptyDescription: "Da de alta a quienes te venden.",
  },
  // The app's frame: navigation, page title, user menu (src/shell).
  shell: {
    skipToContent: "Saltar al contenido",
    mainNav: "Principal",
    breadcrumb: "Estás en",
    userMenu: "Menú de usuario",
    signOut: "Cerrar sesión",
  },
  // The components' own text (src/components/ui).
  ui: {
    optional: "opcional",
    loading: "Cargando…",
    close: "Cerrar",
    select: {
      placeholder: "Elige una opción",
    },
    combobox: {
      placeholder: "Escribe para buscar",
      empty: "No hay resultados.",
      toggle: "Mostrar las opciones",
    },
    number: {
      invalid: "Escribe un número, como 2,5.",
      tooManyDecimals: "Escribe como mucho {max} decimales.",
      negative: "No puede ser negativo.",
    },
    table: {
      pagination: "Páginas",
      page: "Página {page} de {pages}",
      showing: "{first}–{last} de {total}",
      previous: "Página anterior",
      next: "Página siguiente",
      empty: "Todavía no hay nada aquí.",
    },
    error: {
      title: "Algo ha fallado",
      retry: "Reintentar",
    },
    toast: {
      region: "Avisos",
      close: "Cerrar el aviso",
    },
  },
  // The API answers errors with a code (`{ error: "forbidden" }`); these are what the user reads.
  errors: {
    unauthorized: "Tu sesión ha terminado. Vuelve a iniciar sesión.",
    forbidden: "Tu rol no permite hacer esto.",
    two_factor_required:
      "Antes tienes que activar la verificación en dos pasos.",
    unexpected_response:
      "El servidor ha respondido algo inesperado. Inténtalo de nuevo.",
    invalid_input: "Revisa los campos marcados.",
    conflict: "Algún dato ya está en uso.",
    not_found: "No existe, o ya no está disponible.",
    unknown: "Algo ha fallado. Inténtalo de nuevo.",
    // Why a field was refused: one per code in packages/shared (FIELD_ERROR_CODES).
    fields: {
      required: "Este campo es obligatorio.",
      invalid: "No es válido.",
      too_short: "Es demasiado corto.",
      too_long: "Es demasiado largo.",
      too_small: "Es demasiado pequeño.",
      too_big: "Es demasiado grande.",
      unknown_field: "Este campo no se admite.",
      invalid_tax_id:
        "No es un NIF, NIE o CIF válido. Revisa la letra o el dígito de control.",
      taken: "Ya está en uso.",
      reserved: "Ese nombre está reservado.",
      not_found: "Ya no existe.",
      in_use: "Está en uso y no se puede cambiar así.",
      unknown_unit: "No es una de las unidades del producto.",
      not_whole_base_units: "No da un número entero de la unidad base.",
    },
  },
};

/** The shape every language's messages must have: the Spanish file's keys, each a string. */
export type Messages = typeof es;
