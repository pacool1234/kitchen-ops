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
    unknown: "Algo ha fallado. Inténtalo de nuevo.",
  },
};

/** The shape every language's messages must have: the Spanish file's keys, each a string. */
export type Messages = typeof es;
