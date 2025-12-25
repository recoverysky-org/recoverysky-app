import { Translations } from "./en"

const es: Translations = {
  common: {
    ok: "OK",
    cancel: "Cancelar",
    back: "Volver",
    logOut: "Cerrar sesión",
  },
  welcomeScreen: {
    postscript: "Probablemente esto no es lo que tu app luce.",
    readyForLaunch: "¡Tu app, casi lista para lanzar!",
    exciting: "(¡ohh, esto es emocionante!)",
    letsGo: "¡Vamos!",
  },
  errorScreen: {
    title: "¡Algo salió mal!",
    friendlySubtitle: "Esta es la pantalla que tus usuarios verán en producción cuando ocurra un error.",
    reset: "REINICIAR APP",
    traceTitle: "Error de la pila %{name}",
  },
  emptyStateComponent: {
    generic: {
      heading: "Tan vacío... tan triste",
      content: "Aún no hay datos. Intenta presionar el botón para refrescar o recargar la app.",
      button: "Intentemos de nuevo",
    },
  },
  errors: {
    invalidEmail: "Dirección de correo inválida.",
  },
  loginScreen: {
    logIn: "Iniciar sesión",
    enterDetails: "Ingresa tus datos abajo para desbloquear información secreta.",
    emailFieldLabel: "Correo",
    passwordFieldLabel: "Contraseña",
    emailFieldPlaceholder: "Ingresa tu correo electrónico",
    passwordFieldPlaceholder: "Contraseña súper secreta aquí",
    tapToLogIn: "¡Toca para iniciar sesión!",
    hint: "Pista: puedes usar cualquier correo y tu contraseña favorita :)",
  },
  mainNavigator: {
    homeTab: "Inicio",
    liveTab: "En vivo",
    meetingsTab: "Reuniones",
    scheduleTab: "Horario",
    profileTab: "Perfil",
  },
  homeScreen: {
    title: "Inicio",
    placeholder: "Contenido del panel próximamente",
  },
  meetingsScreen: {
    title: "Reuniones",
    placeholder: "Lista de reuniones próximamente",
  },
  scheduleScreen: {
    title: "Horario",
    placeholder: "Vista de horario próximamente",
  },
  liveScreen: {
    title: "En vivo ahora",
    noMeetings: "No hay reuniones en vivo ahora",
    lastRefresh: "Última verificación: {{time}}",
    joinMeeting: "Unirse",
    meetingCount: "{{count}} reuniones en vivo",
  },
  profileScreen: {
    title: "Perfil",
    placeholder: "Configuración del perfil próximamente",
  },
  devScreen: {
    title: "Herramientas de desarrollo",
    reportBugs: "Reportar errores",
    reactotron: "Enviar a Reactotron",
    androidReactotronHint: "Si no funciona, asegúrate de que Reactotron esté ejecutándose.",
    iosReactotronHint: "Si no funciona, asegúrate de que Reactotron esté ejecutándose.",
    macosReactotronHint: "Si no funciona, asegúrate de que Reactotron esté ejecutándose.",
    webReactotronHint: "Si no funciona, asegúrate de que Reactotron esté ejecutándose.",
    windowsReactotronHint: "Si no funciona, asegúrate de que Reactotron esté ejecutándose.",
  },
}

export default es
