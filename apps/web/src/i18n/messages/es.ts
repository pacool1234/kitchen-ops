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
      "Las cuentas de dirección necesitan una app de autenticación (por ejemplo, Google Authenticator, Microsoft Authenticator o 1Password). Confirma tu contraseña para empezar.",
    password: "Contraseña",
    continue: "Continuar",
    wrongPassword: "La contraseña no es correcta.",
    unexpectedAnswer:
      "El servidor ha respondido algo inesperado. Inténtalo de nuevo.",
    scan: "Escanea este código con tu app de autenticación:",
    qrAlt: "Código QR para tu app de autenticación",
    manualKey: "O escribe esta clave en la app:",
    backupTitle: "Códigos de respaldo.",
    backupText:
      "Cada uno sirve una vez si pierdes el móvil. Guárdalos ahora en un lugar seguro: no se vuelven a mostrar.",
    code: "Código de la app",
    submit: "Activar la verificación",
  },
  products: {
    title: "Productos",
    loading: "Cargando…",
    empty: "Todavía no hay productos.",
    loadFailed:
      "No se han podido cargar los productos. Comprueba la conexión y recarga la página.",
    signOut: "Cerrar sesión",
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
